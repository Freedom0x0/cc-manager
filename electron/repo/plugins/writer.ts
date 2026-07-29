/**
 * electron/repo/plugins/writer.ts — v5 wave-2 Plugins 配置写入
 *
 * createPlugin / updatePlugin / deletePlugin 都改 ~/.claude/plugins/<name>/
 * 子目录。create 写 plugin.json(JSON 配置文件,严格 schema);update 读 → 改
 * → 写(原子写);delete rm -rf 整个子目录(不可恢复,UI 必须 Modal.confirm)。
 *
 * 原子写策略:同 hooks/writer.ts 写法 — 写 tmp 文件 → rename 替换。失败回滚:
 * tmp 文件若残留则 unlink。parent 目录不存在则 mkdir -p(避免首次写入 ENOENT)。
 *
 * enabled 状态**不**写到 plugin.json(那是 state.ts 的 KV 表职责)— D6
 * 决策延伸:UI toggle 不能污染原文件。
 *
 * Schema 严格校验(必填 name/version/description)— wave-2-spec §2.3:
 * - name:非空字符串(主键,文件名)
 * - version:非空字符串(用户应填 semver,如 '1.0.0',writer 不强制 semver regex;
 *   只校验非空 — Simplicity First,允许 '1' / '0.1' 等简化形式)
 * - description:非空字符串
 * - author / dependencies / entry:可选
 *
 * 缺必填字段时 throw(给用户明确反馈,**不 silent return null** — 任务硬规则)。
 *
 * 容错:
 * - createPlugin name 重复 → 抛错(pluginDir 已存在)
 * - updatePlugin / deletePlugin name 不存在 → 抛错
 *
 * 跨平台:pluginsDir 参数允许测试注入 fixture 路径 — CLAUDE.md §13 D10。
 */

import { writeFile, rename, unlink, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { defaultPluginsDir, readPluginFile } from './scanner';
import type { PluginCreateInput, PluginUpdatePatch } from './types';

/**
 * 严格 schema 校验 — 必填 name/version/description 非空字符串。
 * 缺必填字段抛错(任务硬规则:不 silent return null)。
 */
function validatePluginInput(input: {
  name?: unknown;
  version?: unknown;
  description?: unknown;
}): void {
  if (typeof input.name !== 'string' || input.name.length === 0) {
    throw new Error('Plugin: missing required field "name"');
  }
  if (typeof input.version !== 'string' || input.version.length === 0) {
    throw new Error('Plugin: missing required field "version"');
  }
  if (typeof input.description !== 'string' || input.description.length === 0) {
    throw new Error('Plugin: missing required field "description"');
  }
}

function resolvePath(pluginsDir?: string): string {
  return pluginsDir ?? defaultPluginsDir();
}

/**
 * 原子写 plugin.json:写 tmp → rename 替换。失败回滚:tmp 文件若残留则 unlink。
 * parent 目录不存在则 mkdir -p(createPlugin 首次创建子目录时需要)。
 */
async function atomicWriteJson(
  config: Record<string, unknown>,
  filePath: string
): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true });
  const tmp = filePath + `.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
    await rename(tmp, filePath);
  } catch (e) {
    try {
      if (existsSync(tmp)) await unlink(tmp);
    } catch {
      /* swallow */
    }
    throw e;
  }
}

/** 从 PluginCreateInput / PluginUpdatePatch 提取可写入的字段 */
function extractMeta(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof input.version === 'string') out.version = input.version;
  if (typeof input.description === 'string') out.description = input.description;
  if (typeof input.author === 'string') out.author = input.author;
  if (Array.isArray(input.dependencies)) out.dependencies = input.dependencies;
  if (typeof input.entry === 'string') out.entry = input.entry;
  return out;
}

/**
 * 新建 ~/.claude/plugins/<name>/plugin.json + 子目录。
 * - 缺必填字段抛错(strict schema validation)
 * - name 重复(pluginDir 已存在)抛错
 */
export async function createPlugin(
  input: PluginCreateInput,
  pluginsDir?: string
): Promise<void> {
  validatePluginInput(input);
  const dir = resolvePath(pluginsDir);
  const pluginDir = join(dir, input.name);
  if (existsSync(pluginDir)) {
    throw new Error(`Plugin "${input.name}" already exists`);
  }
  await mkdir(pluginDir, { recursive: true });
  // 写入顺序:必填字段先,可选字段按字母序(JSON.stringify 已经按插入序,无所谓)
  const config: Record<string, unknown> = {
    name: input.name,
    version: input.version,
    description: input.description,
  };
  if (input.author) config.author = input.author;
  if (input.dependencies) config.dependencies = input.dependencies;
  if (input.entry) config.entry = input.entry;
  await atomicWriteJson(config, join(pluginDir, 'plugin.json'));
}

/**
 * 修改 ~/.claude/plugins/<name>/plugin.json。name 不存在抛错。
 * 缺必填字段抛错(stop-validation)。
 * patch 字段策略:
 *   - version / description:undefined 不动,空字符串抛错(stop-validation)
 *   - author:undefined 不动;空字符串 = 清空该字段
 *   - dependencies:undefined 不动;空数组 = 清空
 *   - entry:同 author
 */
export async function updatePlugin(
  name: string,
  patch: PluginUpdatePatch,
  pluginsDir?: string
): Promise<void> {
  // patch 不能把必填字段清空成空字符串(防 stop-validation)
  if (patch.version !== undefined) {
    if (typeof patch.version !== 'string' || patch.version.length === 0) {
      throw new Error('Plugin: version must be non-empty string');
    }
  }
  if (patch.description !== undefined) {
    if (typeof patch.description !== 'string' || patch.description.length === 0) {
      throw new Error('Plugin: description must be non-empty string');
    }
  }

  const file = await readPluginFile(name, pluginsDir);
  if (!file) {
    throw new Error(`Plugin "${name}" not found`);
  }
  // 读到的内容做 deep clone 防污染
  const config: Record<string, unknown> = JSON.parse(JSON.stringify(file.content));

  if (patch.version !== undefined) config.version = patch.version;
  if (patch.description !== undefined) config.description = patch.description;
  if (patch.author !== undefined) {
    if (patch.author) config.author = patch.author;
    else delete config.author;
  }
  if (patch.dependencies !== undefined) {
    if (patch.dependencies.length > 0) config.dependencies = patch.dependencies;
    else delete config.dependencies;
  }
  if (patch.entry !== undefined) {
    if (patch.entry) config.entry = patch.entry;
    else delete config.entry;
  }

  await atomicWriteJson(config, join(file.dir, 'plugin.json'));
}

/**
 * 删除 ~/.claude/plugins/<name>/ 整个子目录(rm -rf)。
 * name 不存在(pluginDir 不存在)抛错。
 * 不可恢复 — UI 必须 Modal.confirm 二次确认。
 */
export async function deletePlugin(name: string, pluginsDir?: string): Promise<void> {
  const dir = resolvePath(pluginsDir);
  const pluginDir = join(dir, name);
  if (!existsSync(pluginDir)) {
    throw new Error(`Plugin "${name}" not found`);
  }
  await rm(pluginDir, { recursive: true, force: true });
}

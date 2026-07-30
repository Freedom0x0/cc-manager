/**
 * electron/repo/plugins/writer.ts — v5 wave-2 Plugins 配置写入
 *
 * 2026-07-30 重写:从假设的"`<name>/plugin.json` 目录"改为实际
 * `~/.claude/plugins/installed_plugins.json` 单文件。
 *
 * createPlugin:在实际 Claude Code 中,plugin 是从 marketplace 装的(需要 git clone
 * + metadata),本应用**不实际**安装新 plugin。createPlugin 仅作 UI 占位
 * 入口(允许用户添加本地已有 plugin 到 installed_plugins.json,跟手动编辑
 * 效果一致)。
 *
 * updatePlugin:允许更新 scope 与 version(其他字段不暴露修改)。enabled
 * 状态**不**写 installed_plugins.json(那是 state.ts 的 KV 表职责)— D6 决策延伸。
 *
 * deletePlugin:从 installed_plugins.json 移除条目。**不** rm -rf installPath
 * (那是 marketplace 的 git clone,删了用户会重装);仅删 JSON 条目。
 *
 * 原子写策略:同 hooks/writer.ts 写法 — 写 tmp 文件 → rename 替换。失败回滚。
 */

import { writeFile, rename, unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { defaultInstalledPluginsPath } from './scanner';
import type { PluginCreateInput, PluginUpdatePatch } from './types';

function resolvePath(filePath?: string): string {
  return filePath ?? defaultInstalledPluginsPath();
}

/**
 * 读 installed_plugins.json 完整内容。文件不存在返空结构。
 */
async function readInstalledFile(
  filePath: string
): Promise<{ version: number; plugins: Record<string, unknown[]> }> {
  if (!existsSync(filePath)) return { version: 2, plugins: {} };
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 2,
    plugins:
      typeof parsed.plugins === 'object' && parsed.plugins !== null
        ? (parsed.plugins as Record<string, unknown[]>)
        : {},
  };
}

/**
 * 原子写 installed_plugins.json:写 tmp → rename 替换。失败回滚。
 */
async function atomicWriteJson(
  config: object,
  filePath: string
): Promise<void> {
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

function validateCreateInput(input: PluginCreateInput): void {
  if (typeof input.fullName !== 'string' || input.fullName.length === 0) {
    throw new Error('Plugin: missing required field "fullName"');
  }
  if (typeof input.installPath !== 'string' || input.installPath.length === 0) {
    throw new Error('Plugin: missing required field "installPath"');
  }
  if (typeof input.version !== 'string' || input.version.length === 0) {
    throw new Error('Plugin: missing required field "version"');
  }
  if (input.scope !== 'user' && input.scope !== 'project') {
    throw new Error('Plugin: scope must be "user" or "project"');
  }
}

/**
 * 新增 plugin 到 installed_plugins.json。
 * - fullName 重复 → 抛错
 * - 缺必填字段 → 抛错
 */
export async function createPlugin(
  input: PluginCreateInput,
  filePath?: string
): Promise<void> {
  validateCreateInput(input);
  const path = resolvePath(filePath);
  const data = await readInstalledFile(path);
  if (data.plugins[input.fullName]) {
    throw new Error(`Plugin "${input.fullName}" already exists`);
  }
  const now = new Date().toISOString();
  data.plugins[input.fullName] = [
    {
      scope: input.scope,
      installPath: input.installPath,
      version: input.version,
      installedAt: now,
      lastUpdated: now,
      gitCommitSha: '',
    },
  ];
  await atomicWriteJson(data, path);
}

/**
 * 更新 plugin 的 scope 与 version。fullName 不存在抛错。
 */
export async function updatePlugin(
  fullName: string,
  patch: PluginUpdatePatch,
  filePath?: string
): Promise<void> {
  const path = resolvePath(filePath);
  const data = await readInstalledFile(path);
  const versions = data.plugins[fullName];
  if (!versions || versions.length === 0) {
    throw new Error(`Plugin "${fullName}" not found`);
  }
  // 改最新 version
  const latest = versions[versions.length - 1] as Record<string, unknown>;
  if (patch.scope !== undefined) {
    if (patch.scope !== 'user' && patch.scope !== 'project') {
      throw new Error('Plugin: scope must be "user" or "project"');
    }
    latest.scope = patch.scope;
  }
  if (patch.version !== undefined) {
    if (typeof patch.version !== 'string' || patch.version.length === 0) {
      throw new Error('Plugin: version must be non-empty string');
    }
    latest.version = patch.version;
  }
  latest.lastUpdated = new Date().toISOString();
  await atomicWriteJson(data, path);
}

/**
 * 从 installed_plugins.json 移除 plugin。**不**删 installPath 目录。
 * fullName 不存在抛错。不可恢复 — UI 必须 Modal.confirm 二次确认。
 */
export async function deletePlugin(
  fullName: string,
  filePath?: string
): Promise<void> {
  const path = resolvePath(filePath);
  const data = await readInstalledFile(path);
  if (!data.plugins[fullName]) {
    throw new Error(`Plugin "${fullName}" not found`);
  }
  delete data.plugins[fullName];
  await atomicWriteJson(data, path);
}

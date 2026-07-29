/**
 * electron/repo/plugins/scanner.ts — v5 wave-2 Plugins 配置扫描器
 *
 * 读 ~/.claude/plugins/<name>/plugin.json → 注入 enabled(KV 表)→ 返 Plugin[]。
 * 存的是**目录**(同 Skill 模式,但 Skill 用 .md frontmatter,Plugin 用 JSON)。
 *
 * JSON 解析:依赖 plugin.json schema 严格校验(必填 name/version/description)。
 * schema 校验在 writer.ts 的 validatePluginInput,scanner 只容忍"非破坏性
 * 解析失败"(JSON 损坏 / 缺必填字段 → 跳过该目录,不抛错)— 读路径宽容、
 * 写路径严格(防止 create 脏数据进入)。
 *
 * 容错:
 * - pluginsDir 不存在 → 返 [](prd §1 边界 case)
 * - 子目录内无 plugin.json → 跳过该目录(不报错)
 * - 单 plugin.json read 失败 / JSON 损坏 → 跳过(stray 文件不污染列表)
 * - plugin.json 缺必填字段 → 跳过(读路径宽容,抛错发生在 create/update)
 *
 * 路径注入:pluginsDir 参数允许测试注入 fixture 路径(避免碰真实
 * ~/.claude/plugins);生产调用方传 defaultPluginsDir() —
 * CLAUDE.md §13 D8 + D10。
 */

import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { DB } from '../../db/connection';
import { getEnabled } from './state';
import type { Plugin } from './types';

/** 默认生产路径 ~/.claude/plugins。测试通过 pluginsDir 参数覆盖。 */
export function defaultPluginsDir(): string {
  return join(homedir(), '.claude', 'plugins');
}

/**
 * 读 ~/.claude/plugins/<name>/plugin.json → 注入 enabled → 返 Plugin[]。
 * pluginsDir 不存在或空目录返 []。
 *
 * @param db 已 initDB 的 SQLite handle(读 enabled KV)
 * @param pluginsDir 可选:注入 fixture 路径(测试用);默认走 ~/.claude/plugins
 */
export async function listPlugins(db: DB, pluginsDir?: string): Promise<Plugin[]> {
  const dir = pluginsDir ?? defaultPluginsDir();
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = await readdir(dir, { withFileTypes: true })
      .then((d) => d.filter((e) => e.isDirectory()).map((e) => e.name))
      .catch(() => []);
  } catch {
    return [];
  }
  const out: Plugin[] = [];
  for (const name of entries) {
    const pluginDir = join(dir, name);
    const pluginFile = join(pluginDir, 'plugin.json');
    if (!existsSync(pluginFile)) continue;
    let data: Record<string, unknown>;
    try {
      const raw = await readFile(pluginFile, 'utf8');
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // 单文件读/解析失败 → 跳过(stray 文件不污染列表)
      continue;
    }
    // 缺必填字段 → 跳过(读路径宽容,不抛)
    const version = data.version;
    const description = data.description;
    if (typeof version !== 'string' || version.length === 0) continue;
    if (typeof description !== 'string' || description.length === 0) continue;

    const author = typeof data.author === 'string' ? data.author : undefined;
    const entry = typeof data.entry === 'string' ? data.entry : undefined;
    const dependencies = Array.isArray(data.dependencies)
      ? (data.dependencies as unknown[]).filter((d): d is string => typeof d === 'string')
      : undefined;

    out.push({
      name,
      path: pluginDir,
      version,
      description,
      author,
      entry,
      dependencies,
      enabled: getEnabled(db, name),
    });
  }
  return out;
}

/**
 * 单 plugin 查询。name 不存在返 null。
 */
export async function getPlugin(
  db: DB,
  name: string,
  pluginsDir?: string
): Promise<Plugin | null> {
  const list = await listPlugins(db, pluginsDir);
  return list.find((p) => p.name === name) ?? null;
}

/**
 * 取 plugin.json 原始内容(供 writer 读改写用)+ 目录路径。
 * name 不存在返 null。
 */
export async function readPluginFile(
  name: string,
  pluginsDir?: string
): Promise<{ dir: string; content: Record<string, unknown> } | null> {
  const dir = pluginsDir ?? defaultPluginsDir();
  const pluginDir = join(dir, name);
  const pluginFile = join(pluginDir, 'plugin.json');
  if (!existsSync(pluginFile)) return null;
  const raw = await readFile(pluginFile, 'utf8');
  return { dir: pluginDir, content: JSON.parse(raw) as Record<string, unknown> };
}

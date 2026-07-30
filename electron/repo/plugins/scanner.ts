/**
 * electron/repo/plugins/scanner.ts — v5 wave-2 Plugins 配置扫描器
 *
 * 读 ~/.claude/plugins/installed_plugins.json 单文件 → 解析
 * `plugins: Record<fullName, InstalledPluginVersion[]>` → 注入 enabled
 * (从 settings.json.enabledPlugins 读 — D10 决策,真停用)→ 返 Plugin[]。
 *
 * 2026-07-30 重写:原 scanner 假设 `<name>/plugin.json` 目录结构,实际 Claude Code
 * 用 installed_plugins.json 单文件。详见 wave-3 收尾时核对。
 *
 * 容错:
 * - installed_plugins.json 不存在 → 返 []
 * - 顶层 JSON 损坏 / 缺 plugins 字段 → 返 []
 * - 单 plugin 缺必填字段 → 跳过(读路径宽容)
 * - settings.json 不存在 → 视为 enabledPlugins = {} (默认全 enabled)
 *
 * 路径注入:`filePath` 参数允许测试注入 installed_plugins.json 路径;
 * `settingsPath` 注入 settings.json 路径(避免碰真实 ~/.claude/)—
 * CLAUDE.md §13 D8 + D10。
 */

import { readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { DB } from '../../db/connection';
import type {
  Plugin,
  InstalledPluginsFile,
  InstalledPluginVersion,
} from './types';

/** 默认生产路径 ~/.claude/plugins/installed_plugins.json。 */
export function defaultInstalledPluginsPath(): string {
  return join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
}

/** 默认 settings.json 路径(scanner 读 enabledPlugins 用) */
function defaultSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

/** 同步读 settings.json.enabledPlugins 字典;文件不存在返 {} */
function readEnabledPlugins(settingsPath?: string): Record<string, boolean> {
  const file = settingsPath ?? defaultSettingsPath();
  if (!existsSync(file)) return {};
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    const ep = parsed.enabledPlugins;
    if (ep && typeof ep === 'object' && !Array.isArray(ep)) {
      return ep as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

/** 解析 fullName(name@marketplace)→ {name, marketplace},无 @ 视为 name 全 */
function parseFullName(fullName: string): { name: string; marketplace: string } {
  const at = fullName.lastIndexOf('@');
  if (at < 0) return { name: fullName, marketplace: '' };
  return {
    name: fullName.slice(0, at),
    marketplace: fullName.slice(at + 1),
  };
}

/**
 * 校验单条 InstalledPluginVersion 必填字段,缺则返 null。
 */
function validateVersion(v: unknown): InstalledPluginVersion | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.scope !== 'string') return null;
  if (typeof o.installPath !== 'string') return null;
  if (typeof o.version !== 'string') return null;
  if (typeof o.installedAt !== 'string') return null;
  if (typeof o.lastUpdated !== 'string') return null;
  if (typeof o.gitCommitSha !== 'string') return null;
  return {
    scope: o.scope as 'user' | 'project',
    installPath: o.installPath,
    version: o.version,
    installedAt: o.installedAt,
    lastUpdated: o.lastUpdated,
    gitCommitSha: o.gitCommitSha,
  };
}

/**
 * 读 installed_plugins.json → 解析 → 注入 enabled(从 settings.json.enabledPlugins)
 * → 返 Plugin[]。文件不存在或 JSON 损坏返 []。同 plugin 多个 version 返**最新**
 * (lastUpdated 倒序)。
 *
 * @param db 已 initDB 的 SQLite handle(保留作未来扩展,本函数不再读 KV)
 * @param filePath 可选:注入 installed_plugins.json 路径(测试用)
 * @param settingsPath 可选:注入 settings.json 路径(测试用)
 */
export async function listPlugins(
  db: DB,
  filePath?: string,
  settingsPath?: string
): Promise<Plugin[]> {
  void db;
  const path = filePath ?? defaultInstalledPluginsPath();
  if (!existsSync(path)) return [];
  let data: InstalledPluginsFile;
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.plugins !== 'object' || parsed.plugins === null) return [];
    data = {
      version: typeof parsed.version === 'number' ? parsed.version : 2,
      plugins: parsed.plugins as Record<string, InstalledPluginVersion[]>,
    };
  } catch {
    return [];
  }

  const enabledPlugins = readEnabledPlugins(settingsPath);
  const out: Plugin[] = [];
  for (const [fullName, versions] of Object.entries(data.plugins)) {
    if (!Array.isArray(versions) || versions.length === 0) continue;
    // 多版本取 lastUpdated 最新
    const validVersions = versions
      .map(validateVersion)
      .filter((v): v is InstalledPluginVersion => v !== null);
    if (validVersions.length === 0) continue;
    validVersions.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
    const v = validVersions[0];
    const { name, marketplace } = parseFullName(fullName);
    // enabled 推导:settings.json.enabledPlugins[fullName] === true → enabled
    //                                === false → disabled
    //                                不存在 → 默认 true
    const explicit = enabledPlugins[fullName];
    out.push({
      fullName,
      name,
      marketplace,
      installPath: v.installPath,
      version: v.version,
      scope: v.scope,
      installedAt: v.installedAt,
      lastUpdated: v.lastUpdated,
      gitCommitSha: v.gitCommitSha,
      enabled: explicit === undefined ? true : explicit === true,
    });
  }
  return out;
}

/**
 * 单 plugin 查询。fullName 不存在返 null。
 */
export async function getPlugin(
  db: DB,
  fullName: string,
  filePath?: string,
  settingsPath?: string
): Promise<Plugin | null> {
  const list = await listPlugins(db, filePath, settingsPath);
  return list.find((p) => p.fullName === fullName) ?? null;
}

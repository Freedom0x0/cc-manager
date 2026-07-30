/**
 * electron/repo/plugins/state.ts — v5 wave-3 Plugins enabled 状态
 *
 * v5 wave-3 改造(2026-07-30 PRD real-disable):
 * 用户的 enabled toggle 状态**写真实文件** `~/.claude/settings.json` 的
 * `enabledPlugins[<fullName>]` 字段(PRD Goal 1 决策 — 插件启用态在
 * settings.json 而非 installed_plugins.json,后者只存 scope/installPath/
 * version/installedAt/lastUpdated/gitCommitSha,无 enabled)。
 *
 * mcp_server_state KV 表(plugin:enabled:<fullName>)仍保留作 cache +
 * profile_capture 读历史偏好。getEnabled 仍可从 KV 读(给 profile_capture
 * 快照用),但 listPlugins 不再以 KV 为准,而是读 settings.json.enabledPlugins。
 *
 * 路径注入:settingsPath 参数允许测试注入 fixture 路径(CLAUDE.md §13 D10)。
 */

import type { DB } from '../../db/connection';
import { setPluginEnabled as writeSettingsEnabled } from '../settings-writer';

const KEY_PREFIX = 'plugin:enabled:';

/**
 * 读 enabled 状态(从 KV 表)。**仅**给 profile_capture 用作"用户历史偏好"
 * 快照,不是 UI 真实状态(UI 真实状态 = settings.json.enabledPlugins)。
 *
 * 无 key 默认 true(全新 plugin 视为启用)。
 */
export function getEnabled(db: DB, fullName: string): boolean {
  const row = db
    .prepare('SELECT value FROM mcp_server_state WHERE key = ?')
    .get(KEY_PREFIX + fullName) as { value: string } | undefined;
  return row?.value !== 'false';
}

/**
 * 写真实 settings.json enabledPlugins[fullName] = enabled(主操作)。
 * 同时更新 KV 表作为 cache(供 profile_capture 读历史偏好)。
 *
 * 失败语义:写 settings.json 抛错 → 不写 KV 也不更新 UI(PRD AC-4)。
 */
export async function setEnabled(
  db: DB,
  fullName: string,
  enabled: boolean,
  settingsPath?: string
): Promise<void> {
  // 1. 写真实 settings.json(主操作,失败抛错)
  await writeSettingsEnabled(fullName, enabled, settingsPath);
  // 2. 写 KV 表(cache,失败不抛错 — 主操作已成功)
  try {
    db.prepare(
      'INSERT OR REPLACE INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?)'
    ).run(KEY_PREFIX + fullName, enabled ? 'true' : 'false', Date.now());
  } catch {
    /* KV 写失败不阻断主操作 */
  }
}

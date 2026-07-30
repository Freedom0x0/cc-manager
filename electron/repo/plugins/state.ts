/**
 * electron/repo/plugins/state.ts — v5 wave-2 Plugins 启用状态(KV 表)
 *
 * 跟 wave-1/2/3 其他模块一致:enabled 状态写到 mcp_server_state 表,key 前缀
 * 'plugin:enabled:<fullName>'。D6 决策延伸:不污染原文件(本模块原文件
 * installed_plugins.json 也不存 enabled)。
 */

import type { DB } from '../../db/connection';

const KEY_PREFIX = 'plugin:enabled:';

export function getEnabled(db: DB, fullName: string): boolean {
  const row = db
    .prepare('SELECT value FROM mcp_server_state WHERE key = ?')
    .get(KEY_PREFIX + fullName) as { value: string } | undefined;
  return row?.value !== 'false';
}

export function setEnabled(db: DB, fullName: string, enabled: boolean): void {
  db.prepare(
    'INSERT OR REPLACE INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?)'
  ).run(KEY_PREFIX + fullName, enabled ? 'true' : 'false', Date.now());
}

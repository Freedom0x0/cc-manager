/**
 * electron/repo/profiles/state.ts — Profile 状态共享
 *
 * 本模块的"state"不是 enabled 状态(那是各业务模块的 state.ts 职责),
 * 而是 profile_apply 事务化所需的 KV 备份/恢复。
 *
 * 备份策略(任务硬规则 — profile_apply 失败回滚):
 *   1. 备份前:SELECT 所有 key LIKE '...:enabled:...' → Map<key, value>
 *   2. 应用:ProfileConfig.enabled* → upsert 各 KV key
 *   3. 验证:读回各 enabledServers 检查 value === 'true'
 *   4. 失败:从备份恢复(upsert + delete 当前多出来的 key)
 *
 * 注意:profile_apply 故意**不**主动禁用 profile 没列出的 KV 项。
 * profile 只携带"当前启用的列表",不携带"应该禁用的列表"。简化语义:
 * apply 后,profile 列出的项 enabled=true,其他项保持原 KV 状态。
 */

import type { DB } from '../../db/connection';

/** KV 命名空间:所有 enabled* key 的 SQL LIKE pattern。v5 wave-3 修正(2026-07-30):
 * 原代码 'mcp:enabled:%' 但 mcp/state.ts 实际写 'enabled:'(无 mcp: 前缀),导致
 * 备份/恢复漏掉 MCP。改为 'enabled:%'(裸 prefix — MCP 实际写法)+ 其余 5
 * '<prefix>:enabled:%'。
 */
const ENABLED_PATTERN_BARE = 'enabled:%';
const ENABLED_PATTERN_PREFIXED = '%:enabled:%';

/**
 * 备份 mcp_server_state 表所有 enabled* 状态。返回 Map<key, value>。
 * v5 wave-3 修正:用 'enabled:%'(裸 prefix — MCP 实际写法)+ '%:enabled:%'
 * (其余 5 prefix 的写法)。原来只查 '%:enabled:%' 会漏掉 MCP 状态。
 */
export function backupEnabledStates(db: DB): Map<string, string> {
  const stmt = db.prepare(
    `SELECT key, value FROM mcp_server_state WHERE key LIKE ? OR key LIKE ?`
  );
  const rows = stmt.all(ENABLED_PATTERN_BARE, ENABLED_PATTERN_PREFIXED) as {
    key: string;
    value: string;
  }[];
  const out = new Map<string, string>();
  for (const row of rows) {
    out.set(row.key, row.value);
  }
  return out;
}

/** 恢复 enabled 状态 — 备份中有的 key 用备份值,没有的 key 删除。 */
export function restoreEnabledStates(db: DB, backup: Map<string, string>): void {
  const stmt = db.prepare(
    `SELECT key FROM mcp_server_state WHERE key LIKE ? OR key LIKE ?`
  );
  const currentKeys = (stmt.all(ENABLED_PATTERN_BARE, ENABLED_PATTERN_PREFIXED) as {
    key: string;
  }[]).map((r) => r.key);
  const upsert = db.prepare(
    "INSERT INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );
  const del = db.prepare("DELETE FROM mcp_server_state WHERE key = ?");
  const tx = db.transaction(() => {
    for (const [k, v] of backup) {
      upsert.run(k, v, Date.now());
    }
    for (const k of currentKeys) {
      if (!backup.has(k)) del.run(k);
    }
  });
  tx();
}
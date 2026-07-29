/**
 * electron/repo/commands/state.ts — Commands 模块 enabled 状态 KV 助手
 *
 * 复用 mcp_server_state 表(CLAUDE.md v5 D1 决策延伸):3 列 KV 模型
 * (key PRIMARY KEY / value / updated_at)通用,key 前缀隔离:
 *   - 'cmd:enabled:<name>' → 'true' / 'false' (用户 toggle)
 *
 * 注意:虽然表名是 mcp_server_state,但本质是带 key 前缀隔离的通用 KV
 * 命名空间。模块加得越多越能体现 D1 的"故意偏离 5 列模板"的价值 —
 * 加一个新的 KV 字段 = 加一个 key 前缀,不再加新表。
 */

import type { DB } from '../../db/connection';
import type { Statement } from 'better-sqlite3';

const STMT_CACHE = new WeakMap<
  DB,
  {
    select: Statement<[string]>;
    upsert: Statement<[string, string, number]>;
  }
>();

function stmts(db: DB) {
  let s = STMT_CACHE.get(db);
  if (!s) {
    s = {
      select: db.prepare("SELECT value FROM mcp_server_state WHERE key = ?"),
      upsert: db.prepare(
        "INSERT INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ),
    };
    STMT_CACHE.set(db, s);
  }
  return s;
}

/** 读 enabled 状态。无 key 默认 true(全新 command 视为启用) */
export function getEnabled(db: DB, name: string): boolean {
  const row = stmts(db).select.get(`cmd:enabled:${name}`) as { value: string | null } | undefined;
  if (!row || row.value === null) return true;
  return row.value === 'true';
}

/** 写 enabled 状态到 KV 表 */
export function setEnabled(db: DB, name: string, enabled: boolean): void {
  stmts(db).upsert.run(`cmd:enabled:${name}`, enabled ? 'true' : 'false', Date.now());
}

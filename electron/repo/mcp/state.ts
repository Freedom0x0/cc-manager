/**
 * electron/repo/mcp/state.ts — D6 决策落库的 KV 助手
 *
 * 跟 watcher-state.ts 同形:3 列 KV 表(mcp_server_state)上的 prepared
 * statement 函数集合。本文件只暴露**对外用得到**的最小 API:
 *
 * - getEnabled(db, name)     — 读 enabled 状态(无 key 默认 true)
 * - setEnabled(db, name, b)  — 写 enabled 状态
 * - getLastModified(db, name)— 读 last_modified ISO 字符串(无 key 返 null)
 * - setLastModified(db, name, iso) — 写 last_modified
 *
 * key 约定:'enabled:<name>' / 'last_modified:<name>'。
 * 本表**不**存真实 mcpServers 配置(那是 ~/.claude.json 的事)— D6 决策:
 * 用户的 toggle 是 UI 偏好,不能污染原配置文件。
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

/**
 * 读 enabled 状态。无 key 默认 true(全新 server 视为启用)— 与 listMcpServers
 * 返回初始 enabled=true 一致。
 */
export function getEnabled(db: DB, name: string): boolean {
  const row = stmts(db).select.get(`enabled:${name}`) as { value: string | null } | undefined;
  if (!row || row.value === null) return true;
  return row.value === 'true';
}

/** 写 enabled 状态到 KV 表。 */
export function setEnabled(db: DB, name: string, enabled: boolean): void {
  stmts(db).upsert.run(`enabled:${name}`, enabled ? 'true' : 'false', Date.now());
}

/** 读 last_modified ISO 字符串。无 key 返 null。 */
export function getLastModified(db: DB, name: string): string | null {
  const row = stmts(db).select.get(`last_modified:${name}`) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}

/** 写 last_modified ISO 字符串。 */
export function setLastModified(db: DB, name: string, iso: string): void {
  stmts(db).upsert.run(`last_modified:${name}`, iso, Date.now());
}

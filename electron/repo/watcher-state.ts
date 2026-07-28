/**
 * watcher-state.ts — D2 决策落库的 KV 助手
 *
 * 单值 KV 表(watcher_state)上的 4 个 prepared statement 函数。共用 Task 1
 * 建立的 3 列 schema(key PRIMARY KEY / value / updated_at),故意不写 ORM,
 * 不引 better-sqlite3 之外的新依赖。
 *
 * 4 个函数的语义分工:
 * - getState(db, key)      — 读 value,无 key 返 null
 * - setStatus(db, value)   — 写 status(单一 key='status',watcher 启动/空闲/错误状态)
 * - recordEvent(db, evt)   — 写 last_event(JSON 序列化,add/change/unlink)
 * - recordError(db, err)   — 写 last_error(err.message + stack 头)
 *
 * 见 electron/db/connection.ts SCHEMA 中 watcher_state 表定义。
 */

import type { DB } from '../db/connection';
import type { Statement } from 'better-sqlite3';

// 每个 db 实例首次调用时懒初始化 prepared statements,缓存到 db 对象的 Symbol key 上
// (避免模块级全局缓存导致多 db 串味)
const STMT_CACHE = new WeakMap<DB, {
  select: Statement<[string]>;
  upsert: Statement<[string, string, number]>;
}>();

function stmts(db: DB) {
  let s = STMT_CACHE.get(db);
  if (!s) {
    s = {
      select: db.prepare("SELECT value FROM watcher_state WHERE key = ?"),
      upsert: db.prepare(
        "INSERT INTO watcher_state (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ),
    };
    STMT_CACHE.set(db, s);
  }
  return s;
}

/**
 * 读 watcher_state 单值 KV。key 不存在返 null。
 *
 * @param db 已 initDB 的 SQLite handle
 * @param key 状态键
 * @returns value 字符串(原样返,类型可能是 JSON / 纯文本 / 数字字符串)
 */
export function getState(db: DB, key: string): string | null {
  const row = stmts(db).select.get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

/**
 * 写 watcher 整体状态到单一 key='status'。常用值:'starting' | 'idle' | 'error'。
 */
export function setStatus(db: DB, value: string): void {
  stmts(db).upsert.run('status', value, Date.now());
}

/**
 * 记录 chokidar 事件到 key='last_event'。evt 序列化为 JSON 字符串。
 */
export function recordEvent(
  db: DB,
  evt: { type: string; path?: string }
): void {
  stmts(db).upsert.run('last_event', JSON.stringify(evt), Date.now());
}

/**
 * 记录 watcher 错误到 key='last_error'。只取 message + 头 3 行 stack。
 */
export function recordError(db: DB, err: Error): void {
  const stackHead = (err.stack ?? '').split('\n').slice(0, 3).join('\n');
  const value = JSON.stringify({ message: err.message, stack: stackHead });
  stmts(db).upsert.run('last_error', value, Date.now());
}
/**
 * electron/repo/hooks/state.ts — Hooks 模块 enabled 状态
 *
 * v5 wave-3 改造(2026-07-30 PRD real-disable):
 * 用户 toggle "disable" = splice 移除该 hook 从 settings.json 的 hooks[<event>]
 * 数组(PRD 决策:Claude Code 不读 disabled 标记字段,只有"数组里存在 = 启用")。
 *
 * "enable" 不在本函数职责 — 重新加一个 hook 需要完整 HookEntry 信息
 * (matcher + command),那是 hooks/writer.ts:createHook 的职责。本 toggle 只
 * 承诺"disable" 路径,"enable" 通过 createHook 走 UI 显式创建流程。
 *
 * mcp_server_state KV 表(hook:enabled:<id>)仍保留作 cache +
 * profile_capture 读历史偏好。getEnabled 仍可从 KV 读(给 profile_capture
 * 快照用),但 listHooks 不再以 KV 为准,而是看 settings.json 数组存在性。
 *
 * 路径注入:settingsPath 参数允许测试注入 fixture 路径(CLAUDE.md §13 D10)。
 */

import type { DB } from '../../db/connection';
import type { Statement } from 'better-sqlite3';
import { setHookEnabled as writeSettingsHookSplice } from '../settings-writer';
import type { HookEvent } from './types';

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

/** 从 id (格式 `${event}-${index}`) 拆出 event + index。 */
function parseHookId(
  id: string,
  validEvents: readonly HookEvent[]
): { event: HookEvent; index: number } {
  const idx = id.lastIndexOf('-');
  if (idx < 0) throw new Error(`Hook id "${id}" malformed`);
  const event = id.slice(0, idx);
  const indexStr = id.slice(idx + 1);
  if (!validEvents.includes(event as HookEvent)) {
    throw new Error(`Hook id "${id}" has unknown event "${event}"`);
  }
  const index = Number.parseInt(indexStr, 10);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Hook id "${id}" has invalid index`);
  }
  return { event: event as HookEvent, index };
}

/**
 * 读 enabled 状态(从 KV 表)。**仅**给 profile_capture 用作"用户历史偏好"
 * 快照,不是 UI 真实状态(UI 真实状态 = settings.json 数组存在性)。
 *
 * 无 key 默认 true(全新 hook 视为启用)。
 */
export function getEnabled(db: DB, id: string): boolean {
  const row = stmts(db).select.get(`hook:enabled:${id}`) as { value: string | null } | undefined;
  if (!row || row.value === null) return true;
  return row.value === 'true';
}

/**
 * 写真实 settings.json — disable = splice 移除。
 * setEnabled(true) 抛错:enable 必须走 hooks/writer.ts:createHook 重新创建
 * (需要完整 HookEntry 信息)。
 *
 * settingsPath 必传(scanner 不传,scanner 是读路径);测试可通过 settingsPath
 * 注入 fixture。
 */
export async function setEnabled(
  db: DB,
  id: string,
  enabled: boolean,
  settingsPath: string,
  validEvents: readonly HookEvent[]
): Promise<void> {
  const { event, index } = parseHookId(id, validEvents);
  // 1. 写真实 settings.json(主操作,失败抛错)
  await writeSettingsHookSplice(event, index, enabled, settingsPath);
  // 2. 写 KV 表(cache,失败不抛错)
  try {
    stmts(db).upsert.run(`hook:enabled:${id}`, enabled ? 'true' : 'false', Date.now());
  } catch {
    /* KV 写失败不阻断主操作 */
  }
}

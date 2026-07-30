/**
 * electron/repo/mcp/state.ts — MCP enabled 状态管理
 *
 * v5 wave-3 改造(2026-07-30 PRD real-disable):
 * 用户的 enabled toggle 状态**写真实文件** `~/.claude/settings.json` 的
 * `disabledMcpjsonServers[]` 黑名单(PRD Question 2 决策)。scanner 读这个
 * 黑名单反推每个 server 的 enabled 状态。
 *
 * mcp_server_state KV 表仍保留(用作 cache + profile capture 用),但**不**
 * 是 UI 真实状态的真理。KV 在此作为 audit log 跟"用户希望状态"快照:
 * - getEnabled 仍可从 KV 读(给 profile_capture 用 — 它是历史快照)
 * - 但 listMcpServers 不再以 KV 为准,而是读 disabledMcpjsonServers
 *
 * 与 v5 wave-1 D6 决策的差异:之前为了"不污染原文件"把 enabled 隔离进 KV,
 * 但 Claude Code 不读 KV,导致假停用。PRD 决定:停用语义必须写到 Claude
 * Code 实际读取的字段(D10 决策)。
 *
 * 路径注入:settingsPath 参数允许测试注入 fixture 路径(CLAUDE.md §13 D10)。
 */

import type { DB } from '../../db/connection';
import type { Statement } from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { setMcpDisabled as writeSettingsDisabled } from '../settings-writer';

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
 * 读 enabled 状态(从 KV 表)。**仅**给 profile_capture 用作"用户历史偏好"
 * 快照,不是 UI 真实状态(UI 真实状态 = settings.json 的 disabledMcpjsonServers
 * 黑名单)。
 *
 * 无 key 默认 true(全新 server 视为启用) — 与 listMcpServers 返回初始
 * enabled=true 一致。
 */
export function getEnabled(db: DB, name: string): boolean {
  const row = stmts(db).select.get(`enabled:${name}`) as { value: string | null } | undefined;
  if (!row || row.value === null) return true;
  return row.value === 'true';
}

/**
 * 写真实 settings.json disabledMcpjsonServers 数组增删(主操作)。
 * 同时更新 KV 表作为 cache(供 profile_capture 读历史偏好)。
 *
 * 失败语义:写 settings.json 抛错 → 上层 IPC handler 不写 KV 也不更新 UI。
 * 这是 PRD §Acceptance criterion 4:原子写不破,UI 状态回滚。
 *
 * settingsPath 默认 settings-writer.defaultSettingsPath() (~/.claude/settings.json),
 * 测试可通过 settingsPath 注入 fixture。
 */
export async function setEnabled(
  db: DB,
  name: string,
  enabled: boolean,
  settingsPath?: string
): Promise<void> {
  // 1. 写真实 settings.json(主操作,失败抛错)
  await writeSettingsDisabled(name, !enabled, settingsPath);
  // 2. 写 KV 表(cache,失败不抛错 — 主操作已成功)
  try {
    stmts(db).upsert.run(`enabled:${name}`, enabled ? 'true' : 'false', Date.now());
  } catch {
    /* KV 写失败不阻断主操作 */
  }
}

/** 从 settings.json 的 disabledMcpjsonServers 数组反推 enabled。 */
export function isDisabledInSettings(name: string, settingsPath?: string): boolean {
  return getEnabledFromSettings(settingsPath).includes(name);
}

/**
 * 同步读 settings.json 的 disabledMcpjsonServers 数组(scanner 用)。
 * scanner 已 async,这里用 fs 同步是 OK 的;listMcpServers 一次只调一次。
 */
export function getEnabledFromSettings(settingsPath?: string): string[] {
  const file = settingsPath ?? join(homedir(), '.claude', 'settings.json');
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.disabledMcpjsonServers) ? parsed.disabledMcpjsonServers : [];
  } catch {
    return [];
  }
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

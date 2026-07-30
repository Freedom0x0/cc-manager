/**
 * electron/repo/sub-agents/state.ts — Sub-Agents 模块 enabled 状态
 *
 * v5 wave-3 改造(2026-07-30 PRD real-disable):
 * 用户的 enabled toggle = 改 ~/.claude/agents/<name>.md → <name>.md.disabled
 * (PRD 决策:Claude Code 不读 .disabled 后缀文件)。
 *
 * mcp_server_state KV 表(agent:enabled:<name>)仍保留作 cache +
 * profile_capture 读历史偏好。
 *
 * 路径注入:baseDir 参数允许测试注入 fixture 路径(CLAUDE.md §13 D10),
 * 默认走 settings-writer.defaultClaudeDir() → ~/.claude。
 */

import type { DB } from '../../db/connection';
import type { Statement } from 'better-sqlite3';
import { setDisabledSuffix as writeAgentsSuffix } from '../settings-writer';

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

export function getEnabled(db: DB, name: string): boolean {
  const row = stmts(db).select.get(`agent:enabled:${name}`) as { value: string | null } | undefined;
  if (!row || row.value === null) return true;
  return row.value === 'true';
}

export async function setEnabled(
  db: DB,
  name: string,
  enabled: boolean,
  baseDir?: string
): Promise<void> {
  await writeAgentsSuffix('agent', name, !enabled, baseDir);
  try {
    stmts(db).upsert.run(`agent:enabled:${name}`, enabled ? 'true' : 'false', Date.now());
  } catch {
    /* KV 写失败不阻断主操作 */
  }
}

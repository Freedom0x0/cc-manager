/**
 * electron/repo/skills/state.ts — Skills 模块 enabled 状态
 *
 * v5 wave-3 改造(2026-07-30 PRD real-disable):
 * 用户的 enabled toggle = 改 ~/.claude/skills/<name>/ 目录为 .disabled 后缀
 * (PRD 决策:Claude Code 不读 .disabled 后缀的 skill 目录,实测
 * `claude -p "/code-mentor 可用吗?"` → NO,/skills 不出现)。
 *
 * mcp_server_state KV 表(skill:enabled:<name>)仍保留作 cache +
 * profile_capture 读历史偏好。getEnabled 仍可从 KV 读,但 listSkills
 * 不再以 KV 为准,而是看 .disabled 后缀是否在。
 *
 * 路径注入:baseDir 参数允许测试注入 fixture 路径(CLAUDE.md §13 D10),
 * 默认走 settings-writer.defaultClaudeDir() → ~/.claude。
 */

import type { DB } from '../../db/connection';
import type { Statement } from 'better-sqlite3';
import { setDisabledSuffix as writeSkillsSuffix } from '../settings-writer';

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
 * 快照,不是 UI 真实状态(UI 真实状态 = 文件存在性 + .disabled 后缀)。
 */
export function getEnabled(db: DB, name: string): boolean {
  const row = stmts(db).select.get(`skill:enabled:${name}`) as { value: string | null } | undefined;
  if (!row || row.value === null) return true;
  return row.value === 'true';
}

/**
 * 写真实文件:disable = mv <name>/ → <name>.disabled/;enable = 反向。
 * 同时更新 KV 表作为 cache(供 profile_capture 读历史偏好)。
 *
 * 失败语义:写文件失败 → 不写 KV 也不更新 UI(PRD AC-4)。
 */
export async function setEnabled(
  db: DB,
  name: string,
  enabled: boolean,
  baseDir?: string
): Promise<void> {
  // 1. 写真实文件(主操作,失败抛错)
  await writeSkillsSuffix('skill', name, !enabled, baseDir);
  // 2. 写 KV 表(cache,失败不抛错)
  try {
    stmts(db).upsert.run(`skill:enabled:${name}`, enabled ? 'true' : 'false', Date.now());
  } catch {
    /* KV 写失败不阻断主操作 */
  }
}

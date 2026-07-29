/**
 * electron/repo/usage/scanner.ts — v5 wave-3 用量分析 只读聚合
 *
 * 用量分析模块是只读聚合,无 schema、无 state、无 writer。6 个 IPC handler
 * 全走这里,直接对 sessions / messages 表做 COUNT / SUM / GROUP BY 查询。
 *
 * 数据源约定:
 * - sessions 表:project_id / started_at / last_message_at / message_count
 * - messages 表:session_id / role / content / content_blocks (JSON 数组) / created_at
 * - messages.content_blocks 每个 element 形如
 *   { type: 'tool_use', name, input } | { type: 'text', text } |
 *   { type: 'thinking', thinking } | ...
 *
 * 性能:本任务接受 O(N) 聚合,30 天窗口 sessions 数通常 < 1000,不做缓存。
 * 风险预警 (RD §4):SQLite json_extract 走 JSON1 扩展,better-sqlite3 内置
 * 支持,无需额外加载。
 *
 * token 估算算法(任务硬规则 — Simplicity First):
 *   - 文本类 block (text / thinking):length(text) / 4
 *   - tool_use block:length(JSON.stringify(input)) / 4
 *   - tool_result / unknown:不计
 *   - 实际 token 数会偏差 50-100%,但用量分析的精度不需要精确
 */

import type { DB } from '../../db/connection';
import type {
  UsageSummary,
  UsageByProjectRow,
  UsageByDayRow,
  UsageByToolRow,
  SessionCost,
  SessionTimeline,
  SessionTimelineEntry,
} from './types';

/**
 * 估算单 message 的 token 数。
 * 走 JS 计算(更易读 + 易调),不走 json_extract 在 SQL 里算字符数。
 * 输入是已解析的 ContentBlock JSON,或 messages.content_blocks 列原文。
 */
function estimateTokensFromBlocksJson(contentBlocksJson: string | null, plainContent: string): number {
  // 文本 token:plain content 字符 / 4(粗估,英文 4 字符 ≈ 1 token)
  let chars = plainContent.length;
  if (contentBlocksJson) {
    try {
      const blocks = JSON.parse(contentBlocksJson);
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (!b || typeof b !== 'object') continue;
          if (b.type === 'text' && typeof b.text === 'string') {
            chars += b.text.length;
          } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
            chars += b.thinking.length;
          } else if (b.type === 'tool_use' && b.input !== undefined) {
            chars += JSON.stringify(b.input).length;
          }
          // tool_result / unknown 不计(过短 / 噪声)
        }
      }
    } catch {
      // 损坏的 JSON 不计 blocks,只算 plain content
    }
  }
  return Math.max(0, Math.floor(chars / 4));
}

/**
 * 单 message token 数(从 DB 查 content + content_blocks,JS 端估)。
 * 用 prepared statement 直接读单条 message,性能可接受。
 */
function tokenForMessage(db: DB, messageId: number): number {
  const row = db
    .prepare('SELECT content, content_blocks FROM messages WHERE id = ?')
    .get(messageId) as { content: string; content_blocks: string | null } | undefined;
  if (!row) return 0;
  return estimateTokensFromBlocksJson(row.content_blocks, row.content);
}

/**
 * 主聚合:totalSessions + totalMessages + totalTokens + totalDurationMs +
 * byProject + byDay + byTool。1 IPC 调用返 1 个 UsageSummary 对象。
 *
 * rangeDays 默认 30 — byDay 只统计最近 N 天的(老 sessions 仍计入
 * totalSessions / totalMessages / byProject 等全量指标)。
 */
export function usageSummary(db: DB, rangeDays: number = 30): UsageSummary {
  // 1. 全局计数
  const totalSessions = (db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE is_deleted = 0').get() as { c: number }).c;
  const totalMessages = (db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c;

  // 2. 总时长 = SUM(last_message_at - started_at),单位 ms
  const totalDurationRow = db
    .prepare(
      'SELECT COALESCE(SUM(last_message_at - started_at), 0) AS d FROM sessions WHERE is_deleted = 0'
    )
    .get() as { d: number };
  const totalDurationMs = totalDurationRow.d;

  // 3. totalTokens = 对每条 message 走 estimateTokensFromBlocksJson 求和
  //    全量 SUM,O(N),接受这个性能(RD 风险预警 §2)。
  let totalTokens = 0;
  const msgIter = db.prepare('SELECT id FROM messages').iterate() as Iterable<{ id: number }>;
  for (const row of msgIter) {
    totalTokens += tokenForMessage(db, row.id);
  }

  // 4. byProject:JOIN projects + sessions + messages COUNT,排除 archived projects
  const byProjectRows = db
    .prepare(
      `SELECT p.id AS projectId, p.name AS projectName,
              COUNT(DISTINCT s.session_id) AS sessions,
              COUNT(m.id) AS messages
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id AND s.is_deleted = 0
       LEFT JOIN messages m ON m.session_id = s.session_id
       WHERE p.is_archived = 0
       GROUP BY p.id
       ORDER BY messages DESC`
    )
    .all() as Array<{ projectId: number; projectName: string; sessions: number; messages: number }>;

  // byProject.tokens 单独算(每 session 的 token 加和)— 接受 N+1 查询,数据量小
  const byProject: UsageByProjectRow[] = byProjectRows.map((r) => {
    const sidRows = db
      .prepare('SELECT session_id FROM sessions WHERE project_id = ?')
      .all(r.projectId) as { session_id: string }[];
    let tokens = 0;
    if (sidRows.length > 0) {
      const placeholders = sidRows.map(() => '?').join(',');
      const mIter = db
        .prepare(`SELECT id FROM messages WHERE session_id IN (${placeholders})`)
        .iterate(...sidRows.map((s) => s.session_id)) as Iterable<{ id: number }>;
      for (const mr of mIter) tokens += tokenForMessage(db, mr.id);
    }
    return { ...r, tokens };
  });

  // 5. byDay:按 started_at GROUP BY date(UTC date string YYYY-MM-DD)
  //    rangeDays 只过滤 byDay,totalSessions / totalMessages 不受影响。
  const cutoffMs = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  const byDayRows = db
    .prepare(
      `SELECT date(started_at / 1000, 'unixepoch') AS day,
              COUNT(*) AS sessions
       FROM sessions
       WHERE started_at >= ? AND is_deleted = 0
       GROUP BY day
       ORDER BY day ASC`
    )
    .all(cutoffMs) as Array<{ day: string; sessions: number }>;
  // byDay 显示 message 数 + token 数(SUM 而非 COUNT)— 用范围过滤 messages.created_at
  const msgDayIter = db
    .prepare('SELECT id, created_at FROM messages WHERE created_at >= ?')
    .iterate(cutoffMs) as Iterable<{ id: number; created_at: number }>;
  const dayMap = new Map<string, { messages: number; tokens: number }>();
  for (const { day } of byDayRows) dayMap.set(day, { messages: 0, tokens: 0 });
  for (const mr of msgDayIter) {
    const day = new Date(mr.created_at).toISOString().slice(0, 10);
    const entry = dayMap.get(day) ?? { messages: 0, tokens: 0 };
    entry.messages += 1;
    entry.tokens += tokenForMessage(db, mr.id);
    dayMap.set(day, entry);
  }
  const byDay: UsageByDayRow[] = Array.from(dayMap.entries())
    .map(([date, v]) => ({ date, messages: v.messages, tokens: v.tokens }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 6. byTool:从 messages.content_blocks 提 tool_use.name,GROUP BY
  //    json_each 展开 JSON 数组 + json_extract 取 type 和 name
  const toolRows = db
    .prepare(
      `SELECT json_extract(value, '$.name') AS tool, COUNT(*) AS cnt
       FROM messages, json_each(messages.content_blocks)
       WHERE json_extract(value, '$.type') = 'tool_use'
       GROUP BY tool
       ORDER BY cnt DESC`
    )
    .all() as Array<{ tool: string | null; cnt: number }>;
  const byTool: UsageByToolRow[] = toolRows
    .filter((r) => r.tool !== null)
    .map((r) => ({ tool: String(r.tool), count: r.cnt }));

  return {
    totalSessions,
    totalMessages,
    totalTokens,
    totalDurationMs,
    byProject,
    byDay,
    byTool,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 单 session 详情:token + 工具列表 + 时长。
 */
export function getSessionCost(db: DB, sessionId: string): SessionCost | null {
  const row = db
    .prepare(
      `SELECT s.session_id AS sessionId, s.project_id AS projectId,
              p.name AS projectName,
              s.started_at AS startedAt, s.last_message_at AS lastMessageAt,
              s.message_count AS messageCount
       FROM sessions s
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.session_id = ?`
    )
    .get(sessionId) as
    | {
        sessionId: string;
        projectId: number;
        projectName: string | null;
        startedAt: number;
        lastMessageAt: number;
        messageCount: number;
      }
    | undefined;
  if (!row) return null;

  // tokens
  const mIter = db
    .prepare('SELECT id FROM messages WHERE session_id = ?')
    .iterate(sessionId) as Iterable<{ id: number }>;
  let tokens = 0;
  for (const mr of mIter) tokens += tokenForMessage(db, mr.id);

  // tools
  const toolRows = db
    .prepare(
      `SELECT json_extract(value, '$.name') AS tool, COUNT(*) AS cnt
       FROM messages, json_each(messages.content_blocks)
       WHERE json_extract(value, '$.type') = 'tool_use'
         AND messages.session_id = ?
       GROUP BY tool ORDER BY cnt DESC`
    )
    .all(sessionId) as Array<{ tool: string | null; cnt: number }>;
  const tools: UsageByToolRow[] = toolRows
    .filter((r) => r.tool !== null)
    .map((r) => ({ tool: String(r.tool), count: r.cnt }));

  return {
    sessionId,
    projectId: row.projectId,
    projectName: row.projectName ?? '(deleted project)',
    startedAt: row.startedAt,
    lastMessageAt: row.lastMessageAt,
    durationMs: row.lastMessageAt - row.startedAt,
    messageCount: row.messageCount,
    tokens,
    tools,
  };
}

/**
 * 单 session 时间线:逐 message 列表。
 */
export function getSessionTimeline(db: DB, sessionId: string): SessionTimeline | null {
  const row = db
    .prepare(
      `SELECT s.session_id AS sessionId, s.title, p.name AS projectName
       FROM sessions s
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.session_id = ?`
    )
    .get(sessionId) as { sessionId: string; title: string | null; projectName: string | null } | undefined;
  if (!row) return null;

  const entries: SessionTimelineEntry[] = (
    db
      .prepare(
        `SELECT uuid, role, content, created_at AS createdAt
         FROM messages WHERE session_id = ?
         ORDER BY created_at ASC`
      )
      .all(sessionId) as Array<{
        uuid: string;
        role: 'user' | 'assistant';
        content: string;
        createdAt: number;
      }>
  ).map((m) => ({
    uuid: m.uuid,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
  }));

  return {
    sessionId,
    projectName: row.projectName ?? '(deleted project)',
    title: row.title,
    entries,
  };
}

/**
 * 单 project 详情:同 byProject 单行,但额外给 sessions list 概要。
 * 当前实现 = byProject 单行 + 该项目 sessions 数 / messages 数 / tokens。
 */
export function getProjectBreakdown(db: DB, projectId: number): UsageByProjectRow | null {
  const row = db
    .prepare(
      `SELECT p.id AS projectId, p.name AS projectName,
              COUNT(DISTINCT s.session_id) AS sessions,
              COUNT(m.id) AS messages
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id AND s.is_deleted = 0
       LEFT JOIN messages m ON m.session_id = s.session_id
       WHERE p.id = ? AND p.is_archived = 0
       GROUP BY p.id`
    )
    .get(projectId) as { projectId: number; projectName: string; sessions: number; messages: number } | undefined;
  if (!row) return null;
  let tokens = 0;
  const mIter = db
    .prepare(
      `SELECT m.id FROM messages m
       JOIN sessions s ON s.session_id = m.session_id
       WHERE s.project_id = ?`
    )
    .iterate(projectId) as Iterable<{ id: number }>;
  for (const mr of mIter) tokens += tokenForMessage(db, mr.id);
  return { ...row, tokens };
}

/**
 * 按日聚合单独查询 — 仅 byDay。rangeDays 默认 30。
 */
export function getDailyBreakdown(db: DB, rangeDays: number): UsageByDayRow[] {
  const cutoffMs = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  const byDayRows = db
    .prepare(
      `SELECT date(started_at / 1000, 'unixepoch') AS day, COUNT(*) AS sessions
       FROM sessions
       WHERE started_at >= ? AND is_deleted = 0
       GROUP BY day ORDER BY day ASC`
    )
    .all(cutoffMs) as Array<{ day: string; sessions: number }>;
  const dayMap = new Map<string, { messages: number; tokens: number }>();
  for (const { day } of byDayRows) dayMap.set(day, { messages: 0, tokens: 0 });

  const msgDayIter = db
    .prepare('SELECT id, created_at FROM messages WHERE created_at >= ?')
    .iterate(cutoffMs) as Iterable<{ id: number; created_at: number }>;
  for (const mr of msgDayIter) {
    const day = new Date(mr.created_at).toISOString().slice(0, 10);
    const entry = dayMap.get(day) ?? { messages: 0, tokens: 0 };
    entry.messages += 1;
    entry.tokens += tokenForMessage(db, mr.id);
    dayMap.set(day, entry);
  }
  return Array.from(dayMap.entries())
    .map(([date, v]) => ({ date, messages: v.messages, tokens: v.tokens }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 工具频次 Top N(默认 10)。
 */
export function getTopTools(db: DB, limit: number = 10): UsageByToolRow[] {
  const toolRows = db
    .prepare(
      `SELECT json_extract(value, '$.name') AS tool, COUNT(*) AS cnt
       FROM messages, json_each(messages.content_blocks)
       WHERE json_extract(value, '$.type') = 'tool_use'
       GROUP BY tool
       ORDER BY cnt DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ tool: string | null; cnt: number }>;
  return toolRows
    .filter((r) => r.tool !== null)
    .map((r) => ({ tool: String(r.tool), count: r.cnt }));
}
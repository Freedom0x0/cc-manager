/**
 * electron/repo/usage/types.ts — v5 wave-3 用量分析 模块跨层共享类型
 *
 * 跨层复用约定(CLAUDE.md §5):electron 主进程不 import src/types.ts(主进程
 * 不能跑浏览器模块),所以 UsageSummary 实体类型在本文件定义,再由 src/types.ts
 * 同样形状地再声明一次。两边必须保持字段一致。
 *
 * 用量分析是**只读聚合模块**——没有 create / update / delete / toggle,
 * 全部 6 个 IPC channel 都是聚合查询(sessions / messages 表 COUNT / SUM /
 * GROUP BY)。这跟前 6 个 CRUD 模块不同,无 schema,无 state.ts(KV 表无
 * 字段)、无 writer.ts(原子写也无)。
 *
 * 数据来源:
 * - sessions:totalSessions / totalDurationMs / byProject.sessions / byDay
 * - messages:totalMessages / byProject.messages / byDay.messages
 * - messages.content_blocks (JSON 数组):totalTokens / byProject.tokens /
 *   byDay.tokens / byTool
 *
 * 重要约定:messages.content_blocks 列存 JSON 数组,每个 element 形如
 *   { type: 'text', text } | { type: 'tool_use', name, input } |
 *   { type: 'tool_result', content, is_error } |
 *   { type: 'thinking', thinking } | { type: 'unknown', raw }
 *
 * SQL json_extract 提取 tool_name 时用 $.name(不是 $.tool_name——
 * 见 parser.ts extractContent 的 tool_use 字段拼装)。
 */

export interface UsageByProjectRow {
  projectId: number;
  projectName: string;
  sessions: number;
  messages: number;
  tokens: number;
}

export interface UsageByDayRow {
  /** YYYY-MM-DD (UTC date) */
  date: string;
  messages: number;
  tokens: number;
}

export interface UsageByToolRow {
  tool: string;
  count: number;
}

export interface UsageSummary {
  totalSessions: number;
  totalMessages: number;
  /** 估算 token 数 — 当前算法:assistant 消息 content + tool_use.input 的 JSON 长度 / 4 */
  totalTokens: number;
  /** 所有 sessions 总时长(毫秒,基于 sessions.started_at / last_message_at) */
  totalDurationMs: number;
  byProject: UsageByProjectRow[];
  byDay: UsageByDayRow[];
  byTool: UsageByToolRow[];
  generatedAt: string;
}

export interface SessionCost {
  sessionId: string;
  projectId: number;
  projectName: string;
  startedAt: number;
  lastMessageAt: number;
  durationMs: number;
  messageCount: number;
  tokens: number;
  tools: UsageByToolRow[];
}

export interface SessionTimelineEntry {
  uuid: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface SessionTimeline {
  sessionId: string;
  projectName: string;
  title: string | null;
  entries: SessionTimelineEntry[];
}
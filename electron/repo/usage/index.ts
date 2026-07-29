/**
 * electron/repo/usage/index.ts — 用量分析 模块聚合导出
 *
 * 用量分析模块是**只读聚合**,无 state.ts(KV 表无字段)、无 writer.ts
 * (原子写也无)。对外暴露 6 个聚合函数:
 * - usageSummary:主聚合,1 IPC 返 1 UsageSummary 对象
 * - getSessionCost:单 session token + 工具列表
 * - getSessionTimeline:单 session 时间线
 * - getProjectBreakdown:单项目聚合
 * - getDailyBreakdown:仅按日聚合
 * - getTopTools:工具频次 Top N
 *
 * 所有函数只读 sessions / messages 表,不写任何 state。
 */

export {
  usageSummary,
  getSessionCost,
  getSessionTimeline,
  getProjectBreakdown,
  getDailyBreakdown,
  getTopTools,
} from './scanner';
export type {
  UsageSummary,
  UsageByProjectRow,
  UsageByDayRow,
  UsageByToolRow,
  SessionCost,
  SessionTimeline,
  SessionTimelineEntry,
} from './types';
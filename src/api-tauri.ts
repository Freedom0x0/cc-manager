import { invoke } from '@tauri-apps/api/core';
import type {
  ProjectRow,
  ProjectTreeNode,
  SessionRow,
  MessageRow,
  SearchHit,
  ResumeCommand,
  WatcherStatus,
  McpServer,
  McpCreateInput,
  McpUpdatePatch,
  Skill,
  SkillCreateInput,
  SkillUpdatePatch,
  Command,
  CommandCreateInput,
  CommandUpdatePatch,
  SubAgent,
  SubAgentCreateInput,
  SubAgentUpdatePatch,
  Hook,
  HookCreateInput,
  HookUpdatePatch,
  Plugin,
  PluginCreateInput,
  PluginUpdatePatch,
  UsageSummary,
  SessionCost,
  SessionTimeline,
  UsageByProjectRow,
  UsageByDayRow,
  UsageByToolRow,
  ImportStats,
} from './types';

// v4.0 Tauri 2 全栈迁移 — api-tauri.ts
//
// 平移自 v3.1 electron/preload.ts 注入的 window.api + src/api.ts 的 60 个 wrapper。
// 每个 wrapper 调 `invoke(cmd, args)` — Tauri 2 IPC。
//
// 分 rid 实现状态 (commit 2-12):
// - rid-2 / commit 2: 5 读 IPC (listProjects/listProjectTree/listSessions/listMessages/searchMessages)
// - rid-2 / commit 3: 5 写 IPC + resumeSession
// - rid-2 / commit 4: 2 特殊 (watcherRescanAll/watcherGetStatus)
// - rid-3 / commit 5-10: 30 6 模块 IPC (mcp/skills/commands/sub-agents/hooks/plugins)
// - rid-4 / commit 11-12: 12 Profiles + Usage IPC
//
// 未注册的 IPC 在 commit 范围内调用会 reject(前端 try/catch 处理)。
export const api = {
  // ===== Sessions (rid-2 / commit 2-4) =====
  listProjects: (): Promise<ProjectRow[]> => invoke<ProjectRow[]>('cmd_list_projects'),
  listProjectTree: (): Promise<ProjectTreeNode[]> =>
    invoke<ProjectTreeNode[]>('cmd_list_project_tree'),
  listSessions: (projectId: number, includeDeleted: boolean): Promise<SessionRow[]> =>
    invoke<SessionRow[]>('cmd_list_sessions', { projectId, includeDeleted }),
  listDeletedSessions: (): Promise<SessionRow[]> =>
    invoke<SessionRow[]>('cmd_list_deleted_sessions'),
  listMessages: (sessionId: string): Promise<MessageRow[]> =>
    invoke<MessageRow[]>('cmd_list_messages', { sessionId }),
  searchMessages: (
    query: string,
    projectIds: number[] | null,
    fromMs: number | null,
    toMs: number | null
  ): Promise<SearchHit[]> =>
    invoke<SearchHit[]>('cmd_search_messages', { query, projectIds, fromMs, toMs }),
  watcherRescanAll: (): Promise<ImportStats> => invoke<ImportStats>('cmd_watcher_rescan_all'),
  watcherGetStatus: (): Promise<WatcherStatus> => invoke<WatcherStatus>('cmd_watcher_get_status'),
  softDeleteSession: (sessionId: string): Promise<void> =>
    invoke<void>('cmd_soft_delete_session', { sessionId }),
  restoreSession: (sessionId: string): Promise<void> =>
    invoke<void>('cmd_restore_session', { sessionId }),
  permanentDeleteSession: (sessionId: string): Promise<void> =>
    invoke<void>('cmd_permanent_delete_session', { sessionId }),
  resumeSession: (sessionId: string): Promise<ResumeCommand | null> =>
    invoke<ResumeCommand | null>('cmd_resume_session', { sessionId }),

  // ===== MCP (rid-3 / commit 5) =====
  mcpList: (): Promise<McpServer[]> => invoke<McpServer[]>('cmd_mcp_list'),
  mcpGet: (name: string): Promise<McpServer | null> => invoke<McpServer | null>('cmd_mcp_get', { name }),
  mcpCreate: (input: McpCreateInput): Promise<void> => invoke<void>('cmd_mcp_create', { input }),
  mcpUpdate: (name: string, patch: McpUpdatePatch): Promise<void> =>
    invoke<void>('cmd_mcp_update', { name, patch }),
  mcpDelete: (name: string): Promise<void> => invoke<void>('cmd_mcp_delete', { name }),
  mcpToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    invoke<void>('cmd_mcp_toggle_enabled', { name, enabled }),

  // ===== Skills (rid-3 / commit 6) =====
  skillList: (): Promise<Skill[]> => invoke<Skill[]>('cmd_skill_list'),
  skillGet: (name: string): Promise<Skill | null> => invoke<Skill | null>('cmd_skill_get', { name }),
  skillCreate: (input: SkillCreateInput): Promise<void> => invoke<void>('cmd_skill_create', { input }),
  skillUpdate: (name: string, patch: SkillUpdatePatch): Promise<void> =>
    invoke<void>('cmd_skill_update', { name, patch }),
  skillDelete: (name: string): Promise<void> => invoke<void>('cmd_skill_delete', { name }),
  skillToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    invoke<void>('cmd_skill_toggle_enabled', { name, enabled }),

  // ===== Commands (rid-3 / commit 7) =====
  commandList: (): Promise<Command[]> => invoke<Command[]>('cmd_command_list'),
  commandGet: (name: string): Promise<Command | null> =>
    invoke<Command | null>('cmd_command_get', { name }),
  commandCreate: (input: CommandCreateInput): Promise<void> =>
    invoke<void>('cmd_command_create', { input }),
  commandUpdate: (name: string, patch: CommandUpdatePatch): Promise<void> =>
    invoke<void>('cmd_command_update', { name, patch }),
  commandDelete: (name: string): Promise<void> => invoke<void>('cmd_command_delete', { name }),
  commandToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    invoke<void>('cmd_command_toggle_enabled', { name, enabled }),

  // ===== Sub-Agents (rid-3 / commit 8) =====
  subagentList: (): Promise<SubAgent[]> => invoke<SubAgent[]>('cmd_subagent_list'),
  subagentGet: (name: string): Promise<SubAgent | null> =>
    invoke<SubAgent | null>('cmd_subagent_get', { name }),
  subagentCreate: (input: SubAgentCreateInput): Promise<void> =>
    invoke<void>('cmd_subagent_create', { input }),
  subagentUpdate: (name: string, patch: SubAgentUpdatePatch): Promise<void> =>
    invoke<void>('cmd_subagent_update', { name, patch }),
  subagentDelete: (name: string): Promise<void> => invoke<void>('cmd_subagent_delete', { name }),
  subagentToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    invoke<void>('cmd_subagent_toggle_enabled', { name, enabled }),

  // ===== Hooks (rid-3 / commit 9) =====
  hookList: (): Promise<Hook[]> => invoke<Hook[]>('cmd_hook_list'),
  hookGet: (id: string): Promise<Hook | null> => invoke<Hook | null>('cmd_hook_get', { id }),
  hookCreate: (input: HookCreateInput): Promise<void> => invoke<void>('cmd_hook_create', { input }),
  hookUpdate: (id: string, patch: HookUpdatePatch): Promise<void> =>
    invoke<void>('cmd_hook_update', { id, patch }),
  hookDelete: (id: string): Promise<void> => invoke<void>('cmd_hook_delete', { id }),
  hookToggleEnabled: (id: string, enabled: boolean): Promise<void> =>
    invoke<void>('cmd_hook_toggle_enabled', { id, enabled }),

  // ===== Plugins (rid-3 / commit 10) =====
  pluginList: (): Promise<Plugin[]> => invoke<Plugin[]>('cmd_plugin_list'),
  pluginGet: (fullName: string): Promise<Plugin | null> =>
    invoke<Plugin | null>('cmd_plugin_get', { fullName }),
  pluginCreate: (input: PluginCreateInput): Promise<void> =>
    invoke<void>('cmd_plugin_create', { input }),
  pluginUpdate: (fullName: string, patch: PluginUpdatePatch): Promise<void> =>
    invoke<void>('cmd_plugin_update', { fullName, patch }),
  pluginDelete: (fullName: string): Promise<void> => invoke<void>('cmd_plugin_delete', { fullName }),
  pluginToggleEnabled: (fullName: string, enabled: boolean): Promise<void> =>
    invoke<void>('cmd_plugin_toggle_enabled', { fullName, enabled }),

  // ===== Profiles (rid-4 / commit 11) =====
  // v4 后端 commit 11 schema: id: i64 + name + modules: Map<module, Vec<item>>;
  // apply / get / delete / diff 走 id (i64); list / create 走 name (string)
  // 前端 Profile 类型需从 v3.1 shape ({ name, description, config: ProfileConfig })
  // 迁移到 v4 shape — src/types.ts Profile 重写在 v4.1 commit 18b 跟进。
  // 本 commit 18 修 channel name + id-based wrapper 参数;类型 Profile / ProfileUpdatePatch
  // 暂保留 import 但 api 层不暴露(后续 commit 18b 重写)。
  profileList: (): Promise<unknown[]> => invoke<unknown[]>('cmd_profile_list'),
  profileGet: (id: number): Promise<unknown | null> =>
    invoke<unknown | null>('cmd_profile_get', { id }),
  profileCreate: (name: string): Promise<unknown> =>
    invoke<unknown>('cmd_profile_create', { name }),
  profileApply: (id: number): Promise<unknown> =>
    invoke<unknown>('cmd_profile_apply', { id }),
  profileDelete: (id: number): Promise<void> =>
    invoke<void>('cmd_profile_delete', { id }),
  profileDiff: (id: number): Promise<unknown> =>
    invoke<unknown>('cmd_profile_diff', { id }),

  // ===== Usage (rid-4 / commit 12) =====
  usageSummary: (rangeDays: number): Promise<UsageSummary> =>
    invoke<UsageSummary>('cmd_usage_summary', { rangeDays }),
  usageGetSessionCost: (sessionId: string): Promise<SessionCost | null> =>
    invoke<SessionCost | null>('cmd_usage_get_session_cost', { sessionId }),
  usageGetSessionTimeline: (sessionId: string): Promise<SessionTimeline | null> =>
    invoke<SessionTimeline | null>('cmd_usage_get_session_timeline', { sessionId }),
  usageGetProjectBreakdown: (projectId: number): Promise<UsageByProjectRow | null> =>
    invoke<UsageByProjectRow | null>('cmd_usage_get_project_breakdown', { projectId }),
  usageGetDailyBreakdown: (rangeDays: number): Promise<UsageByDayRow[]> =>
    invoke<UsageByDayRow[]>('cmd_usage_get_daily_breakdown', { rangeDays }),
  usageGetTopTools: (limit: number): Promise<UsageByToolRow[]> =>
    invoke<UsageByToolRow[]>('cmd_usage_get_top_tools', { limit }),
};
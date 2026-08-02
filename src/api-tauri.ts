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
  Profile,
  ProfileCreateInput,
  ProfileUpdatePatch,
  UsageSummary,
  SessionCost,
  SessionTimeline,
  UsageByProjectRow,
  UsageByDayRow,
  UsageByToolRow,
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
  listProjects: (): Promise<ProjectRow[]> => invoke<ProjectRow[]>('list_projects'),
  listProjectTree: (): Promise<ProjectTreeNode[]> =>
    invoke<ProjectTreeNode[]>('list_project_tree'),
  listSessions: (projectId: number, includeDeleted: boolean): Promise<SessionRow[]> =>
    invoke<SessionRow[]>('list_sessions', { projectId, includeDeleted }),
  listDeletedSessions: (): Promise<SessionRow[]> =>
    invoke<SessionRow[]>('list_deleted_sessions'),
  listMessages: (sessionId: string): Promise<MessageRow[]> =>
    invoke<MessageRow[]>('list_messages', { sessionId }),
  searchMessages: (
    query: string,
    projectIds: number[] | null,
    fromMs: number | null,
    toMs: number | null
  ): Promise<SearchHit[]> =>
    invoke<SearchHit[]>('search_messages', { query, projectIds, fromMs, toMs }),
  watcherRescanAll: (): Promise<{ ok: true }> => invoke<{ ok: true }>('watcher_rescan_all'),
  watcherGetStatus: (): Promise<WatcherStatus> => invoke<WatcherStatus>('watcher_get_status'),
  softDeleteSession: (sessionId: string): Promise<void> =>
    invoke<void>('soft_delete_session', { sessionId }),
  restoreSession: (sessionId: string): Promise<void> =>
    invoke<void>('restore_session', { sessionId }),
  permanentDeleteSession: (sessionId: string): Promise<void> =>
    invoke<void>('permanent_delete_session', { sessionId }),
  resumeSession: (sessionId: string): Promise<ResumeCommand | null> =>
    invoke<ResumeCommand | null>('resume_session', { sessionId }),

  // ===== MCP (rid-3 / commit 5) =====
  mcpList: (): Promise<McpServer[]> => invoke<McpServer[]>('mcp_list'),
  mcpGet: (name: string): Promise<McpServer | null> => invoke<McpServer | null>('mcp_get', { name }),
  mcpCreate: (input: McpCreateInput): Promise<void> => invoke<void>('mcp_create', { input }),
  mcpUpdate: (name: string, patch: McpUpdatePatch): Promise<void> =>
    invoke<void>('mcp_update', { name, patch }),
  mcpDelete: (name: string): Promise<void> => invoke<void>('mcp_delete', { name }),
  mcpToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    invoke<void>('mcp_toggle_enabled', { name, enabled }),

  // ===== Skills (rid-3 / commit 6) =====
  skillList: (): Promise<Skill[]> => invoke<Skill[]>('skill_list'),
  skillGet: (name: string): Promise<Skill | null> => invoke<Skill | null>('skill_get', { name }),
  skillCreate: (input: SkillCreateInput): Promise<void> => invoke<void>('skill_create', { input }),
  skillUpdate: (name: string, patch: SkillUpdatePatch): Promise<void> =>
    invoke<void>('skill_update', { name, patch }),
  skillDelete: (name: string): Promise<void> => invoke<void>('skill_delete', { name }),
  skillToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    invoke<void>('skill_toggle_enabled', { name, enabled }),

  // ===== Commands (rid-3 / commit 7) =====
  commandList: (): Promise<Command[]> => invoke<Command[]>('command_list'),
  commandGet: (name: string): Promise<Command | null> =>
    invoke<Command | null>('command_get', { name }),
  commandCreate: (input: CommandCreateInput): Promise<void> =>
    invoke<void>('command_create', { input }),
  commandUpdate: (name: string, patch: CommandUpdatePatch): Promise<void> =>
    invoke<void>('command_update', { name, patch }),
  commandDelete: (name: string): Promise<void> => invoke<void>('command_delete', { name }),
  commandToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    invoke<void>('command_toggle_enabled', { name, enabled }),

  // ===== Sub-Agents (rid-3 / commit 8) =====
  subagentList: (): Promise<SubAgent[]> => invoke<SubAgent[]>('subagent_list'),
  subagentGet: (name: string): Promise<SubAgent | null> =>
    invoke<SubAgent | null>('subagent_get', { name }),
  subagentCreate: (input: SubAgentCreateInput): Promise<void> =>
    invoke<void>('subagent_create', { input }),
  subagentUpdate: (name: string, patch: SubAgentUpdatePatch): Promise<void> =>
    invoke<void>('subagent_update', { name, patch }),
  subagentDelete: (name: string): Promise<void> => invoke<void>('subagent_delete', { name }),
  subagentToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    invoke<void>('subagent_toggle_enabled', { name, enabled }),

  // ===== Hooks (rid-3 / commit 9) =====
  hookList: (): Promise<Hook[]> => invoke<Hook[]>('hook_list'),
  hookGet: (id: string): Promise<Hook | null> => invoke<Hook | null>('hook_get', { id }),
  hookCreate: (input: HookCreateInput): Promise<void> => invoke<void>('hook_create', { input }),
  hookUpdate: (id: string, patch: HookUpdatePatch): Promise<void> =>
    invoke<void>('hook_update', { id, patch }),
  hookDelete: (id: string): Promise<void> => invoke<void>('hook_delete', { id }),
  hookToggleEnabled: (id: string, enabled: boolean): Promise<void> =>
    invoke<void>('hook_toggle_enabled', { id, enabled }),

  // ===== Plugins (rid-3 / commit 10) =====
  pluginList: (): Promise<Plugin[]> => invoke<Plugin[]>('plugin_list'),
  pluginGet: (fullName: string): Promise<Plugin | null> =>
    invoke<Plugin | null>('plugin_get', { fullName }),
  pluginCreate: (input: PluginCreateInput): Promise<void> =>
    invoke<void>('plugin_create', { input }),
  pluginUpdate: (fullName: string, patch: PluginUpdatePatch): Promise<void> =>
    invoke<void>('plugin_update', { fullName, patch }),
  pluginDelete: (fullName: string): Promise<void> => invoke<void>('plugin_delete', { fullName }),
  pluginToggleEnabled: (fullName: string, enabled: boolean): Promise<void> =>
    invoke<void>('plugin_toggle_enabled', { fullName, enabled }),

  // ===== Profiles (rid-4 / commit 11) =====
  profileList: (): Promise<Profile[]> => invoke<Profile[]>('profile_list'),
  profileGet: (name: string): Promise<Profile | null> =>
    invoke<Profile | null>('profile_get', { name }),
  profileCapture: (name: string, description: string): Promise<void> =>
    invoke<void>('profile_capture', { name, description }),
  profileApply: (name: string): Promise<{ ok: true; appliedAt: number }> =>
    invoke<{ ok: true; appliedAt: number }>('profile_apply', { name }),
  profileDelete: (name: string): Promise<void> => invoke<void>('profile_delete', { name }),
  profileUpdate: (name: string, patch: ProfileUpdatePatch): Promise<void> =>
    invoke<void>('profile_update', { name, patch }),

  // ===== Usage (rid-4 / commit 12) =====
  usageSummary: (rangeDays: number): Promise<UsageSummary> =>
    invoke<UsageSummary>('usage_summary', { rangeDays }),
  usageGetSessionCost: (sessionId: string): Promise<SessionCost | null> =>
    invoke<SessionCost | null>('usage_get_session_cost', { sessionId }),
  usageGetSessionTimeline: (sessionId: string): Promise<SessionTimeline | null> =>
    invoke<SessionTimeline | null>('usage_get_session_timeline', { sessionId }),
  usageGetProjectBreakdown: (projectId: number): Promise<UsageByProjectRow | null> =>
    invoke<UsageByProjectRow | null>('usage_get_project_breakdown', { projectId }),
  usageGetDailyBreakdown: (rangeDays: number): Promise<UsageByDayRow[]> =>
    invoke<UsageByDayRow[]>('usage_get_daily_breakdown', { rangeDays }),
  usageGetTopTools: (limit: number): Promise<UsageByToolRow[]> =>
    invoke<UsageByToolRow[]>('usage_get_top_tools', { limit }),
};
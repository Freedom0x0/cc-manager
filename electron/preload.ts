import { contextBridge, ipcRenderer } from 'electron';

// v5 wave-1 输入/补丁类型 — 仅作 preload 参数标注,
// 与 src/types.ts 中的同形 interface 保持字段一致(CLAUDE.md §5 双修约定)。
// 这里不复用 src/types.ts 是因为 tsconfig.electron.json rootDir 限定在 electron/。
interface McpCreateInput {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  description?: string;
}
interface McpUpdatePatch {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}
interface SkillCreateInput {
  name: string;
  description: string;
  body?: string;
  allowedTools?: string[];
  version?: string;
}
interface SkillUpdatePatch {
  description?: string;
  allowedTools?: string[];
  version?: string;
  body?: string;
}
interface CommandCreateInput {
  name: string;
  description: string;
  body?: string;
  argumentHint?: string;
}
interface CommandUpdatePatch {
  description?: string;
  argumentHint?: string;
  body?: string;
}
interface SubAgentCreateInput {
  name: string;
  description: string;
  body?: string;
  argumentHint?: string;
}
interface SubAgentUpdatePatch {
  description?: string;
  argumentHint?: string;
  body?: string;
}
type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'Notification'
  | 'UserPromptSubmit';
interface HookCreateInput {
  event: HookEvent;
  matcher?: string;
  command: string;
}
interface HookUpdatePatch {
  matcher?: string;
  command?: string;
}
interface PluginCreateInput {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: string[];
  entry?: string;
}
interface PluginUpdatePatch {
  version?: string;
  description?: string;
  author?: string;
  dependencies?: string[];
  entry?: string;
}
interface ProfileCreateInput {
  name: string;
  description: string;
}
interface ProfileUpdatePatch {
  description?: string;
}

contextBridge.exposeInMainWorld('api', {
  listProjects: () => ipcRenderer.invoke('list_projects'),
  listProjectTree: () => ipcRenderer.invoke('list_project_tree'),
  listSessions: (projectId: number, includeDeleted: boolean) =>
    ipcRenderer.invoke('list_sessions', projectId, includeDeleted),
  listDeletedSessions: () => ipcRenderer.invoke('list_deleted_sessions'),
  listMessages: (sessionId: string) => ipcRenderer.invoke('list_messages', sessionId),
  searchMessages: (
    query: string,
    projectIds: number[] | null,
    fromMs: number | null,
    toMs: number | null
  ) => ipcRenderer.invoke('search_messages', query, projectIds, fromMs, toMs),
  watcherRescanAll: () => ipcRenderer.invoke('watcher_rescan_all'),
  watcherGetStatus: () => ipcRenderer.invoke('watcher_get_status'),
  softDeleteSession: (sessionId: string) => ipcRenderer.invoke('soft_delete_session', sessionId),
  restoreSession: (sessionId: string) => ipcRenderer.invoke('restore_session', sessionId),
  permanentDeleteSession: (sessionId: string) =>
    ipcRenderer.invoke('permanent_delete_session', sessionId),
  resumeSession: (sessionId: string) => ipcRenderer.invoke('resume_session', sessionId),
  // v5 wave-1 MCP 模块 — 6 IPC invoke
  mcpList: () => ipcRenderer.invoke('mcp_list'),
  mcpGet: (name: string) => ipcRenderer.invoke('mcp_get', name),
  mcpCreate: (input: McpCreateInput) => ipcRenderer.invoke('mcp_create', input),
  mcpUpdate: (name: string, patch: McpUpdatePatch) => ipcRenderer.invoke('mcp_update', name, patch),
  mcpDelete: (name: string) => ipcRenderer.invoke('mcp_delete', name),
  mcpToggleEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('mcp_toggle_enabled', name, enabled),
  // v5 wave-1 Skills 模块 — 6 IPC invoke
  skillList: () => ipcRenderer.invoke('skill_list'),
  skillGet: (name: string) => ipcRenderer.invoke('skill_get', name),
  skillCreate: (input: SkillCreateInput) => ipcRenderer.invoke('skill_create', input),
  skillUpdate: (name: string, patch: SkillUpdatePatch) => ipcRenderer.invoke('skill_update', name, patch),
  skillDelete: (name: string) => ipcRenderer.invoke('skill_delete', name),
  skillToggleEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('skill_toggle_enabled', name, enabled),
  // v5 wave-1 Commands 模块 — 6 IPC invoke
  commandList: () => ipcRenderer.invoke('command_list'),
  commandGet: (name: string) => ipcRenderer.invoke('command_get', name),
  commandCreate: (input: CommandCreateInput) => ipcRenderer.invoke('command_create', input),
  commandUpdate: (name: string, patch: CommandUpdatePatch) => ipcRenderer.invoke('command_update', name, patch),
  commandDelete: (name: string) => ipcRenderer.invoke('command_delete', name),
  commandToggleEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('command_toggle_enabled', name, enabled),
  // v5 wave-2 Sub-Agents 模块 — 6 IPC invoke
  subagentList: () => ipcRenderer.invoke('subagent_list'),
  subagentGet: (name: string) => ipcRenderer.invoke('subagent_get', name),
  subagentCreate: (input: SubAgentCreateInput) => ipcRenderer.invoke('subagent_create', input),
  subagentUpdate: (name: string, patch: SubAgentUpdatePatch) => ipcRenderer.invoke('subagent_update', name, patch),
  subagentDelete: (name: string) => ipcRenderer.invoke('subagent_delete', name),
  subagentToggleEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('subagent_toggle_enabled', name, enabled),
  // v5 wave-2 Hooks 模块 — 6 IPC invoke
  hookList: () => ipcRenderer.invoke('hook_list'),
  hookGet: (id: string) => ipcRenderer.invoke('hook_get', id),
  hookCreate: (input: HookCreateInput) => ipcRenderer.invoke('hook_create', input),
  hookUpdate: (id: string, patch: HookUpdatePatch) =>
    ipcRenderer.invoke('hook_update', id, patch),
  hookDelete: (id: string) => ipcRenderer.invoke('hook_delete', id),
  hookToggleEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('hook_toggle_enabled', id, enabled),
  // v5 wave-2 Plugins 模块 — 6 IPC invoke
  pluginList: () => ipcRenderer.invoke('plugin_list'),
  pluginGet: (name: string) => ipcRenderer.invoke('plugin_get', name),
  pluginCreate: (input: PluginCreateInput) => ipcRenderer.invoke('plugin_create', input),
  pluginUpdate: (name: string, patch: PluginUpdatePatch) =>
    ipcRenderer.invoke('plugin_update', name, patch),
  pluginDelete: (name: string) => ipcRenderer.invoke('plugin_delete', name),
  pluginToggleEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('plugin_toggle_enabled', name, enabled),
  // v5 wave-3 Profiles 模块 — 6 IPC invoke
  profileList: () => ipcRenderer.invoke('profile_list'),
  profileGet: (name: string) => ipcRenderer.invoke('profile_get', name),
  profileCapture: (name: string, description: string) =>
    ipcRenderer.invoke('profile_capture', name, description),
  profileApply: (name: string) => ipcRenderer.invoke('profile_apply', name),
  profileDelete: (name: string) => ipcRenderer.invoke('profile_delete', name),
  profileUpdate: (name: string, patch: ProfileUpdatePatch) =>
    ipcRenderer.invoke('profile_update', name, patch),
  // v5 wave-3 用量分析 模块 — 6 IPC invoke。全只读聚合
  usageSummary: (rangeDays: number) => ipcRenderer.invoke('usage_summary', rangeDays),
  usageGetSessionCost: (sessionId: string) =>
    ipcRenderer.invoke('usage_get_session_cost', sessionId),
  usageGetSessionTimeline: (sessionId: string) =>
    ipcRenderer.invoke('usage_get_session_timeline', sessionId),
  usageGetProjectBreakdown: (projectId: number) =>
    ipcRenderer.invoke('usage_get_project_breakdown', projectId),
  usageGetDailyBreakdown: (rangeDays: number) =>
    ipcRenderer.invoke('usage_get_daily_breakdown', rangeDays),
  usageGetTopTools: (limit: number) =>
    ipcRenderer.invoke('usage_get_top_tools', limit),
});

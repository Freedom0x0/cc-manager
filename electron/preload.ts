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
  globalSearch: (query: string, limit: number) =>
    ipcRenderer.invoke('global_search', query, limit),
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
});

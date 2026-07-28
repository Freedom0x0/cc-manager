import { contextBridge, ipcRenderer } from 'electron';

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
  mcpCreate: (input) => ipcRenderer.invoke('mcp_create', input),
  mcpUpdate: (name: string, patch) => ipcRenderer.invoke('mcp_update', name, patch),
  mcpDelete: (name: string) => ipcRenderer.invoke('mcp_delete', name),
  mcpToggleEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('mcp_toggle_enabled', name, enabled),
});

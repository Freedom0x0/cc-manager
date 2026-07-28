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
  softDeleteSession: (sessionId: string) => ipcRenderer.invoke('soft_delete_session', sessionId),
  restoreSession: (sessionId: string) => ipcRenderer.invoke('restore_session', sessionId),
  permanentDeleteSession: (sessionId: string) =>
    ipcRenderer.invoke('permanent_delete_session', sessionId),
  resumeSession: (sessionId: string) => ipcRenderer.invoke('resume_session', sessionId),
});

import type { ProjectRow, ProjectTreeNode, SessionRow, MessageRow, SearchHit } from './types';

export const api = {
  listProjects: (): Promise<ProjectRow[]> => window.api.listProjects(),
  listProjectTree: (): Promise<ProjectTreeNode[]> => window.api.listProjectTree(),
  listSessions: (projectId: number, includeDeleted: boolean): Promise<SessionRow[]> =>
    window.api.listSessions(projectId, includeDeleted),
  listDeletedSessions: (): Promise<SessionRow[]> => window.api.listDeletedSessions(),
  listMessages: (sessionId: string): Promise<MessageRow[]> => window.api.listMessages(sessionId),
  searchMessages: (
    query: string,
    projectIds: number[] | null,
    fromMs: number | null,
    toMs: number | null
  ): Promise<SearchHit[]> => window.api.searchMessages(query, projectIds, fromMs, toMs),
  softDeleteSession: (sessionId: string): Promise<void> => window.api.softDeleteSession(sessionId),
  restoreSession: (sessionId: string): Promise<void> => window.api.restoreSession(sessionId),
  permanentDeleteSession: (sessionId: string): Promise<void> =>
    window.api.permanentDeleteSession(sessionId),
  resumeSession: (sessionId: string): Promise<number> => window.api.resumeSession(sessionId),
};

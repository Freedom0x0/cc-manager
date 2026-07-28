import type {
  ProjectRow,
  ProjectTreeNode,
  SessionRow,
  MessageRow,
  SearchHit,
  ResumeCommand,
  GlobalSearchHit,
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
} from './types';

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
  globalSearch: (query: string, limit: number): Promise<GlobalSearchHit[]> =>
    window.api.globalSearch(query, limit),
  watcherRescanAll: (): Promise<{ ok: true }> => window.api.watcherRescanAll(),
  watcherGetStatus: (): Promise<WatcherStatus> => window.api.watcherGetStatus(),
  softDeleteSession: (sessionId: string): Promise<void> => window.api.softDeleteSession(sessionId),
  restoreSession: (sessionId: string): Promise<void> => window.api.restoreSession(sessionId),
  permanentDeleteSession: (sessionId: string): Promise<void> =>
    window.api.permanentDeleteSession(sessionId),
  resumeSession: (sessionId: string): Promise<ResumeCommand | null> =>
    window.api.resumeSession(sessionId),
  // v5 wave-1 MCP 模块 — 6 IPC 包装
  mcpList: (): Promise<McpServer[]> => window.api.mcpList(),
  mcpGet: (name: string): Promise<McpServer | null> => window.api.mcpGet(name),
  mcpCreate: (input: McpCreateInput): Promise<void> => window.api.mcpCreate(input),
  mcpUpdate: (name: string, patch: McpUpdatePatch): Promise<void> =>
    window.api.mcpUpdate(name, patch),
  mcpDelete: (name: string): Promise<void> => window.api.mcpDelete(name),
  mcpToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    window.api.mcpToggleEnabled(name, enabled),
  // v5 wave-1 Skills 模块 — 6 IPC 包装
  skillList: (): Promise<Skill[]> => window.api.skillList(),
  skillGet: (name: string): Promise<Skill | null> => window.api.skillGet(name),
  skillCreate: (input: SkillCreateInput): Promise<void> => window.api.skillCreate(input),
  skillUpdate: (name: string, patch: SkillUpdatePatch): Promise<void> =>
    window.api.skillUpdate(name, patch),
  skillDelete: (name: string): Promise<void> => window.api.skillDelete(name),
  skillToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    window.api.skillToggleEnabled(name, enabled),
  // v5 wave-1 Commands 模块 — 6 IPC 包装
  commandList: (): Promise<Command[]> => window.api.commandList(),
  commandGet: (name: string): Promise<Command | null> => window.api.commandGet(name),
  commandCreate: (input: CommandCreateInput): Promise<void> => window.api.commandCreate(input),
  commandUpdate: (name: string, patch: CommandUpdatePatch): Promise<void> =>
    window.api.commandUpdate(name, patch),
  commandDelete: (name: string): Promise<void> => window.api.commandDelete(name),
  commandToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    window.api.commandToggleEnabled(name, enabled),
};

// Browser-dev mock: in dev (vite serve) window.api is set by src/mock.ts.
// In Electron, window.api is set by electron/preload.ts at runtime.
// Type is the union of both; both implementations match this contract.

import type {
  ProjectRow,
  SessionRow,
  MessageRow,
  SearchHit,
  ProjectTreeNode,
  ResumeCommand,
  GlobalSearchHit,
  WatcherStatus,
  McpServer,
  McpCreateInput,
  McpUpdatePatch,
} from './types';

export type Api = {
  listProjects(): Promise<ProjectRow[]>;
  listProjectTree(): Promise<ProjectTreeNode[]>;
  listSessions(projectId: number, includeDeleted: boolean): Promise<SessionRow[]>;
  listDeletedSessions(): Promise<SessionRow[]>;
  listMessages(sessionId: string): Promise<MessageRow[]>;
  searchMessages(
    query: string,
    projectIds: number[] | null,
    fromMs: number | null,
    toMs: number | null
  ): Promise<SearchHit[]>;
  globalSearch(query: string, limit: number): Promise<GlobalSearchHit[]>;
  watcherRescanAll(): Promise<{ ok: true }>;
  watcherGetStatus(): Promise<WatcherStatus>;
  softDeleteSession(sessionId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  permanentDeleteSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<ResumeCommand | null>;
  // v5 wave-1 MCP 模块 — 5 IPC channel
  mcpList(): Promise<McpServer[]>;
  mcpGet(name: string): Promise<McpServer | null>;
  mcpCreate(input: McpCreateInput): Promise<void>;
  mcpUpdate(name: string, patch: McpUpdatePatch): Promise<void>;
  mcpDelete(name: string): Promise<void>;
};

declare global {
  interface Window {
    api: Api;
  }
}
export {};


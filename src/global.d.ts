// Browser-dev mock: in dev (vite serve) window.api is set by src/mock.ts.
// In Electron, window.api is set by electron/preload.ts at runtime.
// Type is the union of both; both implementations match this contract.

import type { ProjectRow, SessionRow, MessageRow, SearchHit, ProjectTreeNode, ResumeCommand } from './types';

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
  softDeleteSession(sessionId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  permanentDeleteSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<ResumeCommand | null>;
  /** 主进程推送：首次导入完成后触发。浏览器 mock 模式下为 noop。 */
  onImportDone(cb: () => void): void;
};

declare global {
  interface Window {
    api: Api;
  }
}
export {};



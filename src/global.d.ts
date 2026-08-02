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
  ImportStats,
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
  watcherRescanAll(): Promise<ImportStats>;
  watcherGetStatus(): Promise<WatcherStatus>;
  softDeleteSession(sessionId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  permanentDeleteSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<ResumeCommand | null>;
  // v5 wave-1 MCP 模块 — 6 IPC channel
  mcpList(): Promise<McpServer[]>;
  mcpGet(name: string): Promise<McpServer | null>;
  mcpCreate(input: McpCreateInput): Promise<void>;
  mcpUpdate(name: string, patch: McpUpdatePatch): Promise<void>;
  mcpDelete(name: string): Promise<void>;
  mcpToggleEnabled(name: string, enabled: boolean): Promise<void>;
  // v5 wave-1 Skills 模块 — 6 IPC channel
  skillList(): Promise<Skill[]>;
  skillGet(name: string): Promise<Skill | null>;
  skillCreate(input: SkillCreateInput): Promise<void>;
  skillUpdate(name: string, patch: SkillUpdatePatch): Promise<void>;
  skillDelete(name: string): Promise<void>;
  skillToggleEnabled(name: string, enabled: boolean): Promise<void>;
  // v5 wave-1 Commands 模块 — 6 IPC channel
  commandList(): Promise<Command[]>;
  commandGet(name: string): Promise<Command | null>;
  commandCreate(input: CommandCreateInput): Promise<void>;
  commandUpdate(name: string, patch: CommandUpdatePatch): Promise<void>;
  commandDelete(name: string): Promise<void>;
  commandToggleEnabled(name: string, enabled: boolean): Promise<void>;
  // v5 wave-2 Sub-Agents 模块 — 6 IPC channel
  subagentList(): Promise<SubAgent[]>;
  subagentGet(name: string): Promise<SubAgent | null>;
  subagentCreate(input: SubAgentCreateInput): Promise<void>;
  subagentUpdate(name: string, patch: SubAgentUpdatePatch): Promise<void>;
  subagentDelete(name: string): Promise<void>;
  subagentToggleEnabled(name: string, enabled: boolean): Promise<void>;
  // v5 wave-2 Hooks 模块 — 6 IPC channel
  hookList(): Promise<Hook[]>;
  hookGet(id: string): Promise<Hook | null>;
  hookCreate(input: HookCreateInput): Promise<void>;
  hookUpdate(id: string, patch: HookUpdatePatch): Promise<void>;
  hookDelete(id: string): Promise<void>;
  hookToggleEnabled(id: string, enabled: boolean): Promise<void>;
  // v5 wave-2 Plugins 模块 — 6 IPC channel
  pluginList(): Promise<Plugin[]>;
  pluginGet(fullName: string): Promise<Plugin | null>;
  pluginCreate(input: PluginCreateInput): Promise<void>;
  pluginUpdate(fullName: string, patch: PluginUpdatePatch): Promise<void>;
  pluginDelete(fullName: string): Promise<void>;
  pluginToggleEnabled(fullName: string, enabled: boolean): Promise<void>;
  // v5 wave-3 Profiles 模块 — 6 IPC channel
  profileList(): Promise<Profile[]>;
  profileGet(name: string): Promise<Profile | null>;
  profileCapture(name: string, description: string): Promise<void>;
  profileApply(name: string): Promise<{ ok: true; appliedAt: number }>;
  profileDelete(name: string): Promise<void>;
  profileUpdate(name: string, patch: ProfileUpdatePatch): Promise<void>;
  // v5 wave-3 用量分析 模块 — 6 IPC channel(全只读聚合)
  usageSummary(rangeDays: number): Promise<UsageSummary>;
  usageGetSessionCost(sessionId: string): Promise<SessionCost | null>;
  usageGetSessionTimeline(sessionId: string): Promise<SessionTimeline | null>;
  usageGetProjectBreakdown(projectId: number): Promise<UsageByProjectRow | null>;
  usageGetDailyBreakdown(rangeDays: number): Promise<UsageByDayRow[]>;
  usageGetTopTools(limit: number): Promise<UsageByToolRow[]>;
};

declare global {
  interface Window {
    api: Api;
  }
}
export {};


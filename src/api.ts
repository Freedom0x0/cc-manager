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
  // v5 wave-1 MCP module — 6 IPC wrappers
  mcpList: (): Promise<McpServer[]> => window.api.mcpList(),
  mcpGet: (name: string): Promise<McpServer | null> => window.api.mcpGet(name),
  mcpCreate: (input: McpCreateInput): Promise<void> => window.api.mcpCreate(input),
  mcpUpdate: (name: string, patch: McpUpdatePatch): Promise<void> =>
    window.api.mcpUpdate(name, patch),
  mcpDelete: (name: string): Promise<void> => window.api.mcpDelete(name),
  mcpToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    window.api.mcpToggleEnabled(name, enabled),
  // v5 wave-1 Skills module — 6 IPC wrappers
  skillList: (): Promise<Skill[]> => window.api.skillList(),
  skillGet: (name: string): Promise<Skill | null> => window.api.skillGet(name),
  skillCreate: (input: SkillCreateInput): Promise<void> => window.api.skillCreate(input),
  skillUpdate: (name: string, patch: SkillUpdatePatch): Promise<void> =>
    window.api.skillUpdate(name, patch),
  skillDelete: (name: string): Promise<void> => window.api.skillDelete(name),
  skillToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    window.api.skillToggleEnabled(name, enabled),
  skillImportFile: (): Promise<SkillCreateInput | null> => window.api.skillImportFile(),
  // v5 wave-1 Commands module — 6 IPC wrappers
  commandList: (): Promise<Command[]> => window.api.commandList(),
  commandGet: (name: string): Promise<Command | null> => window.api.commandGet(name),
  commandCreate: (input: CommandCreateInput): Promise<void> => window.api.commandCreate(input),
  commandUpdate: (name: string, patch: CommandUpdatePatch): Promise<void> =>
    window.api.commandUpdate(name, patch),
  commandDelete: (name: string): Promise<void> => window.api.commandDelete(name),
  commandToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    window.api.commandToggleEnabled(name, enabled),
  // v5 wave-2 Sub-Agents module — 6 IPC wrappers
  subagentList: (): Promise<SubAgent[]> => window.api.subagentList(),
  subagentGet: (name: string): Promise<SubAgent | null> => window.api.subagentGet(name),
  subagentCreate: (input: SubAgentCreateInput): Promise<void> =>
    window.api.subagentCreate(input),
  subagentUpdate: (name: string, patch: SubAgentUpdatePatch): Promise<void> =>
    window.api.subagentUpdate(name, patch),
  subagentDelete: (name: string): Promise<void> => window.api.subagentDelete(name),
  subagentToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    window.api.subagentToggleEnabled(name, enabled),
  // v5 wave-2 Hooks module — 6 IPC wrappers
  hookList: (): Promise<Hook[]> => window.api.hookList(),
  hookGet: (id: string): Promise<Hook | null> => window.api.hookGet(id),
  hookCreate: (input: HookCreateInput): Promise<void> => window.api.hookCreate(input),
  hookUpdate: (id: string, patch: HookUpdatePatch): Promise<void> =>
    window.api.hookUpdate(id, patch),
  hookDelete: (id: string): Promise<void> => window.api.hookDelete(id),
  hookToggleEnabled: (id: string, enabled: boolean): Promise<void> =>
    window.api.hookToggleEnabled(id, enabled),
  // v5 wave-2 Plugins module — 6 IPC wrappers
  pluginList: (): Promise<Plugin[]> => window.api.pluginList(),
  pluginGet: (name: string): Promise<Plugin | null> => window.api.pluginGet(name),
  pluginCreate: (input: PluginCreateInput): Promise<void> => window.api.pluginCreate(input),
  pluginUpdate: (name: string, patch: PluginUpdatePatch): Promise<void> =>
    window.api.pluginUpdate(name, patch),
  pluginDelete: (name: string): Promise<void> => window.api.pluginDelete(name),
  pluginToggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    window.api.pluginToggleEnabled(name, enabled),
  // v5 wave-3 Profiles module — 6 IPC wrappers
  profileList: (): Promise<Profile[]> => window.api.profileList(),
  profileGet: (name: string): Promise<Profile | null> => window.api.profileGet(name),
  profileCapture: (name: string, description: string): Promise<void> =>
    window.api.profileCapture(name, description),
  profileApply: (name: string): Promise<{ ok: true; appliedAt: number }> =>
    window.api.profileApply(name),
  profileDelete: (name: string): Promise<void> => window.api.profileDelete(name),
  profileUpdate: (name: string, patch: ProfileUpdatePatch): Promise<void> =>
    window.api.profileUpdate(name, patch),
  // v5 wave-3 用量分析 module — 6 IPC wrappers(全只读聚合)
  usageSummary: (rangeDays: number): Promise<UsageSummary> =>
    window.api.usageSummary(rangeDays),
  usageGetSessionCost: (sessionId: string): Promise<SessionCost | null> =>
    window.api.usageGetSessionCost(sessionId),
  usageGetSessionTimeline: (sessionId: string): Promise<SessionTimeline | null> =>
    window.api.usageGetSessionTimeline(sessionId),
  usageGetProjectBreakdown: (projectId: number): Promise<UsageByProjectRow | null> =>
    window.api.usageGetProjectBreakdown(projectId),
  usageGetDailyBreakdown: (rangeDays: number): Promise<UsageByDayRow[]> =>
    window.api.usageGetDailyBreakdown(rangeDays),
  usageGetTopTools: (limit: number): Promise<UsageByToolRow[]> =>
    window.api.usageGetTopTools(limit),
};

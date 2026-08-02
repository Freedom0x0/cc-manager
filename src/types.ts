export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; content: unknown; isError?: boolean }
  | { type: 'thinking'; thinking: string }
  | { type: 'unknown'; raw: unknown };

export interface ProjectTreeNode {
  id: number;
  name: string;
  path: string;
  sessionCount: number;
  children?: ProjectTreeNode[]; // optional; flat model used in v3
}

export interface ProjectRow {
  id: number;
  path: string;
  name: string;
  sessionCount: number;
}

export interface SessionRow {
  id: number;
  sessionId: string;
  projectId: number;
  title: string | null;
  cwd: string | null;
  startedAt: number;
  lastMessageAt: number;
  messageCount: number;
  sourceFile: string;
  firstUserMessage: string | null;
}

export interface MessageRow {
  id: number;
  uuid: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  blocks: ContentBlock[];
  createdAt: number;
}

export interface SearchHit {
  message: MessageRow;
  snippet: string;
  sessionTitle: string | null;
  projectName: string;
  projectId: number;
}

export interface WatcherStatus {
  status: 'starting' | 'idle' | 'error';
  lastEvent?: string;
  lastError?: string;
}

export interface ResumeCommand {
  command: string;
  cwd?: string;
}

/**
 * McpServer — 跨层共享类型(CLAUDE.md §5)
 *
 * 与 electron/repo/mcp/types.ts 中的 McpServer **同形**(字段名 + 类型一致)。
 * 双修:任何字段重命名都要同步改 electron 侧。
 *
 * v5 wave-1 MCP 模块:从 ~/.claude.json 读 mcpServers → 注入 enabled(KV 表)
 * → UI 渲染。createMcpServer 接收的输入是 McpCreateInput(electron 侧定义);
 * updateMcpServer 接收 McpUpdatePatch。
 */
export interface McpServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  description?: string;
  source: 'global';
}

export interface McpCreateInput {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  description?: string;
}

export interface McpUpdatePatch {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

/**
 * Skill — 跨层共享类型(CLAUDE.md §5)
 *
 * 与 electron/repo/skills/types.ts 中的 Skill **同形**(字段名 + 类型一致)。
 * 双修:任何字段重命名都要同步改 electron 侧。
 *
 * v5 wave-1 Skills 模块:从 ~/.claude/skills/<name>/SKILL.md 读 frontmatter
 * → 注入 enabled(KV 表 key 前缀 'skill:enabled:<name>')→ UI 渲染。
 * createSkill 接收 SkillCreateInput;updateSkill 接收 SkillUpdatePatch。
 */
export interface Skill {
  name: string;
  path: string;
  description: string;
  allowedTools?: string[];
  enabled: boolean;
  version?: string;
  body: string;
}

export interface SkillCreateInput {
  name: string;
  description: string;
  body?: string;
  allowedTools?: string[];
  version?: string;
}

export interface SkillUpdatePatch {
  description?: string;
  allowedTools?: string[];
  version?: string;
  body?: string;
}

/**
 * Command — 跨层共享类型(CLAUDE.md §5)
 *
 * 与 electron/repo/commands/types.ts 中的 Command **同形**(字段名 + 类型一致)。
 * 双修:任何字段重命名都要同步改 electron 侧。
 *
 * v5 wave-1 Commands 模块:从 ~/.claude/commands/<name>.md 单文件读 frontmatter
 * → 注入 enabled(KV 表 key 前缀 'cmd:enabled:<name>')→ UI 渲染。
 * createCommand 接收 CommandCreateInput;updateCommand 接收 CommandUpdatePatch。
 *
 * 与 Skill 不同:Command 用**单文件**而非目录,frontmatter + body 格式同 SKILL.md。
 */
export interface Command {
  name: string;
  path: string;
  description: string;
  argumentHint?: string;
  enabled: boolean;
  body: string;
}

export interface CommandCreateInput {
  name: string;
  description: string;
  body?: string;
  argumentHint?: string;
}

export interface CommandUpdatePatch {
  description?: string;
  argumentHint?: string;
  body?: string;
}

/**
 * SubAgent — 跨层共享类型(CLAUDE.md §5)
 *
 * 与 electron/repo/sub-agents/types.ts 中的 SubAgent **同形**(字段名 + 类型一致)。
 * 双修:任何字段重命名都要同步改 electron 侧。
 *
 * v5 wave-2 Sub-Agents 模块:从 ~/.claude/agents/<name>.md 单文件读 frontmatter
 * → 注入 enabled(KV 表 key 前缀 'agent:enabled:<name>')→ UI 渲染。
 * createSubAgent 接收 SubAgentCreateInput;updateSubAgent 接收 SubAgentUpdatePatch。
 *
 * 与 Command 同结构:都是**单文件**而非目录,frontmatter + body 格式相同。
 */
export interface SubAgent {
  name: string;
  path: string;
  description: string;
  argumentHint?: string;
  enabled: boolean;
  body: string;
}

export interface SubAgentCreateInput {
  name: string;
  description: string;
  body?: string;
  argumentHint?: string;
}

export interface SubAgentUpdatePatch {
  description?: string;
  argumentHint?: string;
  body?: string;
}

/**
 * Hook — 跨层共享类型(CLAUDE.md §5)
 *
 * 与 electron/repo/hooks/types.ts 中的 Hook **同形**(字段名 + 类型一致)。
 * 双修:任何字段重命名都要同步改 electron 侧。
 *
 * v5 wave-2 Hooks 模块:从 ~/.claude/settings.json 的 hooks 字段读各 event
 * 数组 → 扁平化 + 注入 enabled(KV 表 key 前缀 'hook:enabled:<id>')→ UI
 * 渲染。id 字段 = `${event}-${index}`,由 scanner 拼装。
 *
 * 与 SubAgent / Skill 不同:Hook **改 settings.json**(嵌套 JSON)而非单文件。
 */
export interface Hook {
  id: string;
  event:
    | 'PreToolUse'
    | 'PostToolUse'
    | 'Stop'
    | 'SubagentStop'
    | 'Notification'
    | 'UserPromptSubmit';
  matcher?: string;
  command: string;
  enabled: boolean;
  scope: 'global';
}

export interface HookCreateInput {
  event: Hook['event'];
  matcher?: string;
  command: string;
}

export interface HookUpdatePatch {
  matcher?: string;
  command?: string;
}

/**
 * Plugin — 跨层共享类型(CLAUDE.md §5)
 *
 * 与 electron/repo/plugins/types.ts 中的 Plugin **同形**(字段名 + 类型一致)。
 * 双修:任何字段重命名都要同步改 electron 侧。
 *
 * v5 wave-2 Plugins 模块:从 ~/.claude/plugins/<name>/plugin.json 读 JSON
 * → 注入 enabled(KV 表 key 前缀 'plugin:enabled:<name>')→ UI 渲染。
 * createPlugin 接收 PluginCreateInput;updatePlugin 接收 PluginUpdatePatch。
 *
 * 严格 schema 校验:必填 fullName/installPath/version/scope,缺则 throw —
 * wave-2-spec §2.3。
 *
 * 2026-07-30 重写:从假设的"`<name>/plugin.json` 目录"改为实际
 * `~/.claude/plugins/installed_plugins.json` 单文件。
 * 字段:fullName (`name@marketplace`)、name (short)、marketplace、
 * installPath (实际安装路径)、version、scope、installedAt、lastUpdated、
 * gitCommitSha、enabled (KV 状态)。
 */
export interface Plugin {
  fullName: string;       // name@marketplace,主键
  name: string;           // 解析后的 shortName
  marketplace: string;    // 解析后的 marketplace 名
  installPath: string;
  version: string;
  scope: 'user' | 'project';
  installedAt: string;    // ISO
  lastUpdated: string;    // ISO
  gitCommitSha: string;
  enabled: boolean;       // KV 状态
}

export interface PluginCreateInput {
  fullName: string;
  installPath: string;
  version: string;
  scope: 'user' | 'project';
}

export interface PluginUpdatePatch {
  scope?: 'user' | 'project';
  version?: string;
}

/**
 * Profile — 跨层共享类型(CLAUDE.md §5)
 *
 * v4 后端 commit 11 schema: ProfileSnapshot = { id: i64, name, modules: Map<module,
 * Vec<item>>, createdAt, updatedAt }。ProfileSummary (list 视图) 只含
 * id + name + 时戳 + itemCount,不含 modules Map;ProfileSnapshot (get
 * 视图) 完整含 modules。
 *
 * v3.1 Profile (config: ProfileConfig enabled* 数组 + description) 已废 — 改
 * v4 shape 后, Profile = 6 模块真实 enabled 全集(走 6 scanner 拿, D15 决策),
 * 写真实文件而非 KV 表(apply reverse-disable 完整替代, D13 决策)。
 *
 * profile_capture / profile_apply / profile_delete / profile_diff 走 cmd_xxx
 * channel (commit 18 加 cmd_ 前缀修复 D20)。
 */
export interface ProfileModuleItem {
  name: string;
  scope: string;
  /** 原文件路径 (settings.json / skills/<name>/SKILL.md / commands/<name>.md 等) */
  sourcePath: string;
  enabled: boolean;
}

export type ProfileModules = Record<string, ProfileModuleItem[]>;

export interface ProfileSummary {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  itemCount: number;
}

export interface ProfileSnapshot {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  modules: ProfileModules;
}

export interface ApplyResult {
  ok: boolean;
  restoredCount: number;
  realFileErrors: string[];
}

export interface ProfileDiff {
  id: number;
  name: string;
  added: ProfileModuleItem[];
  removed: ProfileModuleItem[];
  modified: ProfileModuleItem[];
}

/**
 * UsageSummary — 跨层共享类型(CLAUDE.md §5)
 *
 * 与 electron/repo/usage/types.ts 中的 UsageSummary **同形**(字段名 +
 * 类型一致)。双修:任何字段重命名都要同步改 electron 侧。
 *
 * v5 wave-3 用量分析 模块:UsageSummary 是 sessions / messages 表的只读
 * 聚合结果。1 IPC 返 1 个对象,无 schema、无 state、无 writer。token 数
 * 走 JS 端估算(粗估,精度不追求——用量分析意图是趋势 / 占比展示)。
 *
 * 6 个 IPC channel 都基于此结构或其子结构:
 *   - usage_summary → 整个 UsageSummary
 *   - usage_get_session_cost → SessionCost
 *   - usage_get_session_timeline → SessionTimeline
 *   - usage_get_project_breakdown → UsageByProjectRow
 *   - usage_get_daily_breakdown → UsageByDayRow[]
 *   - usage_get_top_tools → UsageByToolRow[]
 */
export interface UsageByProjectRow {
  projectId: number;
  projectName: string;
  sessions: number;
  messages: number;
  tokens: number;
}

export interface UsageByDayRow {
  /** YYYY-MM-DD (UTC date) */
  date: string;
  messages: number;
  tokens: number;
}

export interface UsageByToolRow {
  tool: string;
  count: number;
}

export interface UsageSummary {
  totalSessions: number;
  totalMessages: number;
  /** 估算 token 数 */
  totalTokens: number;
  /** 所有 sessions 总时长(毫秒) */
  totalDurationMs: number;
  byProject: UsageByProjectRow[];
  byDay: UsageByDayRow[];
  byTool: UsageByToolRow[];
  generatedAt: string;
}

export interface SessionCost {
  sessionId: string;
  projectId: number;
  projectName: string;
  startedAt: number;
  lastMessageAt: number;
  durationMs: number;
  messageCount: number;
  tokens: number;
  tools: UsageByToolRow[];
}

export interface SessionTimelineEntry {
  uuid: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface SessionTimeline {
  sessionId: string;
  projectName: string;
  title: string | null;
  entries: SessionTimelineEntry[];
}

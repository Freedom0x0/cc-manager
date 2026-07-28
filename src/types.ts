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

export interface GlobalSearchHit {
  id: string;
  kind: 'project' | 'session' | 'message';
  title: string;
  subtitle?: string;
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

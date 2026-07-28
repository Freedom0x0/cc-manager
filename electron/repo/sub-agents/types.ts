/**
 * electron/repo/sub-agents/types.ts — v5 wave-2 Sub-Agents 模块跨层共享类型
 *
 * 跨层复用约定(CLAUDE.md §5):electron 主进程不 import src/types.ts(主进程
 * 不能跑浏览器模块),所以 SubAgent 实体类型在本文件定义,再由 src/types.ts
 * 同样形状地再声明一次。两边必须保持字段一致。
 *
 * SubAgent 是**对外契约**:scanner 读 ~/.claude/agents/<name>.md 单文件后,
 * 注入 enabled 状态(从 mcp_server_state KV 表读,key 前缀 'agent:enabled:<name>')
 * 后返回。createSubAgent/updateSubAgent 接收的 patch 字段是 SubAgent 的子集。
 *
 * 与 Command 同结构:都是**单文件**(~/.claude/agents/<name>.md 而非子目录)。
 * frontmatter + markdown body 格式同 commands/skills。
 *
 * agentsDir 参数是模块级 fixture 注入点(CLAUDE.md §13 D10)。
 */

export interface SubAgent {
  /** 文件名(去 .md 后缀),主键 */
  name: string;
  /** 完整路径:~/.claude/agents/<name>.md */
  path: string;
  /** frontmatter.description,缺失则取首段正文 */
  description: string;
  /** 用户传给 agent 的参数提示(frontmatter.argument-hint) */
  argumentHint?: string;
  /** 用户 toggle 的启用状态,从 mcp_server_state KV 表读(默认 true) */
  enabled: boolean;
  /** .md 去除 frontmatter 后的正文 */
  body: string;
}

/** createSubAgent 接收的输入:必填 name/description,可选 body/argumentHint */
export interface SubAgentCreateInput {
  name: string;
  description: string;
  body?: string;
  argumentHint?: string;
}

/** updateSubAgent 接收的 patch:除 name/path/enabled/body 外都可改 */
export interface SubAgentUpdatePatch {
  description?: string;
  argumentHint?: string;
  body?: string;
}

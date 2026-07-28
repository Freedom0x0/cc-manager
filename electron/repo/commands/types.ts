/**
 * electron/repo/commands/types.ts — v5 wave-1 Commands 模块跨层共享类型
 *
 * 跨层复用约定(CLAUDE.md §5):electron 主进程不 import src/types.ts(主进程
 * 不能跑浏览器模块),所以 Command 实体类型在本文件定义,再由 src/types.ts
 * 同样形状地再声明一次。两边必须保持字段一致。
 *
 * Command 是**对外契约**:scanner 读 ~/.claude/commands/<name>.md 单文件后,
 * 注入 enabled 状态(从 mcp_server_state KV 表读,key 前缀 'cmd:enabled:<name>')
 * 后返回。createCommand/updateCommand 接收的 patch 字段是 Command 的子集。
 *
 * 与 Skill 不同:Command 用**单文件**(~/.claude/commands/<name>.md)而非
 * 子目录 + SKILL.md。frontmatter + markdown body 格式同 SKILL.md。
 *
 * commandsDir 参数是模块级 fixture 注入点(CLAUDE.md §13 D10)。
 */

export interface Command {
  /** 文件名(去 .md 后缀),主键 */
  name: string;
  /** 完整路径:~/.claude/commands/<name>.md */
  path: string;
  /** frontmatter.description,缺失则取首段正文 */
  description: string;
  /** 用户传给命令的参数提示(frontmatter.argument-hint) */
  argumentHint?: string;
  /** 用户 toggle 的启用状态,从 mcp_server_state KV 表读(默认 true) */
  enabled: boolean;
  /** .md 去除 frontmatter 后的正文 */
  body: string;
}

/** createCommand 接收的输入:必填 name/description,可选 body/argumentHint */
export interface CommandCreateInput {
  name: string;
  description: string;
  body?: string;
  argumentHint?: string;
}

/** updateCommand 接收的 patch:除 name/path/enabled/body 外都可改 */
export interface CommandUpdatePatch {
  description?: string;
  argumentHint?: string;
  body?: string;
}

/**
 * electron/repo/mcp/types.ts — v5 wave-1 MCP 模块跨层共享类型
 *
 * 跨层复用约定(CLAUDE.md §5):electron 主进程不 import src/types.ts(主进程
 * 不能跑浏览器模块),所以 MCP 实体类型在本文件定义,再由 src/types.ts
 * 同样形状地再声明一次。两边必须保持字段一致。
 *
 * McpServer 是**对外契约**:scanner 读 ~/.claude.json 的 mcpServers[name] 后,
 * 注入 enabled 状态(从 mcp_server_state KV 表读)和 description 后返回。
 * createMcpServer/updateMcpServer 接收的 patch 字段是 McpServer 的子集。
 */

export interface McpServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** 用户 toggle 的启用状态,从 mcp_server_state KV 表读(默认 true) */
  enabled: boolean;
  description?: string;
  /** v5 wave-1 只支持 global(读 ~/.claude.json);project 级留给未来 */
  source: 'global';
}

/** createMcpServer 接收的输入:必填 name/command/args,可选 env/description */
export interface McpCreateInput {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  description?: string;
}

/** updateMcpServer 接收的 patch:除 name 外都可改 */
export interface McpUpdatePatch {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

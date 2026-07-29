/**
 * electron/repo/mcp/index.ts — MCP 模块聚合导出
 *
 * 聚合 `electron/repo/mcp/{scanner,writer,state,types}.ts`,对外暴露:
 * - 扫描:listMcpServers / getMcpServer
 * - 写入:createMcpServer / updateMcpServer / deleteMcpServer
 * - 状态(getEnabled/setEnabled 是 list 的内部依赖,这里也透传供未来 IPC 直接调用)
 * - 类型:McpServer / McpCreateInput / McpUpdatePatch
 */

export { listMcpServers, getMcpServer, defaultMcpConfigPath } from './scanner';
export { createMcpServer, updateMcpServer, deleteMcpServer } from './writer';
export { getEnabled, setEnabled, getLastModified, setLastModified } from './state';
export type { McpServer, McpCreateInput, McpUpdatePatch } from './types';

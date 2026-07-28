/**
 * electron/repo/sub-agents/index.ts — Sub-Agents 模块聚合导出
 *
 * 聚合 `electron/repo/sub-agents/{scanner,writer,state,types}.ts`,对外暴露:
 * - 扫描:listSubAgents / getSubAgent / readSubAgentFile / defaultAgentsDir / parseFrontmatter
 * - 写入:createSubAgent / updateSubAgent / deleteSubAgent
 * - 状态:getEnabled / setEnabled(KV 命名空间 agent:enabled:<name>)
 * - 类型:SubAgent / SubAgentCreateInput / SubAgentUpdatePatch
 */

export {
  listSubAgents,
  getSubAgent,
  readSubAgentFile,
  defaultAgentsDir,
  parseFrontmatter,
} from './scanner';
export { createSubAgent, updateSubAgent, deleteSubAgent } from './writer';
export { getEnabled, setEnabled } from './state';
export type { SubAgent, SubAgentCreateInput, SubAgentUpdatePatch } from './types';

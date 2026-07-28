/**
 * electron/repo/commands/index.ts — Commands 模块聚合导出
 *
 * 聚合 `electron/repo/commands/{scanner,writer,state,types}.ts`,对外暴露:
 * - 扫描:listCommands / getCommand / readCommandFile / defaultCommandsDir / parseFrontmatter
 * - 写入:createCommand / updateCommand / deleteCommand
 * - 状态:getEnabled / setEnabled(KV 命名空间 cmd:enabled:<name>)
 * - 类型:Command / CommandCreateInput / CommandUpdatePatch
 */

export {
  listCommands,
  getCommand,
  readCommandFile,
  defaultCommandsDir,
  parseFrontmatter,
} from './scanner';
export { createCommand, updateCommand, deleteCommand } from './writer';
export { getEnabled, setEnabled } from './state';
export type { Command, CommandCreateInput, CommandUpdatePatch } from './types';

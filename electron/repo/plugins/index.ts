/**
 * electron/repo/plugins/index.ts — Plugins 模块聚合导出
 *
 * 聚合 `electron/repo/plugins/{scanner,writer,state,types}.ts`,对外暴露:
 * - 扫描:listPlugins / getPlugin / readPluginFile / defaultPluginsDir
 * - 写入:createPlugin / updatePlugin / deletePlugin
 * - 状态:getEnabled / setEnabled(KV 命名空间 plugin:enabled:<name>)
 * - 类型:Plugin / PluginCreateInput / PluginUpdatePatch
 */

export {
  listPlugins,
  getPlugin,
  readPluginFile,
  defaultPluginsDir,
} from './scanner';
export { createPlugin, updatePlugin, deletePlugin } from './writer';
export { getEnabled, setEnabled } from './state';
export type { Plugin, PluginCreateInput, PluginUpdatePatch } from './types';

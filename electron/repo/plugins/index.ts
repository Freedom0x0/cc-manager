/**
 * electron/repo/plugins/index.ts — Plugins 模块聚合导出
 *
 * 2026-07-30 重写:从假设的"`<name>/plugin.json` 目录"改为实际
 * `~/.claude/plugins/installed_plugins.json` 单文件。
 *
 * 聚合 `electron/repo/plugins/{scanner,writer,state,types}.ts`,对外暴露:
 * - 扫描:listPlugins / getPlugin / defaultInstalledPluginsPath
 * - 写入:createPlugin / updatePlugin / deletePlugin
 * - 状态:getEnabled / setEnabled(KV 命名空间 plugin:enabled:<fullName>)
 * - 类型:Plugin / InstalledPluginVersion / InstalledPluginsFile / PluginCreateInput / PluginUpdatePatch
 */

export {
  listPlugins,
  getPlugin,
  defaultInstalledPluginsPath,
} from './scanner';
export { createPlugin, updatePlugin, deletePlugin } from './writer';
export { getEnabled, setEnabled } from './state';
export type {
  Plugin,
  InstalledPluginVersion,
  InstalledPluginsFile,
  PluginCreateInput,
  PluginUpdatePatch,
} from './types';

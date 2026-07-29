/**
 * electron/repo/hooks/index.ts — Hooks 模块聚合导出
 *
 * 聚合 `electron/repo/hooks/{scanner,writer,state,types}.ts`,对外暴露:
 * - 扫描:listHooks / getHook / defaultSettingsPath
 * - 写入:createHook / updateHook / deleteHook
 * - 状态:getEnabled / setEnabled(KV 命名空间 hook:enabled:<id>)
 * - 类型:Hook / HookCreateInput / HookUpdatePatch / HookEvent / HOOK_EVENTS
 */

export { listHooks, getHook, defaultSettingsPath } from './scanner';
export { createHook, updateHook, deleteHook } from './writer';
export { getEnabled, setEnabled } from './state';
export type { Hook, HookCreateInput, HookUpdatePatch, HookEvent } from './types';
export { HOOK_EVENTS } from './types';

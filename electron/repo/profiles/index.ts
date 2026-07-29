/**
 * electron/repo/profiles/index.ts — Profiles 模块聚合导出
 *
 * 聚合 `electron/repo/profiles/{scanner,writer,state,types}.ts`,对外暴露:
 * - 扫描:listProfiles / getProfile / defaultProfilesPath
 * - 写入:createProfile / updateProfile / deleteProfile / applyProfile
 * - 捕获:captureProfileFromState(实时从 KV 表读 enabled 状态)
 * - 状态:backupEnabledStates / restoreEnabledStates(供 applyProfile 内部用)
 * - 类型:Profile / ProfileConfig / ProfileCreateInput / ProfileUpdatePatch
 *
 * Profile 是整个 ~/.claude 状态的快照 — 6 个 enabled* 命名空间(mcp /
 * skill / cmd / agent / hook / plugin)的合并视图。apply 是事务化的,
 * 失败时回滚 KV 表到 apply 前的状态(任务硬规则)。
 */

export { listProfiles, getProfile, defaultProfilesPath } from './scanner';
export {
  createProfile,
  updateProfile,
  deleteProfile,
  applyProfile,
  captureProfileFromState,
} from './writer';
export { backupEnabledStates, restoreEnabledStates } from './state';
export type {
  Profile,
  ProfileConfig,
  ProfileCreateInput,
  ProfileUpdatePatch,
} from './types';
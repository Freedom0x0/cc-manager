/**
 * electron/repo/skills/index.ts — Skills 模块聚合导出
 *
 * 聚合 `electron/repo/skills/{scanner,writer,state,types}.ts`,对外暴露:
 * - 扫描:listSkills / getSkill / readSkillFile / defaultSkillsDir / defaultDisabledSkillsDir / parseFrontmatter
 * - 写入:createSkill / updateSkill / deleteSkill
 * - 状态:getEnabled / setEnabled(KV 命名空间 skill:enabled:<name>)
 * - 类型:Skill / SkillCreateInput / SkillUpdatePatch
 */

export {
  listSkills,
  getSkill,
  readSkillFile,
  defaultSkillsDir,
  defaultDisabledSkillsDir,
  parseFrontmatter,
} from './scanner';
export { createSkill, updateSkill, deleteSkill } from './writer';
export { getEnabled, setEnabled } from './state';
export type { Skill, SkillCreateInput, SkillUpdatePatch } from './types';

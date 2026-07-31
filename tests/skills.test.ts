/**
 * tests/skills.test.ts — v5 wave-1 Skills 模块 5 case
 *
 * Case 1: listSkills() on 不存在目录 → 返 []
 * Case 2: listSkills() on fixture 目录 → 返 fixture skill + enabled 注入
 * Case 3: createSkill() 写 SKILL.md
 * Case 4: updateSkill() 改 description
 * Case 5: deleteSkill() 删目录
 *
 * Fixture 设计(CLAUDE.md §13 D10):
 * - DB 用 initDB(':memory:') — 内存 DB,沙箱干净
 * - skills 目录用 `os.tmpdir()` 临时路径,**不**碰真实 ~/.claude/skills/
 * - 通过 skillsDir 参数显式注入(不依赖环境变量,避免 ESM 模块求值时序坑)
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDB, closeDB, type DB } from '../electron/db/connection';
import {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  setEnabled,
} from '../electron/repo/skills';

// 模块级 fixture 路径 — 所有 case 共享一个 tmp 目录
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-skills-test-'));
const skillsDir = path.join(tmpRoot, 'skills');

let db: DB;

beforeEach(() => {
  db = initDB(':memory:');
  // 每个 case 起始清空 fixture 目录(让 case 1 验证"不存在"场景)
  fs.rmSync(skillsDir, { recursive: true, force: true });
});

function writeFixtureSkill(name: string, description: string, body = ''): void {
  const dir = path.join(skillsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const frontmatter = `---\ndescription: ${description}\n---\n`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), frontmatter + body);
}

// Case 1: 目录不存在 → 返 []
test('listSkills returns [] when skills directory does not exist', async () => {
  const list = await listSkills(db, skillsDir);
  assert.deepStrictEqual(list, [], '不存在目录应返空数组');
  closeDB(db);
});

// Case 2: fixture 目录 → 返 fixture skill(enabled 恒 true,因为 .disabled 跳过)
test('listSkills reads fixture directory (enabled is structural — directory presence)', async () => {
  writeFixtureSkill('commit', 'Generate commit message', 'Body content here');
  const list = await listSkills(db, skillsDir);
  assert.strictEqual(list.length, 1, '应读出 1 个 skill');
  const s = list[0];
  assert.strictEqual(s.name, 'commit');
  assert.strictEqual(s.description, 'Generate commit message');
  assert.strictEqual(s.body, 'Body content here');
  assert.strictEqual(s.enabled, true, '目录存在(非 .disabled) → enabled=true');
  closeDB(db);
});

// Case 2b (新增): setEnabled(false) → mv 到镜像目录 → list 跳过
test('listSkills excludes disabled skills moved to disabled_skills/ mirror (commit 9)', async () => {
  writeFixtureSkill('commit', 'desc');
  // setEnabled 写真实文件:disable = mv skills/commit/ → disabled_skills/commit/
  await setEnabled(db, 'commit', false, path.dirname(skillsDir));

  // 1. 物理验证:commit/ 不存在,disabled_skills/commit/ 存在
  assert.ok(!fs.existsSync(path.join(skillsDir, 'commit')), 'skills/commit/ 应被 mv 走');
  const disabledSkillsDir = path.join(path.dirname(skillsDir), 'disabled_skills');
  assert.ok(
    fs.existsSync(path.join(disabledSkillsDir, 'commit')),
    'disabled_skills/commit/ 镜像目录应存在'
  );
  // SKILL.md 内容保留在镜像目录
  assert.ok(
    fs.existsSync(path.join(disabledSkillsDir, 'commit', 'SKILL.md')),
    'SKILL.md 应保留在镜像目录'
  );
  // 关键:skills/ 目录内**没有** commit.disabled/ 残留
  assert.ok(
    !fs.existsSync(path.join(skillsDir, 'commit.disabled')),
    'skills/ 目录内不应有 commit.disabled/ 残留(commit 5 旧方案)'
  );

  // 2. list 跳过(只扫 skills/ 目录,镜像目录自动不扫)
  const list = await listSkills(db, skillsDir);
  assert.strictEqual(list.length, 0, '镜像目录不应出现在 list');

  // 3. setEnabled(true) 恢复
  await setEnabled(db, 'commit', true, path.dirname(skillsDir));
  assert.ok(fs.existsSync(path.join(skillsDir, 'commit')), 'skills/commit/ 应恢复');
  assert.ok(
    !fs.existsSync(path.join(disabledSkillsDir, 'commit')),
    'disabled_skills/commit/ 应消失'
  );
  const list2 = await listSkills(db, skillsDir);
  assert.strictEqual(list2.length, 1, '恢复后 list 应有 1 个');
  closeDB(db);
});

// Case 3: createSkill 写 SKILL.md
test('createSkill writes SKILL.md with frontmatter and body', async () => {
  await createSkill(
    {
      name: 'review',
      description: 'Code review helper',
      body: 'Review the following code:',
    },
    skillsDir
  );

  // 目录应存在
  const dir = path.join(skillsDir, 'review');
  assert.ok(fs.existsSync(dir), 'createSkill 应创建目录');
  // SKILL.md 文件应存在
  const filePath = path.join(dir, 'SKILL.md');
  assert.ok(fs.existsSync(filePath), 'SKILL.md 应被创建');
  // 内容正确
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.match(raw, /description:\s*Code review helper/, 'frontmatter 应包含 description');
  assert.match(raw, /Review the following code:/, 'body 应被包含');
  closeDB(db);
});

// Case 4: updateSkill 改 description
test('updateSkill patches description without losing body', async () => {
  writeFixtureSkill('review', 'old desc', 'body content');
  await updateSkill('review', { description: 'new desc' }, skillsDir);

  const filePath = path.join(skillsDir, 'review', 'SKILL.md');
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.match(raw, /description:\s*new desc/, 'description 应被更新');
  assert.match(raw, /body content/, 'body 应保留');
  closeDB(db);
});

// Case 5: deleteSkill 删目录
test('deleteSkill removes the skill directory', async () => {
  writeFixtureSkill('review', 'desc');
  writeFixtureSkill('commit', 'desc2');
  await deleteSkill('review', skillsDir);

  assert.ok(!fs.existsSync(path.join(skillsDir, 'review')), 'review 目录应被删除');
  assert.ok(fs.existsSync(path.join(skillsDir, 'commit')), 'commit 目录应保留');

  // 顺便验证 getSkill:删后 null
  const got = await getSkill(db, 'review', skillsDir);
  assert.strictEqual(got, null, 'getSkill 在删后应返 null');
  const got2 = await getSkill(db, 'commit', skillsDir);
  assert.ok(got2, 'getSkill 应能找到 commit');
  assert.strictEqual(got2?.name, 'commit');
  closeDB(db);
});

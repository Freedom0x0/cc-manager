/**
 * tests/commands.test.ts — v5 wave-1 Commands 模块 5 case
 *
 * Case 1: listCommands() on 不存在目录 → 返 []
 * Case 2: listCommands() on fixture 目录 → 返 fixture command + enabled 注入
 * Case 3: createCommand() 写 <name>.md
 * Case 4: updateCommand() 改 description
 * Case 5: deleteCommand() 删 .md
 *
 * Fixture 设计(CLAUDE.md §13 D10):
 * - DB 用 initDB(':memory:') — 内存 DB,沙箱干净
 * - commands 目录用 `os.tmpdir()` 临时路径,**不**碰真实 ~/.claude/commands/
 * - 通过 commandsDir 参数显式注入(不依赖环境变量,避免 ESM 模块求值时序坑)
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDB, closeDB, type DB } from '../electron/db/connection';
import {
  listCommands,
  getCommand,
  createCommand,
  updateCommand,
  deleteCommand,
  setEnabled,
} from '../electron/repo/commands';

// 模块级 fixture 路径 — 所有 case 共享一个 tmp 目录
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-commands-test-'));
const commandsDir = path.join(tmpRoot, 'commands');

let db: DB;

beforeEach(() => {
  db = initDB(':memory:');
  // 每个 case 起始清空 fixture 目录(让 case 1 验证"不存在"场景)
  fs.rmSync(commandsDir, { recursive: true, force: true });
});

function writeFixtureCommand(name: string, description: string, body = ''): void {
  // listCommands 期望目录存在;mkdirSync 在 fixture 操作前保证目录在位
  fs.mkdirSync(commandsDir, { recursive: true });
  const frontmatter = `---\ndescription: ${description}\n---\n`;
  fs.writeFileSync(path.join(commandsDir, `${name}.md`), frontmatter + body);
}

// Case 1: 目录不存在 → 返 []
test('listCommands returns [] when commands directory does not exist', async () => {
  const list = await listCommands(db, commandsDir);
  assert.deepStrictEqual(list, [], '不存在目录应返空数组');
  closeDB(db);
});

// Case 2: fixture 目录 → 返 fixture command(enabled 恒 true,因为 .disabled 跳过)
test('listCommands reads fixture directory (enabled is structural — file presence)', async () => {
  writeFixtureCommand('review', 'Review code', 'Body content here');
  const list = await listCommands(db, commandsDir);
  assert.strictEqual(list.length, 1, '应读出 1 个 command');
  const c = list[0];
  assert.strictEqual(c.name, 'review');
  assert.strictEqual(c.description, 'Review code');
  assert.strictEqual(c.body, 'Body content here');
  assert.strictEqual(c.enabled, true, '.md 文件存在(非 .md.disabled) → enabled=true');
  closeDB(db);
});

// Case 2b (新增): setEnabled(false) → mv 文件为 .md.disabled → list 跳过
test('listCommands includes .md.disabled files with enabled=false after setEnabled(false)', async () => {
  writeFixtureCommand('review', 'desc');
  // setEnabled 写真实文件:disable = mv review.md → review.md.disabled
  await setEnabled(db, 'review', false, path.dirname(commandsDir));

  // 1. 物理验证:review.md 不存在,review.md.disabled 存在
  assert.ok(!fs.existsSync(path.join(commandsDir, 'review.md')), 'review.md 应被 mv 走');
  assert.ok(
    fs.existsSync(path.join(commandsDir, 'review.md.disabled')),
    'review.md.disabled 应存在'
  );

  // 2. list **包含** .md.disabled,标 enabled=false(D14 改造 — 与 skills 镜像方案对称)
  const list = await listCommands(db, commandsDir);
  assert.strictEqual(list.length, 1, '.md.disabled 应出现在列表,enabled=false');
  assert.strictEqual(list[0].name, 'review', 'name 应是 review(去掉 .md.disabled 后缀)');
  assert.strictEqual(list[0].enabled, false, 'enabled=false 反映 .md.disabled 后缀');

  // 3. setEnabled(true) 恢复
  await setEnabled(db, 'review', true, path.dirname(commandsDir));
  assert.ok(fs.existsSync(path.join(commandsDir, 'review.md')), 'review.md 应恢复');
  assert.ok(
    !fs.existsSync(path.join(commandsDir, 'review.md.disabled')),
    'review.md.disabled 应消失'
  );
  const list2 = await listCommands(db, commandsDir);
  assert.strictEqual(list2.length, 1, '恢复后 list 应有 1 个');
  assert.strictEqual(list2[0].enabled, true, '恢复后 enabled=true');
  closeDB(db);
});

// Case 3: createCommand 写 .md
test('createCommand writes .md with frontmatter and body', async () => {
  await createCommand(
    {
      name: 'release',
      description: 'Bump version and tag',
      body: 'Run npm version and git tag push.',
    },
    commandsDir
  );

  // .md 文件应存在
  const filePath = path.join(commandsDir, 'release.md');
  assert.ok(fs.existsSync(filePath), 'release.md 应被创建');
  // 内容正确
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.match(raw, /description:\s*Bump version and tag/, 'frontmatter 应包含 description');
  assert.match(raw, /Run npm version and git tag push\./, 'body 应被包含');
  closeDB(db);
});

// Case 4: updateCommand 改 description
test('updateCommand patches description without losing body', async () => {
  writeFixtureCommand('release', 'old desc', 'body content');
  await updateCommand('release', { description: 'new desc' }, commandsDir);

  const filePath = path.join(commandsDir, 'release.md');
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.match(raw, /description:\s*new desc/, 'description 应被更新');
  assert.match(raw, /body content/, 'body 应保留');
  closeDB(db);
});

// Case 5: deleteCommand 删 .md
test('deleteCommand removes the .md file', async () => {
  writeFixtureCommand('review', 'desc');
  writeFixtureCommand('commit', 'desc2');
  await deleteCommand('review', commandsDir);

  assert.ok(!fs.existsSync(path.join(commandsDir, 'review.md')), 'review.md 应被删除');
  assert.ok(fs.existsSync(path.join(commandsDir, 'commit.md')), 'commit.md 应保留');

  // 顺便验证 getCommand:删后 null
  const got = await getCommand(db, 'review', commandsDir);
  assert.strictEqual(got, null, 'getCommand 在删后应返 null');
  const got2 = await getCommand(db, 'commit', commandsDir);
  assert.ok(got2, 'getCommand 应能找到 commit');
  assert.strictEqual(got2?.name, 'commit');
  closeDB(db);
});

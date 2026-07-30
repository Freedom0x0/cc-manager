/**
 * tests/sub-agents.test.ts — v5 wave-2 Sub-Agents 模块 5 case
 *
 * Case 1: listSubAgents() on 不存在目录 → 返 []
 * Case 2: listSubAgents() on fixture 目录 → 返 fixture sub-agent + enabled 注入
 * Case 3: createSubAgent() 写 <name>.md
 * Case 4: updateSubAgent() 改 description
 * Case 5: deleteSubAgent() 删 .md
 *
 * Fixture 设计(CLAUDE.md §13 D10):
 * - DB 用 initDB(':memory:') — 内存 DB,沙箱干净
 * - agents 目录用 `os.tmpdir()` 临时路径,**不**碰真实 ~/.claude/agents/
 * - 通过 agentsDir 参数显式注入(不依赖环境变量,避免 ESM 模块求值时序坑)
 *
 * 与 tests/commands.test.ts **同形**(同字段、同函数签名)— Sub-Agents 模块
 * 跟 Commands 模块几乎复制,只换 fixture 目录与字段名。
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDB, closeDB, type DB } from '../electron/db/connection';
import {
  listSubAgents,
  getSubAgent,
  createSubAgent,
  updateSubAgent,
  deleteSubAgent,
  setEnabled,
} from '../electron/repo/sub-agents';

// 模块级 fixture 路径 — 所有 case 共享一个 tmp 目录
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-subagents-test-'));
const agentsDir = path.join(tmpRoot, 'agents');

let db: DB;

beforeEach(() => {
  db = initDB(':memory:');
  // 每个 case 起始清空 fixture 目录(让 case 1 验证"不存在"场景)
  fs.rmSync(agentsDir, { recursive: true, force: true });
});

function writeFixtureSubAgent(name: string, description: string, body = ''): void {
  // listSubAgents 期望目录存在;mkdirSync 在 fixture 操作前保证目录在位
  fs.mkdirSync(agentsDir, { recursive: true });
  const frontmatter = `---\ndescription: ${description}\n---\n`;
  fs.writeFileSync(path.join(agentsDir, `${name}.md`), frontmatter + body);
}

// Case 1: 目录不存在 → 返 []
test('listSubAgents returns [] when agents directory does not exist', async () => {
  const list = await listSubAgents(db, agentsDir);
  assert.deepStrictEqual(list, [], '不存在目录应返空数组');
  closeDB(db);
});

// Case 2: fixture 目录 → 返 fixture sub-agent(enabled 恒 true,因为 .disabled 跳过)
test('listSubAgents reads fixture directory (enabled is structural — file presence)', async () => {
  writeFixtureSubAgent('explore', 'Read-only code exploration', 'Body content here');
  const list = await listSubAgents(db, agentsDir);
  assert.strictEqual(list.length, 1, '应读出 1 个 sub-agent');
  const a = list[0];
  assert.strictEqual(a.name, 'explore');
  assert.strictEqual(a.description, 'Read-only code exploration');
  assert.strictEqual(a.body, 'Body content here');
  assert.strictEqual(a.enabled, true, '.md 文件存在(非 .md.disabled) → enabled=true');
  closeDB(db);
});

// Case 2b (新增): setEnabled(false) → mv 文件为 .md.disabled → list 跳过
test('listSubAgents excludes .md.disabled files after setEnabled(false)', async () => {
  writeFixtureSubAgent('explore', 'desc');
  await setEnabled(db, 'explore', false, path.dirname(agentsDir));

  // 1. 物理验证
  assert.ok(!fs.existsSync(path.join(agentsDir, 'explore.md')), 'explore.md 应被 mv 走');
  assert.ok(
    fs.existsSync(path.join(agentsDir, 'explore.md.disabled')),
    'explore.md.disabled 应存在'
  );

  // 2. list 跳过
  const list = await listSubAgents(db, agentsDir);
  assert.strictEqual(list.length, 0, '.md.disabled 不应出现在列表');

  // 3. setEnabled(true) 恢复
  await setEnabled(db, 'explore', true, path.dirname(agentsDir));
  assert.ok(fs.existsSync(path.join(agentsDir, 'explore.md')), 'explore.md 应恢复');
  assert.ok(
    !fs.existsSync(path.join(agentsDir, 'explore.md.disabled')),
    'explore.md.disabled 应消失'
  );
  const list2 = await listSubAgents(db, agentsDir);
  assert.strictEqual(list2.length, 1, '恢复后 list 应有 1 个');
  closeDB(db);
});

// Case 3: createSubAgent 写 .md
test('createSubAgent writes .md with frontmatter and body', async () => {
  await createSubAgent(
    {
      name: 'plan',
      description: 'Plan a multi-step implementation',
      body: 'Analyze requirements and propose a phased plan.',
    },
    agentsDir
  );

  // .md 文件应存在
  const filePath = path.join(agentsDir, 'plan.md');
  assert.ok(fs.existsSync(filePath), 'plan.md 应被创建');
  // 内容正确
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.match(raw, /description:\s*Plan a multi-step implementation/, 'frontmatter 应包含 description');
  assert.match(raw, /Analyze requirements and propose a phased plan\./, 'body 应被包含');
  closeDB(db);
});

// Case 4: updateSubAgent 改 description
test('updateSubAgent patches description without losing body', async () => {
  writeFixtureSubAgent('plan', 'old desc', 'body content');
  await updateSubAgent('plan', { description: 'new desc' }, agentsDir);

  const filePath = path.join(agentsDir, 'plan.md');
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.match(raw, /description:\s*new desc/, 'description 应被更新');
  assert.match(raw, /body content/, 'body 应保留');
  closeDB(db);
});

// Case 5: deleteSubAgent 删 .md
test('deleteSubAgent removes the .md file', async () => {
  writeFixtureSubAgent('explore', 'desc');
  writeFixtureSubAgent('plan', 'desc2');
  await deleteSubAgent('explore', agentsDir);

  assert.ok(!fs.existsSync(path.join(agentsDir, 'explore.md')), 'explore.md 应被删除');
  assert.ok(fs.existsSync(path.join(agentsDir, 'plan.md')), 'plan.md 应保留');

  // 顺便验证 getSubAgent:删后 null
  const got = await getSubAgent(db, 'explore', agentsDir);
  assert.strictEqual(got, null, 'getSubAgent 在删后应返 null');
  const got2 = await getSubAgent(db, 'plan', agentsDir);
  assert.ok(got2, 'getSubAgent 应能找到 plan');
  assert.strictEqual(got2?.name, 'plan');
  closeDB(db);
});

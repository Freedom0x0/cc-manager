/**
 * tests/hooks.test.ts — v5 wave-2 Hooks 模块 5 case
 *
 * v5 wave-3 改造(2026-07-30 PRD real-disable):
 * enabled 状态从 settings.json 的 hooks[] 数组存在性读(PRD 决策:
 * disable = splice 移除,enable = 通过 createHook 重建)。不再是
 * mcp_server_state KV 表(D10 决策 — 真停用)。
 *
 * Case 1: listHooks() on 不存在 settings.json → 返 []
 * Case 2: listHooks() on fixture settings.json → 解析 2 event 分组返 3 hook
 * Case 3: createHook 加到 PreToolUse 数组 + 原子写
 * Case 4: updateHook 改 matcher(**其他字段保留** — 重点测不破坏其他 event 数组)
 * Case 5: deleteHook 从 PreToolUse 数组移除(PostToolUse 不动)
 * Case 6: setEnabled(false) → splice 移除该 hook(真停用硬证据)
 *
 * Fixture 设计(CLAUDE.md §13 D10):
 * - DB 用 initDB(':memory:') — 内存 DB,沙箱干净
 * - settings.json 路径用 `os.tmpdir()` 临时路径,**不**碰真实
 *   ~/.claude/settings.json
 * - 通过 settingsPath 参数显式注入(不依赖环境变量,避免 ESM 模块求值时序坑)
 *
 * 与 tests/mcp.test.ts 同形 — 都改单 JSON 配置文件,但 hooks 改的是嵌套
 * 字段(hooks:<event>)而非顶层(mcpServers:<name>),所以读 + 改 + 写时
 * 必须保留 settings.json 的其他字段(mcpServers / permissions / ...)。
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDB, closeDB, type DB } from '../electron/db/connection';
import {
  listHooks,
  getHook,
  createHook,
  updateHook,
  deleteHook,
  setEnabled,
  HOOK_EVENTS,
} from '../electron/repo/hooks';

// 模块级 fixture 路径 — 所有 case 共享一个 tmp 目录
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-hooks-test-'));
const settingsPath = path.join(tmpRoot, 'settings.json');

let db: DB;

beforeEach(() => {
  db = initDB(':memory:');
  // 每个 case 起始清空 fixture 文件(让 case 1 验证"不存在"场景)
  fs.rmSync(settingsPath, { force: true });
});

function writeFixtureSettings(content: object): void {
  // 模拟"用户已有 settings.json 含其它字段" — 这时 create/update 必须
  // 字节级保留 mcpServers 等其他字段(Case 4 是硬证据)
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(content, null, 2));
}

// Case 1: settings.json 不存在 → 返 []
test('listHooks returns [] when settings.json does not exist', async () => {
  const list = await listHooks(db, settingsPath);
  assert.deepStrictEqual(list, [], '不存在 settings.json 应返空数组');
  closeDB(db);
});

// Case 2: fixture settings.json → 解析 2 event 分组返 3 hook
test('listHooks parses fixture settings.json (enabled is structural — array presence)', async () => {
  writeFixtureSettings({
    permissions: { allow: ['Bash'] }, // 其他字段保留的证据 — 后面 case 会原值读回
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre1' }] },
        { matcher: 'Read', hooks: [{ type: 'command', command: 'echo pre2' }] },
      ],
      PostToolUse: [
        { hooks: [{ type: 'command', command: 'echo post1' }] },
      ],
    },
  });
  // enabled 推导:hooks[event] 数组中存在 → enabled=true(PRD 决策)
  const list = await listHooks(db, settingsPath);
  assert.strictEqual(list.length, 3, '应读出 3 个 hook(2 PreToolUse + 1 PostToolUse)');
  // id 顺序按 event 扁平化(PreToolUse 在前)
  assert.strictEqual(list[0].id, 'PreToolUse-0');
  assert.strictEqual(list[0].event, 'PreToolUse');
  assert.strictEqual(list[0].matcher, 'Bash');
  assert.strictEqual(list[0].command, 'echo pre1');
  assert.strictEqual(list[0].enabled, true, 'hooks[] 中存在 → enabled=true');
  assert.strictEqual(list[1].id, 'PreToolUse-1');
  assert.strictEqual(list[2].id, 'PostToolUse-0');
  assert.strictEqual(list[2].matcher, undefined, 'PostToolUse-0 无 matcher');
  assert.strictEqual(list[2].command, 'echo post1');
  closeDB(db);
});

// Case 3: createHook 加到 PreToolUse 数组 + 原子写
test('createHook appends to PreToolUse array with atomic write', async () => {
  writeFixtureSettings({
    hooks: {
      PreToolUse: [{ hooks: [{ type: 'command', command: 'echo pre1' }] }],
    },
  });
  await createHook(
    { event: 'PreToolUse', matcher: 'Write', command: 'echo new' },
    settingsPath
  );

  // 读回 settings.json 验证 PreToolUse 数组新增一项,且原有不变
  const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(raw.hooks.PreToolUse.length, 2, 'PreToolUse 数组应新增 1 条');
  assert.strictEqual(raw.hooks.PreToolUse[0].hooks[0].command, 'echo pre1', '原项保留');
  assert.strictEqual(raw.hooks.PreToolUse[1].matcher, 'Write', '新项 matcher 写入');
  assert.strictEqual(raw.hooks.PreToolUse[1].hooks[0].command, 'echo new', '新项 command 写入');
  closeDB(db);
});

// Case 4: updateHook 改 matcher — 其他 event 数组与 mcpServers/permissions 字节级保留
test('updateHook patches matcher without disturbing other fields or other event arrays', async () => {
  writeFixtureSettings({
    mcpServers: { fs: { command: 'npx', args: ['-y', 'fs'] } }, // 必须保留
    permissions: { allow: ['Bash', 'Read'] }, // 必须保留
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
      PostToolUse: [{ hooks: [{ type: 'command', command: 'echo post' }] }],
    },
  });
  await updateHook(
    'PreToolUse-0',
    { matcher: 'Read' },
    HOOK_EVENTS,
    settingsPath
  );

  const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  // matcher 被改
  assert.strictEqual(raw.hooks.PreToolUse[0].matcher, 'Read', 'matcher 应改为 Read');
  // command 保留
  assert.strictEqual(raw.hooks.PreToolUse[0].hooks[0].command, 'echo pre', 'command 保留');
  // PostToolUse 不动(关键)
  assert.strictEqual(raw.hooks.PostToolUse.length, 1, 'PostToolUse 数组保持长度');
  assert.strictEqual(raw.hooks.PostToolUse[0].hooks[0].command, 'echo post', 'PostToolUse 内容保留');
  // mcpServers / permissions 字节级保留(**这是硬证据** — 不会被 hooks 修改吞掉)
  assert.deepStrictEqual(
    raw.mcpServers,
    { fs: { command: 'npx', args: ['-y', 'fs'] } },
    'mcpServers 字段字节级保留'
  );
  assert.deepStrictEqual(
    raw.permissions,
    { allow: ['Bash', 'Read'] },
    'permissions 字段字节级保留'
  );
  closeDB(db);
});

// Case 5: deleteHook 从 PreToolUse 数组移除(PostToolUse 不动)
test('deleteHook removes entry from PreToolUse without touching PostToolUse', async () => {
  writeFixtureSettings({
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre1' }] },
        { matcher: 'Read', hooks: [{ type: 'command', command: 'echo pre2' }] },
      ],
      PostToolUse: [{ hooks: [{ type: 'command', command: 'echo post1' }] }],
    },
  });
  await deleteHook('PreToolUse-0', HOOK_EVENTS, settingsPath);

  const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(raw.hooks.PreToolUse.length, 1, 'PreToolUse-0 应被移除');
  assert.strictEqual(raw.hooks.PreToolUse[0].matcher, 'Read', 'PreToolUse-1 提升到 index 0');
  // PostToolUse 不动
  assert.strictEqual(raw.hooks.PostToolUse.length, 1, 'PostToolUse 数组不动');
  assert.strictEqual(raw.hooks.PostToolUse[0].hooks[0].command, 'echo post1');

  // 顺便验证 getHook:被删的 PreToolUse-0(原 Bash hook) 不再以 Bash 身份存在
  // → 删除 PreToolUse-0 后索引 0 变为 Read hook,所以查 event=PreToolUse 会
  //   找到 matcher='Read' 的 hook(不再是 'Bash')。直接断言"pre1" 不在 raw 内。
  const raw2 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const allCommands = JSON.stringify(raw2.hooks);
  assert.ok(!allCommands.includes('echo pre1'), 'pre1 命令应被移除');
  assert.ok(allCommands.includes('echo pre2'), 'pre2 保留');
  assert.ok(allCommands.includes('echo post1'), 'post1 保留');
  // getHook('PostToolUse-0') 仍可找到 — 验证 PostToolUse 区间未受影响
  const post = await getHook(db, 'PostToolUse-0', settingsPath);
  assert.ok(post, 'PostToolUse-0 应存在');
  assert.strictEqual(post?.command, 'echo post1');
  closeDB(db);
});

// Case 6 (新增): setEnabled(false) → splice 移除该 hook(真停用硬证据)
test('setEnabled(false) splices the hook from settings.json (real disable)', async () => {
  writeFixtureSettings({
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre1' }] },
        { matcher: 'Read', hooks: [{ type: 'command', command: 'echo pre2' }] },
      ],
    },
  });

  // 停用 PreToolUse-0
  await setEnabled(db, 'PreToolUse-0', false, settingsPath, HOOK_EVENTS);

  // 1. settings.json 真变了:PreToolUse-0 被 splice
  const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(
    raw.hooks.PreToolUse.length,
    1,
    'PreToolUse 数组应剩 1 条(被停用那个被 splice)'
  );
  assert.strictEqual(
    raw.hooks.PreToolUse[0].matcher,
    'Read',
    '剩余应是原 PreToolUse-1(Read)'
  );

  // 2. list 也不再有 PreToolUse-0
  const list = await listHooks(db, settingsPath);
  assert.strictEqual(list.length, 1, 'list 长度 = 1');
  assert.strictEqual(list[0].id, 'PreToolUse-0', '原 PreToolUse-1 提升到 index 0');
  assert.strictEqual(list[0].matcher, 'Read');
  closeDB(db);
});

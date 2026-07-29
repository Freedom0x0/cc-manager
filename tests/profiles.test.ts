/**
 * tests/profiles.test.ts — v5 wave-3 Profiles 模块 5 case
 *
 * Case 1: listProfiles on 不存在 profiles.json → 返 []
 * Case 2: listProfiles on fixture → 返 fixture profiles
 * Case 3: captureProfile 从 KV 表 enabled 状态生成(关键测试)
 * Case 4: applyProfile 写 KV 表 + 验证事务
 * Case 5: applyProfile 失败回滚(故意传错 profile 触发 throw,验证 KV 表恢复)
 *
 * Fixture 设计(CLAUDE.md §13 D10):
 * - DB 用 initDB(':memory:') — 内存 DB,沙箱干净
 * - profiles 路径用 `os.tmpdir()` 临时路径,**不**碰真实 ~/.claude/profiles.json
 * - 通过 profilesPath 参数显式注入(避免依赖环境变量)
 *
 * KV 表交互:6 个 enabled* 命名空间(mcp: / skill: / cmd: / agent: / hook:
 * / plugin:)都用 prepared statement 直接写,不走各模块的 setEnabled(避免
 * 测试与其他模块耦合)。这是 wave-3 Profiles 的特性:profile_apply 操作
 * 横跨 6 个模块的 KV 命名空间,但只读写,不依赖各模块的 schema 校验。
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDB, closeDB, type DB } from '../electron/db/connection';
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  applyProfile,
  captureProfileFromState,
} from '../electron/repo/profiles';

// 模块级 fixture 路径 — 所有 case 共享一个 tmp 目录
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-profiles-test-'));
const profilesPath = path.join(tmpRoot, 'profiles.json');

let db: DB;

beforeEach(() => {
  db = initDB(':memory:');
  // 每个 case 起始清空 fixture 文件
  fs.rmSync(profilesPath, { force: true });
});

/** 直接写 KV 表的辅助函数(不走各模块 setEnabled)— Case 3/4 用 */
function setKvEnabled(db: DB, prefix: 'mcp' | 'skill' | 'cmd' | 'agent' | 'hook' | 'plugin', name: string, enabled: boolean): void {
  const v = enabled ? 'true' : 'false';
  db.prepare(
    "INSERT INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(`${prefix}:enabled:${name}`, v, Date.now());
}

/** 直接读 KV 表的辅助函数 */
function getKvEnabled(db: DB, prefix: string, name: string): string | null {
  const row = db.prepare(
    "SELECT value FROM mcp_server_state WHERE key = ?"
  ).get(`${prefix}:enabled:${name}`) as { value: string } | undefined;
  return row?.value ?? null;
}

// Case 1: profiles.json 不存在 → 返 []
test('listProfiles returns [] when profiles.json does not exist', async () => {
  const list = await listProfiles(profilesPath);
  assert.deepStrictEqual(list, [], '不存在文件应返空数组');
  closeDB(db);
});

// Case 2: fixture profiles.json → 返 fixture profiles
test('listProfiles reads fixture profiles.json', async () => {
  fs.writeFileSync(
    profilesPath,
    JSON.stringify({
      profiles: [
        {
          name: 'work',
          description: 'work mode',
          config: {
            enabledServers: ['a'],
            enabledSkills: [],
            enabledCommands: [],
            enabledAgents: [],
            enabledHooks: [],
            enabledPlugins: [],
          },
          createdAt: '2026-07-29T00:00:00.000Z',
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
        {
          name: 'home',
          description: 'home mode',
          config: {
            enabledServers: [],
            enabledSkills: ['b'],
            enabledCommands: [],
            enabledAgents: [],
            enabledHooks: [],
            enabledPlugins: [],
          },
          createdAt: '2026-07-29T00:00:00.000Z',
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
      ],
    })
  );
  const list = await listProfiles(profilesPath);
  assert.strictEqual(list.length, 2, '应读出 2 个 profile');
  assert.strictEqual(list[0].name, 'work');
  assert.strictEqual(list[0].description, 'work mode');
  assert.deepStrictEqual(list[0].config.enabledServers, ['a']);
  assert.strictEqual(list[1].name, 'home');
  assert.deepStrictEqual(list[1].config.enabledSkills, ['b']);

  // getProfile 单查
  const single = await getProfile('home', profilesPath);
  assert.ok(single, 'home 应存在');
  assert.strictEqual(single.name, 'home');
  closeDB(db);
});

// Case 3: captureProfile 从 KV 表 enabled 状态生成(关键测试)
test('captureProfile reads KV table and generates ProfileConfig', async () => {
  // 在 KV 表 6 个命名空间各写 enabled=true / false 混合数据
  setKvEnabled(db, 'mcp', 'filesystem', true);
  setKvEnabled(db, 'mcp', 'github', false);
  setKvEnabled(db, 'skill', 'commit-helper', true);
  setKvEnabled(db, 'cmd', 'review', true);
  setKvEnabled(db, 'agent', 'explore', true);
  setKvEnabled(db, 'hook', 'PreToolUse-0', true);
  setKvEnabled(db, 'plugin', 'gh', true);
  setKvEnabled(db, 'plugin', 'docker-tools', false);

  // 实时 capture
  const config = captureProfileFromState(db);
  assert.deepStrictEqual(config.enabledServers, ['filesystem'], 'enabled=true 的 server');
  assert.deepStrictEqual(config.enabledSkills, ['commit-helper']);
  assert.deepStrictEqual(config.enabledCommands, ['review']);
  assert.deepStrictEqual(config.enabledAgents, ['explore']);
  assert.deepStrictEqual(config.enabledHooks, ['PreToolUse-0']);
  assert.deepStrictEqual(config.enabledPlugins, ['gh'], 'enabled=true 的 plugin');

  // createProfile 完整流程(实时 capture + 写 profiles.json)
  await createProfile(db, { name: 'captured', description: 'auto-captured' }, profilesPath);
  const list = await listProfiles(profilesPath);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'captured');
  assert.deepStrictEqual(list[0].config.enabledServers, ['filesystem']);
  // createdAt / updatedAt 应该是 ISO 字符串
  assert.match(list[0].createdAt, /^\d{4}-\d{2}-\d{2}T/, 'createdAt 应是 ISO');
  closeDB(db);
});

// Case 4: applyProfile 写 KV 表 + 验证事务
test('applyProfile writes enabled=true to KV table and verifies', () => {
  // 先在 KV 表写一些 enabled=false 的项(模拟当前 disabled 状态)
  setKvEnabled(db, 'mcp', 'filesystem', false);
  setKvEnabled(db, 'skill', 'commit-helper', false);

  // 用 fixture 直接写一个 profile(enabledServers: ['filesystem'])
  fs.writeFileSync(
    profilesPath,
    JSON.stringify({
      profiles: [
        {
          name: 'enable-fs',
          description: 'enable filesystem',
          config: {
            enabledServers: ['filesystem'],
            enabledSkills: ['commit-helper'],
            enabledCommands: [],
            enabledAgents: [],
            enabledHooks: [],
            enabledPlugins: [],
          },
          createdAt: '2026-07-29T00:00:00.000Z',
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
      ],
    })
  );

  const result = applyProfile(db, 'enable-fs', profilesPath);
  assert.strictEqual(result.ok, true);
  assert.ok(typeof result.appliedAt === 'number');

  // 验证 KV 表 — 应 enabled=true
  assert.strictEqual(getKvEnabled(db, 'mcp', 'filesystem'), 'true', 'filesystem 应启用');
  assert.strictEqual(getKvEnabled(db, 'skill', 'commit-helper'), 'true', 'commit-helper 应启用');
  closeDB(db);
});

// Case 5: applyProfile 失败回滚(故意构造坏 profile 触发 throw,验证 KV 表恢复)
test('applyProfile rolls back KV state on failure', () => {
  // 1. 设置初始 KV 状态(已 enabled 的若干项)
  setKvEnabled(db, 'mcp', 'filesystem', true);
  setKvEnabled(db, 'mcp', 'github', true);
  setKvEnabled(db, 'skill', 'commit-helper', true);

  // 2. 写一个故意破坏的 profile:config 缺 enabledServers 字段
  //    → applyConfigToState 访问 undefined.enabledServers 抛 TypeError
  fs.writeFileSync(
    profilesPath,
    JSON.stringify({
      profiles: [
        {
          name: 'broken',
          description: 'config is missing enabledServers',
          config: {}, // 故意空对象 — applyConfigToState 会抛
          createdAt: '2026-07-29T00:00:00.000Z',
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
      ],
    })
  );

  // 3. applyProfile 应该 throw
  assert.throws(
    () => applyProfile(db, 'broken', profilesPath),
    /is not iterable|Cannot read|undefined/,
    'broken profile 应抛 TypeError(访问 undefined.enabledServers)'
  );

  // 4. 验证 KV 表恢复(初始 3 项应保持 enabled=true)
  assert.strictEqual(getKvEnabled(db, 'mcp', 'filesystem'), 'true', 'filesystem 应保持 enabled');
  assert.strictEqual(getKvEnabled(db, 'mcp', 'github'), 'true', 'github 应保持 enabled');
  assert.strictEqual(getKvEnabled(db, 'skill', 'commit-helper'), 'true', 'commit-helper 应保持 enabled');
  closeDB(db);
});
/**
 * tests/plugins.test.ts — v5 wave-2 Plugins 模块 5 case
 *
 * 2026-07-30 重写:从假设的"`<name>/plugin.json` 目录"改为实际
 * `~/.claude/plugins/installed_plugins.json` 单文件。
 *
 * Case 1: listPlugins() on 不存在文件 → 返 []
 * Case 2: listPlugins() on fixture 文件 → 返 fixture plugin + enabled 注入
 * Case 3: createPlugin() 写 installed_plugins.json(必填字段校验通过)
 * Case 4: updatePlugin() 改 version(scope 保留)— 重点测不破坏其他字段
 * Case 5: createPlugin() 缺必填字段(没 version)→ throw(任务硬规则)
 *
 * Fixture 设计(CLAUDE.md §13 D10):
 * - DB 用 initDB(':memory:') — 内存 DB,沙箱干净
 * - installed_plugins.json 用 `os.tmpdir()` 临时路径,**不**碰真实
 *   ~/.claude/plugins/installed_plugins.json
 * - 通过 filePath 参数显式注入(不依赖环境变量)
 *
 * 与 Skill / Sub-Agent / Command / Hook 的最大差异:**严格 schema 校验**
 * (缺必填字段 throw,而非 silent return null)— wave-2-spec §2.3。
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDB, closeDB, type DB } from '../electron/db/connection';
import {
  listPlugins,
  getPlugin,
  createPlugin,
  updatePlugin,
  deletePlugin,
  setEnabled,
} from '../electron/repo/plugins';

let db: DB;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-plugins-test-'));
const installedPath = path.join(tmpDir, 'installed_plugins.json');

beforeEach(() => {
  db = initDB(':memory:');
  // 每个 case 起始清空 fixture 文件
  fs.rmSync(installedPath, { force: true });
});

function writeFixtureFile(plugins: Record<string, unknown[]>): void {
  fs.writeFileSync(
    installedPath,
    JSON.stringify({ version: 2, plugins }, null, 2)
  );
}

// Case 1: 文件不存在 → 返 []
test('listPlugins returns [] when installed_plugins.json does not exist', async () => {
  const list = await listPlugins(db, installedPath);
  assert.deepStrictEqual(list, [], '不存在文件应返空数组');
  closeDB(db);
});

// Case 2: fixture 文件 → 返 fixture plugin + enabled 注入
test('listPlugins reads installed_plugins.json and injects enabled state from KV', async () => {
  writeFixtureFile({
    'gh@claude-plugins-official': [
      {
        scope: 'user',
        installPath: 'C:/Users/.../gh/1.0.0',
        version: '1.2.0',
        installedAt: '2026-07-01T06:16:31.254Z',
        lastUpdated: '2026-07-01T06:16:31.254Z',
        gitCommitSha: 'abc1234567',
      },
    ],
  });

  // 默认 enabled = true(KV 表无 key)
  const list = await listPlugins(db, installedPath);
  assert.strictEqual(list.length, 1, '应读出 1 个 plugin');
  const p = list[0];
  assert.strictEqual(p.fullName, 'gh@claude-plugins-official');
  assert.strictEqual(p.name, 'gh', 'shortName 解析');
  assert.strictEqual(p.marketplace, 'claude-plugins-official');
  assert.strictEqual(p.version, '1.2.0');
  assert.strictEqual(p.scope, 'user');
  assert.strictEqual(p.installPath, 'C:/Users/.../gh/1.0.0');
  assert.strictEqual(p.gitCommitSha, 'abc1234567');
  assert.strictEqual(p.enabled, true, '默认 enabled=true');

  // 设 enabled=false 后应读出来
  setEnabled(db, 'gh@claude-plugins-official', false);
  const list2 = await listPlugins(db, installedPath);
  assert.strictEqual(list2[0].enabled, false, 'KV 表写入后 enabled=false');
  closeDB(db);
});

// Case 3: createPlugin 写 installed_plugins.json(必填字段校验通过)
test('createPlugin writes installed_plugins.json with required fields', async () => {
  await createPlugin(
    {
      fullName: 'my-plugin@local',
      installPath: 'C:/Users/.../my-plugin/1.0.0',
      version: '1.0.0',
      scope: 'user',
    },
    installedPath
  );

  // 文件应存在
  assert.ok(fs.existsSync(installedPath), 'installed_plugins.json 应被创建');
  // 内容正确
  const raw = JSON.parse(fs.readFileSync(installedPath, 'utf8')) as {
    plugins: Record<string, Array<Record<string, unknown>>>;
  };
  assert.ok(raw.plugins['my-plugin@local'], 'plugin 条目应存在');
  const entry = raw.plugins['my-plugin@local'][0];
  assert.strictEqual(entry.scope, 'user');
  assert.strictEqual(entry.installPath, 'C:/Users/.../my-plugin/1.0.0');
  assert.strictEqual(entry.version, '1.0.0');
  assert.ok(typeof entry.installedAt === 'string');
  assert.ok(typeof entry.lastUpdated === 'string');
  closeDB(db);
});

// Case 4: updatePlugin 改 version(scope 保留)— 重点测不破坏其他字段
test('updatePlugin patches version while preserving scope', async () => {
  writeFixtureFile({
    'plan@local': [
      {
        scope: 'user',
        installPath: 'C:/Users/.../plan/2.0.0',
        version: '2.0.0',
        installedAt: '2026-07-01T00:00:00.000Z',
        lastUpdated: '2026-07-01T00:00:00.000Z',
        gitCommitSha: 'sha-old',
      },
    ],
  });
  await updatePlugin(
    'plan@local',
    { version: '2.1.0' },
    installedPath
  );

  const raw = JSON.parse(fs.readFileSync(installedPath, 'utf8')) as {
    plugins: Record<string, Array<Record<string, unknown>>>;
  };
  const entry = raw.plugins['plan@local'][0];
  assert.strictEqual(entry.version, '2.1.0', 'version 应被更新');
  assert.strictEqual(entry.scope, 'user', 'scope 应保留');
  assert.strictEqual(entry.installPath, 'C:/Users/.../plan/2.0.0', 'installPath 应保留');
  assert.strictEqual(entry.gitCommitSha, 'sha-old', 'gitCommitSha 应保留');
  closeDB(db);
});

// Case 5: createPlugin 缺必填字段(没 version)→ throw(任务硬规则)
test('createPlugin throws when required field (version) is missing', async () => {
  await assert.rejects(
    async () =>
      createPlugin(
        {
          fullName: 'invalid@local',
          installPath: '/tmp/invalid',
          scope: 'user',
        } as never,
        installedPath
      ),
    /missing required field "version"/,
    'createPlugin 应抛错提示缺 version'
  );
  closeDB(db);
});

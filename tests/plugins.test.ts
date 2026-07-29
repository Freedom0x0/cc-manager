/**
 * tests/plugins.test.ts — v5 wave-2 Plugins 模块 5 case
 *
 * Case 1: listPlugins() on 不存在目录 → 返 []
 * Case 2: listPlugins() on fixture 目录 → 返 fixture plugin + enabled 注入
 * Case 3: createPlugin() 写 plugin.json(必填字段校验通过)
 * Case 4: updatePlugin() 改 description(**version 保留** — 重点测)
 * Case 5: createPlugin() 缺必填字段(没 version)→ throw(任务硬规则)
 *
 * Fixture 设计(CLAUDE.md §13 D10):
 * - DB 用 initDB(':memory:') — 内存 DB,沙箱干净
 * - plugins 目录用 `os.tmpdir()` 临时路径,**不**碰真实 ~/.claude/plugins/
 * - 通过 pluginsDir 参数显式注入(不依赖环境变量,避免 ESM 模块求值时序坑)
 *
 * 与 tests/sub-agents.test.ts **结构同形**(都改单 .json 文件 + 严格
 * schema),但 plugin 是**目录** + plugin.json JSON(而非 frontmatter).
 *
 * 跟 Skill / Sub-Agent / Command / Hook 的最大差异:**严格 schema 校验**
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

// 模块级 fixture 路径 — 所有 case 共享一个 tmp 目录
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-plugins-test-'));
const pluginsDir = path.join(tmpRoot, 'plugins');

let db: DB;

beforeEach(() => {
  db = initDB(':memory:');
  // 每个 case 起始清空 fixture 目录(让 case 1 验证"不存在"场景)
  fs.rmSync(pluginsDir, { recursive: true, force: true });
});

function writeFixturePlugin(
  name: string,
  data: { version: string; description: string; author?: string; dependencies?: string[]; entry?: string }
): void {
  // listPlugins 期望目录存在;mkdirSync 在 fixture 操作前保证目录在位
  fs.mkdirSync(pluginsDir, { recursive: true });
  const pluginDir = path.join(pluginsDir, name);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({ name, ...data }, null, 2)
  );
}

// Case 1: 目录不存在 → 返 []
test('listPlugins returns [] when plugins directory does not exist', async () => {
  const list = await listPlugins(db, pluginsDir);
  assert.deepStrictEqual(list, [], '不存在目录应返空数组');
  closeDB(db);
});

// Case 2: fixture 目录 → 返 fixture plugin + enabled 注入
test('listPlugins reads fixture directory and injects enabled state from KV', async () => {
  writeFixturePlugin('gh', {
    version: '1.2.0',
    description: 'GitHub CLI helpers',
    author: 'octocat',
    dependencies: ['git', 'gh-cli'],
    entry: 'index.js',
  });
  // 默认 enabled = true(KV 表无 key)
  const list = await listPlugins(db, pluginsDir);
  assert.strictEqual(list.length, 1, '应读出 1 个 plugin');
  const p = list[0];
  assert.strictEqual(p.name, 'gh');
  assert.strictEqual(p.version, '1.2.0');
  assert.strictEqual(p.description, 'GitHub CLI helpers');
  assert.strictEqual(p.author, 'octocat');
  assert.deepStrictEqual(p.dependencies, ['git', 'gh-cli']);
  assert.strictEqual(p.entry, 'index.js');
  assert.strictEqual(p.enabled, true, '默认 enabled=true(KV 表无 key)');

  // 设 enabled=false 后应读出来
  setEnabled(db, 'gh', false);
  const list2 = await listPlugins(db, pluginsDir);
  assert.strictEqual(list2[0].enabled, false, 'KV 表写入后 enabled=false');
  closeDB(db);
});

// Case 3: createPlugin 写 plugin.json(必填字段校验通过)
test('createPlugin writes plugin.json with required fields', async () => {
  await createPlugin(
    {
      name: 'git-tools',
      version: '1.0.0',
      description: 'Git workflow helpers',
      author: 'foo',
      dependencies: ['git'],
    },
    pluginsDir
  );

  // plugin.json 应存在
  const filePath = path.join(pluginsDir, 'git-tools', 'plugin.json');
  assert.ok(fs.existsSync(filePath), 'plugin.json 应被创建');
  // 内容正确
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.strictEqual(raw.name, 'git-tools');
  assert.strictEqual(raw.version, '1.0.0');
  assert.strictEqual(raw.description, 'Git workflow helpers');
  assert.strictEqual(raw.author, 'foo');
  assert.deepStrictEqual(raw.dependencies, ['git']);
  closeDB(db);
});

// Case 4: updatePlugin 改 description(version 保留)
test('updatePlugin patches description while preserving version', async () => {
  writeFixturePlugin('plan', {
    version: '2.0.0',
    description: 'old desc',
  });
  await updatePlugin(
    'plan',
    { description: 'new desc' },
    pluginsDir
  );

  const filePath = path.join(pluginsDir, 'plan', 'plugin.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.strictEqual(raw.description, 'new desc', 'description 应被更新');
  assert.strictEqual(raw.version, '2.0.0', 'version 应保留');
  closeDB(db);
});

// Case 5: createPlugin 缺必填字段(没 version)→ throw(任务硬规则)
test('createPlugin throws when required field (version) is missing', async () => {
  // @ts-expect-error - intentional missing version to test strict schema validation
  await assert.rejects(
    async () =>
      createPlugin(
        {
          name: 'invalid',
          description: 'only description',
        } as never,
        pluginsDir
      ),
    /missing required field "version"/,
    'createPlugin 应抛错提示缺 version'
  );
  closeDB(db);
});

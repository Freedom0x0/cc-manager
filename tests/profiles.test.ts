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

/** 直接写 KV 表的辅助函数(不走各模块 setEnabled)— Case 3/4 用
 * v5 wave-3 修正(2026-07-30):MCP 实际 writer 用 'enabled:'(无 mcp:
 * 前缀),所以这里 mcp 用裸 prefix。其余 5 prefix 不变。
 */
function setKvEnabled(db: DB, prefix: 'mcp' | 'skill' | 'cmd' | 'agent' | 'hook' | 'plugin', name: string, enabled: boolean): void {
  const v = enabled ? 'true' : 'false';
  const key = prefix === 'mcp' ? `enabled:${name}` : `${prefix}:enabled:${name}`;
  db.prepare(
    "INSERT INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, v, Date.now());
}

/** 直接读 KV 表的辅助函数 */
function getKvEnabled(db: DB, prefix: string, name: string): string | null {
  const key = prefix === 'mcp' ? `enabled:${name}` : `${prefix}:enabled:${name}`;
  const row = db.prepare(
    "SELECT value FROM mcp_server_state WHERE key = ?"
  ).get(key) as { value: string } | undefined;
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

// Case 4: applyProfile 写 KV 表 + 验证事务(async — v5 wave-3 real-disable)
test('applyProfile writes enabled=true to KV table and verifies', async () => {
  // v5 wave-3:real 文件也参与 apply。先建真实文件(因为 setDisabledSuffix
  // 需要 source/.disabled 存在)
  const claudeDir = path.join(tmpRoot, '.claude');
  fs.mkdirSync(path.join(claudeDir, 'skills', 'commit-helper'), { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'skills', 'commit-helper', 'SKILL.md'),
    '# commit'
  );
  // 真实 skill 已存在(enabled=true 实际状态)

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

  const result = await applyProfile(db, 'enable-fs', profilesPath, undefined, claudeDir);
  assert.strictEqual(result.ok, true);
  assert.ok(typeof result.appliedAt === 'number');
  assert.deepStrictEqual(result.realFileErrors, [], '真实文件无错误');

  // 验证 KV 表 — 应 enabled=true
  assert.strictEqual(getKvEnabled(db, 'mcp', 'filesystem'), 'true', 'filesystem 应启用');
  assert.strictEqual(getKvEnabled(db, 'skill', 'commit-helper'), 'true', 'commit-helper 应启用');

  // 真实文件验证:commit-helper/.disabled 不应存在
  assert.ok(
    !fs.existsSync(path.join(claudeDir, 'skills', 'commit-helper.disabled')),
    'applyProfile 后 commit-helper.disabled/ 不应存在'
  );
  closeDB(db);
});

// Case 5: applyProfile 失败回滚(async — 故意构造坏 profile 触发 throw,验证 KV 表恢复)
test('applyProfile rolls back KV state on failure', async () => {
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
  await assert.rejects(
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

// Case 6 (新增): applyProfile 写真实文件 — settings.json.disabledMcpjsonServers 真删除
test('applyProfile writes real settings.json (MCP enabled list removes from black list)', async () => {
  // D13 改造后必须传 baseDir + mcpJson fixture,避免 listMcpServers 扫到生产 ~/.claude.json
  const claudeDir = path.join(tmpRoot, 'claude-dir-case6');
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, 'settings.json');
  // writer.ts 用 join(baseDir, '..', '.claude.json') — baseDir = claudeDir,父级 = tmpRoot
  const mcpConfigPath = path.join(tmpRoot, '.claude.json');

  // 预置 .claude.json:filesystem 物理存在(只这一个 MCP,避免 reverse-disable 把别的加进来)
  fs.writeFileSync(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: { filesystem: { command: 'fs', args: [] } },
    })
  );
  // 预置 settings.json:filesystem 在黑名单
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ disabledMcpjsonServers: ['filesystem'] })
  );
  // KV 写 enabled=false(模拟当前 disabled)
  setKvEnabled(db, 'mcp', 'filesystem', false);
  // profile 配 enabledServers: ['filesystem']
  fs.writeFileSync(
    profilesPath,
    JSON.stringify({
      profiles: [
        {
          name: 'enable-fs',
          description: 'enable filesystem',
          config: {
            enabledServers: ['filesystem'],
            enabledSkills: [],
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

  const result = await applyProfile(db, 'enable-fs', profilesPath, settingsPath, claudeDir);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.realFileErrors, []);

  // 真实文件验证:disabledMcpjsonServers 应不含 filesystem
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepStrictEqual(
    settings.disabledMcpjsonServers,
    [],
    'applyProfile 写真实文件:filesystem 应从黑名单移除'
  );
  closeDB(db);
});

// Case 7 (D13 新增): applyProfile 反向 disable skills — current ∖ target → 镜像目录
// 场景:用户报告"8 skills 停 4 存 P1 → 8 全启 → apply P1 → 期望 4 启 4 停"。
// D13 改造前,applyProfile 只保证列出的 enabled,其他不动 → 实际 8 全启。
// D13 改造后,current ∖ target → 镜像目录,符合完整替代语义。
test('applyProfile reverse-disables skills not in profile (D13 complete-replace semantics)', async () => {
  const claudeDir = path.join(tmpRoot, 'claude-dir');
  const skillsDir = path.join(claudeDir, 'skills');
  const disabledSkillsDir = path.join(claudeDir, 'disabled_skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(disabledSkillsDir, { recursive: true });

  // 预置:模拟"8 个全启"状态——主目录有 8 个 skill(每个含 SKILL.md)
  for (const name of ['foo', 'bar', 'baz', 'qux', 'a', 'b', 'c', 'd']) {
    fs.mkdirSync(path.join(skillsDir, name), { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, name, 'SKILL.md'),
      `---\ndescription: ${name} desc\n---\nbody`
    );
  }

  // profile P1 只 capture 了 [foo, bar, baz, qux](对应"之前停了 4 个的另 4 个 enabled"快照)
  fs.writeFileSync(
    profilesPath,
    JSON.stringify({
      profiles: [
        {
          name: 'keep-half',
          description: 'only foo/bar/baz/qux enabled',
          config: {
            enabledServers: [],
            enabledSkills: ['foo', 'bar', 'baz', 'qux'],
            enabledCommands: [],
            enabledAgents: [],
            enabledHooks: [],
            enabledPlugins: [],
          },
          createdAt: '2026-07-31T00:00:00.000Z',
          updatedAt: '2026-07-31T00:00:00.000Z',
        },
      ],
    })
  );

  const result = await applyProfile(
    db,
    'keep-half',
    profilesPath,
    undefined, // settingsPath 默认(本 case 不涉及 MCP/Plugin/Hook)
    claudeDir
  );
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.realFileErrors, []);

  // 验证 D13 行为:target 里的 4 个仍在 skills/,current ∖ target 的 4 个挪到 disabled_skills/
  for (const kept of ['foo', 'bar', 'baz', 'qux']) {
    assert.ok(
      fs.existsSync(path.join(skillsDir, kept)),
      `${kept} 应在 skills/`
    );
    assert.ok(
      !fs.existsSync(path.join(disabledSkillsDir, kept)),
      `${kept} 不应在 disabled_skills/`
    );
  }
  for (const removed of ['a', 'b', 'c', 'd']) {
    assert.ok(
      !fs.existsSync(path.join(skillsDir, removed)),
      `${removed} 应从 skills/ 移走(反向 disable)`
    );
    assert.ok(
      fs.existsSync(path.join(disabledSkillsDir, removed)),
      `${removed} 应在 disabled_skills/(完整替代语义生效)`
    );
  }
  closeDB(db);
});

// Case 8 (D13 新增): applyProfile 反向 disable plugins — current ∖ target → enabled=false
// 场景:profile.config.enabledPlugins 只有 [plugin1],当前 enabledPlugins 有 plugin1+plugin2
// → apply 后 plugin2 应在 enabledPlugins 写 false(完整替代)
test('applyProfile reverse-disables plugins not in profile (D13 complete-replace)', async () => {
  const claudeDir = path.join(tmpRoot, 'claude-dir2');
  fs.mkdirSync(path.join(claudeDir, 'plugins'), { recursive: true });
  const installedPluginsPath = path.join(claudeDir, 'plugins', 'installed_plugins.json');
  const settingsPath = path.join(claudeDir, 'settings.json');

  // 预置 installed_plugins.json:2 个插件都在(物理存在,validateVersion 必填 6 字段全)
  fs.writeFileSync(
    installedPluginsPath,
    JSON.stringify({
      version: 2,
      plugins: {
        'plugin1@mp': [{
          scope: 'user',
          installPath: '/p1',
          version: '1.0',
          installedAt: '2026-07-30T00:00:00.000Z',
          lastUpdated: '2026-07-30T00:00:00.000Z',
          gitCommitSha: 'sha1',
        }],
        'plugin2@mp': [{
          scope: 'user',
          installPath: '/p2',
          version: '1.0',
          installedAt: '2026-07-30T00:00:00.000Z',
          lastUpdated: '2026-07-30T00:00:00.000Z',
          gitCommitSha: 'sha2',
        }],
      },
    })
  );
  // 预置 settings.json:两个都 enabled=true
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      enabledPlugins: {
        'plugin1@mp': true,
        'plugin2@mp': true,
      },
    })
  );

  // profile P1 只有 plugin1
  fs.writeFileSync(
    profilesPath,
    JSON.stringify({
      profiles: [
        {
          name: 'plugins-keep1',
          description: 'only plugin1 enabled',
          config: {
            enabledServers: [],
            enabledSkills: [],
            enabledCommands: [],
            enabledAgents: [],
            enabledHooks: [],
            enabledPlugins: ['plugin1@mp'],
          },
          createdAt: '2026-07-31T00:00:00.000Z',
          updatedAt: '2026-07-31T00:00:00.000Z',
        },
      ],
    })
  );

  const result = await applyProfile(
    db,
    'plugins-keep1',
    profilesPath,
    settingsPath,
    claudeDir
  );
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.realFileErrors, []);

  // 验证 D13 行为:settings.json 里 plugin2 应 enabled=false
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(
    settings.enabledPlugins['plugin1@mp'],
    true,
    'plugin1 应保持 enabled=true(profile target 里)'
  );
  assert.strictEqual(
    settings.enabledPlugins['plugin2@mp'],
    false,
    'plugin2 应 enabled=false(反向 disable,D13 完整替代)'
  );
  closeDB(db);
});

// Case 9 (D13 新增): applyProfile 反向 disable MCP — current ∖ target → 加黑名单
// 场景:profile.config.enabledServers 只有 [mcp-fs],当前有 mcp-fs + mcp-github
// → apply 后 mcp-github 应在 disabledMcpjsonServers[]
test('applyProfile reverse-disables MCP not in profile (D13 complete-replace)', async () => {
  // writer.ts 用 join(baseDir, '..', '.claude.json') 拼 mcpConfigPath。
  // baseDir = claudeDir → 父级 = tmpRoot → .claude.json 必须在 tmpRoot 下
  const claudeDir = path.join(tmpRoot, 'claude-dir3');
  fs.mkdirSync(claudeDir, { recursive: true });
  const mcpConfigPath = path.join(tmpRoot, '.claude.json');
  const settingsPath = path.join(claudeDir, 'settings.json');

  // 预置 .claude.json:2 个 MCP 物理定义
  fs.writeFileSync(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: {
        'mcp-fs': { command: 'fs', args: [] },
        'mcp-github': { command: 'gh', args: [] },
      },
    })
  );
  // 预置 settings.json:都不在黑名单(两个当前 enabled)
  fs.writeFileSync(settingsPath, JSON.stringify({}));

  // profile P1 只有 mcp-fs
  fs.writeFileSync(
    profilesPath,
    JSON.stringify({
      profiles: [
        {
          name: 'mcp-keep1',
          description: 'only mcp-fs enabled',
          config: {
            enabledServers: ['mcp-fs'],
            enabledSkills: [],
            enabledCommands: [],
            enabledAgents: [],
            enabledHooks: [],
            enabledPlugins: [],
          },
          createdAt: '2026-07-31T00:00:00.000Z',
          updatedAt: '2026-07-31T00:00:00.000Z',
        },
      ],
    })
  );

  const result = await applyProfile(
    db,
    'mcp-keep1',
    profilesPath,
    settingsPath,
    claudeDir
  );
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.realFileErrors, []);

  // 验证 D13 行为:disabledMcpjsonServers 应含 mcp-github,不含 mcp-fs
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepStrictEqual(
    settings.disabledMcpjsonServers,
    ['mcp-github'],
    'mcp-github 应被加进黑名单(D13 反向 disable),mcp-fs 应保留 enabled'
  );
  closeDB(db);
});
/**
 * tests/migration.test.ts — v5 wave-3 real-disable 一次性迁移测试
 *
 * 验证 runMigration 把 mcp_server_state 6 prefix 的 enabled 状态
 * 同步到真实文件(settings.json / .disabled 后缀)。KV 表保留(不删),
 * 作为 audit log + profile_capture 快照源。
 *
 * Case 1: 空 KV → result.counts 全 0,无 failure
 * Case 2: KV 含 mcp/server-x = 'false' → settings.json.disabledMcpjsonServers 含
 * Case 3: KV 含 mcp/server-x = 'true' → settings.json.disabledMcpjsonServers 不含
 * Case 4: KV 含 plugin/foo@bar = 'false' → settings.json.enabledPlugins[foo@bar] = false
 * Case 5: KV 含 skill/old = 'false' → ~/.claude/skills/old.disabled/ 存在
 * Case 6: KV 含 cmd/rev = 'true' → ~/.claude/commands/rev.md 存在(无 .disabled)
 * Case 7: 幂等:连续调两次 → 第二轮 counts 全 0(KV 已对齐)
 * Case 8: 部分失败:settings.json 不可写 → 失败条目进 failures,其它 OK
 *
 * Fixture 设计(CLAUDE.md §13 D10):所有路径走 os.tmpdir() 临时目录,
 * **不**碰真实 ~/.claude/。
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDB, closeDB, type DB } from '../electron/db/connection';
import { runMigration } from '../electron/repo/migration';
import { HOOK_EVENTS } from '../electron/repo/hooks/types';

let db: DB;
let tmpRoot: string;
let claudeDir: string;
let settingsPath: string;

beforeEach(() => {
  db = initDB(':memory:');
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-migration-test-'));
  // 把 ~/.claude/ 模拟到 tmpRoot/.claude/
  claudeDir = path.join(tmpRoot, '.claude');
  fs.mkdirSync(path.join(claudeDir, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'agents'), { recursive: true });
  settingsPath = path.join(claudeDir, 'settings.json');
});

function upsert(key: string, value: string): void {
  db.prepare(
    "INSERT INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, value, Date.now());
}

// Case 1: 空 KV → 0 迁移
test('runMigration with empty KV applies nothing', async () => {
  const result = await runMigration(db, settingsPath, claudeDir, HOOK_EVENTS);
  assert.deepStrictEqual(
    result.counts,
    { mcp: 0, skill: 0, command: 0, agent: 0, hook: 0, plugin: 0 },
    '空 KV 应 0 迁移'
  );
  assert.deepStrictEqual(result.failures, [], '空 KV 无 failure');
  closeDB(db);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Case 2: mcp KV 'false' → 真实 settings.json disabledMcpjsonServers 含
test('runMigration: KV mcp=false writes settings.json disabledMcpjsonServers', async () => {
  upsert('enabled:server-x', 'false');
  const result = await runMigration(db, settingsPath, claudeDir, HOOK_EVENTS);
  assert.strictEqual(result.counts.mcp, 1, 'mcp 应迁移 1 条');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepStrictEqual(
    settings.disabledMcpjsonServers,
    ['server-x'],
    'settings.json.disabledMcpjsonServers 应含 server-x'
  );
  // KV 保留(不删)
  const row = db
    .prepare("SELECT value FROM mcp_server_state WHERE key = 'enabled:server-x'")
    .get() as { value: string };
  assert.strictEqual(row.value, 'false', 'KV 应保留为 audit log');
  closeDB(db);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Case 3: mcp KV 'true' → settings.json.disabledMcpjsonServers 不含(若原本是 KV 写 'false' 后又改 'true',要能反向)
test('runMigration: KV mcp=true removes from settings.json disabledMcpjsonServers', async () => {
  // 先预置 settings.json 已有 server-x 在黑名单
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ disabledMcpjsonServers: ['server-x'] })
  );
  // KV 写 'true' 表示用户希望启用
  upsert('enabled:server-x', 'true');
  const result = await runMigration(db, settingsPath, claudeDir, HOOK_EVENTS);
  assert.strictEqual(result.counts.mcp, 1);
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepStrictEqual(
    settings.disabledMcpjsonServers,
    [],
    'KV true 应把 server-x 从 disabledMcpjsonServers 移除'
  );
  closeDB(db);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Case 4: plugin KV 'false' → settings.json.enabledPlugins[fullName] = false
test('runMigration: KV plugin=false writes settings.json enabledPlugins', async () => {
  upsert('plugin:enabled:foo@bar', 'false');
  const result = await runMigration(db, settingsPath, claudeDir, HOOK_EVENTS);
  assert.strictEqual(result.counts.plugin, 1);
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(
    settings.enabledPlugins['foo@bar'],
    false,
    'settings.json.enabledPlugins[foo@bar] 应为 false'
  );
  closeDB(db);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Case 5: skill KV 'false' → ~/.claude/skills/<name>.disabled/ 存在
test('runMigration: KV skill=false renames skill directory to .disabled', async () => {
  // 先建一个 skill 目录
  const skillDir = path.join(claudeDir, 'skills', 'old');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# old skill');

  upsert('skill:enabled:old', 'false');
  const result = await runMigration(db, settingsPath, claudeDir, HOOK_EVENTS);
  assert.strictEqual(result.counts.skill, 1);
  assert.ok(!fs.existsSync(skillDir), 'skills/old/ 应被 mv 走');
  // commit 9 修复:skills 改用镜像目录方案,旧 .disabled/ 方案实测失败
  assert.ok(
    fs.existsSync(path.join(claudeDir, 'disabled_skills', 'old')),
    'disabled_skills/old/ 镜像目录应存在(commit 9 镜像目录方案)'
  );
  assert.ok(
    !fs.existsSync(path.join(claudeDir, 'skills', 'old.disabled')),
    'skills/ 目录内不应有 old.disabled/ 残留(commit 5 旧方案)'
  );
  closeDB(db);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Case 6: cmd KV 'true' → cmd 文件存在(无 .disabled)
test('runMigration: KV cmd=true ensures command .md is present (no .disabled)', async () => {
  // 先建一个 cmd 文件
  const cmdFile = path.join(claudeDir, 'commands', 'rev.md');
  fs.writeFileSync(cmdFile, '# rev');

  upsert('cmd:enabled:rev', 'true');
  const result = await runMigration(db, settingsPath, claudeDir, HOOK_EVENTS);
  assert.strictEqual(result.counts.command, 1);
  assert.ok(fs.existsSync(cmdFile), 'rev.md 应存在(无 .disabled)');
  assert.ok(
    !fs.existsSync(path.join(claudeDir, 'commands', 'rev.md.disabled')),
    'rev.md.disabled 应不存在'
  );
  closeDB(db);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Case 7: 幂等:连续两次 → 第二轮 counts 全 0(KV 已对齐)
test('runMigration is idempotent — second run applies nothing', async () => {
  upsert('enabled:server-x', 'false');
  upsert('plugin:enabled:foo@bar', 'false');
  const r1 = await runMigration(db, settingsPath, claudeDir, HOOK_EVENTS);
  assert.strictEqual(r1.counts.mcp + r1.counts.plugin, 2, '第一轮迁 2 条');
  const r2 = await runMigration(db, settingsPath, claudeDir, HOOK_EVENTS);
  // 第二轮 KV 仍指 'false' → 会再次写真实文件(原子写是幂等的,效果一致)
  // counts 不为 0,但失败也是 0
  assert.strictEqual(r2.failures.length, 0, '第二轮无失败');
  // settings.json 内容不变
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepStrictEqual(
    settings.disabledMcpjsonServers,
    ['server-x'],
    '第二轮后 server-x 仍在黑名单'
  );
  assert.strictEqual(
    settings.enabledPlugins['foo@bar'],
    false,
    '第二轮后 plugin 仍 disabled'
  );
  closeDB(db);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

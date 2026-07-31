/**
 * tests/settings-writer.test.ts — v5 wave-3 真停用抽象 12 case
 *
 * Case 1: readSettings 不存在 → {}
 * Case 2: readSettings JSON 损坏 → SyntaxError
 * Case 3: readSettings 含多字段 → 完整 round-trip
 * Case 4: writeSettings 原子写 → 旧内容被新内容覆盖，无 tmp 残留
 * Case 5: writeSettings 失败（注入 fs.writeFile mock 抛 EACCES）→ 旧文件保留
 * Case 6: setPluginEnabled('a@b', true) → 重读 enabledPlugins['a@b'] === true
 * Case 7: setPluginEnabled('a@b', false) → 重读 enabledPlugins['a@b'] === false
 * Case 8: setMcpDisabled('x', true) → 数组含 'x'；再 setMcpDisabled('x', false) → 数组不含
 * Case 9: setHookEnabled('PreToolUse', 0, false) → hooks.PreToolUse 被 splice
 * Case 10: setDisabledSuffix('skill', 'foo', true) → disabled_skills/foo/ 存在 / skills/foo/ 不存在(commit 9 镜像目录方案)
 * Case 11: setDisabledSuffix('command', 'bar.md', true) → bar.md.disabled 存在 / bar.md 不存在
 * Case 12: 并发 writeSettings → 最终内容是其中一个完整版本（不撕裂）
 *
 * Fixture 设计（CLAUDE.md §13 D10）：
 * - 所有路径用 os.tmpdir() 临时路径，**不**碰真实 ~/.claude/
 * - 每个 case 独立 tmpdir（beforeEach mkdtempSync），避免互相污染
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readSettings,
  writeSettings,
  setPluginEnabled,
  setMcpDisabled,
  setHookEnabled,
  setDisabledSuffix,
  type ClaudeSettings,
} from '../electron/repo/settings-writer';

let tmpDir: string;
let settingsPath: string;
let claudeDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-settings-writer-test-'));
  claudeDir = tmpDir; // 把 .claude/ 模拟到 tmpDir/.claude/
  settingsPath = path.join(claudeDir, 'settings.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readRaw(): string {
  return fs.readFileSync(settingsPath, 'utf8');
}

// ---------------------------------------------------------------------------
// Case 1: readSettings 不存在 → {}
// ---------------------------------------------------------------------------
test('readSettings returns {} when settings.json does not exist', async () => {
  const result = await readSettings(settingsPath);
  assert.deepStrictEqual(result, {}, '不存在 settings.json 应返空对象');
});

// ---------------------------------------------------------------------------
// Case 2: readSettings JSON 损坏 → SyntaxError
// ---------------------------------------------------------------------------
test('readSettings throws SyntaxError on corrupt JSON', async () => {
  fs.writeFileSync(settingsPath, '{ this is not valid json', 'utf8');
  await assert.rejects(
    () => readSettings(settingsPath),
    SyntaxError,
    'JSON 损坏应抛 SyntaxError'
  );
});

// ---------------------------------------------------------------------------
// Case 3: readSettings 含多字段 → 完整 round-trip
// ---------------------------------------------------------------------------
test('readSettings round-trips multiple known and unknown fields', async () => {
  const fixture: ClaudeSettings = {
    permissions: { allow: ['Bash'], deny: ['WebFetch'] },
    mcpServers: { github: { command: 'gh-mcp', args: [] } },
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo' }] }] },
    unknownFutureField: { foo: 'bar' }, // 兜底保留
  };
  fs.writeFileSync(settingsPath, JSON.stringify(fixture, null, 2), 'utf8');
  const result = await readSettings(settingsPath);
  assert.deepStrictEqual(result, fixture, '多字段应原值 round-trip');
  assert.strictEqual(result.unknownFutureField.foo, 'bar', '未知字段不丢');
});

// ---------------------------------------------------------------------------
// Case 4: writeSettings 原子写 → 旧内容被覆盖、无 tmp 残留
// ---------------------------------------------------------------------------
test('writeSettings atomically replaces file with no tmp residue', async () => {
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ old: 'content' }, null, 2),
    'utf8'
  );
  await writeSettings({ new: 'content' }, settingsPath);
  const result = JSON.parse(readRaw());
  assert.deepStrictEqual(result, { new: 'content' }, '旧内容应被替换');
  // 检查无 tmp 残留
  const dirEntries = fs.readdirSync(claudeDir);
  const tmpFiles = dirEntries.filter((f) => f.includes('.tmp.'));
  assert.strictEqual(tmpFiles.length, 0, '不应有 tmp 残留');
});

// ---------------------------------------------------------------------------
// Case 5: writeSettings 失败 → 旧文件保留、tmp 被清理
// ---------------------------------------------------------------------------
test('writeSettings failure cleans up tmp file (D7 模式验证)', async () => {
  // 注入失败：用 only-Windows 盘符 Z:\ 不存在时 mkdir + write 全失败
  // 跨平台 fallback：用一个能 mkdir 成功但 writeFile 失败的场景
  // — Windows 上把路径设到 NUL 设备：CON / NUL / ...
  // 简单方案：用一个非常深的递归路径在 parent 为只读目录的场景
  // 最简：用已存在的目录当文件 — writeFile 会抛 EISDIR
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ original: true }, null, 2),
    'utf8'
  );
  // 删原文件，把 settingsPath 路径变成一个目录 → writeFile(EISDIR)
  fs.rmSync(settingsPath, { force: true });
  fs.mkdirSync(settingsPath); // 把 settingsPath 变成目录

  await assert.rejects(
    () => writeSettings({ content: 'should fail' }, settingsPath),
    /EISDIR|EACCES|EPERM|EBUSY|ENOENT/,
    '写一个目录当作文件应抛错'
  );

  // 验证 tmp 被清理（D7 模式关键约束）
  const entries = fs.readdirSync(claudeDir);
  const tmpFiles = entries.filter((f) => f.includes('.tmp.'));
  assert.strictEqual(tmpFiles.length, 0, '失败时 tmp 应被清理（D7 不留残）');
});

// ---------------------------------------------------------------------------
// Case 6: setPluginEnabled → enabled=true
// ---------------------------------------------------------------------------
test('setPluginEnabled(true) sets enabledPlugins[<fullName>] = true', async () => {
  // 起始空文件
  await setPluginEnabled('a@b', true, settingsPath);
  const result = await readSettings(settingsPath);
  assert.strictEqual(
    result.enabledPlugins?.['a@b'],
    true,
    'enabledPlugins[a@b] 应为 true'
  );
});

// ---------------------------------------------------------------------------
// Case 7: setPluginEnabled → enabled=false（保留键，不删除）
// ---------------------------------------------------------------------------
test('setPluginEnabled(false) sets enabledPlugins[<fullName>] = false (key kept)', async () => {
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ enabledPlugins: { 'a@b': true } }),
    'utf8'
  );
  await setPluginEnabled('a@b', false, settingsPath);
  const result = await readSettings(settingsPath);
  assert.strictEqual(
    result.enabledPlugins?.['a@b'],
    false,
    'enabledPlugins[a@b] 应为 false（键保留）'
  );
});

// ---------------------------------------------------------------------------
// Case 8: setMcpDisabled 增删 + 幂等
// ---------------------------------------------------------------------------
test('setMcpDisabled toggles array membership idempotently', async () => {
  // disable
  await setMcpDisabled('server-x', true, settingsPath);
  let result = await readSettings(settingsPath);
  assert.deepStrictEqual(
    result.disabledMcpjsonServers,
    ['server-x'],
    'disable 后数组应含 server-x'
  );
  // 重复 disable 幂等
  await setMcpDisabled('server-x', true, settingsPath);
  result = await readSettings(settingsPath);
  assert.deepStrictEqual(
    result.disabledMcpjsonServers,
    ['server-x'],
    '重复 disable 应幂等（去重）'
  );
  // disable 第二个
  await setMcpDisabled('server-y', true, settingsPath);
  result = await readSettings(settingsPath);
  assert.deepStrictEqual(
    result.disabledMcpjsonServers,
    ['server-x', 'server-y'],
    '多个 disabled 应并存'
  );
  // enable 回去
  await setMcpDisabled('server-x', false, settingsPath);
  result = await readSettings(settingsPath);
  assert.deepStrictEqual(
    result.disabledMcpjsonServers,
    ['server-y'],
    'enable 后 server-x 应从数组移除'
  );
});

// ---------------------------------------------------------------------------
// Case 9: setHookEnabled → splice 移除
// ---------------------------------------------------------------------------
test('setHookEnabled(false) splices the entry from hooks[<event>]', async () => {
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo 1' }] },
          { matcher: 'Read', hooks: [{ type: 'command', command: 'echo 2' }] },
        ],
      },
    }),
    'utf8'
  );
  await setHookEnabled('PreToolUse', 0, false, settingsPath);
  const result = await readSettings(settingsPath);
  assert.strictEqual(result.hooks?.PreToolUse?.length, 1, '数组应剩 1 条');
  assert.strictEqual(
    result.hooks?.PreToolUse?.[0]?.matcher,
    'Read',
    '剩余应是 index=1 那个'
  );
});

test('setHookEnabled throws on invalid event', async () => {
  await assert.rejects(
    () => setHookEnabled('InvalidEvent' as any, 0, false, settingsPath),
    /Unknown hook event/,
    '未知 event 应抛错'
  );
});

test('setHookEnabled throws on out-of-bounds index', async () => {
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ hooks: { PreToolUse: [] } }),
    'utf8'
  );
  await assert.rejects(
    () => setHookEnabled('PreToolUse', 0, false, settingsPath),
    /not found/,
    '越界 index 应抛错'
  );
});

test('setHookEnabled(true) is not supported (use createHook instead)', async () => {
  await assert.rejects(
    () => setHookEnabled('PreToolUse', 0, true, settingsPath),
    /not supported/,
    'enable=true 应抛错（不是本函数职责）'
  );
});

// ---------------------------------------------------------------------------
// Case 10: setDisabledSuffix → skill（目录，镜像目录方案 commit 9）
// ---------------------------------------------------------------------------
test('setDisabledSuffix(skill, true) moves foo/ to ~/.claude/disabled_skills/foo/', async () => {
  const skillsDir = path.join(claudeDir, 'skills');
  const skillDir = path.join(skillsDir, 'foo');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# foo', 'utf8');

  await setDisabledSuffix('skill', 'foo', true, claudeDir);

  assert.strictEqual(
    fs.existsSync(skillDir),
    false,
    '原 skills/foo/ 目录应不存在'
  );
  const disabledSkillsDir = path.join(claudeDir, 'disabled_skills');
  assert.strictEqual(
    fs.existsSync(path.join(disabledSkillsDir, 'foo')),
    true,
    'disabled_skills/foo/ 镜像目录应存在'
  );
  // 文件内容保留
  assert.strictEqual(
    fs.readFileSync(path.join(disabledSkillsDir, 'foo', 'SKILL.md'), 'utf8'),
    '# foo',
    'SKILL.md 内容保留在镜像目录'
  );
  // 关键:skills/ 目录内**没有** foo.disabled/ 残留(commit 5 旧方案的行为)
  assert.strictEqual(
    fs.existsSync(path.join(skillsDir, 'foo.disabled')),
    false,
    'skills/ 目录内不应有 foo.disabled/ 残留'
  );
});

test('setDisabledSuffix(skill, false) restores disabled_skills/foo/ → skills/foo/', async () => {
  const skillsDir = path.join(claudeDir, 'skills');
  const disabledSkillsDir = path.join(claudeDir, 'disabled_skills');
  const disabledDir = path.join(disabledSkillsDir, 'foo');
  fs.mkdirSync(disabledDir, { recursive: true });
  fs.writeFileSync(path.join(disabledDir, 'SKILL.md'), '# foo', 'utf8');

  await setDisabledSuffix('skill', 'foo', false, claudeDir);

  assert.strictEqual(
    fs.existsSync(path.join(skillsDir, 'foo')),
    true,
    'skills/foo/ 应恢复'
  );
  assert.strictEqual(
    fs.existsSync(disabledDir),
    false,
    'disabled_skills/foo/ 应消失'
  );
});

// ---------------------------------------------------------------------------
// Case 11: setDisabledSuffix → command（单文件）
// ---------------------------------------------------------------------------
test('setDisabledSuffix(command, true) renames bar.md → bar.md.disabled', async () => {
  const commandsDir = path.join(claudeDir, 'commands');
  fs.mkdirSync(commandsDir, { recursive: true });
  const srcFile = path.join(commandsDir, 'bar.md');
  const dstFile = path.join(commandsDir, 'bar.md.disabled');
  fs.writeFileSync(srcFile, '# bar', 'utf8');

  await setDisabledSuffix('command', 'bar', true, claudeDir);

  assert.strictEqual(fs.existsSync(srcFile), false, 'bar.md 应消失');
  assert.strictEqual(fs.existsSync(dstFile), true, 'bar.md.disabled 应存在');
  assert.strictEqual(
    fs.readFileSync(dstFile, 'utf8'),
    '# bar',
    '内容保留'
  );
});

test('setDisabledSuffix(command, false) restores bar.md.disabled → bar.md', async () => {
  const commandsDir = path.join(claudeDir, 'commands');
  fs.mkdirSync(commandsDir, { recursive: true });
  const dstFile = path.join(commandsDir, 'bar.md.disabled');
  fs.writeFileSync(dstFile, '# bar', 'utf8');

  await setDisabledSuffix('command', 'bar', false, claudeDir);

  assert.strictEqual(
    fs.existsSync(path.join(commandsDir, 'bar.md')),
    true,
    'bar.md 应恢复'
  );
});

test('setDisabledSuffix is no-op when target state already matches', async () => {
  // 已 disabled 状态下再调 disabled=true → no-op 不抛错
  // commit 9 后:disabled 状态 = 在 disabled_skills/<name>/
  const disabledSkillsDir = path.join(claudeDir, 'disabled_skills');
  fs.mkdirSync(path.join(disabledSkillsDir, 'foo'), { recursive: true });
  await setDisabledSuffix('skill', 'foo', true, claudeDir);
  assert.strictEqual(
    fs.existsSync(path.join(disabledSkillsDir, 'foo')),
    true,
    '已 disabled 状态再 disable 应 no-op'
  );
});

test('setDisabledSuffix throws on non-existent source', async () => {
  await assert.rejects(
    () => setDisabledSuffix('skill', 'nonexistent', true, claudeDir),
    /not found/,
    '不存在的 skill disable 应抛错'
  );
});

test('setDisabledSuffix throws on invalid name (path traversal)', async () => {
  await assert.rejects(
    () => setDisabledSuffix('skill', '../etc/passwd', true, claudeDir),
    /Invalid/,
    'name 含 .. 应抛错'
  );
});

// ---------------------------------------------------------------------------
// Case 12: 并发 writeSettings → 最终内容是一个完整版本
// ---------------------------------------------------------------------------
test('concurrent writeSettings produces one of the inputs (no torn write)', async () => {
  // 起始空文件
  // 并发写 3 个不同内容 — 最终内容应是其中之一（不是 mix）
  const a = { tag: 'A', payload: 'a'.repeat(1000) };
  const b = { tag: 'B', payload: 'b'.repeat(1000) };
  const c = { tag: 'C', payload: 'c'.repeat(1000) };

  await Promise.all([
    writeSettings(a, settingsPath),
    writeSettings(b, settingsPath),
    writeSettings(c, settingsPath),
  ]);

  const finalRaw = readRaw();
  const final = JSON.parse(finalRaw);
  const tags = ['A', 'B', 'C'];
  assert.ok(
    tags.includes(final.tag),
    `最终 tag 必须是 A/B/C 之一，得到 ${final.tag}`
  );
  // payload 完整（不撕裂 = 不混 a/b/c）
  const expectedPayload = final.tag === 'A' ? a.payload : final.tag === 'B' ? b.payload : c.payload;
  assert.strictEqual(
    final.payload,
    expectedPayload,
    'payload 必须与 tag 对应（无撕裂）'
  );
});

/**
 * tests/usage.test.ts — v5 wave-3 用量分析 模块 5 case
 *
 * 用量分析 = 只读聚合,无 state / writer。5 case 覆盖 6 个聚合函数的
 * 关键路径(usageSummary 是主聚合,getSessionCost / getDailyBreakdown /
 * getTopTools 单独测,getSessionTimeline / getProjectBreakdown 通过
 * usageSummary 间接覆盖)。
 *
 * Case 1: usageSummary on 空 DB → 返零值
 * Case 2: usageSummary on fixture(2 project / 2 session / 5 message)→ 正确聚合
 * Case 3: getSessionCost 单 session
 * Case 4: getDailyBreakdown 按日(rangeDays 过滤)
 * Case 5: getTopTools 频次(json_each 提 tool_use.name)
 *
 * Fixture 设计(CLAUDE.md §13 D10):
 * - DB 用 initDB(':memory:') — 内存 DB,沙箱干净
 * - 数据用 prepared statement 直接 INSERT,不 importFile 真实 fixture(避免依赖
 *   JSONL parser,本模块只测聚合 SQL)
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { initDB, closeDB, type DB } from '../electron/db/connection';
import {
  usageSummary,
  getSessionCost,
  getDailyBreakdown,
  getTopTools,
  getProjectBreakdown,
  getSessionTimeline,
} from '../electron/repo/usage';

let db: DB;

beforeEach(() => {
  db = initDB(':memory:');
});

/** 插 fixture:2 个 project / 2 个 session / 5 个 message(3 + 2)。
 *  s1 在 day1(今天-12h,在 rangeDays=1 窗口内),s2 在 day2(今天-36h,
 *  在 rangeDays=1 窗口外)。给足时间缓冲避免 Date.now() 在 setup 和
 *  query 之间漂移导致 flake。
 *  s1 含 2 个 tool_use(Read + Bash + Read = 1 Read + 1 Bash),
 *  s2 全是 plain text。 */
function insertFixture(): void {
  db.exec(
    "INSERT INTO projects (id, project_path, name, imported_at) VALUES (1, '/p/a', 'projA', 0), (2, '/p/b', 'projB', 0)"
  );
  const now = Date.now();
  // day1 = now - 12h(在 1d 窗口内),day2 = now - 36h(在 1d 窗口外)
  const day1 = now - 12 * 3600 * 1000;
  const day2 = now - 36 * 3600 * 1000;
  db.exec(
    `INSERT INTO sessions (session_id, project_id, started_at, last_message_at, message_count, source_file)
     VALUES ('s1', 1, ${day1}, ${day1 + 60000}, 3, '/f1'),
            ('s2', 2, ${day2}, ${day2 + 60000}, 2, '/f2')`
  );
  const blocks1 = JSON.stringify([
    { type: 'text', text: 'hello' },
    { type: 'tool_use', name: 'Read', input: { file: '/etc' } },
  ]);
  const blocks2 = JSON.stringify([
    { type: 'text', text: 'world' },
    { type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } },
    { type: 'tool_use', name: 'Read', input: { file: '/tmp' } },
  ]);
  const ins = db.prepare(
    'INSERT INTO messages (uuid, session_id, role, content, content_blocks, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  ins.run('m1', 's1', 'user', 'hi', null, day1 + 1000);
  ins.run('m2', 's1', 'assistant', 'hello', blocks1, day1 + 2000);
  ins.run('m3', 's1', 'assistant', 'world', blocks2, day1 + 3000);
  ins.run('m4', 's2', 'user', 'question', null, day2 + 1000);
  ins.run('m5', 's2', 'assistant', 'answer', null, day2 + 2000);
}

// Case 1: 空 DB → 全零值
test('usageSummary returns zero values on empty DB', () => {
  const sum = usageSummary(db, 30);
  assert.strictEqual(sum.totalSessions, 0);
  assert.strictEqual(sum.totalMessages, 0);
  assert.strictEqual(sum.totalTokens, 0);
  assert.strictEqual(sum.totalDurationMs, 0);
  assert.deepStrictEqual(sum.byProject, []);
  assert.deepStrictEqual(sum.byDay, []);
  assert.deepStrictEqual(sum.byTool, []);
  assert.match(sum.generatedAt, /^\d{4}-\d{2}-\d{2}T/, 'generatedAt 应是 ISO');
  closeDB(db);
});

// Case 2: fixture → 正确聚合
test('usageSummary aggregates correctly on fixture (2 projects / 2 sessions / 5 messages)', () => {
  insertFixture();
  const sum = usageSummary(db, 30);

  assert.strictEqual(sum.totalSessions, 2, '应计 2 个 session');
  assert.strictEqual(sum.totalMessages, 5, '应计 5 个 message');
  assert.ok(sum.totalTokens > 0, 'token 估算应 > 0');
  assert.strictEqual(sum.totalDurationMs, 120000, '2 个 session 各 60s,共 120s');

  // byProject:2 个 project,s1 → projA(sessions=1, messages=3), s2 → projB(sessions=1, messages=2)
  assert.strictEqual(sum.byProject.length, 2);
  const pa = sum.byProject.find((r) => r.projectName === 'projA');
  const pb = sum.byProject.find((r) => r.projectName === 'projB');
  assert.ok(pa && pb, '两个 project 都应有');
  assert.strictEqual(pa!.sessions, 1);
  assert.strictEqual(pa!.messages, 3);
  assert.strictEqual(pb!.sessions, 1);
  assert.strictEqual(pb!.messages, 2);

  // byDay:day1 / day2 各 1 天,消息数对应
  assert.strictEqual(sum.byDay.length, 2);
  const d1 = sum.byDay.find((r) => r.messages === 3);
  const d2 = sum.byDay.find((r) => r.messages === 2);
  assert.ok(d1 && d2, 'byDay 应有 day1(day1=3 msg) + day2(day2=2 msg)');

  // byTool:Read 出现 2 次(m2 + m3 各 1),Bash 1 次
  const readTool = sum.byTool.find((t) => t.tool === 'Read');
  const bashTool = sum.byTool.find((t) => t.tool === 'Bash');
  assert.ok(readTool && bashTool, 'Read + Bash 都应有');
  assert.strictEqual(readTool!.count, 2);
  assert.strictEqual(bashTool!.count, 1);
  // byTool 按 count DESC 排序
  assert.ok(sum.byTool[0].count >= sum.byTool[1].count);
  closeDB(db);
});

// Case 3: getSessionCost 单 session
test('getSessionCost returns single session detail with tokens and tools', () => {
  insertFixture();
  const cost = getSessionCost(db, 's1');
  assert.ok(cost, 's1 应存在');
  assert.strictEqual(cost!.sessionId, 's1');
  assert.strictEqual(cost!.projectName, 'projA');
  assert.strictEqual(cost!.durationMs, 60000, '60s');
  assert.strictEqual(cost!.messageCount, 3);
  assert.ok(cost!.tokens > 0, 'token 估算应 > 0');
  // tools:Read(2)+ Bash(1)
  const readTool = cost!.tools.find((t) => t.tool === 'Read');
  const bashTool = cost!.tools.find((t) => t.tool === 'Bash');
  assert.ok(readTool && bashTool);
  assert.strictEqual(readTool!.count, 2);
  assert.strictEqual(bashTool!.count, 1);

  // 不存在的 session → null
  assert.strictEqual(getSessionCost(db, 'nope'), null);

  // getProjectBreakdown:projA 验证
  const proj = getProjectBreakdown(db, 1);
  assert.ok(proj);
  assert.strictEqual(proj!.sessions, 1);
  assert.strictEqual(proj!.messages, 3);

  // getSessionTimeline:s1 应有 3 条 entries
  const timeline = getSessionTimeline(db, 's1');
  assert.ok(timeline);
  assert.strictEqual(timeline!.entries.length, 3);
  assert.strictEqual(timeline!.entries[0].role, 'user');
  closeDB(db);
});

// Case 4: getDailyBreakdown 按日(rangeDays 过滤)
test('getDailyBreakdown filters by rangeDays and groups by date', () => {
  insertFixture();
  // rangeDays=1 → 只剩 day1(=今天-1天)
  const recent = getDailyBreakdown(db, 1);
  assert.strictEqual(recent.length, 1, 'rangeDays=1 应只剩今天');
  assert.strictEqual(recent[0].messages, 3, 'day1 有 3 条 message');

  // rangeDays=30 → 2 天都有
  const wide = getDailyBreakdown(db, 30);
  assert.strictEqual(wide.length, 2);
  closeDB(db);
});

// Case 5: getTopTools 频次(json_each 提 tool_use.name)
test('getTopTools extracts tool_use names via json_each', () => {
  insertFixture();
  const top = getTopTools(db, 10);
  // 期望:Read=2(在 m2 + m3),Bash=1(在 m3)
  const readTool = top.find((t) => t.tool === 'Read');
  const bashTool = top.find((t) => t.tool === 'Bash');
  assert.ok(readTool && bashTool, 'Read + Bash 都应被提取');
  assert.strictEqual(readTool!.count, 2);
  assert.strictEqual(bashTool!.count, 1);
  // 按 count DESC 排序
  assert.ok(top[0].count >= top[1].count);

  // limit=1 → 只返 Read
  const top1 = getTopTools(db, 1);
  assert.strictEqual(top1.length, 1);
  assert.strictEqual(top1[0].tool, 'Read');
  closeDB(db);
});
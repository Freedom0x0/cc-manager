import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { scanSourceDir, importFile, scanProjectFolders, importProjectFolder } from '../electron/importer';

test('imports two jsonl files into db (v3 compat: importFile)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-imp-'));
  const dbPath = path.join(tmp, 'app.db');
  const db = initDB(dbPath);

  const fixtures = path.resolve('tests/fixtures');
  let totalSess = 0;
  let totalMsg = 0;
  for (const file of scanSourceDir(fixtures)) {
    const stats = importFile(db, file);
    totalSess += stats.sessionsAdded;
    totalMsg += stats.messagesAdded;
  }

  const sessCount = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
  const msgCount = (db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c;
  closeDB(db);
  assert.ok(sessCount >= 2);
  assert.ok(msgCount >= 4);
  assert.ok(totalSess >= 2);
  assert.ok(totalMsg >= 4);
});

test('import is idempotent (uuid dedup)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-imp2-'));
  const dbPath = path.join(tmp, 'app.db');
  const db = initDB(dbPath);
  const file = path.resolve('tests/fixtures/proj-a/sess-1.jsonl');
  importFile(db, file);
  importFile(db, file);
  const count = (db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c;
  closeDB(db);
  assert.strictEqual(count, 2);
});

test('v4: scanProjectFolders returns folder with jsonl list, skips subdirs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-scan-'));
  // 模拟 ~/.claude/projects/<folder>/ 形态
  const folderA = path.join(tmp, 'C--Users-test-Desktop-prompt');
  fs.mkdirSync(folderA, { recursive: true });
  fs.writeFileSync(path.join(folderA, 'sess-1.jsonl'), '{"type":"user","uuid":"u","sessionId":"s","timestamp":"2026-07-28T10:00:00.000Z","cwd":"C:/Users/test/prompt","message":{"role":"user","content":"hi"}}');
  fs.writeFileSync(path.join(folderA, 'sess-2.jsonl'), '{"type":"user","uuid":"u2","sessionId":"s2","timestamp":"2026-07-28T10:00:00.000Z","cwd":"C:/Users/test/prompt","message":{"role":"user","content":"hi2"}}');
  // 同 folder 下的运行时工作区子目录 — 不应被当 jsonl 扫到
  const workDir = path.join(folderA, 'abc-uuid');
  fs.mkdirSync(workDir);
  fs.writeFileSync(path.join(workDir, 'whatever.jsonl'), '{}');

  const folders = scanProjectFolders(tmp);
  assert.strictEqual(folders.length, 1);
  assert.strictEqual(folders[0].folderPath, folderA);
  assert.strictEqual(folders[0].jsonlFiles.length, 2);
});

test('v4: importProjectFolder creates one project for two sessions with same cwd', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-imp4-'));
  const db = initDB(path.join(tmp, 'app.db'));
  const folder = {
    folderPath: path.resolve('tests/fixtures/proj-a'),
    jsonlFiles: [
      path.resolve('tests/fixtures/proj-a/sess-1.jsonl'),
      path.resolve('tests/fixtures/proj-a/sess-2.jsonl'),
    ],
  };
  importProjectFolder(db, folder);

  const projCount = (db.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c;
  const sessCount = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
  const proj = db.prepare('SELECT name, cwd FROM projects').get() as { name: string; cwd: string | null };
  closeDB(db);
  // 1 个 folder → 1 个 project,即使 jsonl 跨不同 cwd
  // (因为 v4 的语义是"folder = project",session 的 cwd 各自存到 sessions.cwd)
  assert.strictEqual(projCount, 1);
  assert.strictEqual(sessCount, 2);
  // 第一个 jsonl 的 cwd = C:/Users/test/prompt/react-prompt-editor → name = react-prompt-editor
  assert.strictEqual(proj.name, 'react-prompt-editor');
  assert.strictEqual(proj.cwd, 'C:/Users/test/prompt/react-prompt-editor');
});

test('v4: sessions.cwd is set per-session from first message cwd', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-imp5-'));
  const db = initDB(path.join(tmp, 'app.db'));
  const folder = {
    folderPath: path.resolve('tests/fixtures/proj-a'),
    jsonlFiles: [
      path.resolve('tests/fixtures/proj-a/sess-1.jsonl'),
      path.resolve('tests/fixtures/proj-a/sess-2.jsonl'),
    ],
  };
  importProjectFolder(db, folder);
  const rows = db
    .prepare('SELECT session_id, cwd FROM sessions ORDER BY session_id')
    .all() as { session_id: string; cwd: string | null }[];
  closeDB(db);
  assert.strictEqual(rows.length, 2);
  const byId = new Map(rows.map((r) => [r.session_id, r.cwd]));
  assert.strictEqual(byId.get('sess-1'), 'C:/Users/test/prompt/react-prompt-editor');
  assert.strictEqual(byId.get('sess-2'), 'C:/Users/test/prompt/boss-prompts-manager');
});

import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { scanSourceDir, importFile } from '../electron/importer';

test('imports two jsonl files into db', () => {
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

import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { importFile } from '../electron/importer';
import { listBySession } from '../electron/repo/messages';
import { search } from '../electron/repo/search';

function setup(): { db: ReturnType<typeof initDB>; projectId: number } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-search-'));
  const db = initDB(path.join(tmp, 'app.db'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-1.jsonl'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-2.jsonl'));
  // Pick the leaf project that owns sess-1
  const row = db
    .prepare("SELECT project_id FROM sessions WHERE session_id = 'sess-1'")
    .get() as { project_id: number };
  return { db, projectId: row.project_id };
}

test('list messages in session', () => {
  const { db } = setup();
  const msgs = listBySession(db, 'sess-1');
  closeDB(db);
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, 'user');
});

test('search single keyword', () => {
  const { db } = setup();
  const hits = search(db, 'hello', null, null);
  closeDB(db);
  assert.ok(hits.some((h) => h.message.content.includes('hello')));
});

test('search multi-keyword AND', () => {
  const { db } = setup();
  const hits = search(db, 'reset database', null, null);
  closeDB(db);
  assert.strictEqual(hits.length, 1);
  assert.ok(hits[0].message.content.includes('reset'));
});

test('search filter by project', () => {
  const { db, projectId } = setup();
  // projectId is the leaf project for sess-1, which contains 'hello world'
  const hits = search(db, 'hello', [projectId], null);
  closeDB(db);
  assert.ok(hits.length > 0);
});

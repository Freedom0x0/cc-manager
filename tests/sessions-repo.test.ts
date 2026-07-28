import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { importFile } from '../electron/importer';
import { listByProject, get, softDelete, restore, permanentDelete } from '../electron/repo/sessions';

function setup(): { db: ReturnType<typeof initDB>; projectId: number } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-sess-'));
  const db = initDB(path.join(tmp, 'app.db'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-1.jsonl'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-2.jsonl'));
  // sess-1 belongs to its own child project (react-prompt-editor)
  const row = db
    .prepare(
      "SELECT project_id FROM sessions WHERE session_id = 'sess-1'"
    )
    .get() as { project_id: number };
  return { db, projectId: row.project_id };
}

test('list excludes deleted by default', () => {
  const { db, projectId } = setup();
  softDelete(db, 'sess-1');
  // After delete, the child project that owned sess-1 has 0 active sessions
  const active = listByProject(db, projectId, false);
  const all = listByProject(db, projectId, true);
  closeDB(db);
  assert.strictEqual(active.length, 0);
  assert.strictEqual(all.length, 1);
});

test('soft delete then restore', () => {
  const { db, projectId } = setup();
  softDelete(db, 'sess-1');
  assert.ok(get(db, 'sess-1'));
  restore(db, 'sess-1');
  const active = listByProject(db, projectId, false);
  closeDB(db);
  assert.strictEqual(active.length, 1);
});

test('permanent delete removes messages', () => {
  const { db } = setup();
  permanentDelete(db, 'sess-1');
  const count = (db.prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id = 'sess-1'").get() as { c: number }).c;
  closeDB(db);
  assert.strictEqual(count, 0);
});

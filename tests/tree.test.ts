import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { importFile } from '../electron/importer';
import { listProjectTree } from '../electron/repo/tree';

function setup(): ReturnType<typeof initDB> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-tree-'));
  const db = initDB(path.join(tmp, 'app.db'));
  // Flat model: one project, no parent
  const projId = (db.prepare(
    "INSERT INTO projects (project_path, name, parent_project_id, imported_at) VALUES (?, ?, NULL, ?)"
  ).run('C:/Users/test/prompt/react', 'react', Date.now()) as any).lastInsertRowid;
  db.prepare(
    "INSERT INTO sessions (session_id, project_id, title, started_at, last_message_at, message_count, source_file) VALUES (?, ?, ?, ?, ?, 0, ?)"
  ).run('s1', projId, 'session 1', 1, 1, 'fake.jsonl');
  return db;
}

test('listProjectTree returns flat project list', () => {
  const db = setup();
  const tree = listProjectTree(db);
  closeDB(db);
  assert.strictEqual(tree.length, 1);
  assert.strictEqual(tree[0].name, 'react');
  assert.strictEqual(tree[0].sessionCount, 1);
});

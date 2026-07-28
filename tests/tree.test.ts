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
  // Create a leaf project manually so we don't depend on the cluster for this test
  const topId = (db.prepare(
    "INSERT INTO projects (project_path, name, parent_project_id, imported_at) VALUES (?, ?, NULL, ?)"
  ).run('<top:prompt>', 'prompt', Date.now()) as any).lastInsertRowid;
  const childId = (db.prepare(
    "INSERT INTO projects (project_path, name, parent_project_id, imported_at) VALUES (?, ?, ?, ?)"
  ).run('C:/Users/test/prompt/react', 'react', topId, Date.now()) as any).lastInsertRowid;
  db.prepare(
    "INSERT INTO sessions (session_id, project_id, title, started_at, last_message_at, message_count, source_file) VALUES (?, ?, ?, ?, ?, 0, ?)"
  ).run('s1', childId, 'session 1', 1, 1, 'fake.jsonl');
  return db;
}

test('listProjectTree returns tops with children', () => {
  const db = setup();
  const tree = listProjectTree(db);
  closeDB(db);
  assert.strictEqual(tree.length, 1);
  assert.strictEqual(tree[0].name, 'prompt');
  assert.strictEqual(tree[0].children.length, 1);
  assert.strictEqual(tree[0].children[0].name, 'react');
  assert.strictEqual(tree[0].children[0].sessionCount, 1);
});

test('listProjectTree: tops with no children still appear', () => {
  const db = setup();
  db.prepare(
    "INSERT INTO projects (project_path, name, parent_project_id, imported_at) VALUES (?, ?, NULL, ?)"
  ).run('<top:other>', 'other', Date.now());
  const tree = listProjectTree(db);
  closeDB(db);
  assert.strictEqual(tree.length, 2);
  const other = tree.find((t) => t.name === 'other')!;
  assert.strictEqual(other.children.length, 0);
});

test('listProjectTree: deleted sessions not counted', () => {
  const db = setup();
  db.prepare("UPDATE sessions SET is_deleted = 1 WHERE session_id = 's1'").run();
  const tree = listProjectTree(db);
  closeDB(db);
  assert.strictEqual(tree[0].children[0].sessionCount, 0);
});

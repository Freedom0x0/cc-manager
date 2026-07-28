import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { importFile } from '../electron/importer';
import { listProjectTree } from '../electron/repo/tree';

test('lists projects in tree with session counts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-proj-'));
  const db = initDB(path.join(tmp, 'app.db'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-1.jsonl'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-2.jsonl'));
  const tree = listProjectTree(db);
  closeDB(db);
  // 1 top (prompt) + 2 children
  assert.strictEqual(tree.length, 1);
  assert.strictEqual(tree[0].name, 'prompt');
  assert.strictEqual(tree[0].children.length, 2);
  const totalChildSessions = tree[0].children.reduce((s, c) => s + c.sessionCount, 0);
  assert.strictEqual(totalChildSessions, 2);
});

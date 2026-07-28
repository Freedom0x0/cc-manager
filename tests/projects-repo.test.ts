import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { importFile } from '../electron/importer';
import { listProjectTree } from '../electron/repo/tree';

test('lists projects in flat tree with session counts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-proj-'));
  const db = initDB(path.join(tmp, 'app.db'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-1.jsonl'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-2.jsonl'));
  const tree = listProjectTree(db);
  closeDB(db);
  // Flat model: 2 independent projects (react-prompt-editor + boss-prompts-manager)
  assert.strictEqual(tree.length, 2);
  const total = tree.reduce((s, p) => s + p.sessionCount, 0);
  assert.strictEqual(total, 2);
});

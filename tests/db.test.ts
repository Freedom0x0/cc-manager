import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';

test('initDB creates projects, sessions, messages, messages_fts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-test-'));
  const dbPath = path.join(tmp, 'app.db');
  const db = initDB(dbPath);
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects','sessions','messages','messages_fts')")
    .all() as { name: string }[];
  closeDB(db);
  const names = rows.map((r) => r.name).sort();
  assert.deepStrictEqual(names, ['messages', 'messages_fts', 'projects', 'sessions']);
});

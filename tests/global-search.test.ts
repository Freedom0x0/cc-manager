import { test } from 'node:test';
import assert from 'node:assert';
import { initDB, closeDB } from '../electron/db/connection';
import { globalSearch } from '../electron/repo/search';

function createFixtureDB() {
  const db = initDB(':memory:');
  const insert = db.prepare(
    'INSERT INTO projects (project_path, name, imported_at, is_archived) VALUES (?, ?, ?, 0)'
  );
  insert.run('C:/projects/app-shell', 'App Shell', Date.now());
  insert.run('C:/projects/mobile-app', 'Mobile App', Date.now());
  insert.run('C:/projects/docs', 'Documentation', Date.now());
  return db;
}

test("globalSearch matches project names with LIKE '%query%'", () => {
  const db = createFixtureDB();
  const hits = globalSearch(db, 'app', 5);

  assert.ok(hits.length >= 1);
  assert.ok(hits.every((hit) => hit.kind === 'project'));
  assert.ok(hits.every((hit) => hit.title.toLowerCase().includes('app')));

  closeDB(db);
});

test('globalSearch respects the requested limit', () => {
  const db = createFixtureDB();
  const hits = globalSearch(db, 'app', 1);

  assert.ok(hits.length <= 1);

  closeDB(db);
});

test('globalSearch returns an empty array for an empty query', () => {
  const db = createFixtureDB();
  const hits = globalSearch(db, '', 5);

  assert.deepStrictEqual(hits, []);

  closeDB(db);
});

import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { importProjectFolder, archiveLegacyFakeProjects } from '../electron/importer';
import { listProjectTree } from '../electron/repo/tree';

test('lists projects in flat tree with session counts (v4: folder-level)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-proj-'));
  const db = initDB(path.join(tmp, 'app.db'));
  // 2 个 folder(模拟 ~/.claude/projects 下的两个 project)→ 2 个 project,2 个 session
  const folderA = {
    folderPath: path.resolve('tests/fixtures/proj-a'),
    jsonlFiles: [path.resolve('tests/fixtures/proj-a/sess-1.jsonl')],
  };
  // 第 2 个 folder 用临时目录 + 自己的 jsonl
  const folderB = path.join(tmp, 'C--Users-test-Desktop-cc-session-manager');
  fs.mkdirSync(folderB, { recursive: true });
  const jsonlB = path.join(folderB, 'sess-x.jsonl');
  fs.writeFileSync(
    jsonlB,
    '{"type":"user","uuid":"ux","sessionId":"sx","timestamp":"2026-07-28T11:00:00.000Z","cwd":"C:/Users/test/Desktop/cc-session-manager","message":{"role":"user","content":"hi"}}'
  );
  importProjectFolder(db, folderA);
  importProjectFolder(db, { folderPath: folderB, jsonlFiles: [jsonlB] });

  const tree = listProjectTree(db);
  closeDB(db);
  assert.strictEqual(tree.length, 2);
  const total = tree.reduce((s, p) => s + p.sessionCount, 0);
  assert.strictEqual(total, 2);
});

test('v4: archiveLegacyFakeProjects hides old v3 projects whose path is a cwd', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-mig-'));
  const db = initDB(path.join(tmp, 'app.db'));
  // 直接插 2 个假 project(v3 残留)
  db.prepare(
    "INSERT INTO projects (project_path, name, parent_project_id, imported_at) VALUES (?, ?, NULL, ?)"
  ).run('C:/Users/15532/Desktop/prompt', 'prompt', Date.now());
  db.prepare(
    "INSERT INTO projects (project_path, name, parent_project_id, imported_at) VALUES (?, ?, NULL, ?)"
  ).run('C:/Users/15532/Desktop/xj', 'xj', Date.now());

  const projectsDir = 'C:/Users/15532/.claude/projects';
  const archived = archiveLegacyFakeProjects(db, projectsDir);
  const visible = db
    .prepare('SELECT COUNT(*) AS c FROM projects WHERE is_archived = 0')
    .get() as { c: number };
  closeDB(db);
  assert.strictEqual(archived, 2);
  assert.strictEqual(visible.c, 0);
});

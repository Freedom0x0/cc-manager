import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import Database from 'better-sqlite3';
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

test('initDB on v1-shaped old DB migrates to v4 (adds cwd, is_archived, content_blocks)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-mig-'));
  const dbPath = path.join(tmp, 'app.db');
  // 1) 模拟 v1 老库:用 v1 最小 schema 直接建(没有 v4 的 cwd/is_archived/content_blocks)
  const v1Schema = `
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      project_path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      parent_project_id INTEGER REFERENCES projects(id),
      imported_at INTEGER NOT NULL
    );
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL,
      project_id INTEGER NOT NULL,
      title TEXT,
      started_at INTEGER NOT NULL,
      last_message_at INTEGER NOT NULL,
      message_count INTEGER NOT NULL,
      source_file TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      uuid TEXT UNIQUE NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `;
  const oldDb = new Database(dbPath);
  oldDb.pragma('foreign_keys = ON');
  oldDb.exec(v1Schema);
  // 插一条 v1 风格的项目,path 是 cwd-style
  oldDb
    .prepare(
      "INSERT INTO projects (project_path, name, parent_project_id, imported_at) VALUES (?, ?, NULL, ?)"
    )
    .run('C:/Users/old/prompt', 'prompt', Date.now());
  oldDb.close();

  // 2) 重新 initDB,应走 migrate 分支给老库加列
  const db2 = initDB(dbPath);
  const projCols = db2.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
  const sessCols = db2.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  const msgCols = db2.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const idxRows = db2
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_projects_archived'")
    .all() as { name: string }[];
  // 老数据迁移后 is_archived 应是 0
  const proj = db2
    .prepare("SELECT is_archived FROM projects WHERE project_path = 'C:/Users/old/prompt'")
    .get() as { is_archived: number | null };
  closeDB(db2);

  const projColNames = projCols.map((c) => c.name);
  const sessColNames = sessCols.map((c) => c.name);
  const msgColNames = msgCols.map((c) => c.name);
  assert.ok(projColNames.includes('cwd'), 'projects.cwd should be added');
  assert.ok(projColNames.includes('is_archived'), 'projects.is_archived should be added');
  assert.ok(sessColNames.includes('cwd'), 'sessions.cwd should be added');
  assert.ok(msgColNames.includes('content_blocks'), 'messages.content_blocks should be added');
  assert.strictEqual(idxRows.length, 1, 'idx_projects_archived index should exist after migrate');
  assert.strictEqual(proj.is_archived, 0, 'old project should default to is_archived=0 after migrate');
});


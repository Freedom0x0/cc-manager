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

test('initDB creates watcher_state table for chokidar event tracking (v5 wave-0)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-watcher-'));
  const dbPath = path.join(tmp, 'app.db');
  const db = initDB(dbPath);

  // 表存在
  const tableRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='watcher_state'")
    .all() as { name: string }[];
  assert.strictEqual(tableRows.length, 1, 'watcher_state table should exist after initDB');

  // 5 列齐全:key/value/updated_at(基础 KV)+ status/last_event/last_error(watcher 主控写入的辅助字段)
  // 但 Simplicity First:5 列收敛到最小集。watcher-state.ts 4 函数(getState/setStatus/recordEvent/recordError)
  // 共享一个 KV 表即可,不需要每函数一列。watcher 状态存到 key='status' 的 value 字段,避免 5 列里有 4 列是 NULL。
  const cols = db.prepare("PRAGMA table_info(watcher_state)").all() as { name: string }[];
  const colNames = cols.map((c) => c.name).sort();
  // 3 列 KV 模型:key 唯一 / value 存 JSON 字符串或纯文本 / updated_at 时间戳
  assert.deepStrictEqual(
    colNames,
    ['key', 'updated_at', 'value'],
    'watcher_state should have key/value/updated_at columns (KV 模型)'
  );
  assert.strictEqual(cols.length, 3, 'watcher_state 应该精确 3 列(KV 模型,多 1 列就违反 Simplicity First)');

  // 单值 KV 可读写(set/get 是后续 watcher-state.ts 的契约,这里先验证表可写)
  db.prepare("INSERT INTO watcher_state (key, value, updated_at) VALUES (?, ?, ?)").run(
    'status',
    'idle',
    Date.now()
  );
  const row = db
    .prepare("SELECT value FROM watcher_state WHERE key = 'status'")
    .get() as { value: string };
  assert.strictEqual(row.value, 'idle', 'watcher_state should store key/value pair');

  closeDB(db);
});

test('initDB creates mcp_server_state table for MCP server enabled-state KV (v5 wave-1)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-mcp-'));
  const dbPath = path.join(tmp, 'app.db');
  const db = initDB(dbPath);

  // 表存在
  const tableRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_server_state'")
    .all() as { name: string }[];
  assert.strictEqual(tableRows.length, 1, 'mcp_server_state table should exist after initDB');

  // 3 列 KV 模型,与 watcher_state 同形(D1 Simplicity First:不偏离 KV 模型用 5 列模板)
  const cols = db.prepare("PRAGMA table_info(mcp_server_state)").all() as { name: string }[];
  const colNames = cols.map((c) => c.name).sort();
  assert.deepStrictEqual(
    colNames,
    ['key', 'updated_at', 'value'],
    'mcp_server_state should have key/value/updated_at columns (KV 模型)'
  );
  assert.strictEqual(cols.length, 3, 'mcp_server_state 应该精确 3 列(KV 模型)');

  // KV 可读写,key 约定 'enabled:<name>' / 'last_modified:<name>'
  db.prepare("INSERT INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?)").run(
    'enabled:filesystem',
    'true',
    Date.now()
  );
  db.prepare("INSERT INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?)").run(
    'last_modified:filesystem',
    new Date().toISOString(),
    Date.now()
  );
  const enabled = db
    .prepare("SELECT value FROM mcp_server_state WHERE key = 'enabled:filesystem'")
    .get() as { value: string };
  const modified = db
    .prepare("SELECT value FROM mcp_server_state WHERE key = 'last_modified:filesystem'")
    .get() as { value: string };
  assert.strictEqual(enabled.value, 'true', 'mcp_server_state enabled KV should round-trip');
  assert.ok(modified.value.length > 0, 'mcp_server_state last_modified KV should round-trip');

  closeDB(db);
});


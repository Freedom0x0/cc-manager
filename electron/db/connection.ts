import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export type DB = Database.Database;

// Schema 故意不建 is_archived 索引:老库可能没 is_archived 列,
// CREATE INDEX IF NOT EXISTS 在不存在的列上会抛 'no such column'。
// 所有索引(包括 v4 新加的)统一在 initDB 末尾 migrate 阶段建,保证列先存在。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  project_path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  cwd TEXT,
  parent_project_id INTEGER REFERENCES projects(id),
  imported_at INTEGER NOT NULL,
  is_archived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  title TEXT,
  cwd TEXT,
  started_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  source_file TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  content_blocks TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_deleted ON sessions(is_deleted);
CREATE INDEX IF NOT EXISTS idx_sessions_last_msg ON sessions(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
`;

export function initDB(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // v1 → v2 migration: parent_project_id
  const projCols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
  if (!projCols.some((c) => c.name === 'parent_project_id')) {
    db.exec("ALTER TABLE projects ADD COLUMN parent_project_id INTEGER REFERENCES projects(id)");
  }
  // v4 migration: projects.cwd(真实路径)+ is_archived(老库假 project 隐藏)
  if (!projCols.some((c) => c.name === 'cwd')) {
    db.exec("ALTER TABLE projects ADD COLUMN cwd TEXT");
  }
  if (!projCols.some((c) => c.name === 'is_archived')) {
    // 老表加列不能 NOT NULL DEFAULT 0(SQLite 老版本限制),
    // 加成可空 + 应用层确保 0/1
    db.exec("ALTER TABLE projects ADD COLUMN is_archived INTEGER");
    db.exec("UPDATE projects SET is_archived = 0 WHERE is_archived IS NULL");
  }
  // v4 migration: sessions.cwd(resumer 用)
  const sessCols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (!sessCols.some((c) => c.name === 'cwd')) {
    db.exec("ALTER TABLE sessions ADD COLUMN cwd TEXT");
  }
  // v4 migration: messages.content_blocks(JSON)
  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!msgCols.some((c) => c.name === 'content_blocks')) {
    db.exec("ALTER TABLE messages ADD COLUMN content_blocks TEXT");
  }

  // 所有列都存在后,再建新索引(列存在性 + 索引 IF NOT EXISTS 一起保证幂等)
  db.exec("CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(is_archived)");
  return db;
}

export function closeDB(db: DB): void {
  db.close();
}

//! v4.0 DB 层
//!
//! 平移自 v3.1 `electron/db/connection.ts`(5 表 + FTS5 + 触发器 + 4 ALTER 兼容)。
//! schema 不变(snake_case),repo 函数返回时用 serde rename 转 camelCase 喂前端。
//!
//! 模块结构:
//! - `mod.rs` — DB struct + init_db() + SCHEMA_SQL 常量 + pragma 设置
//! - `migration.rs` — 4 个 ALTER 兼容迁移(v1 → v2 → v4)
//!
//! 跨平台 app_data_dir 由 Tauri 提供(`app_handle.path().app_data_dir()`),
//! 删 v3.1 `main.ts:getDataDir()` 的手写分支。

use rusqlite::Connection;
use std::path::Path;
use std::fs;
use thiserror::Error;

mod migration;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("rusqlite error: {0}")]
    Rusqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("migration error: {0}")]
    Migration(String),
}

pub type Result<T> = std::result::Result<T, DbError>;

/// v4.0 DB 包装。Connection 是 Send + !Sync,外面装 Mutex 后变 Send + Sync
/// 才能装进 tauri::State(spec §3.4)。
pub struct DB(pub Connection);

/// 5 表 + FTS5 + 触发器 + 4 索引。
/// 与 v3.1 `electron/db/connection.ts:10-93` 字节级等价。
///
/// v5 wave-0: watcher 单值 KV 表 (key PRIMARY KEY / value / updated_at) — Simplicity First。
/// v5 wave-1: mcp_server_state KV 表存 enabled: / last_modified: 前缀。
/// commit 14 drop_mcp_server_state(豁免 §4 半年原则,D15 后已无读路径)。
const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  project_path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  cwd TEXT,
  parent_project_id INTEGER REFERENCES projects(id),
  imported_at INTEGER NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS watcher_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_server_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);
"#;

/// 初始化 DB:创建父目录 + 打开 connection + 执行 schema + 4 ALTER 迁移 + pragma。
///
/// 与 v3.1 `electron/db/connection.ts:95-131` 逻辑等价。
pub fn init_db(app_data_dir: &Path) -> Result<DB> {
    fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("app.db");
    let conn = Connection::open(&db_path)?;

    // WAL 模式允许并发读 + 单写;foreign_keys 强制外键约束
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    conn.execute_batch(SCHEMA_SQL)?;

    // 4 个 ALTER 兼容迁移(逻辑在 migration.rs)
    crate::db::migration::run_migrations(&conn)?;

    // 所有列都存在后,再建新索引
    conn.execute("CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(is_archived)", [])?;

    Ok(DB(conn))
}

impl DB {
    /// 关闭连接(v3.1 closeDB 的对应实现)。
    /// rusqlite Connection::close() 返回 `Result<(), (Connection, Error)>`:
    /// Ok 时 close 成功(空 tuple);Err 时保留 Connection 用于排查,error 在内层 tuple 第二项。
    /// 我们这里忽略 Connection,只看 error。
    pub fn close(self) -> Result<()> {
        match self.0.close() {
            Ok(()) => Ok(()),
            Err((_conn, err)) => Err(DbError::Rusqlite(err)),
        }
    }
}

// ============================================================================
// tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// 列存在性检测 helper(与 v3.1 PRAGMA table_info + some(c.name === ...) 一致)
    fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(cols.iter().any(|c| c == column))
    }

    /// case 1: v1 schema(无 parent_project_id / cwd / is_archived / content_blocks)
    /// → 跑 init_db → 列全在(WAL 启用)
    #[test]
    fn test_init_db_v1_schema_upgrades_to_v4() -> Result<()> {
        let dir = TempDir::new()?;
        let db_path = dir.path().join("v1.db");
        {
            let conn = Connection::open(&db_path)?;
            // v1 schema: 只有最基础的列,没有 v2/v4 加的列
            conn.execute_batch(r#"
                CREATE TABLE projects (
                  id INTEGER PRIMARY KEY,
                  project_path TEXT UNIQUE NOT NULL,
                  name TEXT NOT NULL,
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
            "#)?;
        } // close

        let _db = init_db(dir.path())?;

        // 重新打开验证列存在
        let conn = Connection::open(&db_path)?;
        assert!(has_column(&conn, "projects", "parent_project_id")?, "parent_project_id should be added");
        assert!(has_column(&conn, "projects", "cwd")?, "projects.cwd should be added");
        assert!(has_column(&conn, "projects", "is_archived")?, "projects.is_archived should be added");
        assert!(has_column(&conn, "sessions", "cwd")?, "sessions.cwd should be added");
        assert!(has_column(&conn, "messages", "content_blocks")?, "messages.content_blocks should be added");

        // WAL 启用
        let journal_mode: String = conn.pragma_query_value(None, "journal_mode", |r| r.get(0))?;
        assert_eq!(journal_mode.to_lowercase(), "wal", "WAL pragma should be enabled");

        Ok(())
    }

    /// case 2: v2 schema(有 parent_project_id,缺其他)
    /// → 跑 init_db → 缺的全补
    #[test]
    fn test_init_db_v2_schema_adds_remaining_columns() -> Result<()> {
        let dir = TempDir::new()?;
        let db_path = dir.path().join("v2.db");
        {
            let conn = Connection::open(&db_path)?;
            conn.execute_batch(r#"
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
            "#)?;
        }

        let _db = init_db(dir.path())?;

        let conn = Connection::open(&db_path)?;
        // v2 已有 parent_project_id,但缺 cwd / is_archived / sessions.cwd / messages.content_blocks
        assert!(has_column(&conn, "projects", "parent_project_id")?);
        assert!(has_column(&conn, "projects", "cwd")?, "projects.cwd should be added (v2 -> v4)");
        assert!(has_column(&conn, "projects", "is_archived")?, "projects.is_archived should be added (v2 -> v4)");
        assert!(has_column(&conn, "sessions", "cwd")?);
        assert!(has_column(&conn, "messages", "content_blocks")?);

        Ok(())
    }

    /// case 3: v4 schema(全在)
    /// → 跑 init_db → 幂等无错
    #[test]
    fn test_init_db_v4_schema_is_idempotent() -> Result<()> {
        let dir = TempDir::new()?;
        let _db1 = init_db(dir.path())?;
        let _db2 = init_db(dir.path())?; // 第二次跑应该不报错
        drop(_db1);
        let _db3 = init_db(dir.path())?; // 第三次跑
        Ok(())
    }

    /// case 4: 跨平台路径(用 tempfile 模拟;实际 OS 路径由 Tauri 提供)
    /// → 各平台 init_db 不报错
    #[test]
    fn test_init_db_cross_platform_temp_paths() -> Result<()> {
        for i in 0..3 {
            let dir = TempDir::new()?;
            // 模拟 Windows / macOS / Linux 各自的 app_data_dir 路径风格
            let app_dir = match i {
                0 => dir.path().join("Roaming").join("cc-session-manager"),
                1 => dir.path().join("Library").join("Application Support").join("cc-session-manager"),
                _ => dir.path().join(".config").join("cc-session-manager"),
            };
            let _db = init_db(&app_dir)?;
            assert!(app_dir.join("app.db").exists(), "DB file should exist at {:?}", app_dir.join("app.db"));
        }
        Ok(())
    }
}
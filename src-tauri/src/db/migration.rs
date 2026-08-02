//! v4.0 DB migration 层
//!
//! 平移自 v3.1 `electron/db/connection.ts:103-126` 的 4 个 ALTER 兼容逻辑。
//! 关键约束:**永远不直接 DROP TABLE**(CLAUDE.md §4);加列必须 ALTER 兼容。
//!
//! 加列必须检测存在性后 ALTER:
//! - SQLite 老版本限制:老表加 NOT NULL DEFAULT 0 列不支持
//! - 应用层确保 is_archived 默认 0/1(加列后 UPDATE WHERE IS NULL)
//! - 索引在所有列都存在后再建(IF NOT EXISTS 防列不存在时报错)
//!
//! 4 个 ALTER 迁移:
//! - v1 → v2: projects.parent_project_id
//! - v2 → v4: projects.cwd
//! - v2 → v4: projects.is_archived(老库假 project 隐藏)
//! - v4: sessions.cwd(resumer 用)
//! - v4: messages.content_blocks(JSON)
//!
//! 实际是 **5 个 ALTER**,v3.1 `electron/db/connection.ts:103-126` 也跑了 5 个
//! (parent_project_id + projects.cwd + projects.is_archived + sessions.cwd + messages.content_blocks)。
//! spec §9 commit 1 写的"4 ALTER"是 rounding down。

use rusqlite::Connection;
use super::Result;

/// 5 个 ALTER 兼容迁移。幂等:重复跑不报错(每步检测列存在性)。
///
/// 与 v3.1 `electron/db/connection.ts:103-126` 1:1 等价。
pub fn run_migrations(conn: &Connection) -> Result<()> {
    // v1 → v2: projects.parent_project_id
    if !has_column(conn, "projects", "parent_project_id")? {
        conn.execute(
            "ALTER TABLE projects ADD COLUMN parent_project_id INTEGER REFERENCES projects(id)",
            [],
        )?;
    }

    // v4: projects.cwd(真实路径)
    if !has_column(conn, "projects", "cwd")? {
        conn.execute("ALTER TABLE projects ADD COLUMN cwd TEXT", [])?;
    }

    // v4: projects.is_archived(老库假 project 隐藏)
    if !has_column(conn, "projects", "is_archived")? {
        // 老表加列不能 NOT NULL DEFAULT 0(SQLite 老版本限制),
        // 加成可空 + 应用层 UPDATE WHERE IS NULL
        conn.execute("ALTER TABLE projects ADD COLUMN is_archived INTEGER", [])?;
        conn.execute("UPDATE projects SET is_archived = 0 WHERE is_archived IS NULL", [])?;
    }

    // v4: sessions.cwd(resumer 用)
    if !has_column(conn, "sessions", "cwd")? {
        conn.execute("ALTER TABLE sessions ADD COLUMN cwd TEXT", [])?;
    }

    // v4: messages.content_blocks(JSON)
    if !has_column(conn, "messages", "content_blocks")? {
        conn.execute("ALTER TABLE messages ADD COLUMN content_blocks TEXT", [])?;
    }

    Ok(())
}

/// 检测列存在性 helper。
///
/// v3.1 用 `db.prepare("PRAGMA table_info(projects)").all() + .some(c => c.name === ...)`,
/// 平移为 `query_map + collect + contains`。
fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}
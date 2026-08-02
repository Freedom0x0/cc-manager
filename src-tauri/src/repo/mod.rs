//! v4.0 Sessions 读 IPC 的 repo 函数
//!
//! 平移自 v3.1 electron/repo/{projects,sessions,messages,search,tree}.ts。
//! 一律使用 snake_case 字段名 + serde 转 camelCase 喂前端(单一来源 types.rs)。
//!
//! commit 2 范围:5 个读 IPC 对应 repo 函数
//! - list_with_counts (projects.rs)
//! - list_by_project (sessions.rs)
//! - list_deleted_sessions (sessions.rs)
//! - list_by_session (messages.rs)
//! - search (search.rs)
//! - list_project_tree (tree.rs)

use crate::db::DB;
use crate::types::{MessageRow, ProjectRow, ProjectTreeNode, ResumeCommand, SearchHit, SessionRow};
use rusqlite::params;
use std::path::Path;

pub mod mcp_scanner;
pub mod mcp_writer;
pub mod skills_scanner;
pub mod skills_writer;
pub mod commands_scanner;
pub mod commands_writer;
pub mod agents_scanner;
pub mod agents_writer;
pub mod hooks_scanner;
pub mod hooks_writer;
pub mod plugins_scanner;
pub mod plugins_writer;
pub mod profiles;
pub mod usage;
pub mod common;

/// 平移自 v3.1 electron/repo/projects.ts:listWithCounts
/// session_count 用 LEFT JOIN 计算,is_archived = 0 过滤。
pub fn list_with_counts(db: &DB) -> rusqlite::Result<Vec<ProjectRow>> {
    let sql = "
        SELECT p.id, p.project_path AS path, p.name, COALESCE(c.cnt, 0) AS session_count
        FROM projects p
        LEFT JOIN (
            SELECT project_id, COUNT(*) AS cnt
            FROM sessions
            WHERE is_deleted = 0
            GROUP BY project_id
        ) c ON c.project_id = p.id
        WHERE p.is_archived = 0
        ORDER BY p.name
    ";
    let conn = &db.0;
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(ProjectRow {
            id: row.get(0)?,
            path: row.get(1)?,
            name: row.get(2)?,
            session_count: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// 平移自 v3.1 electron/repo/sessions.ts:listByProject
pub fn list_by_project(db: &DB, project_id: i64, include_deleted: bool) -> rusqlite::Result<Vec<SessionRow>> {
    let sql = "
        SELECT id, session_id, project_id, title, cwd, started_at, last_message_at,
               message_count, source_file, is_deleted, deleted_at
        FROM sessions
        WHERE project_id = ?1
          AND (?2 = 1 OR is_deleted = 0)
        ORDER BY last_message_at DESC
    ";
    let conn = &db.0;
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![project_id, include_deleted as i64], session_row_mapper)?;
    rows.collect()
}

fn session_row_mapper(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        project_id: row.get(2)?,
        title: row.get(3)?,
        cwd: row.get(4)?,
        started_at: row.get(5)?,
        last_message_at: row.get(6)?,
        message_count: row.get(7)?,
        source_file: row.get(8)?,
        is_deleted: row.get(9)?,
        deleted_at: row.get(10)?,
    })
}

/// 平移自 v3.1 electron/repo/sessions.ts:listDeleted
pub fn list_deleted_sessions(db: &DB) -> rusqlite::Result<Vec<SessionRow>> {
    let sql = "
        SELECT id, session_id, project_id, title, cwd, started_at, last_message_at,
               message_count, source_file, is_deleted, deleted_at
        FROM sessions
        WHERE is_deleted = 1
        ORDER BY deleted_at DESC
    ";
    let conn = &db.0;
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], session_row_mapper)?;
    rows.collect()
}

/// 平移自 v3.1 electron/repo/messages.ts:listBySession
pub fn list_by_session(db: &DB, session_id: &str) -> rusqlite::Result<Vec<MessageRow>> {
    let sql = "
        SELECT id, uuid, session_id, role, content, content_blocks, created_at
        FROM messages
        WHERE session_id = ?1
        ORDER BY created_at ASC
    ";
    let conn = &db.0;
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(MessageRow {
            id: row.get(0)?,
            uuid: row.get(1)?,
            session_id: row.get(2)?,
            role: row.get(3)?,
            content: row.get(4)?,
            content_blocks: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    rows.collect()
}

/// 平移自 v3.1 electron/repo/search.ts:search
/// FTS5 messages_fts 查询 + 可选项目/时间过滤。
pub fn search(
    db: &DB,
    query: &str,
    project_ids: Option<Vec<i64>>,
    range: Option<(i64, i64)>,
) -> rusqlite::Result<Vec<SearchHit>> {
    // 基础查询用 FTS5 bm25 排序,可选 project/time 过滤
    let mut sql = "
        SELECT m.id, m.session_id, s.project_id, m.role, m.content, m.created_at
        FROM messages_fts f
        JOIN messages m ON m.id = f.rowid
        JOIN sessions s ON s.session_id = m.session_id
        WHERE messages_fts MATCH ?1
          AND s.is_deleted = 0
    ".to_string();

    if project_ids.is_some() {
        sql.push_str(" AND s.project_id IN (");
        sql.push_str(&vec!["?"; project_ids.as_ref().unwrap().len()].join(","));
        sql.push(')');
    }

    if range.is_some() {
        sql.push_str(" AND m.created_at BETWEEN ? AND ?");
    }

    sql.push_str(" ORDER BY bm25(messages_fts) LIMIT 200");

    let conn = &db.0;
    let mut stmt = conn.prepare(&sql)?;

    // 动态绑定参数
    let mut params_dyn: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(query.to_string())];
    if let Some(pids) = &project_ids {
        for p in pids {
            params_dyn.push(Box::new(*p));
        }
    }
    if let Some((from, to)) = range {
        params_dyn.push(Box::new(from));
        params_dyn.push(Box::new(to));
    }

    let param_refs: Vec<&dyn rusqlite::ToSql> = params_dyn.iter().map(|b| b.as_ref()).collect();

    let rows = stmt.query_map(&param_refs[..], |row| {
        Ok(SearchHit {
            message_id: row.get(0)?,
            session_id: row.get(1)?,
            project_id: row.get(2)?,
            role: row.get(3)?,
            content: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

/// 平移自 v3.1 electron/repo/tree.ts:listProjectTree
/// parent_project_id 递归构建父子树(简化版 v2 扁平用 path.basename,v3 仍是 v2 父子)。
/// spec §13 D17 项目聚类简化为 path.basename,本函数保留 tree 结构以匹配 v3.1 IPC 形状。
pub fn list_project_tree(db: &DB) -> rusqlite::Result<Vec<ProjectTreeNode>> {
    // 先拿所有项目 + session count
    let flat = list_with_counts(db)?;
    let conn = &db.0;
    let mut stmt = conn.prepare("SELECT id, parent_project_id FROM projects WHERE is_archived = 0")?;
    let parents: Vec<(i64, Option<i64>)> = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let parent_map: std::collections::HashMap<i64, Option<i64>> = parents.into_iter().collect();

    // 找根项目(parent_project_id IS NULL) → 子项目 → 递归
    let mut roots: Vec<ProjectTreeNode> = Vec::new();
    for p in &flat {
        if parent_map.get(&p.id).map_or(true, |pp| pp.is_none()) {
            roots.push(build_node(p.clone(), &flat, &parent_map));
        }
    }
    Ok(roots)
}

fn build_node(
    self_row: ProjectRow,
    all: &[ProjectRow],
    parent_map: &std::collections::HashMap<i64, Option<i64>>,
) -> ProjectTreeNode {
    let mut children = Vec::new();
    for p in all {
        if p.id == self_row.id {
            continue;
        }
        if let Some(Some(parent_id)) = parent_map.get(&p.id) {
            if *parent_id == self_row.id {
                children.push(build_node(p.clone(), all, parent_map));
            }
        }
    }
    ProjectTreeNode {
        id: self_row.id,
        path: self_row.path,
        name: self_row.name,
        session_count: self_row.session_count,
        children,
    }
}

// ============================================================
// commit 3: 5 写 IPC 的 repo 函数
// ============================================================

/// 平移自 v3.1 electron/repo/sessions.ts:get
pub fn get_session(db: &DB, session_id: &str) -> rusqlite::Result<Option<SessionRow>> {
    let sql = "
        SELECT id, session_id, project_id, title, cwd, started_at, last_message_at,
               message_count, source_file, is_deleted, deleted_at
        FROM sessions
        WHERE session_id = ?1
    ";
    let conn = &db.0;
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query(params![session_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(session_row_mapper(row)?))
    } else {
        Ok(None)
    }
}

/// 平移自 v3.1 electron/repo/sessions.ts:softDelete
/// is_deleted = 1 + deleted_at = now, 不真删消息, FTS5 触发器自动同步(soft delete + FTS)
pub fn soft_delete(db: &DB, session_id: &str) -> rusqlite::Result<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let conn = &db.0;
    conn.execute(
        "UPDATE sessions SET is_deleted = 1, deleted_at = ?1 WHERE session_id = ?2",
        params![now, session_id],
    )?;
    Ok(())
}

/// 平移自 v3.1 electron/repo/sessions.ts:restore
pub fn restore(db: &DB, session_id: &str) -> rusqlite::Result<()> {
    let conn = &db.0;
    conn.execute(
        "UPDATE sessions SET is_deleted = 0, deleted_at = NULL WHERE session_id = ?1",
        params![session_id],
    )?;
    Ok(())
}

/// 平移自 v3.1 electron/repo/sessions.ts:permanentDelete
/// 事务: 先删 messages (FTS5 触发器自动同步), 再删 sessions。
pub fn permanent_delete(db: &DB, session_id: &str) -> rusqlite::Result<()> {
    let conn = &db.0;
    conn.execute("DELETE FROM messages WHERE session_id = ?1", params![session_id])?;
    conn.execute("DELETE FROM sessions WHERE session_id = ?1", params![session_id])?;
    Ok(())
}

/// 平移自 v3.1 electron/resumer.ts:buildResumeCommand
/// v4 spec: 只生成命令字符串返回给前端,不在主进程里 spawn claude.cmd。
/// 保留 cwd 让用户在终端里 cd 后执行。
pub fn build_resume_command(session_id: &str, cwd: Option<&Path>) -> ResumeCommand {
    ResumeCommand {
        command: format!("claude --resume {}", session_id),
        cwd: cwd.map(|p| p.to_string_lossy().to_string()),
    }
}

/// resume_session 的实现:
/// 1. 查 sessions 表拿 cwd + session_id
/// 2. 兜底: cwd 为空则取 source_file 的父目录
/// 3. 调 build_resume_command 返回
pub fn resume_session(db: &DB, session_id: &str) -> rusqlite::Result<Option<ResumeCommand>> {
    let conn = &db.0;
    let mut stmt = conn.prepare(
        "SELECT cwd, source_file FROM sessions WHERE session_id = ?1"
    )?;
    let row = stmt.query_row(params![session_id], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, String>(1)?,
        ))
    });
    match row {
        Ok((cwd, source_file)) => {
            let cwd_path = cwd
                .as_deref()
                .map(Path::new)
                .filter(|p| p.exists())
                .unwrap_or_else(|| Path::new(&source_file).parent().unwrap_or(Path::new(".")));
            Ok(Some(build_resume_command(session_id, Some(cwd_path))))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

// ============================================================================
// tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;
    use tempfile::TempDir;

    fn seed(db: &DB) {
        let conn = &db.0;
        conn.execute(
            "INSERT INTO projects (project_path, name, imported_at, is_archived) VALUES ('/p/A', 'Alpha', 1000, 0)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO projects (project_path, name, imported_at, is_archived) VALUES ('/p/B', 'Beta', 1000, 0)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO sessions (session_id, project_id, started_at, last_message_at, message_count, source_file) VALUES
             ('sess-1', 1, 1000, 1000, 5, '/p/A/sess-1.jsonl'),
             ('sess-2', 1, 1100, 1100, 3, '/p/A/sess-2.jsonl'),
             ('sess-3', 2, 1200, 1200, 7, '/p/B/sess-3.jsonl')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO messages (uuid, session_id, role, content, created_at) VALUES
             ('u1', 'sess-1', 'user', 'hello world', 1000),
             ('u2', 'sess-1', 'assistant', 'how can I help', 1100)",
            [],
        ).unwrap();
    }

    #[test]
    fn test_list_with_counts() {
        let dir = TempDir::new().unwrap();
        let db = init_db(dir.path()).unwrap();
        seed(&db);
        let projects = list_with_counts(&db).unwrap();
        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].session_count, 2); // Alpha has 2 sessions
        assert_eq!(projects[1].session_count, 1); // Beta has 1 session
    }

    #[test]
    fn test_list_by_project() {
        let dir = TempDir::new().unwrap();
        let db = init_db(dir.path()).unwrap();
        seed(&db);
        let sessions = list_by_project(&db, 1, false).unwrap();
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn test_list_by_session() {
        let dir = TempDir::new().unwrap();
        let db = init_db(dir.path()).unwrap();
        seed(&db);
        let messages = list_by_session(&db, "sess-1").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
    }

    #[test]
    fn test_search_fts5() {
        let dir = TempDir::new().unwrap();
        let db = init_db(dir.path()).unwrap();
        seed(&db);
        let hits = search(&db, "hello", None, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].content, "hello world");
    }

    #[test]
    fn test_search_with_project_filter() {
        let dir = TempDir::new().unwrap();
        let db = init_db(dir.path()).unwrap();
        seed(&db);
        let hits = search(&db, "hello", Some(vec![1]), None).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn test_list_project_tree() {
        let dir = TempDir::new().unwrap();
        let db = init_db(dir.path()).unwrap();
        seed(&db);
        let tree = list_project_tree(&db).unwrap();
        assert_eq!(tree.len(), 2); // 2 root projects
    }
}
//! v4.0 importer 模块测试 (commit 18)
//!
//! Case 1: scan_project_folders 空目录 → []
//! Case 2: scan_project_folders 单 folder 1 jsonl → 1 folder
//! Case 3: parse_line 基本 user 消息
//! Case 4: parse_line assistant + tool_use block
//! Case 5: parse_line 损坏 JSON 返 None
//! Case 6: import_project_folder 入库 (projects + sessions + messages)
//! Case 7: rescan_all 默认路径 = ~/.claude/projects (函数签名)
//! Case 8: timestamp 解析 RFC3339 → ms

use crate::db::init_db;
use crate::importer::{parse_line, scan_project_folders, ImportStats};
use serde_json::json;
use std::fs;
use tempfile::TempDir;

#[test]
fn case1_scan_empty() {
    let dir = TempDir::new().unwrap();
    let folders = scan_project_folders(dir.path());
    assert!(folders.is_empty());
}

#[test]
fn case2_scan_one_folder() {
    let dir = TempDir::new().unwrap();
    let proj_dir = dir.path().join("proj-a");
    fs::create_dir(&proj_dir).unwrap();
    fs::write(proj_dir.join("session-1.jsonl"), "ignored").unwrap();
    fs::write(proj_dir.join("not-jsonl.txt"), "ignored").unwrap();
    let folders = scan_project_folders(dir.path());
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].folder_path, proj_dir.to_string_lossy().to_string());
    assert_eq!(folders[0].jsonl_files.len(), 1);
}

#[test]
fn case3_parse_user_text() {
    let line = json!({
        "type": "user",
        "uuid": "u1",
        "sessionId": "s1",
        "timestamp": "2026-07-30T06:44:07.884Z",
        "cwd": "C:/Users/me/proj",
        "message": { "role": "user", "content": "hello" }
    })
    .to_string();
    let msg = parse_line(&line).unwrap();
    assert_eq!(msg.uuid, "u1");
    assert_eq!(msg.session_id, "s1");
    assert_eq!(msg.role, "user");
    assert_eq!(msg.content, "hello");
    assert_eq!(msg.project_path, "C:/Users/me/proj");
    assert_eq!(msg.created_at_ms, 1785393847884);
}

#[test]
fn case4_parse_assistant_tool_use() {
    let line = json!({
        "type": "assistant",
        "uuid": "a1",
        "sessionId": "s2",
        "timestamp": "2026-07-30T07:00:00.000Z",
        "cwd": "/home/me/proj",
        "message": {
            "role": "assistant",
            "content": [
                { "type": "text", "text": "Let me read it." },
                { "type": "tool_use", "name": "Read", "input": { "path": "/x" } }
            ]
        }
    })
    .to_string();
    let msg = parse_line(&line).unwrap();
    assert_eq!(msg.role, "assistant");
    assert_eq!(msg.content, "Let me read it.");
    assert_eq!(msg.blocks.len(), 2);
}

#[test]
fn case5_parse_invalid_returns_none() {
    assert!(parse_line("not json").is_none());
    assert!(parse_line(r#"{"type":"system","uuid":"x","sessionId":"y","timestamp":"2026-01-01T00:00:00Z","cwd":"/z","message":{"role":"user","content":"x"}}"#).is_none());
    assert!(parse_line(r#"{"uuid":"x"}"#).is_none());
}

#[test]
fn case6_import_folder() {
    let dir = TempDir::new().unwrap();
    let proj_dir = dir.path().join("p1");
    fs::create_dir(&proj_dir).unwrap();
    let jsonl_path = proj_dir.join("s1.jsonl");
    let content = format!(
        "{}\n{}\n",
        json!({
            "type": "user",
            "uuid": "u1",
            "sessionId": "s1",
            "timestamp": "2026-07-30T06:00:00.000Z",
            "cwd": "/home/me/p1",
            "message": { "role": "user", "content": "hello world" }
        }),
        json!({
            "type": "assistant",
            "uuid": "a1",
            "sessionId": "s1",
            "timestamp": "2026-07-30T06:00:05.000Z",
            "cwd": "/home/me/p1",
            "message": {
                "role": "assistant",
                "content": [
                    { "type": "text", "text": "hi" },
                    { "type": "tool_use", "name": "Read", "input": { "path": "/y" } }
                ]
            }
        })
    );
    fs::write(&jsonl_path, content).unwrap();

    let db_dir = TempDir::new().unwrap();
    let db = init_db(db_dir.path()).unwrap();
    let folders = scan_project_folders(dir.path());
    assert_eq!(folders.len(), 1);

    let stats = crate::importer::import_project_folder(&db, &folders[0]).unwrap();
    assert_eq!(stats.sessions_added, 1);
    assert_eq!(stats.messages_added, 2);

    // 验证 projects + sessions + messages
    let conn = &db.0;
    let proj_count: i64 = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0)).unwrap();
    assert_eq!(proj_count, 1);
    let proj_name: String = conn.query_row("SELECT name FROM projects LIMIT 1", [], |r| r.get(0)).unwrap();
    assert_eq!(proj_name, "p1");
    let sess_count: i64 = conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0)).unwrap();
    assert_eq!(sess_count, 1);
    let msg_count: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0)).unwrap();
    assert_eq!(msg_count, 2);
}

#[test]
fn case7_rescan_all_signature() {
    // 验证 default_source_dir 返回 ~/.claude/projects
    let p = crate::importer::default_source_dir();
    assert!(p.to_string_lossy().contains(".claude"));
    assert!(p.to_string_lossy().ends_with("projects"));
}

#[test]
fn case8_idempotent_rescan() {
    // 二次 import 不增加 sessions (INSERT OR IGNORE 走 UNIQUE session_id)
    let dir = TempDir::new().unwrap();
    let proj_dir = dir.path().join("p");
    fs::create_dir(&proj_dir).unwrap();
    fs::write(
        proj_dir.join("s.jsonl"),
        json!({
            "type": "user",
            "uuid": "u1",
            "sessionId": "s1",
            "timestamp": "2026-07-30T06:00:00.000Z",
            "cwd": "/x",
            "message": { "role": "user", "content": "hi" }
        })
        .to_string(),
    )
    .unwrap();

    let db_dir = TempDir::new().unwrap();
    let db = init_db(db_dir.path()).unwrap();
    let folders = scan_project_folders(dir.path());

    let stats1 = crate::importer::import_project_folder(&db, &folders[0]).unwrap();
    assert_eq!(stats1.sessions_added, 1);
    assert_eq!(stats1.messages_added, 1);

    let stats2 = crate::importer::import_project_folder(&db, &folders[0]).unwrap();
    assert_eq!(stats2.sessions_added, 0);
    assert_eq!(stats2.messages_added, 0);

    let _: ImportStats = Default::default();
}
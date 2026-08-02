//! v4.0 Usage 模块测试
//!
//! 6 case (1-5 usageSummary / 单 session 细节;6 走 get_top_tools):
//! Case 1: 空 DB → 全 0
//! Case 2: 2p+2s+5m → totalSessions=2, totalMessages=5, byProject=[..2..]
//! Case 3: 单 session cost(timeline + cost tokens)
//! Case 4: rangeDays 过滤 byDay
//! Case 5: content_blocks 提 tool_use.name(json_each 路径)
//! Case 6: get_top_tools 限制 limit

use crate::db::init_db;
use crate::repo::usage::{get_session_cost, get_session_timeline, get_top_tools, usage_summary};
use tempfile::TempDir;

fn seed(db: &crate::db::DB) {
    let conn = &db.0;
    conn.execute_batch(
        "INSERT INTO projects (project_path, name, imported_at, is_archived) VALUES
         ('/p/A', 'Alpha', 1000, 0),
         ('/p/B', 'Beta', 1000, 0);",
    )
    .unwrap();
    let day1: i64 = 86_400_000; // 1970-01-02
    let day5: i64 = 5 * day1; // 1970-01-06
    conn.execute_batch(&format!(
        "INSERT INTO sessions (session_id, project_id, started_at, last_message_at, message_count, source_file) VALUES
         ('s1', 1, {d1}, {d1}, 3, '/p/A/s1.jsonl'),
         ('s2', 2, {d5}, {d5}, 2, '/p/B/s2.jsonl');",
        d1 = day1,
        d5 = day5,
    ))
    .unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO messages (uuid, session_id, role, content, content_blocks, created_at) VALUES
         ('u1', 's1', 'user',      'hello world',           '[{{\"type\":\"text\",\"text\":\"hi\"}}]', {d1}),
         ('u2', 's1', 'assistant', 'how can I help',        '[{{\"type\":\"text\",\"text\":\"how can I help\"}}]', {d1}),
         ('u3', 's1', 'assistant', '',                       '[{{\"type\":\"tool_use\",\"name\":\"Read\",\"input\":{{\"path\":\"/x\"}}}}, {{\"type\":\"text\",\"text\":\"ok\"}}]', {d1}),
         ('u4', 's2', 'user',      'second',                NULL, {d5}),
         ('u5', 's2', 'assistant', 'answer',                '[{{\"type\":\"text\",\"text\":\"answer answer answer\"}}]', {d5});",
        d1 = day1,
        d5 = day5,
    ))
    .unwrap();
}

#[test]
fn case1_empty_db() {
    let dir = TempDir::new().unwrap();
    let db = init_db(dir.path()).unwrap();
    let s = usage_summary(&db, 30);
    assert_eq!(s.total_sessions, 0);
    assert_eq!(s.total_messages, 0);
    assert_eq!(s.total_tokens, 0);
    assert_eq!(s.total_duration_ms, 0);
    assert!(s.by_project.is_empty());
    assert!(s.by_day.is_empty());
    assert!(s.by_tool.is_empty());
}

#[test]
fn case2_full_summary() {
    let dir = TempDir::new().unwrap();
    let db = init_db(dir.path()).unwrap();
    seed(&db);
    let s = usage_summary(&db, 30);
    assert_eq!(s.total_sessions, 2);
    assert_eq!(s.total_messages, 5);
    assert!(s.total_tokens > 0);
    assert_eq!(s.total_duration_ms, 0); // started_at == last_message_at
    assert_eq!(s.by_project.len(), 2);
    // 排序:messages DESC → Alpha(3) 排第一
    assert_eq!(s.by_project[0].project_name, "Alpha");
    assert_eq!(s.by_project[0].messages, 3);
    // tool_use 提 Read
    assert!(s.by_tool.iter().any(|t| t.tool == "Read"), "by_tool: {:?}", s.by_tool);
}

#[test]
fn case3_session_cost_timeline() {
    let dir = TempDir::new().unwrap();
    let db = init_db(dir.path()).unwrap();
    seed(&db);
    let cost = get_session_cost(&db, "s1").unwrap();
    assert_eq!(cost.session_id, "s1");
    assert_eq!(cost.project_name, "Alpha");
    assert_eq!(cost.message_count, 3);
    assert!(cost.tokens > 0);
    // tool list 含 Read
    assert!(cost.tools.iter().any(|t| t.tool == "Read"));

    let timeline = get_session_timeline(&db, "s1").unwrap();
    assert_eq!(timeline.session_id, "s1");
    assert_eq!(timeline.entries.len(), 3);
    assert_eq!(timeline.entries[0].role, "user");
    assert_eq!(timeline.entries[0].content, "hello world");
}

#[test]
fn case4_range_days_filters_by_day() {
    let dir = TempDir::new().unwrap();
    let db = init_db(dir.path()).unwrap();
    seed(&db);
    // rangeDays = 1 → cutoff = now - 1day,种子 day1 / day5 都远早于 now,byDay 应空
    let s1 = usage_summary(&db, 1);
    assert!(s1.by_day.is_empty(), "1 day range should exclude seeded old dates");
    // rangeDays 大(覆盖 1970+)→ byDay 含 day1 + day5
    let s_big = usage_summary(&db, 365 * 60);
    assert_eq!(s_big.by_day.len(), 2);
}

#[test]
fn case5_tool_use_name_extraction() {
    let dir = TempDir::new().unwrap();
    let db = init_db(dir.path()).unwrap();
    seed(&db);
    let s = usage_summary(&db, 30);
    // byTool 含 Read(仅 1 次)
    let read = s.by_tool.iter().find(|t| t.tool == "Read").unwrap();
    assert_eq!(read.count, 1);
}

#[test]
fn case6_get_top_tools_limit() {
    let dir = TempDir::new().unwrap();
    let db = init_db(dir.path()).unwrap();
    seed(&db);
    let top1 = get_top_tools(&db, 1);
    assert_eq!(top1.len(), 1);
    assert_eq!(top1[0].tool, "Read"); // only 1 tool
}

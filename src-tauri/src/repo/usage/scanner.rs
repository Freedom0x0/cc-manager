//! v4.0 Usage scanner — 只读聚合(sessions / messages 表)
//!
//! 平移自 v3.1 electron/repo/usage/scanner.ts(commit b16ad01)。
//! 6 IPC: usage_summary / usage_get_session_cost / usage_get_session_timeline /
//! usage_get_project_breakdown / usage_get_daily_breakdown / usage_get_top_tools。
//!
//! 无 schema、无 state、无 writer;只对 sessions / messages 表做 COUNT /
//! SUM / GROUP BY 查询。Token 估算走 JS 端 length/4(粗估,接受)。

use crate::db::DB;
use crate::repo::usage::types::{SessionCost, SessionTimeline, SessionTimelineEntry, UsageByDayRow, UsageByProjectRow, UsageByToolRow, UsageSummary};
use rusqlite::params;
use std::collections::HashMap;

/// 估算单 message 的 token 数(粗估:字符 / 4)
/// 走 JS 端而非 SQL json_extract,理由:v3.1 接受精度偏差 50-100%,
/// 用量分析用途 = 趋势 / 占比,非精确计费。
pub fn estimate_tokens(content: &str, content_blocks_json: Option<&str>) -> i64 {
    let mut chars = content.len();
    if let Some(json) = content_blocks_json {
        if let Ok(blocks) = serde_json::from_str::<Vec<serde_json::Value>>(json) {
            for b in blocks {
                if let Some(t) = b.get("type").and_then(|v| v.as_str()) {
                    match t {
                        "text" => {
                            if let Some(text) = b.get("text").and_then(|v| v.as_str()) {
                                chars += text.len();
                            }
                        }
                        "thinking" => {
                            if let Some(th) = b.get("thinking").and_then(|v| v.as_str()) {
                                chars += th.len();
                            }
                        }
                        "tool_use" => {
                            if let Some(input) = b.get("input") {
                                chars += input.to_string().len();
                            }
                        }
                        _ => {} // tool_result / unknown 不计
                    }
                }
            }
        }
    }
    (chars / 4) as i64
}

fn token_for_message(conn: &rusqlite::Connection, message_id: i64) -> i64 {
    let mut stmt = match conn.prepare("SELECT content, content_blocks FROM messages WHERE id = ?1") {
        Ok(s) => s,
        Err(_) => return 0,
    };
    let row = stmt.query_row(params![message_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    });
    match row {
        Ok((content, blocks)) => estimate_tokens(&content, blocks.as_deref()),
        Err(_) => 0,
    }
}

fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    // 简化 ISO 字符串(只用日期 + 时分秒 — 真实精度无意义,UI 仅 display)
    // 用 chrono 替代? 暂手写,Day 计算在 byDay 用 date(started_at/1000) SQL 走
    ms.to_string()
}

/// 主聚合:totalSessions + totalMessages + totalTokens + totalDurationMs
/// + byProject + byDay + byTool。1 IPC 调用返 1 个 UsageSummary 对象。
pub fn usage_summary(db: &DB, range_days: i64) -> UsageSummary {
    let conn = &db.0;

    let total_sessions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE is_deleted = 0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let total_messages: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
        .unwrap_or(0);

    let total_duration_ms: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(last_message_at - started_at), 0) FROM sessions WHERE is_deleted = 0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // totalTokens = 对每条 message 走 estimate_tokens 求和
    let mut total_tokens: i64 = 0;
    if let Ok(mut stmt) = conn.prepare("SELECT id FROM messages") {
        if let Ok(mut rows) = stmt.query([]) {
            while let Ok(Some(row)) = rows.next() {
                if let Ok(id) = row.get::<_, i64>(0) {
                    total_tokens += token_for_message(conn, id);
                }
            }
        }
    }

    // byProject
    let mut by_project: Vec<UsageByProjectRow> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT p.id, p.name, COUNT(DISTINCT s.session_id), COUNT(m.id)
         FROM projects p
         LEFT JOIN sessions s ON s.project_id = p.id AND s.is_deleted = 0
         LEFT JOIN messages m ON m.session_id = s.session_id
         WHERE p.is_archived = 0
         GROUP BY p.id
         ORDER BY 4 DESC",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        }) {
            for r in rows.flatten() {
                let (pid, pname, sessions, messages) = r;
                // 算 token:取该 project 下所有 session 的 messages
                let mut tokens: i64 = 0;
                if let Ok(mut mstmt) = conn.prepare(
                    "SELECT m.id FROM messages m JOIN sessions s ON m.session_id = s.session_id WHERE s.project_id = ?1",
                ) {
                    if let Ok(mrows) = mstmt.query_map(params![pid], |row| row.get::<_, i64>(0)) {
                        for mid in mrows.flatten() {
                            tokens += token_for_message(conn, mid);
                        }
                    }
                }
                by_project.push(UsageByProjectRow {
                    project_id: pid,
                    project_name: pname,
                    sessions,
                    messages,
                    tokens,
                });
            }
        }
    }

    // byDay:用 started_at / created_at ms → YYYY-MM-DD
    let cutoff_ms = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0))
        - range_days * 24 * 60 * 60 * 1000;

    let mut day_map: HashMap<String, (i64, i64)> = HashMap::new(); // (messages, tokens)
    if let Ok(mut stmt) = conn.prepare("SELECT id, created_at FROM messages WHERE created_at >= ?1") {
        if let Ok(rows) = stmt.query_map(params![cutoff_ms], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        }) {
            for r in rows.flatten() {
                let (mid, created_at) = r;
                let day = ms_to_iso_date(created_at);
                let entry = day_map.entry(day).or_insert((0, 0));
                entry.0 += 1;
                entry.1 += token_for_message(conn, mid);
            }
        }
    }

    let mut by_day: Vec<UsageByDayRow> = day_map
        .into_iter()
        .map(|(date, (messages, tokens))| UsageByDayRow { date, messages, tokens })
        .collect();
    by_day.sort_by(|a, b| a.date.cmp(&b.date));

    // byTool:从 messages.content_blocks 提 tool_use.name
    let mut by_tool: Vec<UsageByToolRow> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT json_extract(value, '$.name') AS tool, COUNT(*) AS cnt
         FROM messages, json_each(messages.content_blocks)
         WHERE json_extract(value, '$.type') = 'tool_use'
         GROUP BY tool
         ORDER BY cnt DESC",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?))
        }) {
            for r in rows.flatten() {
                if let (Some(tool), count) = r {
                    by_tool.push(UsageByToolRow { tool, count });
                }
            }
        }
    }

    UsageSummary {
        total_sessions,
        total_messages,
        total_tokens,
        total_duration_ms,
        by_project,
        by_day,
        by_tool,
        generated_at: now_iso(),
    }
}

fn ms_to_iso_date(ms: i64) -> String {
    // 简化:返回 ms / 86400000 → "1970-01-01" + N days 形式不实用
    // 用 chrono? 暂写手算,Days since epoch + epoch
    // 1970-01-01 epoch day 0
    let days = ms / 86_400_000;
    // 用 builtin SystemTime 仅够秒精度
    // 直接返回 "1970-01-01" + days 的 ISO date — 用公历计算循环
    // 简化:返 YYYY-MM-DD 形式 via civil_from_days (Howard Hinnant 算法)
    civil_from_days(days)
}

/// Howard Hinnant civil_from_days 算法(简化日期计算,no deps)
fn civil_from_days(days_since_epoch: i64) -> String {
    // 算法参考:http://howardhinnant.github.io/date_algorithms.html
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// 单 session 详情
pub fn get_session_cost(db: &DB, session_id: &str) -> Option<SessionCost> {
    let conn = &db.0;
    let session: Option<(i64, i64, i64, Option<String>)> = conn
        .query_row(
            "SELECT project_id, started_at, last_message_at, title
             FROM sessions WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                ))
            },
        )
        .ok();
    let (project_id, started_at, last_message_at, title) = session?;

    let project_name: String = conn
        .query_row(
            "SELECT name FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .unwrap_or_default();

    let message_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // 计算 tokens + 工具
    let mut tokens: i64 = 0;
    let mut tool_map: HashMap<String, i64> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, content, content_blocks FROM messages WHERE session_id = ?1",
    ) {
        if let Ok(rows) = stmt.query_map(params![session_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        }) {
            for r in rows.flatten() {
                let (mid, content, blocks) = r;
                tokens += estimate_tokens(&content, blocks.as_deref());
                if let Some(json) = &blocks {
                    if let Ok(parsed) = serde_json::from_str::<Vec<serde_json::Value>>(json) {
                        for b in parsed {
                            if b.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                                if let Some(name) = b.get("name").and_then(|v| v.as_str()) {
                                    *tool_map.entry(name.to_string()).or_insert(0) += 1;
                                }
                            }
                        }
                    }
                }
                let _ = mid;
            }
        }
    }

    let mut tools: Vec<UsageByToolRow> = tool_map
        .into_iter()
        .map(|(tool, count)| UsageByToolRow { tool, count })
        .collect();
    tools.sort_by(|a, b| b.count.cmp(&a.count));

    Some(SessionCost {
        session_id: session_id.to_string(),
        project_id,
        project_name,
        started_at,
        last_message_at,
        duration_ms: last_message_at - started_at,
        message_count,
        tokens,
        tools,
    })
    .and_then(|sc| {
        // title 仅做日志用,主表类型不含
        let _ = title;
        Some(sc)
    })
}

/// 单 session 时间线
pub fn get_session_timeline(db: &DB, session_id: &str) -> Option<SessionTimeline> {
    let conn = &db.0;
    let meta: Option<(i64, Option<String>)> = conn
        .query_row(
            "SELECT project_id, title FROM sessions WHERE session_id = ?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let (project_id, title) = meta?;

    let project_name: String = conn
        .query_row(
            "SELECT name FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .unwrap_or_default();

    let mut entries: Vec<SessionTimelineEntry> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT uuid, role, content, created_at FROM messages WHERE session_id = ?1 ORDER BY created_at ASC",
    ) {
        if let Ok(rows) = stmt.query_map(params![session_id], |row| {
            Ok(SessionTimelineEntry {
                uuid: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
            })
        }) {
            for e in rows.flatten() {
                entries.push(e);
            }
        }
    }

    Some(SessionTimeline {
        session_id: session_id.to_string(),
        project_name,
        title,
        entries,
    })
}

/// 单项目聚合
pub fn get_project_breakdown(db: &DB, project_id: i64) -> Option<UsageByProjectRow> {
    let summary = usage_summary(db, 30);
    summary.by_project.into_iter().find(|p| p.project_id == project_id)
}

/// 按日聚合
pub fn get_daily_breakdown(db: &DB, range_days: i64) -> Vec<UsageByDayRow> {
    usage_summary(db, range_days).by_day
}

/// 工具频次 Top N
pub fn get_top_tools(db: &DB, limit: i64) -> Vec<UsageByToolRow> {
    let summary = usage_summary(db, 30);
    summary.by_tool.into_iter().take(limit as usize).collect()
}

//! v4.0 importer (commit 18 修复 commit 4 漏)
//!
//! 平移 v3.1 electron/importer/{scanner,parser,index}.ts 的核心 3 函数:
//! - scan_project_folders: 扫 ~/.claude/projects/ 一级子目录
//! - parse_line: 单 jsonl 行解析 → RawMessage (uuid/sessionId/role/content/blocks/createdAtMs/projectPath)
//! - import_project_folder: 把 folder 下 jsonl 入 projects + sessions + messages 表
//!
//! v4 改动 (vs v3.1):
//! - DB 用 rusqlite 同步 API (vs better-sqlite3), connection 走 &DB.lock().unwrap()
//! - 单一文件 (vs v3.1 split 4 文件); importProjectFolder 内联 ensureProject
//! - blocks JSON 用 serde_json::to_string

use crate::db::DB;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        content: serde_json::Value,
        #[serde(rename = "isError", default)]
        is_error: bool,
    },
    #[serde(rename = "thinking")]
    Thinking { thinking: String },
    #[serde(rename = "unknown")]
    Unknown { raw: serde_json::Value },
}

#[derive(Debug)]
pub struct RawMessage {
    pub uuid: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub blocks: Vec<Value>, // serde_json::Value for DB serialization
    pub created_at_ms: i64,
    pub project_path: String,
}

#[derive(Debug, Default)]
pub struct ProjectFolder {
    pub folder_path: String,
    pub jsonl_files: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ImportStats {
    #[serde(rename = "sessionsAdded")]
    pub sessions_added: i64,
    #[serde(rename = "messagesAdded")]
    pub messages_added: i64,
}

// ============================================================
// scan_project_folders
// ============================================================
pub fn scan_project_folders(source_dir: &Path) -> Vec<ProjectFolder> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(source_dir) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let files: Vec<String> = match std::fs::read_dir(&path) {
            Ok(inner) => inner
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.file_type().map(|t| t.is_file()).unwrap_or(false)
                        && e.file_name().to_string_lossy().ends_with(".jsonl")
                })
                .map(|e| e.path().to_string_lossy().to_string())
                .collect(),
            Err(_) => Vec::new(),
        };
        if !files.is_empty() {
            out.push(ProjectFolder {
                folder_path: path.to_string_lossy().to_string(),
                jsonl_files: files,
            });
        }
    }
    out
}

// ============================================================
// parse_line
// ============================================================
pub fn parse_line(line: &str) -> Option<RawMessage> {
    let raw: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return None,
    };
    let r#type = raw.get("type").and_then(|v| v.as_str())?;
    if r#type != "user" && r#type != "assistant" {
        return None;
    }
    let uuid = raw.get("uuid").and_then(|v| v.as_str())?.to_string();
    let session_id = raw.get("sessionId").and_then(|v| v.as_str())?.to_string();
    let timestamp = raw.get("timestamp").and_then(|v| v.as_str())?;
    let cwd = raw.get("cwd").and_then(|v| v.as_str())?.to_string();
    let message = raw.get("message")?;
    let role = message.get("role").and_then(|v| v.as_str())?;
    if role != "user" && role != "assistant" {
        return None;
    }
    let content_value = message.get("content")?;
    let (text, blocks) = extract_content(content_value);
    let created_at_ms = match chrono_like_parse(timestamp) {
        Some(ms) => ms,
        None => return None,
    };
    Some(RawMessage {
        uuid,
        session_id,
        role: role.to_string(),
        content: text,
        blocks,
        created_at_ms,
        project_path: cwd,
    })
}

/// 简化 ISO 8601 / RFC3339 → ms(支持 "2026-07-30T06:44:07.884Z" 等)
/// 手算避免拉 chrono 依赖(chrono = +200KB 二进制)。
/// 接受 "YYYY-MM-DDTHH:MM:SS[.fff][Z|+HH:MM]" 形式,其他返 None。
fn chrono_like_parse(ts: &str) -> Option<i64> {
    // 期望长度 ≥ 19 (YYYY-MM-DDTHH:MM:SS)
    if ts.len() < 19 {
        return None;
    }
    let bytes = ts.as_bytes();
    // 位置: 4 Y, 5 -, 6-7 M, 8 -, 9-10 D, 11 T, 12-13 H, 14 :, 15-16 M, 17 :, 18-19 S
    let y: i64 = std::str::from_utf8(&bytes[0..4]).ok()?.parse().ok()?;
    let mo: i64 = std::str::from_utf8(&bytes[5..7]).ok()?.parse().ok()?;
    let d: i64 = std::str::from_utf8(&bytes[8..10]).ok()?.parse().ok()?;
    let h: i64 = std::str::from_utf8(&bytes[11..13]).ok()?.parse().ok()?;
    let mi: i64 = std::str::from_utf8(&bytes[14..16]).ok()?.parse().ok()?;
    let s: i64 = std::str::from_utf8(&bytes[17..19]).ok()?.parse().ok()?;
    let mut ms: i64 = 0;
    // optional .fff
    if bytes.get(19) == Some(&b'.') {
        let mut frac = String::new();
        for &b in &bytes[20..] {
            if b.is_ascii_digit() {
                frac.push(b as char);
            } else {
                break;
            }
        }
        if !frac.is_empty() {
            // 取前 3 位做 ms,后位四舍五入(简化:截断)
            let frac_padded = format!("{:0<3}", frac);
            let ms_part: i64 = frac_padded[..3].parse().unwrap_or(0);
            ms = ms_part;
        }
    }
    // 计算 UTC ms since epoch (公历算法, Howard Hinnant 同 §12)
    let days = days_from_civil(y, mo as u32, d as u32);
    let secs = days as i64 * 86_400 + h * 3600 + mi * 60 + s;
    Some(secs * 1000 + ms)
}

/// Howard Hinnant civil_from_days 反向(Y/M/D → days since 1970-01-01)
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as i64; // [0, 399]
    let m = m as i64;
    let d = d as i64;
    let mp = if m > 2 { m - 3 } else { m + 9 }; // [0, 11]
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

fn extract_content(v: &Value) -> (String, Vec<Value>) {
    if let Some(s) = v.as_str() {
        let block = json!({"type": "text", "text": s});
        return (s.to_string(), vec![block]);
    }
    if let Some(arr) = v.as_array() {
        let mut text_parts = Vec::new();
        let mut blocks = Vec::new();
        for item in arr {
            if !item.is_object() {
                blocks.push(json!({"type": "unknown", "raw": item}));
                continue;
            }
            let t = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
            match t {
                "text" => {
                    if let Some(s) = item.get("text").and_then(|v| v.as_str()) {
                        text_parts.push(s.to_string());
                        blocks.push(json!({"type": "text", "text": s}));
                    }
                }
                "tool_use" => {
                    let name = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let input = item.get("input").cloned().unwrap_or(Value::Null);
                    blocks.push(json!({"type": "tool_use", "name": name, "input": input}));
                }
                "tool_result" => {
                    let content = item.get("content").cloned().unwrap_or(Value::Null);
                    let is_error = item
                        .get("is_error")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    blocks.push(json!({"type": "tool_result", "content": content, "isError": is_error}));
                }
                "thinking" => {
                    if let Some(s) = item.get("thinking").and_then(|v| v.as_str()) {
                        blocks.push(json!({"type": "thinking", "thinking": s}));
                    }
                }
                _ => {
                    blocks.push(json!({"type": "unknown", "raw": item}));
                }
            }
        }
        (text_parts.join("\n"), blocks)
    } else {
        (String::new(), vec![json!({"type": "unknown", "raw": v})])
    }
}

// ============================================================
// import_project_folder
// ============================================================
pub fn import_project_folder(db: &DB, folder: &ProjectFolder) -> rusqlite::Result<ImportStats> {
    let mut sessions_added = 0i64;
    let mut messages_added = 0i64;
    let mut first_cwd: Option<String> = None;
    let conn = &db.0;

    let mut find_session = conn.prepare(
        "SELECT id, cwd, source_file, project_id FROM sessions WHERE session_id = ?1",
    )?;
    let mut insert_session = conn.prepare(
        "INSERT INTO sessions (session_id, project_id, title, cwd, started_at, last_message_at, message_count, source_file) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
    )?;
    let mut update_session_cwd = conn.prepare(
        "UPDATE sessions SET cwd = COALESCE(cwd, ?1) WHERE session_id = ?2",
    )?;
    let mut update_session_source = conn.prepare(
        "UPDATE sessions SET source_file = ?1 WHERE session_id = ?2 AND (source_file IS NULL OR source_file = '')",
    )?;
    let mut update_session_reassign = conn.prepare(
        "UPDATE sessions SET project_id = ?1 WHERE session_id = ?2 AND project_id != ?1",
    )?;
    let mut insert_message = conn.prepare(
        "INSERT OR IGNORE INTO messages (uuid, session_id, role, content, content_blocks, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    let mut update_session_meta = conn.prepare(
        "UPDATE sessions SET last_message_at = MAX(last_message_at, ?1), message_count = message_count + 1 WHERE session_id = ?2",
    )?;

    let mut project_id: Option<i64> = None;

    for file in &folder.jsonl_files {
        let content = match std::fs::read_to_string(file) {
            Ok(s) => s,
            Err(_) => continue,
        };
        for line in content.split('\n') {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let msg = match parse_line(line) {
                Some(m) => m,
                None => continue,
            };

            if first_cwd.is_none() {
                first_cwd = Some(msg.project_path.clone());
            }

            if project_id.is_none() {
                let folder_basename = Path::new(&folder.folder_path)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let sub_name = Path::new(&msg.project_path)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&folder_basename)
                    .to_string();
                project_id = Some(ensure_project(
                    conn,
                    &folder.folder_path,
                    &sub_name,
                    &msg.project_path,
                )?);
            }
            let pid = project_id.unwrap();

            // session check + maybe create
            let existing: Option<(i64, Option<String>, Option<String>, i64)> = find_session
                .query_row(params![msg.session_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .ok();

            if existing.is_none() {
                let title = if msg.role == "user" {
                    Some(msg.content.chars().take(50).collect::<String>())
                } else {
                    None
                };
                insert_session.execute(params![
                    msg.session_id,
                    pid,
                    title,
                    msg.project_path,
                    msg.created_at_ms,
                    msg.created_at_ms,
                    file
                ])?;
                sessions_added += 1;
            } else {
                let (_id, _cwd, _source_file, old_pid) = existing.unwrap();
                if old_pid != pid {
                    update_session_reassign.execute(params![pid, msg.session_id])?;
                }
                update_session_cwd.execute(params![msg.project_path, msg.session_id])?;
                update_session_source.execute(params![file, msg.session_id])?;
            }

            let blocks_json = if !msg.blocks.is_empty() {
                Some(serde_json::to_string(&msg.blocks).unwrap_or_else(|_| "[]".to_string()))
            } else {
                None
            };

            let changes = insert_message.execute(params![
                msg.uuid,
                msg.session_id,
                msg.role,
                msg.content,
                blocks_json,
                msg.created_at_ms
            ])?;
            if changes > 0 {
                update_session_meta.execute(params![msg.created_at_ms, msg.session_id])?;
                messages_added += 1;
            }
        }
    }

    Ok(ImportStats {
        sessions_added,
        messages_added,
    })
}

fn ensure_project(
    conn: &rusqlite::Connection,
    folder_path: &str,
    name: &str,
    cwd: &str,
) -> rusqlite::Result<i64> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    // INSERT OR IGNORE 走 UNIQUE(project_path) 约束
    conn.execute(
        "INSERT OR IGNORE INTO projects (project_path, name, cwd, imported_at, is_archived) VALUES (?1, ?2, ?3, ?4, 0)",
        params![folder_path, name, cwd, now],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM projects WHERE project_path = ?1",
        params![folder_path],
        |row| row.get(0),
    )?;
    // 补 cwd / name(若已存在但空)
    let mut stmt = conn.prepare(
        "UPDATE projects SET cwd = COALESCE(cwd, ?1), name = COALESCE(NULLIF(name, ''), ?2) WHERE id = ?3",
    )?;
    stmt.execute(params![cwd, name, id])?;
    Ok(id)
}

/// 默认 source_dir = ~/.claude/projects
pub fn default_source_dir() -> std::path::PathBuf {
    home::home_dir()
        .map(|h| h.join(".claude").join("projects"))
        .unwrap_or_else(|| std::path::PathBuf::from("projects"))
}

/// 全量扫所有 project folder + 入库(单文件版本,cmd_watcher_rescan_all 调用)
pub fn rescan_all(db: &DB) -> rusqlite::Result<ImportStats> {
    rescan_source_dir(db, &default_source_dir())
}

/// 扫描指定 Claude projects 目录。watcher 使用该入口，测试和非默认目录不会
/// 意外回退到当前用户的 ~/.claude/projects。
pub fn rescan_source_dir(db: &DB, source_dir: &Path) -> rusqlite::Result<ImportStats> {
    let folders = scan_project_folders(source_dir);
    let mut total = ImportStats::default();
    for folder in &folders {
        let stats = import_project_folder(db, folder)?;
        total.sessions_added += stats.sessions_added;
        total.messages_added += stats.messages_added;
    }
    Ok(total)
}

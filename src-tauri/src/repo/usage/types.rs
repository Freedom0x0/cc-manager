//! v4.0 Usage 模块共享类型
//!
//! 平移自 v3.1 electron/repo/usage/types.ts。
//! 只读聚合模块 — 无 schema,无 state,无 writer,6 个 IPC channel 全是聚合查询。
//!
//! 数据源约定:
//! - sessions:totalSessions / totalDurationMs / byProject.sessions / byDay
//! - messages:totalMessages / byProject.messages / byDay.messages
//! - messages.content_blocks (JSON 数组):totalTokens / byTool
//!
//! SQL 走 JSON1 扩展(serde_json::Value 解析 content_blocks 提 $.name / $.type)。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByProjectRow {
    #[serde(rename = "projectId")]
    pub project_id: i64,
    #[serde(rename = "projectName")]
    pub project_name: String,
    pub sessions: i64,
    pub messages: i64,
    pub tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByDayRow {
    pub date: String, // YYYY-MM-DD
    pub messages: i64,
    pub tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByToolRow {
    pub tool: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSummary {
    #[serde(rename = "totalSessions")]
    pub total_sessions: i64,
    #[serde(rename = "totalMessages")]
    pub total_messages: i64,
    #[serde(rename = "totalTokens")]
    pub total_tokens: i64,
    #[serde(rename = "totalDurationMs")]
    pub total_duration_ms: i64,
    #[serde(rename = "byProject")]
    pub by_project: Vec<UsageByProjectRow>,
    #[serde(rename = "byDay")]
    pub by_day: Vec<UsageByDayRow>,
    #[serde(rename = "byTool")]
    pub by_tool: Vec<UsageByToolRow>,
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionCost {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "projectId")]
    pub project_id: i64,
    #[serde(rename = "projectName")]
    pub project_name: String,
    #[serde(rename = "startedAt")]
    pub started_at: i64,
    #[serde(rename = "lastMessageAt")]
    pub last_message_at: i64,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    #[serde(rename = "messageCount")]
    pub message_count: i64,
    pub tokens: i64,
    pub tools: Vec<UsageByToolRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTimelineEntry {
    pub uuid: String,
    pub role: String, // 'user' | 'assistant'
    pub content: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTimeline {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "projectName")]
    pub project_name: String,
    pub title: Option<String>,
    pub entries: Vec<SessionTimelineEntry>,
}

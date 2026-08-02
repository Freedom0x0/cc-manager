//! v4.0 跨层共享类型
//!
//! 对应 v3.1 src/types.ts + electron/repo/types.ts(双修,v3.1 时是两边各定义)。
//! v4.0 简化:Rust 这边定义一次,serde rename 转 camelCase 喂前端。
//! 前端 src/types.ts 是从 Rust 生成?还是手写?Spec §4.2 钉死"手写 TS 类型即可,60 channel 体量可控"。
//!
//! commit 2 范围:5 个读 IPC 类型(ProjectRow, ProjectTreeNode, SessionRow, MessageRow, SearchHit)。
//! 其余类型按 rid-3/rid-4 commit 逐步添加。

use serde::{Deserialize, Serialize};

// ============================================================
// rid-2 / commit 2: 5 个读 IPC 类型
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRow {
    pub id: i64,
    pub path: String,
    pub name: String,
    #[serde(rename = "sessionCount")]
    pub session_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTreeNode {
    pub id: i64,
    pub path: String,
    pub name: String,
    #[serde(rename = "sessionCount")]
    pub session_count: i64,
    pub children: Vec<ProjectTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRow {
    pub id: i64,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "projectId")]
    pub project_id: i64,
    pub title: Option<String>,
    pub cwd: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at: i64,
    #[serde(rename = "lastMessageAt")]
    pub last_message_at: i64,
    #[serde(rename = "messageCount")]
    pub message_count: i64,
    #[serde(rename = "sourceFile")]
    pub source_file: String,
    #[serde(rename = "isDeleted")]
    pub is_deleted: i64,
    #[serde(rename = "deletedAt")]
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageRow {
    pub id: i64,
    pub uuid: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[serde(rename = "contentBlocks")]
    pub content_blocks: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    #[serde(rename = "messageId")]
    pub message_id: i64,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "projectId")]
    pub project_id: i64,
    pub role: String,
    pub content: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

// ============================================================
// rid-2 / commit 3: 5 写 IPC 类型
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeCommand {
    pub command: String,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherStatus {
    pub state: String, // "starting" | "idle" | "error" | "scanning"
    #[serde(rename = "lastEventAt", skip_serializing_if = "Option::is_none")]
    pub last_event_at: Option<i64>,
    #[serde(rename = "lastEventPath", skip_serializing_if = "Option::is_none")]
    pub last_event_path: Option<String>,
    #[serde(rename = "lastError", skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

// ============================================================
// rid-3 / commit 5-10: 6 模块类型(占位, 后续 commit 补)
// ============================================================

// MCP
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub name: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub server_type: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub url: Option<String>,
    pub enabled: bool,
    #[serde(rename = "lastModified")]
    pub last_modified: Option<String>,
    /// commit 26 增: MCP server 描述 (来自 mcp.description 或 .mcp.json 顶层)
    #[serde(rename = "description", skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCreateInput {
    pub name: String,
    #[serde(rename = "type")]
    pub server_type: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpUpdatePatch {
    #[serde(rename = "type")]
    pub server_type: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub url: Option<String>,
}

// Skills
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub content: String,
    pub path: String,
    pub enabled: bool,
    /// commit 26 增: SKILL.md frontmatter description, 列表显示用
    #[serde(rename = "description", skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillCreateInput {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillUpdatePatch {
    pub content: Option<String>,
}

// Commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Command {
    pub name: String,
    pub content: String,
    pub path: String,
    pub enabled: bool,
    /// commit 26 增: frontmatter description
    #[serde(rename = "description", skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCreateInput {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommandUpdatePatch {
    pub content: Option<String>,
}

// Sub-Agents
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubAgent {
    pub name: String,
    pub content: String,
    pub path: String,
    pub enabled: bool,
    /// commit 26 增: frontmatter description
    #[serde(rename = "description", skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubAgentCreateInput {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SubAgentUpdatePatch {
    pub content: Option<String>,
}

// Hooks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hook {
    pub id: String,
    pub event: String,
    pub matcher: Option<String>,
    #[serde(rename = "type")]
    pub hook_type: String,
    pub command: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookCreateInput {
    pub event: String,
    pub matcher: Option<String>,
    #[serde(rename = "type")]
    pub hook_type: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HookUpdatePatch {
    pub matcher: Option<String>,
    #[serde(rename = "type")]
    pub hook_type: Option<String>,
    pub command: Option<String>,
}

// Plugins
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plugin {
    #[serde(rename = "fullName")]
    pub full_name: String,
    pub name: String,
    #[serde(rename = "marketplace")]
    pub marketplace: String,
    pub version: String,
    pub description: Option<String>,
    pub scope: String,
    #[serde(rename = "installPath")]
    pub install_path: String,
    #[serde(rename = "installedAt")]
    pub installed_at: String,
    #[serde(rename = "lastUpdated")]
    pub last_updated: String,
    #[serde(rename = "gitCommitSha")]
    pub git_commit_sha: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCreateInput {
    pub name: String,
    pub marketplace: String,
    pub version: String,
    pub description: Option<String>,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginUpdatePatch {
    pub version: Option<String>,
    pub description: Option<String>,
}

// ============================================================
// rid-4 / commit 11-12: Profiles + Usage
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub description: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    pub config: ProfileConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileConfig {
    #[serde(rename = "enabledMcps", default)]
    pub enabled_mcps: Vec<String>,
    #[serde(rename = "disabledMcps", default)]
    pub disabled_mcps: Vec<String>,
    #[serde(rename = "enabledSkills", default)]
    pub enabled_skills: Vec<String>,
    #[serde(rename = "disabledSkills", default)]
    pub disabled_skills: Vec<String>,
    #[serde(rename = "enabledCommands", default)]
    pub enabled_commands: Vec<String>,
    #[serde(rename = "disabledCommands", default)]
    pub disabled_commands: Vec<String>,
    #[serde(rename = "enabledAgents", default)]
    pub enabled_agents: Vec<String>,
    #[serde(rename = "disabledAgents", default)]
    pub disabled_agents: Vec<String>,
    #[serde(rename = "enabledPlugins", default)]
    pub enabled_plugins: Vec<String>,
    #[serde(rename = "disabledPlugins", default)]
    pub disabled_plugins: Vec<String>,
    #[serde(rename = "enabledHooks", default)]
    pub enabled_hooks: Vec<String>,
    #[serde(rename = "disabledHooks", default)]
    pub disabled_hooks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileCreateInput {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProfileUpdatePatch {
    pub description: Option<String>,
    pub config: Option<ProfileConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileApplyResult {
    pub ok: bool,
    #[serde(rename = "appliedAt")]
    pub applied_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSummary {
    #[serde(rename = "totalSessions")]
    pub total_sessions: i64,
    #[serde(rename = "totalMessages")]
    pub total_messages: i64,
    #[serde(rename = "totalTokens")]
    pub total_tokens: i64,
    #[serde(rename = "totalCostUsd")]
    pub total_cost_usd: f64,
    #[serde(rename = "topTools")]
    pub top_tools: Vec<UsageByToolRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionCost {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "messageCount")]
    pub message_count: i64,
    #[serde(rename = "inputTokens")]
    pub input_tokens: i64,
    #[serde(rename = "outputTokens")]
    pub output_tokens: i64,
    #[serde(rename = "estimatedCostUsd")]
    pub estimated_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTimeline {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub points: Vec<TimelinePoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelinePoint {
    pub ts: i64,
    #[serde(rename = "messageCount")]
    pub message_count: i64,
    #[serde(rename = "tokensEstimate")]
    pub tokens_estimate: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByProjectRow {
    #[serde(rename = "projectId")]
    pub project_id: i64,
    #[serde(rename = "projectName")]
    pub project_name: String,
    #[serde(rename = "sessionCount")]
    pub session_count: i64,
    #[serde(rename = "messageCount")]
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByDayRow {
    pub day: String,
    #[serde(rename = "sessionCount")]
    pub session_count: i64,
    #[serde(rename = "messageCount")]
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByToolRow {
    #[serde(rename = "toolName")]
    pub tool_name: String,
    pub count: i64,
}
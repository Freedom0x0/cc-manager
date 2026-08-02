//! v4.0 Profiles 模块共享类型
//!
//! 平移自 v3.1 electron/repo/profiles/types.ts。
//! 单一来源:前端从 Rust 类型镜像生成 camelCase。
//!
//! Spec §5.6 + §7.1 钉死 profile_snapshot.snapshot_json 形状。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// profile_snapshot 表的 list 视图(id + name + 时戳 + 模块总数)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileSummary {
    pub id: i64,
    pub name: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(rename = "itemCount")]
    pub item_count: usize,
}

/// 单模块的单个 item(MCP server / Skill / Command / ...)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProfileModuleItem {
    pub name: String,
    pub scope: String,
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    pub enabled: bool,
}

/// ProfileSnapshot = profile_snapshot 表的完整快照
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProfileSnapshot {
    pub id: i64,
    pub name: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    pub modules: HashMap<String, Vec<ProfileModuleItem>>,
}

/// ProfileNew = profile_create 的输入(name + optional description)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileNew {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// 创建返回的 ProfileSnapshot
pub type ProfileSnapshotResult = ProfileSnapshot;

/// profile_apply 的可选控制(spec §7.2 降级)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RestoreOptions {
    /// hash 不匹配时跳过该模块(true)还是 throw(false)。默认 true。
    #[serde(rename = "skipOnHashMismatch", default)]
    pub skip_on_hash_mismatch: bool,
}

/// applyProfile 返的应用结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyResult {
    pub ok: bool,
    #[serde(rename = "restoredCount")]
    pub restored_count: usize,
    #[serde(rename = "realFileErrors")]
    pub real_file_errors: Vec<String>,
}

/// profile_diff 返的差异
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileDiff {
    pub id: i64,
    pub name: String,
    pub added: Vec<ProfileModuleItem>,
    pub removed: Vec<ProfileModuleItem>,
    pub modified: Vec<ProfileModuleItem>,
}

/// 6 模块常量 — capture / apply 都需要
pub const PROFILE_MODULES: &[&str] = &[
    "mcp",
    "skills",
    "commands",
    "sub_agents",
    "hooks",
    "plugins",
];

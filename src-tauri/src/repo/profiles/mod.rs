//! v4.0 Profiles 模块入口
//!
//! 平移自 v3.1 electron/repo/profiles/{scanner,writer,state,index}.ts +
//! spect §5.6 + §7 设计。
//!
//! 6 IPC:
//! - profile_list(profile_snapshot 表 SELECT id + name + 时戳 + itemCount)
//! - profile_get(id)    → Option<ProfileSnapshot> (snapshot_json 反序列化)
//! - profile_create(name) → ProfileSnapshot (capture 6 scanner + INSERT row)
//! - profile_apply(id, options?) → ApplyResult (走完整替代语义 D13, 写真实文件)
//! - profile_delete(id)   → ()
//! - profile_diff(id)     → ProfileDiff (current vs snapshot 比对)

pub mod types;
pub mod capture;
pub mod apply;
pub mod diff;

#[cfg(test)]
mod tests;

use crate::db::DB;
use crate::repo::profiles::apply::{apply_profile, ApplyOptions};
use crate::repo::profiles::capture::{capture_profile_from_state, CaptureOptions};
use crate::repo::profiles::diff::{diff_profile, DiffOptions};
use crate::repo::profiles::types::{ApplyResult, ProfileDiff, ProfileModuleItem, ProfileSnapshot, ProfileSummary};
use rusqlite::params;
use serde_json;
use std::path::PathBuf;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// profile_list: SELECT id, name, created_at, updated_at, itemCount
pub fn list(db: &DB) -> rusqlite::Result<Vec<ProfileSummary>> {
    let conn = &db.0;
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, updated_at, snapshot_json FROM profile_snapshot ORDER BY created_at DESC"
    )?;
    let rows = stmt.query_map([], |row| {
        let json_str: String = row.get(4)?;
        let modules: std::collections::HashMap<String, Vec<ProfileModuleItem>> =
            serde_json::from_str(&json_str).unwrap_or_default();
        let item_count: usize = modules.values().map(|v| v.len()).sum();
        Ok(ProfileSummary {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            item_count,
        })
    })?;
    rows.collect()
}

/// profile_get: SELECT 一行 + snapshot_json 反序列化
pub fn get(db: &DB, id: i64) -> rusqlite::Result<Option<ProfileSnapshot>> {
    let conn = &db.0;
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, updated_at, snapshot_json FROM profile_snapshot WHERE id = ?1"
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        let json_str: String = row.get(4)?;
        let modules: std::collections::HashMap<String, Vec<ProfileModuleItem>> =
            serde_json::from_str(&json_str).unwrap_or_default();
        Ok(Some(ProfileSnapshot {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            modules,
        }))
    } else {
        Ok(None)
    }
}

/// profile_create: capture current + INSERT profile_snapshot row
pub fn create(db: &DB, name: &str, opts: &CaptureOptions) -> rusqlite::Result<ProfileSnapshot> {
    let mut snap = capture_profile_from_state(opts);
    let now = now_ms();
    snap.id = 0;
    snap.name = name.to_string();
    snap.created_at = now;
    snap.updated_at = now;

    let json_str = serde_json::to_string(&snap.modules).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("serialize: {}", e),
        )))
    })?;

    let conn = &db.0;
    conn.execute(
        "INSERT INTO profile_snapshot (name, created_at, updated_at, snapshot_json) VALUES (?1, ?2, ?3, ?4)",
        params![name, now, now, json_str],
    )?;
    let id = conn.last_insert_rowid();

    let mut inserted = snap.clone();
    inserted.id = id;

    Ok(inserted)
}

/// profile_apply: 读 snapshot + apply 完整替代语义(写真实文件)
pub fn apply(
    db: &DB,
    id: i64,
    opts: &ApplyOptions,
) -> anyhow::Result<ApplyResult> {
    let snap = get(db, id)?
        .ok_or_else(|| anyhow::anyhow!("profile {} not found", id))?;
    Ok(apply_profile(&snap, opts))
}

/// profile_delete: DELETE row
pub fn delete(db: &DB, id: i64) -> rusqlite::Result<()> {
    let conn = &db.0;
    conn.execute("DELETE FROM profile_snapshot WHERE id = ?1", params![id])?;
    Ok(())
}

/// profile_diff: 读 snapshot + 当前 6 scanner 比对
pub fn diff(db: &DB, id: i64, opts: &DiffOptions) -> anyhow::Result<ProfileDiff> {
    let snap = get(db, id)?
        .ok_or_else(|| anyhow::anyhow!("profile {} not found", id))?;
    Ok(diff_profile(&snap, opts))
}

/// ApplyOptions / CaptureOptions / DiffOptions 工厂(测试 fixture 用)
impl ApplyOptions {
    pub fn from_base_dir(base: &std::path::Path) -> Self {
        ApplyOptions {
            settings_path: Some(base.join("settings.json")),
            skills_dir: Some(base.join("skills")),
            disabled_skills_dir: Some(base.join("disabled_skills")),
            commands_dir: Some(base.join("commands")),
            agents_dir: Some(base.join("agents")),
            mcp_config_path: Some(base.join("mcp.json")),
            installed_plugins_path: Some(base.join("installed_plugins.json")),
        }
    }
}

impl CaptureOptions {
    pub fn from_base_dir(base: &std::path::Path) -> Self {
        CaptureOptions {
            mcp_config_path: Some(base.join("mcp.json")),
            settings_path: Some(base.join("settings.json")),
            installed_plugins_path: Some(base.join("installed_plugins.json")),
            skills_dir: Some(base.join("skills")),
            disabled_skills_dir: Some(base.join("disabled_skills")),
            commands_dir: Some(base.join("commands")),
            agents_dir: Some(base.join("agents")),
            plugins_root: Some(base.join("plugins")),
        }
    }
}

impl DiffOptions {
    pub fn from_base_dir(base: &std::path::Path) -> Self {
        DiffOptions {
            mcp_config_path: Some(base.join("mcp.json")),
            settings_path: Some(base.join("settings.json")),
            installed_plugins_path: Some(base.join("installed_plugins.json")),
            skills_dir: Some(base.join("skills")),
            disabled_skills_dir: Some(base.join("disabled_skills")),
            commands_dir: Some(base.join("commands")),
            agents_dir: Some(base.join("agents")),
            plugins_root: Some(base.join("plugins")),
        }
    }
}

/// 兼容旧 facade(SettingsPath 测试 helper)
#[allow(dead_code)]
pub fn placeholder_for_path(base: PathBuf) -> PathBuf {
    base
}

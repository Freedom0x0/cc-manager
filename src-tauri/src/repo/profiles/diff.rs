//! v4.0 Profiles diff — 当前 vs 快照差异
//!
//! spec §7.3 钉死 profile_diff 返回:
//! - added: 在当前不在快照
//! - removed: 在快照不在当前
//! - modified: 同 name 但 hash / enabled / scope 不同
//!
//! v4.0 commit 11 简化: scalar 比较 (name + enabled + scope)。hash 字段
//! 首版不上(SHA-256 hash 模块预留 type 字段,interface 不变,v4.1 接)。

use crate::repo::profiles::capture::{capture_profile_from_state, CaptureOptions};
use crate::repo::profiles::types::{ProfileDiff, ProfileModuleItem, ProfileSnapshot};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Default)]
pub struct DiffOptions {
    pub mcp_config_path: Option<PathBuf>,
    pub settings_path: Option<PathBuf>,
    pub installed_plugins_path: Option<PathBuf>,
    pub skills_dir: Option<PathBuf>,
    pub disabled_skills_dir: Option<PathBuf>,
    pub commands_dir: Option<PathBuf>,
    pub agents_dir: Option<PathBuf>,
    pub plugins_root: Option<PathBuf>,
}

/// 给定 profile,捕获当前,按 name + module + scope/enabled 对比。
/// 6 模块合并 added/removed/modified,UI 按全部项数显示。
pub fn diff_profile(snapshot: &ProfileSnapshot, opts: &DiffOptions) -> ProfileDiff {
    let current = capture_profile_from_state(&CaptureOptions {
        mcp_config_path: opts.mcp_config_path.clone(),
        settings_path: opts.settings_path.clone(),
        installed_plugins_path: opts.installed_plugins_path.clone(),
        skills_dir: opts.skills_dir.clone(),
        disabled_skills_dir: opts.disabled_skills_dir.clone(),
        commands_dir: opts.commands_dir.clone(),
        agents_dir: opts.agents_dir.clone(),
        plugins_root: opts.plugins_root.clone(),
    });

    let cur_map = flatten(&current);
    let snap_map = flatten(snapshot);

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();

    // 1) added: 当前有,快照没有
    for (k, v) in &cur_map {
        if !snap_map.contains_key(k) {
            added.push(v.clone());
        }
    }
    // 2) removed: 快照有,当前没有
    for (k, v) in &snap_map {
        if !cur_map.contains_key(k) {
            removed.push(v.clone());
        }
    }
    // 3) modified: 都有但 enabled / scope / source_path 不同
    for (k, snap) in &snap_map {
        if let Some(cur) = cur_map.get(k) {
            if cur.enabled != snap.enabled
                || cur.scope != snap.scope
                || cur.source_path != snap.source_path
            {
                modified.push(ProfileModuleItem {
                    name: k.1.clone(),
                    scope: cur.scope.clone(),
                    source_path: cur.source_path.clone(),
                    enabled: cur.enabled,
                    description: cur.description.clone(),
                });
            }
        }
    }

    ProfileDiff {
        id: snapshot.id,
        name: snapshot.name.clone(),
        added,
        removed,
        modified,
    }
}

type FlatKey = (String, String); // (module, name)

fn flatten(snap: &ProfileSnapshot) -> HashMap<FlatKey, ProfileModuleItem> {
    let mut m = HashMap::new();
    for (module, items) in &snap.modules {
        for item in items {
            m.insert((module.clone(), item.name.clone()), item.clone());
        }
    }
    m
}

//! v4.0 Profiles 模块测试
//!
//! Case 1: capture 空 6 模块 → 全空 snapshot
//! Case 2: create 给定 name → DB row + 时间戳 + 6 module JSON
//! Case 3: list 返 1 个 + apply 把 MCP 移到 disabled 列表 + 写 settings.json
//! Case 4: apply reverse-disable sk/cmd/agent(.disabled 命名)
//! Case 5: delete row
//! Case 6: diff 给出 added/removed/modified
//!
//! commits 11 6 case · profiles 模块 · D13/D15 测试

use crate::repo::profiles::apply::{apply_profile, ApplyOptions};
use crate::repo::profiles::capture::{capture_profile_from_state, CaptureOptions};
use crate::repo::profiles::diff::{diff_profile, DiffOptions};
use crate::repo::profiles::types::PROFILE_MODULES;
use crate::repo::profiles::{create, delete, diff, get, list, apply};
use std::fs;
use tempfile::TempDir;

fn empty_base_dir() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().unwrap();
    let base = dir.path().to_path_buf();
    fs::create_dir_all(base.join("skills")).unwrap();
    fs::create_dir_all(base.join("disabled_skills")).unwrap();
    fs::create_dir_all(base.join("commands")).unwrap();
    fs::create_dir_all(base.join("agents")).unwrap();
    fs::create_dir_all(base.join("plugins")).unwrap();
    fs::write(base.join("settings.json"), "{}").unwrap();
    fs::write(base.join("mcp.json"), r#"{"mcpServers":{}}"#).unwrap();
    fs::write(base.join("installed_plugins.json"), r#"{"plugins":{}}"#).unwrap();
    (dir, base)
}

#[test]
fn case1_capture_empty() {
    let (_dir, base) = empty_base_dir();
    let opts = CaptureOptions::from_base_dir(&base);
    let snap = capture_profile_from_state(&opts);
    assert_eq!(snap.modules.len(), PROFILE_MODULES.len());
    for m in PROFILE_MODULES {
        assert!(snap.modules.get(*m).unwrap().is_empty(), "module {} should be empty", m);
    }
}

#[test]
fn case2_create_persist() {
    let (_dir, base) = empty_base_dir();
    let opts = CaptureOptions::from_base_dir(&base);
    let db_dir = TempDir::new().unwrap();
    let db = crate::db::init_db(db_dir.path()).unwrap();
    let snap = create(&db, "work", &opts).unwrap();
    assert_eq!(snap.name, "work");
    assert!(snap.id > 0);
    assert!(snap.created_at > 0);
    assert_eq!(snap.updated_at, snap.created_at);

    let summaries = list(&db).unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].id, snap.id);
    assert_eq!(summaries[0].name, "work");
    assert_eq!(summaries[0].item_count, 0);

    let got = get(&db, snap.id).unwrap().unwrap();
    assert_eq!(got.name, "work");
    assert_eq!(got.modules.len(), PROFILE_MODULES.len());
}

#[test]
fn case3_apply_real_file_mcp_disabled() {
    let (_dir, base) = empty_base_dir();
    let opts = CaptureOptions::from_base_dir(&base);
    let db_dir = TempDir::new().unwrap();
    let db = crate::db::init_db(db_dir.path()).unwrap();

    // 设置 MCP enabled(把 github 写到 settings.json 的 disabledMcpjsonServers 黑名单外)
    let settings = base.join("settings.json");
    fs::write(&settings, r#"{"disabledMcpjsonServers":[]}"#).unwrap();
    let mcp_json = base.join("mcp.json");
    // ClaudeJson.mcp_servers 字段已加 #[serde(rename = "mcpServers")] (D22 fix),
    // 实际 ~/.claude.json schema 走 camelCase (Anthropic 官方)
    fs::write(&mcp_json, r#"{"mcpServers":{"github":{"command":"gh"}}}"#).unwrap();

    // capture current — github 启用
    let cur = capture_profile_from_state(&opts);
    assert_eq!(cur.modules["mcp"].len(), 1);
    assert_eq!(cur.modules["mcp"][0].name, "github");

    // create snapshot (含 github)
    let snap = create(&db, "mcp-keep", &opts).unwrap();

    // 把 github 加到 disabled 列表
    fs::write(&settings, r#"{"disabledMcpjsonServers":["github"]}"#).unwrap();

    // apply 完整替代 → github 反向启用(从 disabled 移除)
    let apply_opts = ApplyOptions::from_base_dir(&base);
    let result = apply(&db, snap.id, &apply_opts).unwrap();
    assert!(result.real_file_errors.is_empty(), "errors: {:?}", result.real_file_errors);

    let raw = fs::read_to_string(&settings).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let list = parsed.get("disabledMcpjsonServers").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    assert!(list.is_empty(), "github should be removed from disabled list");
}

#[test]
fn case4_apply_reverse_disable_skill_command() {
    let (_dir, base) = empty_base_dir();
    let db_dir = TempDir::new().unwrap();
    let db = crate::db::init_db(db_dir.path()).unwrap();

    // capture 在 snapshot 里 (即"启用 audit / lint / reviewer"作为 target)
    let opts = CaptureOptions::from_base_dir(&base);
    let _ = opts; // placeholder

    // 1 个 skill "audit" 已在主目录(enabled)
    let skills_dir = base.join("skills");
    let audit_dir = skills_dir.join("audit");
    fs::create_dir_all(&audit_dir).unwrap();
    fs::write(audit_dir.join("SKILL.md"), "audit content").unwrap();

    // 1 个 command "lint" 已在主目录
    let commands_dir = base.join("commands");
    fs::write(commands_dir.join("lint.md"), "lint body").unwrap();

    // 1 个 agent "reviewer" 已在主目录
    let agents_dir = base.join("agents");
    fs::write(agents_dir.join("reviewer.md"), "reviewer body").unwrap();

    // capture 看到 3 个 enabled — 把这个 snapshot 保存为"work"
    let cur = capture_profile_from_state(&CaptureOptions::from_base_dir(&base));
    assert_eq!(cur.modules["skills"].len(), 1);
    assert_eq!(cur.modules["commands"].len(), 1);
    assert_eq!(cur.modules["sub_agents"].len(), 1);

    let work_snap = create(&db, "work", &CaptureOptions::from_base_dir(&base)).unwrap();
    // work_snap.modules 仍含 3 个(target)

    // 构造"all empty" target snapshot(全 0 个 — 即反向禁用 3 个)
    // 通过 clone work_snap 并清空 modules 实现
    // 取 work_snap 改 modules
    let mut reverse = work_snap.clone();
    for v in reverse.modules.values_mut() {
        v.clear();
    }
    assert!(reverse.modules["skills"].is_empty());
    assert!(reverse.modules["commands"].is_empty());

    // apply reverse-disable 应把 3 个从主目录移到 disabled 目录
    let apply_opts = ApplyOptions::from_base_dir(&base);
    let result = apply_profile(&reverse, &apply_opts);
    assert!(result.real_file_errors.is_empty(), "errors: {:?}", result.real_file_errors);
    assert!(result.restored_count >= 3, "restored={}", result.restored_count);

    // 验证: 3 个已移到 disabled 主目录已不存在
    assert!(!skills_dir.join("audit").exists(), "audit should be moved to disabled_skills");
    assert!(base.join("disabled_skills").join("audit").exists());
    assert!(!commands_dir.join("lint.md").exists());
    assert!(commands_dir.join("lint.md.disabled").exists());
    assert!(!agents_dir.join("reviewer.md").exists());
    assert!(agents_dir.join("reviewer.md.disabled").exists());
}

#[test]
fn case5_delete() {
    let (_dir, base) = empty_base_dir();
    let opts = CaptureOptions::from_base_dir(&base);
    let db_dir = TempDir::new().unwrap();
    let db = crate::db::init_db(db_dir.path()).unwrap();

    let snap = create(&db, "to-delete", &opts).unwrap();
    assert_eq!(list(&db).unwrap().len(), 1);

    delete(&db, snap.id).unwrap();
    assert_eq!(list(&db).unwrap().len(), 0);
    assert!(get(&db, snap.id).unwrap().is_none());
}

#[test]
fn case6_diff_added_removed() {
    let (_dir, base) = empty_base_dir();
    let opts = CaptureOptions::from_base_dir(&base);
    let db_dir = TempDir::new().unwrap();
    let db = crate::db::init_db(db_dir.path()).unwrap();

    // 创建 1 个 skill
    let skills_dir = base.join("skills");
    fs::create_dir_all(skills_dir.join("foo")).unwrap();
    fs::write(skills_dir.join("foo").join("SKILL.md"), "foo content").unwrap();

    let snap = create(&db, "snapshot", &opts).unwrap();
    let captured = capture_profile_from_state(&opts);
    assert_eq!(captured.modules["skills"].len(), 1);

    // 加 1 个 + 删除旧的
    fs::create_dir_all(skills_dir.join("bar")).unwrap();
    fs::write(skills_dir.join("bar").join("SKILL.md"), "bar content").unwrap();
    fs::remove_dir_all(skills_dir.join("foo")).unwrap();

    let diff_opts = DiffOptions::from_base_dir(&base);
    let diff_result = diff(&db, snap.id, &diff_opts).unwrap();
    assert_eq!(diff_result.id, snap.id);
    // bar 加,foo 删
    let added_names: Vec<&str> = diff_result.added.iter().map(|i| i.name.as_str()).collect();
    let removed_names: Vec<&str> = diff_result.removed.iter().map(|i| i.name.as_str()).collect();
    assert!(added_names.contains(&"bar"), "added: {:?}", added_names);
    assert!(removed_names.contains(&"audit-foo") || removed_names.contains(&"foo"), "removed: {:?}", removed_names);

    // 此外 capture 本身可独立验证
    let fresh = capture_profile_from_state(&opts);
    let _ = diff_profile(&snap, &diff_opts);
    assert_eq!(fresh.modules["skills"].len(), 1);
}

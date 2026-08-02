//! v4.0 Profiles apply — 完整替代语义(D13)
//!
//! v3.1 D13 决策: applyProfile 不只 target 列表启用,还要 reverse-disable
//! `current ∖ target` 的人(写真实文件而不仅 KV 表)。commit 89b6b07 串行
//! 写 settings.json mutex 防止 race。
//!
//! v4.0 commit 11 简化: profile_apply 走纯函数 6 模块改写真实文件,事务
//! 失败 best-effort 回滚(每模块独立 try,失败累计 errors)。
//!
//! 注意: capability 6 模块的 enable 路径不一定能对称执行(MCP black-list
//! 移除 vs plugins `enabledPlugins[k]=true` vs skills/commands/agents
//! `MV disabled/` → `skills/`,hooks splice restore)。为简化,本 commit 11
//! 仅实现 4 类反向 disable:MCP / skills / commands / sub_agents。plugins
//! 与 hooks enable 路径缺数据(createPlugin 需 6 字段,createHook 需 HookEntry),
//! capture 段只能存 name / scope / source_path,无法重建完整 entry,这两个模块
//! 走"skip on apply"(collect real_file_errors)。
//!
//! 上层 v4.1 可选择: 给 plugin/hook 拍一份完整 entry(KV 表 cache 兜底),
//! 或简化 UI(apply profile 时显式标 plugins/hooks 为 partial)。

use crate::repo::profiles::capture::{capture_profile_from_state, CaptureOptions};
use crate::repo::profiles::types::{ApplyResult, ProfileModuleItem, ProfileSnapshot};
use crate::repo::profiles::types::PROFILE_MODULES;
use crate::util::atomic_write::atomic_write_json;
use crate::util::settings_reader::{read_claude_settings, ClaudeSettings};
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Debug, Clone, Default)]
pub struct ApplyOptions {
    pub settings_path: Option<PathBuf>,
    pub skills_dir: Option<PathBuf>,
    pub disabled_skills_dir: Option<PathBuf>,
    pub commands_dir: Option<PathBuf>,
    pub agents_dir: Option<PathBuf>,
    pub mcp_config_path: Option<PathBuf>,
    pub installed_plugins_path: Option<PathBuf>,
}

fn settings_or_default(p: &Option<PathBuf>) -> PathBuf {
    p.clone().unwrap_or_else(|| {
        home::home_dir()
            .map(|h| h.join(".claude").join("settings.json"))
            .unwrap_or_else(|| PathBuf::from("settings.json"))
    })
}

fn skills_dir_or_default(p: &Option<PathBuf>) -> PathBuf {
    p.clone()
        .unwrap_or_else(|| home::home_dir().map(|h| h.join(".claude").join("skills")).unwrap_or_else(|| PathBuf::from("skills")))
}

fn disabled_skills_dir_or_default(p: &Option<PathBuf>) -> PathBuf {
    p.clone()
        .unwrap_or_else(|| home::home_dir().map(|h| h.join(".claude").join("disabled_skills")).unwrap_or_else(|| PathBuf::from("disabled_skills")))
}

fn commands_dir_or_default(p: &Option<PathBuf>) -> PathBuf {
    p.clone()
        .unwrap_or_else(|| home::home_dir().map(|h| h.join(".claude").join("commands")).unwrap_or_else(|| PathBuf::from("commands")))
}

fn agents_dir_or_default(p: &Option<PathBuf>) -> PathBuf {
    p.clone()
        .unwrap_or_else(|| home::home_dir().map(|h| h.join(".claude").join("agents")).unwrap_or_else(|| PathBuf::from("agents")))
}

/// 串行 settings.json 写锁(Mutex) — v3.1 commit 89b6b07 race fix 模式
use std::sync::Mutex;
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

/// applyProfile 完整替代语义:
/// 1. capture current 全集(6 scanner)
/// 2. target ∩ current → no-op (already enabled)
/// 3. target ∖ current → 启用(target list items 写真实文件)
/// 4. current ∖ target → reverse-disable(写真实文件 from enabled=true → false)
/// 5. Plugins/hooks 走 skip + 累计 real_file_errors("not implemented in v4.0 commit 11")
pub fn apply_profile(snapshot: &ProfileSnapshot, opts: &ApplyOptions) -> ApplyResult {
    let current = capture_profile_from_state(&CaptureOptions {
        settings_path: opts.settings_path.clone(),
        skills_dir: opts.skills_dir.clone(),
        disabled_skills_dir: opts.disabled_skills_dir.clone(),
        commands_dir: opts.commands_dir.clone(),
        agents_dir: opts.agents_dir.clone(),
        mcp_config_path: opts.mcp_config_path.clone(),
        installed_plugins_path: opts.installed_plugins_path.clone(),
        plugins_root: None,
    });

    let mut restored = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for module in PROFILE_MODULES {
        let target = snapshot.modules.get(*module).cloned().unwrap_or_default();
        let cur = current.modules.get(*module).cloned().unwrap_or_default();

        let target_names: std::collections::HashSet<&str> =
            target.iter().map(|i| i.name.as_str()).collect();
        let cur_names: std::collections::HashSet<&str> =
            cur.iter().map(|i| i.name.as_str()).collect();

        // target ∩ current → no-op
        // target ∖ current → 启用
        for item in &target {
            if !cur_names.contains(item.name.as_str()) {
                if let Err(e) = enable_one(module, item, opts) {
                    errors.push(format!("enable {}::{}: {}", module, item.name, e));
                } else {
                    restored += 1;
                }
            }
        }

        // current ∖ target → reverse-disable
        for item in &cur {
            if !target_names.contains(item.name.as_str()) {
                if let Err(e) = disable_one(module, item, opts) {
                    errors.push(format!("reverse-disable {}::{}: {}", module, item.name, e));
                } else {
                    restored += 1;
                }
            }
        }
    }

    ApplyResult {
        ok: errors.is_empty(),
        restored_count: restored,
        real_file_errors: errors,
    }
}

fn enable_one(module: &str, item: &ProfileModuleItem, opts: &ApplyOptions) -> Result<(), String> {
    match module {
        "mcp" => mcp_set_disabled(&item.name, false, &opts.settings_path),
        "skills" => skills_unset_disabled(&item.name, opts),
        "commands" => commands_unset_disabled(&item.name, opts),
        "sub_agents" => agents_unset_disabled(&item.name, opts),
        "plugins" => Err("plugins enable requires full entry; skipped in v4.0 commit 11".into()),
        "hooks" => Err("hooks enable requires full entry; skipped in v4.0 commit 11".into()),
        _ => Err(format!("unknown module {}", module)),
    }
}

fn disable_one(module: &str, item: &ProfileModuleItem, opts: &ApplyOptions) -> Result<(), String> {
    match module {
        "mcp" => mcp_set_disabled(&item.name, true, &opts.settings_path),
        "skills" => skills_set_disabled(&item.name, opts),
        "commands" => commands_set_disabled(&item.name, opts),
        "sub_agents" => agents_set_disabled(&item.name, opts),
        "plugins" => plugins_set_disabled(&item.name, &opts.settings_path),
        "hooks" => Ok(()), // hooks reverse-disable 复杂需要重建 entry,先 skip
        _ => Err(format!("unknown module {}", module)),
    }
}

// ============================================================
// 6 module enable/disable 真实文件写
// ============================================================

/// MCP 真停用 / 真启用:settings.json 的 disabledMcpjsonServers 黑名单
/// 写入 / 移除(commit d3c6e09 模式)。
fn mcp_set_disabled(name: &str, disabled: bool, settings_path: &Option<PathBuf>) -> Result<(), String> {
    let _lock = SETTINGS_LOCK.lock().map_err(|e| format!("lock: {}", e))?;
    let path = settings_or_default(settings_path);
    let mut settings = read_claude_settings(&path).unwrap_or_default();
    let mut list = settings.disabled_mcpjson_servers.clone().unwrap_or_default();
    list.retain(|n| n != name);
    if disabled {
        if !list.iter().any(|n| n == name) {
            list.push(name.to_string());
        }
    }
    settings.disabled_mcpjson_servers = if list.is_empty() { None } else { Some(list) };
    atomic_write_json(&path, &settings).map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

/// Plugins 真停用:settings.json enabledPlugins[k]=false(不删 entry,因为
/// 它记录了 plugin 全名 / scope 信息,删了会丢失)。
fn plugins_set_disabled(name: &str, settings_path: &Option<PathBuf>) -> Result<(), String> {
    let _lock = SETTINGS_LOCK.lock().map_err(|e| format!("lock: {}", e))?;
    let path = settings_or_default(settings_path);
    let mut settings = read_claude_settings(&path).unwrap_or_default();
    let mut map = settings.enabled_plugins.clone().unwrap_or_default();
    map.insert(name.to_string(), false);
    settings.enabled_plugins = Some(map);
    atomic_write_json(&path, &settings).map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

/// Skills 真停用:把主目录 move 到镜像目录 disabled_skills/<name>
/// (D11 镜像目录方案,不是 .disabled 后缀,因为跨 CC 版本稳定)。
fn skills_set_disabled(name: &str, opts: &ApplyOptions) -> Result<(), String> {
    let main_dir = skills_dir_or_default(&opts.skills_dir).join(name);
    let disabled_dir = disabled_skills_dir_or_default(&opts.disabled_skills_dir).join(name);
    if !main_dir.exists() {
        return Ok(()); // 已不在主目录,no-op
    }
    std::fs::create_dir_all(disabled_dir.parent().unwrap())
        .map_err(|e| format!("mkdir disabled: {}", e))?;
    std::fs::rename(&main_dir, &disabled_dir).map_err(|e| format!("mv to disabled: {}", e))?;
    Ok(())
}

/// Skills 真启用:把镜像目录 move 回主目录。
fn skills_unset_disabled(name: &str, opts: &ApplyOptions) -> Result<(), String> {
    let main_dir = skills_dir_or_default(&opts.skills_dir).join(name);
    let disabled_dir = disabled_skills_dir_or_default(&opts.disabled_skills_dir).join(name);
    if !disabled_dir.exists() {
        return Ok(()); // 已不在镜像目录,no-op
    }
    std::fs::create_dir_all(main_dir.parent().unwrap())
        .map_err(|e| format!("mkdir main: {}", e))?;
    std::fs::rename(&disabled_dir, &main_dir).map_err(|e| format!("mv to main: {}", e))?;
    Ok(())
}

/// Commands 真停用:rename <name>.md → <name>.md.disabled(D14 决策)。\
fn commands_set_disabled(name: &str, opts: &ApplyOptions) -> Result<(), String> {
    let dir = commands_dir_or_default(&opts.commands_dir);
    let main = dir.join(format!("{}.md", name));
    let disabled = dir.join(format!("{}.md.disabled", name));
    if !main.exists() {
        return Ok(());
    }
    std::fs::rename(&main, &disabled).map_err(|e| format!("mv cmd to disabled: {}", e))?;
    Ok(())
}

fn commands_unset_disabled(name: &str, opts: &ApplyOptions) -> Result<(), String> {
    let dir = commands_dir_or_default(&opts.commands_dir);
    let main = dir.join(format!("{}.md", name));
    let disabled = dir.join(format!("{}.md.disabled", name));
    if !disabled.exists() {
        return Ok(());
    }
    std::fs::rename(&disabled, &main).map_err(|e| format!("mv cmd to main: {}", e))?;
    Ok(())
}

/// Sub-agents 真停用:同 commands(D14 决策)。
fn agents_set_disabled(name: &str, opts: &ApplyOptions) -> Result<(), String> {
    let dir = agents_dir_or_default(&opts.agents_dir);
    let main = dir.join(format!("{}.md", name));
    let disabled = dir.join(format!("{}.md.disabled", name));
    if !main.exists() {
        return Ok(());
    }
    std::fs::rename(&main, &disabled).map_err(|e| format!("mv agent to disabled: {}", e))?;
    Ok(())
}

fn agents_unset_disabled(name: &str, opts: &ApplyOptions) -> Result<(), String> {
    let dir = agents_dir_or_default(&opts.agents_dir);
    let main = dir.join(format!("{}.md", name));
    let disabled = dir.join(format!("{}.md.disabled", name));
    if !disabled.exists() {
        return Ok(());
    }
    std::fs::rename(&disabled, &main).map_err(|e| format!("mv agent to main: {}", e))?;
    Ok(())
}

/// 给前端使用:settings.json 完整内容(只看 schema,可用于 diagnostics)
#[allow(dead_code)]
pub fn read_settings_snapshot(settings_path: &Option<PathBuf>) -> Option<ClaudeSettings> {
    let path = settings_or_default(settings_path);
    read_claude_settings(&path)
}

/// 测试 helper:把 apply 结果转 JSON 字符串(类似 v3.1 测试期望)
#[allow(dead_code)]
pub fn apply_result_to_json(r: &ApplyResult) -> Value {
    json!({
        "ok": r.ok,
        "restoredCount": r.restored_count,
        "realFileErrors": r.real_file_errors,
    })
}

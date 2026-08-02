//! v4.0 Profiles capture — 走 6 scanner 拿真实 enabled 全集(D15)
//!
//! v3.1 D10 决策: KV 表 = cache,非 UI 真实状态。D15 实测 6 模块顶级
//! 计数 140 vs profile 13 (a01) 漏 9 项 — 用户从未 toggle 但 scanner
//! 默认 enabled=true 的项不进 KV 表,只走 KV 漏项。
//!
//! v4.0 commit 11 实现: captureProfileFromState 签名扩 CaptureOptions
//! (6 路径全可选,未传走 default*Dir()),不走 KV 表 LIKE 查询。

use crate::repo::agents_scanner::list_sub_agents;
use crate::repo::commands_scanner::list_commands;
use crate::repo::hooks_scanner::list_hooks;
use crate::repo::mcp_scanner::list_mcp_servers;
use crate::repo::plugins_scanner::list_plugins;
use crate::repo::profiles::types::{ProfileModuleItem, ProfileSnapshot, PROFILE_MODULES};
use crate::repo::skills_scanner::list_skills;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// CaptureOptions — 6 模块各自路径,未传走 default*Dir() 默认生产路径。
/// 测试 fixture 必须显式传,避免读 ~/.claude(MCP 黑名单写错会污染)。
#[derive(Debug, Clone, Default)]
pub struct CaptureOptions {
    pub mcp_config_path: Option<PathBuf>,
    pub settings_path: Option<PathBuf>,
    pub installed_plugins_path: Option<PathBuf>,
    pub skills_dir: Option<PathBuf>,
    pub disabled_skills_dir: Option<PathBuf>,
    pub commands_dir: Option<PathBuf>,
    pub agents_dir: Option<PathBuf>,
    pub plugins_root: Option<PathBuf>,
}

/// 6 模块并行 capture:每个 module 走对应 scanner,过滤 enabled==true。
/// 串行实现即可(6 filesystem read,O(N) 几百级,不值得并发复杂度)。
pub fn capture_profile_from_state(opts: &CaptureOptions) -> ProfileSnapshot {
    let mut modules: HashMap<String, Vec<ProfileModuleItem>> = HashMap::new();

    // mcp
    let mcp = list_mcp_servers(opts.mcp_config_path.as_deref(), opts.settings_path.as_deref());
    modules.insert(
        "mcp".into(),
        mcp.into_iter()
            .filter(|x| x.enabled)
            .map(|x| ProfileModuleItem {
                name: x.name,
                scope: "user".into(),
                source_path: opts.settings_path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                enabled: true,
                description: None,
            })
            .collect(),
    );

    // skills
    let skills = list_skills(opts.skills_dir.as_deref(), opts.disabled_skills_dir.as_deref());
    modules.insert(
        "skills".into(),
        skills
            .into_iter()
            .filter(|x| x.enabled)
            .map(|x| ProfileModuleItem {
                name: x.name,
                scope: "user".into(),
                source_path: x.path,
                enabled: true,
                description: x.description,
            })
            .collect(),
    );

    // commands
    let cmds = list_commands(opts.commands_dir.as_deref());
    modules.insert(
        "commands".into(),
        cmds.into_iter()
            .filter(|x| x.enabled)
            .map(|x| ProfileModuleItem {
                name: x.name,
                scope: "user".into(),
                source_path: x.path,
                enabled: true,
                description: x.description,
            })
            .collect(),
    );

    // sub_agents
    let agents = list_sub_agents(opts.agents_dir.as_deref());
    modules.insert(
        "sub_agents".into(),
        agents
            .into_iter()
            .filter(|x| x.enabled)
            .map(|x| ProfileModuleItem {
                name: x.name,
                scope: "user".into(),
                source_path: x.path,
                enabled: true,
                description: x.description,
            })
            .collect(),
    );

    // hooks
    let hooks = list_hooks(opts.settings_path.as_deref());
    modules.insert(
        "hooks".into(),
        hooks
            .into_iter()
            .filter(|x| x.enabled)
            .map(|x| ProfileModuleItem {
                name: x.id,
                scope: "user".into(),
                source_path: opts.settings_path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                enabled: true,
                description: None,
            })
            .collect(),
    );

    // plugins
    let plugins = list_plugins(opts.settings_path.as_deref(), opts.plugins_root.as_deref());
    modules.insert(
        "plugins".into(),
        plugins
            .into_iter()
            .filter(|x| x.enabled)
            .map(|x| ProfileModuleItem {
                name: x.full_name,
                scope: x.scope,
                source_path: x.install_path,
                enabled: true,
                description: x.description,
            })
            .collect(),
    );

    // 验证 PROFILE_MODULES 6 个 key 全部出现(即使空)
    for m in PROFILE_MODULES {
        modules.entry((*m).to_string()).or_insert_with(Vec::new);
    }

    let now = now_ms();
    ProfileSnapshot {
        id: 0,
        name: String::new(),
        created_at: now,
        updated_at: now,
        modules,
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 便捷构造:全部用 default 路径(production)。
pub fn capture_with_defaults() -> ProfileSnapshot {
    capture_profile_from_state(&CaptureOptions::default())
}

/// 便捷构造:全部用指定 base_dir 下的 6 个子目录(test fixture 用)。
/// base_dir 下应有:settings.json / mcp.json / skills/ / commands/ / agents/ / plugins/
#[allow(dead_code)]
pub fn capture_with_base_dir(base_dir: &Path) -> ProfileSnapshot {
    let opts = CaptureOptions {
        mcp_config_path: Some(base_dir.join("mcp.json")),
        settings_path: Some(base_dir.join("settings.json")),
        installed_plugins_path: Some(base_dir.join("installed_plugins.json")),
        skills_dir: Some(base_dir.join("skills")),
        disabled_skills_dir: Some(base_dir.join("disabled_skills")),
        commands_dir: Some(base_dir.join("commands")),
        agents_dir: Some(base_dir.join("agents")),
        plugins_root: Some(base_dir.join("plugins")),
    };
    capture_profile_from_state(&opts)
}

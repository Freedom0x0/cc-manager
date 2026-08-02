//! v4.0 Plugins scanner (commit 10a)
//! 平移自 v3.1 electron/repo/plugins/scanner.ts
//! 主键 fullName = name@marketplace
//! enabled 状态从 settings.json 的 enabledPlugins dict 反推

use crate::types::Plugin;
use crate::util::settings_reader::read_claude_settings;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct InstalledPlugin {
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    install_path: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    installed_at: Option<String>,
    #[serde(default)]
    last_updated: Option<String>,
    #[serde(default)]
    git_commit_sha: Option<String>,
}

pub fn default_plugins_root() -> PathBuf {
    home::home_dir().map(|h| h.join(".claude").join("plugins")).unwrap_or_else(|| "plugins".into())
}

pub fn default_installed_plugins_path() -> PathBuf {
    home::home_dir().map(|h| h.join(".claude").join("plugins").join("installed_plugins.json")).unwrap_or_else(|| "installed_plugins.json".into())
}

fn read_installed_plugins(installed_plugins_path: Option<&Path>) -> std::collections::HashMap<String, InstalledPlugin> {
    let path = installed_plugins_path.map(|p| p.to_path_buf()).unwrap_or_else(default_installed_plugins_path);
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return std::collections::HashMap::new(),
    };
    // commit 28 修 D30: installed_plugins.json 实际 schema 是 v2:
    //   { "version": 2, "plugins": { "name@marketplace": [{ scope, installPath, version, ... }] } }
    // plugins map 的 value 是**数组**(可重复装不同 scope / version), 我们
    // 取第一个 = 首选版本。
    // 之前 v4 scanner 误按 v1 schema 解析(顶层 { name@marketplace: data } 平铺),
    // 'version' / 'plugins' 等顶层 key 不是 InstalledPlugin 形状 → serde
    // 失败 → 跳过 → map 空 → 0 个 plugin。
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(v) => {
            let mut map = std::collections::HashMap::new();
            if let Some(plugins_obj) = v.get("plugins").and_then(|p| p.as_object()) {
                for (k, val) in plugins_obj {
                    // val 是 array, 取第一个
                    if let Some(first) = val.as_array().and_then(|a| a.first()) {
                        if let Ok(parsed) = serde_json::from_value::<InstalledPlugin>(first.clone()) {
                            map.insert(k.clone(), parsed);
                        }
                    }
                }
            }
            map
        }
        Err(_) => std::collections::HashMap::new(),
    }
}

fn parse_plugin_json(path: &Path, full_name: &str, installed: &InstalledPlugin) -> Option<Plugin> {
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or(full_name).to_string();
    let marketplace = if full_name.contains('@') {
        full_name.split('@').nth(1).unwrap_or("").to_string()
    } else {
        String::new()
    };
    Some(Plugin {
        full_name: full_name.to_string(),
        name,
        marketplace,
        version: parsed.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        description: parsed.get("description").and_then(|v| v.as_str()).map(String::from),
        scope: installed.scope.clone().unwrap_or_else(|| "user".to_string()),
        install_path: installed.install_path.clone().unwrap_or_default(),
        installed_at: installed.installed_at.clone().unwrap_or_default(),
        last_updated: installed.last_updated.clone().unwrap_or_default(),
        git_commit_sha: installed.git_commit_sha.clone().unwrap_or_default(),
        enabled: true, // 默认 enabled, 由 enabled dict 修正
    })
}

pub fn list_plugins(settings_path: Option<&Path>, plugins_root: Option<&Path>, installed_plugins_path: Option<&Path>) -> Vec<Plugin> {
    let settings_path = settings_path.map(|p| p.to_path_buf())
        .unwrap_or_else(|| home::home_dir().map(|h| h.join(".claude").join("settings.json")).unwrap_or_else(|| "settings.json".into()));
    let enabled_dict: std::collections::HashMap<String, bool> = read_claude_settings(&settings_path)
        .and_then(|s| s.enabled_plugins)
        .unwrap_or_default();
    let installed = read_installed_plugins(installed_plugins_path);
    let mut result = Vec::new();
    // commit 29 修 D31: plugins_root 参数去掉 _ 前缀, 让 capture 6 模块
    // 真接 opts.plugins_root (CaptureOptions::default() 时 None 走
    // default_plugins_root() = ~/.claude/plugins; test fixture 显式传
    // Some(temp_dir/plugins) 走 test 路径)。之前 _ 前缀忽略 opts, 导致
    // 测试 case1/2 (用 TempDir) 读真 ~/.claude/plugins/ → 期望空但读到
    // 真实装包 → 2 case fail。
    let root = plugins_root.map(|p| p.to_path_buf()).unwrap_or_else(default_plugins_root);
    for (full_name, info) in installed {
        // commit 28 修 D30 续: v2 schema 的 installPath 是 cache 实际路径
        // (e.g. ~/.claude/plugins/cache/<marketplace>/<name>/<version>),
        //  之前 scanner 误用 root/<name>/.claude-plugin/plugin.json = 错的
        //  路径(实际是 cache/ 不是 root/), parse_plugin_json 返 None → 跳过
        //  → 0 plugin。先试 installPath/.claude-plugin/plugin.json, 失败
        //  才退回 root/<name>/.claude-plugin/plugin.json (v1 fallback)。
        let plugin_path = info.install_path.as_deref()
            .map(|p| std::path::PathBuf::from(p).join(".claude-plugin").join("plugin.json"))
            .unwrap_or_else(|| {
                root.join(full_name.split('@').next().unwrap_or(&full_name))
                    .join(".claude-plugin")
                    .join("plugin.json")
            });
        if let Some(mut p) = parse_plugin_json(&plugin_path, &full_name, &info) {
            p.enabled = enabled_dict.get(&full_name).copied().unwrap_or(true);
            result.push(p);
        }
    }
    result
}

pub fn get_plugin(full_name: &str, settings_path: Option<&Path>, plugins_root: Option<&Path>, installed_plugins_path: Option<&Path>) -> Option<Plugin> {
    list_plugins(settings_path, plugins_root, installed_plugins_path).into_iter().find(|p| p.full_name == full_name)
}
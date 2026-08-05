#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // DB 初始化:用 app_data_dir 单一来源(spec §3.2)
  tauri::Builder::default()
    .setup(|app| {
      use tauri::Manager;
      let app_data_dir = app.path().app_data_dir()?;
      let db = crate::db::init_db(&app_data_dir)?;
      let db_state = crate::db::DbState::new(db);
      let source_dir = crate::importer::default_source_dir();
      let watcher = match std::fs::create_dir_all(&source_dir) {
        Ok(()) => match crate::watcher::start_watcher(
          std::sync::Arc::clone(&db_state.0),
          &source_dir,
        ) {
          Ok(watcher) => Some(watcher),
          Err(error) => {
            eprintln!("[startup] watcher failed: {}", error);
            if let Ok(db) = db_state.0.lock() {
              crate::watcher::record_error(&db, &error);
            }
            None
          }
        },
        Err(error) => {
          let error = format!("create watcher directory {}: {}", source_dir.display(), error);
          eprintln!("[startup] {}", error);
          if let Ok(db) = db_state.0.lock() {
            crate::watcher::record_error(&db, &error);
          }
          None
        }
      };
      // commit 24 修 D26: 启动后立即 rescan 一次,把 ~/.claude/projects/ 下
      // 现有 jsonl 导入 DB。否则前端 SessionsPane 空 — D20 类缺口的延伸(commit 4
      // 写 'watcher 集成' 但实际只完成 notify 事件路由, importer 解析 + 启动触发漏)。
      if let Ok(db) = db_state.0.lock() {
        let scan_result = if watcher.is_some() {
          crate::watcher::rescan_all(&db)
        } else {
          // 保留 watcher 启动失败的 error 状态；扫描成功不能伪装成监听正常。
          crate::importer::rescan_all(&db)
        };
        if let Err(e) = scan_result {
          eprintln!("[startup] rescan_all failed: {}", e);
        }
      }
      app.manage(db_state);
      app.manage(crate::watcher::WatcherHandle::new(watcher));
      // v1.2 c4: PetStateDaemon (real wiring with AppHandle so Task 5 can
      // emit "agent-state-event" to the frontend without changing the
      // signature again) + HTTP receiver on 127.0.0.1:19847.
      let app_handle = app.handle().clone();
      let daemon = crate::pet::daemon::PetStateDaemon::new(app_handle);
      let secret = match crate::pet::install::secret_load_or_create(&app_data_dir) {
        Ok(s) => s,
        Err(e) => {
          eprintln!("[startup] pet secret load_or_create failed: {}", e);
          return Err(e.into());
        }
      };
      let daemon_for_http = daemon.clone();
      let secret_for_http = secret.clone();
      tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::pet::http::start_http_server(daemon_for_http, secret_for_http).await {
          eprintln!("[startup] pet http server failed: {}", e);
        }
      });
      app.manage(daemon);
      let _ = secret; // kept for future direct IPC use

      // D37: main window destroyed → auto-close pet webview.
      // Tauri 2 默认主 webview 退出时不关兄弟 webview, 透明 always-on-top
      // 窗口会"残留"在屏幕上 (cc-session-manager.exe 进程也还在), 用户
      // 以为关了实际没关。监听主窗口 CloseRequested, 主窗口准备关时
      // 主动 close pet webview, 整套 app 真退出。
      let app_handle_for_event = app.handle().clone();
      if let Some(main_window) = app.get_webview_window("main") {
        main_window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { .. } = event {
            if let Some(pet) = app_handle_for_event.get_webview_window("pet") {
              let _ = pet.close();
            }
            // 同时清理 HTTP receiver: daemon 里没显式 stop, 但
            // 进程退出时 OS 回收 19847 端口 — 跟 v3.1 Electron 行为一致。
          }
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      // commit 0 hello
      hello_world,
      // commit 2 读 5 IPC
      cmd_list_projects,
      cmd_list_project_tree,
      cmd_list_sessions,
      cmd_list_deleted_sessions,
      cmd_list_messages,
      cmd_search_messages,
      // commit 3 写 5 IPC
      cmd_soft_delete_session,
      cmd_restore_session,
      cmd_permanent_delete_session,
      cmd_resume_session,
      // commit 4 watcher 2 IPC
      cmd_watcher_rescan_all,
      cmd_watcher_get_status,
      // commit 5 MCP 6 IPC
      cmd_mcp_list,
      cmd_mcp_get,
      cmd_mcp_create,
      cmd_mcp_update,
      cmd_mcp_delete,
      cmd_mcp_toggle_enabled,
      // commit 6 skills 6 IPC
      cmd_skill_list,
      cmd_skill_get,
      cmd_skill_create,
      cmd_skill_update,
      cmd_skill_delete,
      cmd_skill_toggle_enabled,
      // commit 7 commands 6 IPC
      cmd_command_list,
      cmd_command_get,
      cmd_command_create,
      cmd_command_update,
      cmd_command_delete,
      cmd_command_toggle_enabled,
      // commit 8 sub-agents 6 IPC
      cmd_subagent_list,
      cmd_subagent_get,
      cmd_subagent_create,
      cmd_subagent_update,
      cmd_subagent_delete,
      cmd_subagent_toggle_enabled,
      // commit 9 hooks 6 IPC
      cmd_hook_list,
      cmd_hook_get,
      cmd_hook_create,
      cmd_hook_update,
      cmd_hook_delete,
      cmd_hook_toggle_enabled,
      // commit 10 plugins 6 IPC
      cmd_plugin_list,
      cmd_plugin_get,
      cmd_plugin_create,
      cmd_plugin_update,
      cmd_plugin_delete,
      cmd_plugin_toggle_enabled,
      // commit 11 profiles 6 IPC
      cmd_profile_list,
      cmd_profile_get,
      cmd_profile_create,
      cmd_profile_apply,
      cmd_profile_delete,
      cmd_profile_diff,
      // commit 12 usage 6 IPC
      cmd_usage_summary,
      cmd_usage_get_session_cost,
      cmd_usage_get_session_timeline,
      cmd_usage_get_project_breakdown,
      cmd_usage_get_daily_breakdown,
      cmd_usage_get_top_tools,
      // v1.2 c2: cc-pet 5 IPC handlers
      cmd_pet_install_status_hook,
      cmd_pet_uninstall_status_hook,
      cmd_pet_window_open,
      cmd_pet_window_close,
      cmd_pet_get_status,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// v4.0 commit 0 验证用 command。后续 commit 会删掉换成 list_projects 等真实 command。
#[tauri::command]
fn hello_world() -> &'static str {
  "cc-session-manager v4.0 (Tauri 2)"
}

// ===== commit 2: 5 个读 IPC =====

#[tauri::command]
fn cmd_list_projects(state: tauri::State<crate::db::DbState>) -> Result<Vec<crate::types::ProjectRow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::list_with_counts(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_project_tree(state: tauri::State<crate::db::DbState>) -> Result<Vec<crate::types::ProjectTreeNode>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::list_project_tree(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_sessions(
    state: tauri::State<crate::db::DbState>,
    project_id: i64,
    include_deleted: bool,
) -> Result<Vec<crate::types::SessionRow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::list_by_project(&db, project_id, include_deleted).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_deleted_sessions(state: tauri::State<crate::db::DbState>) -> Result<Vec<crate::types::SessionRow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::list_deleted_sessions(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_messages(
    state: tauri::State<crate::db::DbState>,
    session_id: String,
) -> Result<Vec<crate::types::MessageRow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::list_by_session(&db, &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_search_messages(
    state: tauri::State<crate::db::DbState>,
    query: String,
    project_ids: Option<Vec<i64>>,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
) -> Result<Vec<crate::types::SearchHit>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let range = match (from_ms, to_ms) {
        (Some(f), Some(t)) => Some((f, t)),
        _ => None,
    };
    crate::repo::search(&db, &query, project_ids, range).map_err(|e| e.to_string())
}

// ===== commit 3: 5 写 IPC =====

#[tauri::command]
fn cmd_soft_delete_session(
    state: tauri::State<crate::db::DbState>,
    session_id: String,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::soft_delete(&db, &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_restore_session(
    state: tauri::State<crate::db::DbState>,
    session_id: String,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::restore(&db, &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_permanent_delete_session(
    state: tauri::State<crate::db::DbState>,
    session_id: String,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::permanent_delete(&db, &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_resume_session(
    state: tauri::State<crate::db::DbState>,
    session_id: String,
) -> Result<Option<crate::types::ResumeCommand>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::resume_session(&db, &session_id).map_err(|e| e.to_string())
}

// ===== commit 4: watcher 2 IPC =====

#[tauri::command]
fn cmd_watcher_rescan_all(state: tauri::State<crate::db::DbState>) -> Result<crate::importer::ImportStats, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::watcher::rescan_all(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_watcher_get_status(state: tauri::State<crate::db::DbState>) -> Result<crate::types::WatcherStatus, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    Ok(crate::watcher::get_status(&db))
}

// ===== commit 5: MCP 6 IPC =====
fn mcp_settings_path() -> std::path::PathBuf {
    home::home_dir().map(|h| h.join(".claude").join("settings.json")).unwrap_or_else(|| "settings.json".into())
}

#[tauri::command]
fn cmd_mcp_list(_state: tauri::State<crate::db::DbState>) -> Result<Vec<crate::types::McpServer>, String> {
    Ok(crate::repo::mcp_scanner::list_mcp_servers(None, Some(&mcp_settings_path())))
}

#[tauri::command]
fn cmd_mcp_get(_state: tauri::State<crate::db::DbState>, name: String) -> Result<Option<crate::types::McpServer>, String> {
    Ok(crate::repo::mcp_scanner::get_mcp_server(&name, None, Some(&mcp_settings_path())))
}

#[tauri::command]
fn cmd_mcp_create(_state: tauri::State<crate::db::DbState>, input: crate::types::McpCreateInput) -> Result<(), String> {
    crate::repo::mcp_writer::create_mcp_server(input, None)
}

#[tauri::command]
fn cmd_mcp_update(_state: tauri::State<crate::db::DbState>, name: String, patch: crate::types::McpUpdatePatch) -> Result<(), String> {
    crate::repo::mcp_writer::update_mcp_server(&name, patch, None)
}

#[tauri::command]
fn cmd_mcp_delete(_state: tauri::State<crate::db::DbState>, name: String) -> Result<(), String> {
    crate::repo::mcp_writer::delete_mcp_server(&name, None)
}

#[tauri::command]
fn cmd_mcp_toggle_enabled(state: tauri::State<crate::db::DbState>, name: String, enabled: bool) -> Result<(), String> {
    use crate::util::atomic_write::atomic_write_json;
    use crate::util::settings_reader::read_claude_settings;
    let path = mcp_settings_path();
    let mut settings = read_claude_settings(&path).unwrap_or_default();
    let list = settings.disabled_mcpjson_servers.get_or_insert_with(Vec::new);
    list.retain(|n| n != &name);
    if !enabled {
        list.push(name.clone());
    }
    // settings.json 还有可能其他字段被洗, 用 serde_json::Value 全字段保留:
    let raw_path = std::path::Path::new(&path);
    let raw = std::fs::read_to_string(raw_path).unwrap_or_else(|_| "{}".to_string());
    let mut full: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(obj) = full.as_object_mut() {
        if enabled {
            obj.remove("disabledMcpjsonServers");
        } else {
            obj.insert("disabledMcpjsonServers".to_string(), serde_json::json!(list));
        }
    }
    atomic_write_json(&path, &full).map_err(|e| format!("atomic_write: {}", e))?;
    let _ = state; // suppress unused
    Ok(())
}

// ===== commit 6: skills 6 IPC =====
fn skills_paths() -> (std::path::PathBuf, std::path::PathBuf) {
    let skills = crate::repo::skills_scanner::default_skills_dir();
    let disabled = crate::repo::skills_scanner::default_disabled_skills_dir();
    (skills, disabled)
}

#[tauri::command]
fn cmd_skill_list(_state: tauri::State<crate::db::DbState>) -> Result<Vec<crate::types::Skill>, String> {
    let (s, d) = skills_paths();
    Ok(crate::repo::skills_scanner::list_skills(Some(&s), Some(&d)))
}

#[tauri::command]
fn cmd_skill_get(_state: tauri::State<crate::db::DbState>, name: String) -> Result<Option<crate::types::Skill>, String> {
    let (s, d) = skills_paths();
    Ok(crate::repo::skills_scanner::get_skill(&name, Some(&s), Some(&d)))
}

#[tauri::command]
fn cmd_skill_create(_state: tauri::State<crate::db::DbState>, input: crate::types::SkillCreateInput) -> Result<(), String> {
    let (s, _) = skills_paths();
    crate::repo::skills_writer::create_skill(input, Some(&s))
}

#[tauri::command]
fn cmd_skill_update(_state: tauri::State<crate::db::DbState>, name: String, patch: crate::types::SkillUpdatePatch) -> Result<(), String> {
    let (s, _) = skills_paths();
    crate::repo::skills_writer::update_skill(&name, patch, Some(&s))
}

#[tauri::command]
fn cmd_skill_delete(_state: tauri::State<crate::db::DbState>, name: String) -> Result<(), String> {
    let (s, _) = skills_paths();
    crate::repo::skills_writer::delete_skill(&name, Some(&s))
}

#[tauri::command]
fn cmd_skill_toggle_enabled(_state: tauri::State<crate::db::DbState>, name: String, enabled: bool) -> Result<(), String> {
    let (skills_dir, disabled_dir) = skills_paths();
    let src = if enabled { disabled_dir.clone() } else { skills_dir.clone() };
    let dst = if enabled { skills_dir.clone() } else { disabled_dir.clone() };
    let src_path = src.join(&name);
    let dst_path = dst.join(&name);
    if !src_path.exists() {
        return Err(format!("skill '{}' not found in {}", name, if enabled {"disabled"} else {"main"}));
    }
    std::fs::create_dir_all(&dst).map_err(|e| format!("mkdir: {}", e))?;
    std::fs::rename(&src_path, &dst_path).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

// ===== commit 7: commands 6 IPC =====
#[tauri::command]
fn cmd_command_list(_state: tauri::State<crate::db::DbState>) -> Result<Vec<crate::types::Command>, String> {
    Ok(crate::repo::commands_scanner::list_commands(None))
}

#[tauri::command]
fn cmd_command_get(_state: tauri::State<crate::db::DbState>, name: String) -> Result<Option<crate::types::Command>, String> {
    Ok(crate::repo::commands_scanner::get_command(&name, None))
}

#[tauri::command]
fn cmd_command_create(_state: tauri::State<crate::db::DbState>, input: crate::types::CommandCreateInput) -> Result<(), String> {
    crate::repo::commands_writer::create_command(input, None)
}

#[tauri::command]
fn cmd_command_update(_state: tauri::State<crate::db::DbState>, name: String, patch: crate::types::CommandUpdatePatch) -> Result<(), String> {
    crate::repo::commands_writer::update_command(&name, patch, None)
}

#[tauri::command]
fn cmd_command_delete(_state: tauri::State<crate::db::DbState>, name: String) -> Result<(), String> {
    crate::repo::commands_writer::delete_command(&name, None)
}

#[tauri::command]
fn cmd_command_toggle_enabled(_state: tauri::State<crate::db::DbState>, name: String, enabled: bool) -> Result<(), String> {
    let dir = crate::repo::commands_scanner::default_commands_dir();
    let src = if enabled { dir.join(format!("{}.md.disabled", name)) } else { dir.join(format!("{}.md", name)) };
    let dst = if enabled { dir.join(format!("{}.md", name)) } else { dir.join(format!("{}.md.disabled", name)) };
    if !src.exists() {
        return Err(format!("command '{}' not found in {} state", name, if enabled {"disabled"} else {"enabled"}));
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

// ===== commit 8: sub-agents 6 IPC =====
#[tauri::command]
fn cmd_subagent_list(_state: tauri::State<crate::db::DbState>) -> Result<Vec<crate::types::SubAgent>, String> {
    Ok(crate::repo::agents_scanner::list_sub_agents(None))
}

#[tauri::command]
fn cmd_subagent_get(_state: tauri::State<crate::db::DbState>, name: String) -> Result<Option<crate::types::SubAgent>, String> {
    Ok(crate::repo::agents_scanner::get_sub_agent(&name, None))
}

#[tauri::command]
fn cmd_subagent_create(_state: tauri::State<crate::db::DbState>, input: crate::types::SubAgentCreateInput) -> Result<(), String> {
    crate::repo::agents_writer::create_sub_agent(input, None)
}

#[tauri::command]
fn cmd_subagent_update(_state: tauri::State<crate::db::DbState>, name: String, patch: crate::types::SubAgentUpdatePatch) -> Result<(), String> {
    crate::repo::agents_writer::update_sub_agent(&name, patch, None)
}

#[tauri::command]
fn cmd_subagent_delete(_state: tauri::State<crate::db::DbState>, name: String) -> Result<(), String> {
    crate::repo::agents_writer::delete_sub_agent(&name, None)
}

#[tauri::command]
fn cmd_subagent_toggle_enabled(_state: tauri::State<crate::db::DbState>, name: String, enabled: bool) -> Result<(), String> {
    let dir = crate::repo::agents_scanner::default_agents_dir();
    let src = if enabled { dir.join(format!("{}.md.disabled", name)) } else { dir.join(format!("{}.md", name)) };
    let dst = if enabled { dir.join(format!("{}.md", name)) } else { dir.join(format!("{}.md.disabled", name)) };
    if !src.exists() {
        return Err(format!("agent '{}' not found in {} state", name, if enabled {"disabled"} else {"enabled"}));
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

// ===== commit 9: hooks 6 IPC =====
#[tauri::command]
fn cmd_hook_list(_state: tauri::State<crate::db::DbState>) -> Result<Vec<crate::types::Hook>, String> {
    Ok(crate::repo::hooks_scanner::list_hooks(Some(&mcp_settings_path())))
}

#[tauri::command]
fn cmd_hook_get(_state: tauri::State<crate::db::DbState>, id: String) -> Result<Option<crate::types::Hook>, String> {
    Ok(crate::repo::hooks_scanner::get_hook(&id, Some(&mcp_settings_path())))
}

#[tauri::command]
fn cmd_hook_create(_state: tauri::State<crate::db::DbState>, input: crate::types::HookCreateInput) -> Result<(), String> {
    crate::repo::hooks_writer::create_hook(input, Some(&mcp_settings_path()))
}

#[tauri::command]
fn cmd_hook_update(_state: tauri::State<crate::db::DbState>, id: String, patch: crate::types::HookUpdatePatch) -> Result<(), String> {
    // id 格式 "<event>-<index>", 解析
    let parts: Vec<&str> = id.rsplitn(2, '-').collect();
    if parts.len() != 2 {
        return Err(format!("invalid hook id '{}'", id));
    }
    let event = parts[1].to_string();
    let index: usize = parts[0].parse().map_err(|_| format!("invalid index in '{}'", id))?;
    crate::repo::hooks_writer::update_hook(&event, index, patch, Some(&mcp_settings_path()))
}

#[tauri::command]
fn cmd_hook_delete(_state: tauri::State<crate::db::DbState>, id: String) -> Result<(), String> {
    let parts: Vec<&str> = id.rsplitn(2, '-').collect();
    if parts.len() != 2 {
        return Err(format!("invalid hook id '{}'", id));
    }
    let event = parts[1].to_string();
    let index: usize = parts[0].parse().map_err(|_| format!("invalid index in '{}'", id))?;
    crate::repo::hooks_writer::delete_hook(&event, index, Some(&mcp_settings_path()))
}

#[tauri::command]
fn cmd_hook_toggle_enabled(_state: tauri::State<crate::db::DbState>, id: String, enabled: bool) -> Result<(), String> {
    let parts: Vec<&str> = id.rsplitn(2, '-').collect();
    if parts.len() != 2 {
        return Err(format!("invalid hook id '{}'", id));
    }
    let event = parts[1].to_string();
    let index: usize = parts[0].parse().map_err(|_| format!("invalid index in '{}'", id))?;
    use crate::util::settings_reader::{read_claude_settings, ClaudeSettings};
    use crate::util::atomic_write::atomic_write_json;
    let path = mcp_settings_path();
    let mut settings: ClaudeSettings = read_claude_settings(&path).unwrap_or_default();
    let Some(hooks_map) = settings.hooks.as_mut() else { return Err("no hooks".into()); };
    let Some(entries) = hooks_map.get_mut(&event) else { return Err(format!("event '{}' not found", event)); };
    if index >= entries.len() { return Err(format!("index {} out of range", index)); }
    if !enabled {
        // 软删: splice remove
        entries.remove(index);
    } else {
        // 重新 enable: 需要从 removed list 拿回,简化版仅返回成功即可
        return Err("enable not implemented in MVP; re-create the hook".into());
    }
    // 写整个 settings, 保留其他字段
    let raw_path = std::path::Path::new(&path);
    let raw = std::fs::read_to_string(raw_path).unwrap_or_else(|_| "{}".to_string());
    let mut full: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(obj) = full.as_object_mut() {
        obj.insert("hooks".to_string(), serde_json::to_value(&hooks_map).unwrap_or(serde_json::Value::Null));
    }
    atomic_write_json(&path, &full).map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

// ===== commit 10: plugins 6 IPC =====
#[tauri::command]
fn cmd_plugin_list(_state: tauri::State<crate::db::DbState>) -> Result<Vec<crate::types::Plugin>, String> {
    Ok(crate::repo::plugins_scanner::list_plugins(Some(&mcp_settings_path()), None, None))
}

#[tauri::command]
fn cmd_plugin_get(_state: tauri::State<crate::db::DbState>, full_name: String) -> Result<Option<crate::types::Plugin>, String> {
    Ok(crate::repo::plugins_scanner::get_plugin(&full_name, Some(&mcp_settings_path()), None, None))
}

#[tauri::command]
fn cmd_plugin_create(_state: tauri::State<crate::db::DbState>, input: crate::types::PluginCreateInput) -> Result<(), String> {
    crate::repo::plugins_writer::create_plugin(input, None)
}

#[tauri::command]
fn cmd_plugin_update(_state: tauri::State<crate::db::DbState>, full_name: String, patch: crate::types::PluginUpdatePatch) -> Result<(), String> {
    crate::repo::plugins_writer::update_plugin(&full_name, patch, None)
}

#[tauri::command]
fn cmd_plugin_delete(_state: tauri::State<crate::db::DbState>, full_name: String) -> Result<(), String> {
    crate::repo::plugins_writer::delete_plugin(&full_name, None)
}

#[tauri::command]
fn cmd_plugin_toggle_enabled(_state: tauri::State<crate::db::DbState>, full_name: String, enabled: bool) -> Result<(), String> {
    use crate::util::settings_reader::read_claude_settings;
    use crate::util::atomic_write::atomic_write_json;
    let path = mcp_settings_path();
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());
    let mut full: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    let obj = full.as_object_mut().ok_or("settings not object")?;
    let enabled_dict = obj.entry("enabledPlugins".to_string()).or_insert(serde_json::json!({}));
    let enabled_map = enabled_dict.as_object_mut().ok_or("enabledPlugins not object")?;
    enabled_map.insert(full_name.clone(), serde_json::json!(enabled));
    atomic_write_json(&path, &full).map_err(|e| format!("atomic_write: {}", e))?;
    let _ = read_claude_settings; // suppress unused
    Ok(())
}

// ===== commit 11: profiles 6 IPC =====
#[tauri::command]
fn cmd_profile_list(state: tauri::State<crate::db::DbState>) -> Result<Vec<crate::repo::profiles::types::ProfileSummary>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::profiles::list(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_profile_get(state: tauri::State<crate::db::DbState>, id: i64) -> Result<Option<crate::repo::profiles::types::ProfileSnapshot>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::profiles::get(&db, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_profile_create(
    state: tauri::State<crate::db::DbState>,
    name: String,
) -> Result<crate::repo::profiles::types::ProfileSnapshot, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    // commit 27 修 D29: CaptureOptions::default() = 7 字段全 None, scanner
    // 内部 default*Dir() 自动走 ~/.claude/skills 等生产路径。from_base_dir
    // 是 test fixture 工厂(接 TempDir 根), 之前被误用为生产路径, 导致
    // capture 期望 ~/mcp.json (实际 ~/.claude.json), 0 项启用。
    let opts = crate::repo::profiles::capture::CaptureOptions::default();
    crate::repo::profiles::create(&db, &name, &opts).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_profile_apply(
    state: tauri::State<crate::db::DbState>,
    id: i64,
) -> Result<crate::repo::profiles::types::ApplyResult, String> {
    // commit 27 修 D29: 改 ApplyOptions::default() 走生产路径(同 cmd_profile_create)
    let opts = crate::repo::profiles::apply::ApplyOptions::default();
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::profiles::apply(&db, id, &opts).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_profile_delete(state: tauri::State<crate::db::DbState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::profiles::delete(&db, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_profile_diff(
    state: tauri::State<crate::db::DbState>,
    id: i64,
) -> Result<crate::repo::profiles::types::ProfileDiff, String> {
    // commit 27 修 D29: 改 DiffOptions::default() 走生产路径(同 cmd_profile_create)
    let opts = crate::repo::profiles::diff::DiffOptions::default();
    let db = state.0.lock().map_err(|e| e.to_string())?;
    crate::repo::profiles::diff(&db, id, &opts).map_err(|e| e.to_string())
}

// ===== commit 12: usage 6 IPC (只读聚合) =====
#[tauri::command]
fn cmd_usage_summary(
    state: tauri::State<crate::db::DbState>,
    range_days: Option<i64>,
) -> Result<crate::repo::usage::UsageSummary, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    Ok(crate::repo::usage::usage_summary(&db, range_days.unwrap_or(30)))
}

#[tauri::command]
fn cmd_usage_get_session_cost(
    state: tauri::State<crate::db::DbState>,
    session_id: String,
) -> Result<Option<crate::repo::usage::SessionCost>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    Ok(crate::repo::usage::get_session_cost(&db, &session_id))
}

#[tauri::command]
fn cmd_usage_get_session_timeline(
    state: tauri::State<crate::db::DbState>,
    session_id: String,
) -> Result<Option<crate::repo::usage::SessionTimeline>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    Ok(crate::repo::usage::get_session_timeline(&db, &session_id))
}

#[tauri::command]
fn cmd_usage_get_project_breakdown(
    state: tauri::State<crate::db::DbState>,
    project_id: i64,
) -> Result<Option<crate::repo::usage::UsageByProjectRow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    Ok(crate::repo::usage::get_project_breakdown(&db, project_id))
}

#[tauri::command]
fn cmd_usage_get_daily_breakdown(
    state: tauri::State<crate::db::DbState>,
    range_days: Option<i64>,
) -> Result<Vec<crate::repo::usage::UsageByDayRow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    Ok(crate::repo::usage::get_daily_breakdown(&db, range_days.unwrap_or(30)))
}

#[tauri::command]
fn cmd_usage_get_top_tools(
    state: tauri::State<crate::db::DbState>,
    limit: Option<i64>,
) -> Result<Vec<crate::repo::usage::UsageByToolRow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    Ok(crate::repo::usage::get_top_tools(&db, limit.unwrap_or(10)))
}

// ===== v1.2 c2: cc-pet IPC handlers =====

#[tauri::command]
async fn cmd_pet_install_status_hook(app: tauri::AppHandle) -> Result<crate::pet::state::InstallResult, String> {
    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let secret = crate::pet::install::secret_load_or_create(&app_data_dir)?;

    let settings_path = home::home_dir()
        .map(|h| h.join(".claude").join("settings.json"))
        .ok_or_else(|| "home_dir not found".to_string())?;

    let emit_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .map(|p| p.join(if cfg!(windows) { "cc-status-emit.exe" } else { "cc-status-emit" }))
        .ok_or_else(|| "exe parent dir not found".to_string())?;

    if !emit_path.is_file() {
        return Err(format!(
            "Agent Status Hook 辅助程序缺失: {}。请重新安装完整的 cc-manager 安装包。",
            emit_path.display()
        ));
    }

    crate::pet::install::install_status_hooks(
        &settings_path,
        &secret,
        &emit_path,
        crate::repo::hooks_scanner::HOOK_EVENTS,
    )
}

#[tauri::command]
async fn cmd_pet_uninstall_status_hook(_app: tauri::AppHandle) -> Result<crate::pet::state::UninstallResult, String> {
    let settings_path = home::home_dir()
        .map(|h| h.join(".claude").join("settings.json"))
        .ok_or_else(|| "home_dir not found".to_string())?;
    crate::pet::install::uninstall_status_hooks(&settings_path)
}

#[tauri::command]
async fn cmd_pet_window_open(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    if let Some(existing) = app.get_webview_window("pet") {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "pet",
        tauri::WebviewUrl::App("pet.html".into()),
    )
    .title("cc-pet")
    .inner_size(224.0, 252.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .transparent(true)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn cmd_pet_window_close(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("pet") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn cmd_pet_get_status(
    state: tauri::State<std::sync::Arc<crate::pet::daemon::PetStateDaemon>>,
) -> Result<Vec<crate::pet::state::AgentStateEvent>, String> {
    Ok(state.snapshot())
}

pub mod db;
pub mod importer;
pub mod pet;       // v1.2 c1 — cc-pet state + types
pub mod repo;
pub mod util;
pub mod types;
pub mod watcher;

#[cfg(test)]
mod importer_tests;

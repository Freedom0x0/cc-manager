#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // DB 初始化:用 app_data_dir 单一来源(spec §3.2)
  tauri::Builder::default()
    .setup(|app| {
      use tauri::Manager;
      let app_data_dir = app.path().app_data_dir()?;
      let db = crate::db::init_db(&app_data_dir)?;
      app.manage(crate::db::DbState::new(db));
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

pub mod db;
pub mod repo;
pub mod util;
pub mod types;

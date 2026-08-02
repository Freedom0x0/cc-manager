#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![hello_world])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// v4.0 commit 0 验证用 command。后续 commit 会删掉换成 list_projects 等真实 command。
#[tauri::command]
fn hello_world() -> &'static str {
  "cc-session-manager v4.0 (Tauri 2)"
}

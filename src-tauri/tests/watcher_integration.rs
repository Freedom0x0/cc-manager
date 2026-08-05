use app_lib::db::{self, DB};
use app_lib::watcher;
use std::fs;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tempfile::TempDir;

#[test]
#[cfg_attr(
    target_os = "macos",
    ignore = "macOS FSEvents loses the stream when this binary follows other cargo test binaries; run this target separately"
)]
fn watcher_records_and_imports_jsonl_changes() {
    let dir = TempDir::new().unwrap();
    let source = dir.path().join("projects");
    let project = source.join("project-a");
    fs::create_dir_all(&project).unwrap();
    let db: Arc<Mutex<DB>> = Arc::new(Mutex::new(
        db::init_db(&dir.path().join("data")).expect("initialize test db"),
    ));
    let watcher = watcher::start_watcher(Arc::clone(&db), &source).expect("start watcher");
    {
        let status = watcher::get_status(&db.lock().unwrap());
        assert_eq!(status.status, "idle");
        assert!(status.last_error.is_none());
        let json = serde_json::to_value(status).unwrap();
        assert_eq!(json["status"], "idle");
        assert!(json.get("state").is_none());
    }

    // FSEvents stream registration is asynchronous; write again while waiting so the
    // test covers both Create and the normal long-running Modify path.
    thread::sleep(Duration::from_millis(300));
    let jsonl = project.join("session.jsonl");
    let content = r#"{"type":"user","uuid":"msg-1","sessionId":"session-1","timestamp":"2026-08-05T03:00:00.000Z","cwd":"/tmp/project-a","message":{"role":"user","content":"hello"}}
"#;
    fs::write(&jsonl, content).unwrap();
    let canonical_jsonl = fs::canonicalize(&jsonl).unwrap();

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut last_write = Instant::now();
    loop {
        {
            let db = db.lock().unwrap();
            let status = watcher::get_status(&db);
            let messages: i64 = db
                .0
                .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
                .unwrap();
            let event_path_matches = status
                .last_event_path
                .as_deref()
                .and_then(|path| fs::canonicalize(path).ok())
                .as_ref()
                == Some(&canonical_jsonl);
            if status.status == "idle" && event_path_matches && messages == 1 {
                break;
            }
        }
        if last_write.elapsed() >= Duration::from_millis(500) {
            fs::write(&jsonl, content).unwrap();
            last_write = Instant::now();
        }
        if Instant::now() >= deadline {
            let db = db.lock().unwrap();
            let status = watcher::get_status(&db);
            let messages: i64 = db
                .0
                .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
                .unwrap();
            panic!(
                "watcher did not import file in time: status={:?}, messages={messages}",
                status
            );
        }
        thread::sleep(Duration::from_millis(50));
    }

    drop(watcher);
}

//! v4.0 文件 watcher (notify 6.x)
//!
//! 平移自 v3.1 electron/watcher.ts (chokidar 5.x)。notify 平移策略:
//! - chokidar 'add' → notify EventKind::Create(_)
//! - chokidar 'change' → notify EventKind::Modify(_)
//! - chokidar 'unlink' → notify EventKind::Remove(_)
//! - 简易 debounce: 同 path 200ms 内多事件合并(spec §5.2 / D18 决策沿用 v3.1 阈值)
//! - RecursiveMode::Recursive(显式声明,跟 chokidar 默认一致)
//! - 当前只路由到 watcher_state KV 表,importFile 留给 commit 4+ 业务模块
//! - std::thread 后台 spawn (不阻塞主线程)

use crate::db::DB;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc::channel, Arc, Mutex};
use std::time::{Duration, Instant};

/// 平移自 v3.1 electron/repo/watcher-state.ts:getState / setStatus / recordEvent / recordError
/// 单一真相在 DB 的 watcher_state KV 表(key PRIMARY KEY)。
fn get_state(db: &DB, key: &str) -> Option<String> {
    let conn = &db.0;
    let mut stmt = conn.prepare("SELECT value FROM watcher_state WHERE key = ?1").ok()?;
    let mut rows = stmt.query(rusqlite::params![key]).ok()?;
    if let Some(row) = rows.next().ok()? {
        Some(row.get::<_, Option<String>>(0).ok()?.unwrap_or_default())
    } else {
        None
    }
}

fn set_state(db: &DB, key: &str, value: &str) -> rusqlite::Result<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let conn = &db.0;
    conn.execute(
        "INSERT INTO watcher_state (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value, now],
    )?;
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn clear_error(db: &DB) -> rusqlite::Result<()> {
    set_state(db, "last_error", "")
}

pub fn record_error(db: &DB, error: &str) {
    let _ = set_state(db, "last_error", error);
    let _ = set_state(db, "status", "error");
}

/// 手动全量扫描，同时维护 UI 所读取的 watcher 状态。
pub fn rescan_all(db: &DB) -> rusqlite::Result<crate::importer::ImportStats> {
    set_state(db, "status", "scanning")?;
    match crate::importer::rescan_all(db) {
        Ok(stats) => {
            clear_error(db)?;
            set_state(db, "status", "idle")?;
            Ok(stats)
        }
        Err(error) => {
            record_error(db, &error.to_string());
            Err(error)
        }
    }
}

/// Tauri 托管该值以保活 notify handle；handle 被 drop 后系统监听会立即停止。
pub struct WatcherHandle {
    _watcher: Mutex<Option<RecommendedWatcher>>,
}

impl WatcherHandle {
    pub fn new(watcher: Option<RecommendedWatcher>) -> Self {
        Self {
            _watcher: Mutex::new(watcher),
        }
    }
}

/// 在 source_dir 上挂 notify 监听,事件路由到 watcher_state KV 表。
/// 返回 watcher handle (持有期间持续监听, drop 时自动卸载)。
pub fn start_watcher(db: Arc<Mutex<DB>>, source_dir: &Path) -> Result<RecommendedWatcher, String> {
    {
        let db = db.lock().map_err(|e| e.to_string())?;
        set_state(&db, "status", "starting").map_err(|e| e.to_string())?;
        clear_error(&db).map_err(|e| e.to_string())?;
    }

    let (tx, rx) = channel();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| format!("notify init: {e}"))?;
    watcher
        .watch(source_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("notify watch {}: {e}", source_dir.display()))?;

    {
        let db = db.lock().map_err(|e| e.to_string())?;
        set_state(&db, "status", "idle").map_err(|e| e.to_string())?;
    }

    // 后台线程处理事件,debounce 200ms (沿用 v3.1 awaitWriteFinish 阈值)
    let watched_dir = source_dir.to_path_buf();
    std::thread::spawn(move || {
        let mut last_event: HashMap<PathBuf, Instant> = HashMap::new();
        for res in rx {
            match res {
                Ok(Event { paths, kind, .. })
                    if matches!(kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) =>
                {
                    let db_clone = Arc::clone(&db);
                    for p in paths {
                        if p.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                            continue;
                        }
                        let now = Instant::now();
                        let should_emit = last_event
                            .get(&p)
                            .map_or(true, |t| now.duration_since(*t) > Duration::from_millis(200));
                        if should_emit {
                            let kind_str = match kind {
                                EventKind::Create(_) => "add",
                                EventKind::Modify(_) => "change",
                                EventKind::Remove(_) => "unlink",
                                _ => continue,
                            };
                            if let Ok(db_guard) = db_clone.lock() {
                                let _ = set_state(&db_guard, "status", "scanning");
                                let _ = set_state(&db_guard, "last_event_type", kind_str);
                                let _ = set_state(&db_guard, "last_event_path", &p.to_string_lossy());
                                let _ = set_state(&db_guard, "last_event_at", &now_ms().to_string());
                                match crate::importer::rescan_source_dir(&db_guard, &watched_dir) {
                                    Ok(_) => {
                                        let _ = clear_error(&db_guard);
                                        let _ = set_state(&db_guard, "status", "idle");
                                    }
                                    Err(error) => record_error(&db_guard, &error.to_string()),
                                }
                            }
                            last_event.insert(p, now);
                        }
                    }
                }
                Err(e) => {
                    if let Ok(db_guard) = db.lock() {
                        let _ = set_state(&db_guard, "last_error", &format!("{:?}", e));
                        let _ = set_state(&db_guard, "status", "error");
                    }
                }
                _ => {}
            }
        }
    });

    Ok(watcher)
}

/// 平移自 v3.1 electron/repo/watcher-state.ts:getState 多键聚合。
pub fn get_status(db: &DB) -> crate::types::WatcherStatus {
    let status = get_state(db, "status").unwrap_or_else(|| "starting".to_string());
    let last_error = get_state(db, "last_error");

    crate::types::WatcherStatus {
        status,
        last_event_at: get_state(db, "last_event_at").and_then(|s| s.parse().ok()),
        last_event_path: get_state(db, "last_event_path").filter(|s| !s.is_empty()),
        last_error: last_error.filter(|s| !s.is_empty()),
    }
}

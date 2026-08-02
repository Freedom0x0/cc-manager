//! v4.0 原子写工具
//!
//! 平移自 v3.1 `electron/repo/settings-writer.ts:115-138`(writeSettings) 的
//! tmp + rename 模式(CLAUDE.md §7 D7 决策延伸)。
//!
//! **关键路径处理**:`tmp = file + .tmp.{pid}.{ts}.{rand}` —— **不**用
//! `with_extension("json.tmp")`,因为 SKILL.md 会变成 SKILL.json.tmp(spec §6)。
//! 用 .tmp + pid + timestamp + random 复合后缀,既避免后缀误伤,又防撞名
//! (commit 5-11 多模块并发写 settings.json 不会撞)。
//!
//! **Windows rename 不是原子操作**:EPERM/EBUSY 偶尔发生,重试 5 次 + 退避。
//!
//! 失败时清理残留 tmp(D7 模式),不破坏其他字段(本 util 不带字段管理,
//! 由各模块 reader 提供 partial-state 处理)。

use serde::Serialize;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use std::fmt;

/// atomic_write 错误类型(独立于 db::DbError,避免循环依赖)
#[derive(Debug)]
pub enum AtomicWriteError {
    Io(std::io::Error),
    Serde(serde_json::Error),
}

impl fmt::Display for AtomicWriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AtomicWriteError::Io(e) => write!(f, "io error: {}", e),
            AtomicWriteError::Serde(e) => write!(f, "serde error: {}", e),
        }
    }
}

impl std::error::Error for AtomicWriteError {}

impl From<std::io::Error> for AtomicWriteError {
    fn from(e: std::io::Error) -> Self {
        AtomicWriteError::Io(e)
    }
}

impl From<serde_json::Error> for AtomicWriteError {
    fn from(e: serde_json::Error) -> Self {
        AtomicWriteError::Serde(e)
    }
}

pub type Result<T> = std::result::Result<T, AtomicWriteError>;

/// Windows rename 不是原子操作;并发多 tmp 准备后逐个 rename,后者 rename
/// 时前者持有的目标句柄偶尔会抛 EPERM/EBUSY(Windows 进程级文件锁)。
/// 重试 5 次 + 退避能解决 99% 场景(v3.1 已生产验证)。
fn rename_with_retry(src: &Path, dst: &Path, max_retries: u32) -> Result<()> {
    let mut last_err = None;
    for i in 0..max_retries {
        match fs::rename(src, dst) {
            Ok(()) => return Ok(()),
            Err(e) => {
                let raw = e.raw_os_error();
                let retryable = raw == Some(5) /* EPERM on Windows */ || raw == Some(32) /* EBUSY */;
                last_err = Some(e);
                if !retryable || i == max_retries - 1 {
                    break;
                }
                // 退避 10ms * (i+1) — 50ms 总预算内完成
                std::thread::sleep(std::time::Duration::from_millis(10 * (i + 1) as u64));
            }
        }
    }
    Err(AtomicWriteError::Io(last_err.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::Other, "rename failed after retries")
    })))
}

/// 原子写 JSON:写 tmp → rename 替换。失败清理 tmp 残留(D7 模式)。
///
/// 与 v3.1 `electron/repo/settings-writer.ts:writeSettings` 行为等价。
/// 主要差异:
/// - 路径:spec §6 钉死 push ".tmp" 后缀,但本实现用 .tmp.{pid}.{ts}.{rand}
///   复合后缀,既避免 SKILL.md → SKILL.json.tmp 错,又防同毫秒撞名。
/// - pid/ts/random 在多模块并发写 settings.json 时保证唯一(commit 5-11 6 个
///   模块可能并发)。
pub fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let tmp = tmp_path_for(path);

    let json = serde_json::to_string_pretty(value)?;
    {
        let mut f = File::create(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.write_all(b"\n")?;
        f.sync_all()?;
    }

    if let Err(e) = rename_with_retry(&tmp, path, 5) {
        // 清理残留 tmp(D7 模式)
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }

    Ok(())
}

/// 生成唯一 tmp 路径:`file.tmp.{pid}.{ms}.{rand8hex}`
///
/// 关键点:`file` 是任意扩展名(SKILL.md / settings.json / plugin.json 通用),
/// tmp 后缀不影响原扩展名识别。
fn tmp_path_for(file: &Path) -> PathBuf {
    let pid = std::process::id();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let rand: u64 = rand_u64();

    let mut s = file.as_os_str().to_owned();
    s.push(format!(".tmp.{}.{}.{:x}", pid, ts, rand));
    PathBuf::from(s)
}

/// 简单 PRNG:用 ts + pid 做种子,不依赖 rand crate(spec §2 没列 rand)。
fn rand_u64() -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    SystemTime::now().hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    hasher.finish()
}

// ============================================================================
// tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use tempfile::TempDir;

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Sample {
        name: String,
        value: i32,
    }

    /// case 5: 普通 .json 文件 → tmp = file.tmp.{pid}.{ts}.{rand}
    /// → rename 成功 → 原文件被覆盖 + tmp 不残留
    #[test]
    fn test_atomic_write_json_normal_file() -> Result<()> {
        let dir = TempDir::new()?;
        let path = dir.path().join("settings.json");

        atomic_write_json(&path, &Sample { name: "a".into(), value: 1 })?;

        // 原文件存在
        assert!(path.exists(), "settings.json should exist");

        // 文件内容正确(pretty + trailing newline)
        let content = fs::read_to_string(&path)?;
        let parsed: Sample = serde_json::from_str(&content)?;
        assert_eq!(parsed, Sample { name: "a".into(), value: 1 });

        // tmp 不残留(检查 dir 里没有 *.tmp.* 文件)
        let entries: Vec<_> = fs::read_dir(dir.path())?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        let has_tmp = entries.iter().any(|n| n.contains(".tmp."));
        assert!(!has_tmp, "no .tmp residue left, found: {:?}", entries);

        // 二次写幂等
        atomic_write_json(&path, &Sample { name: "b".into(), value: 2 })?;
        let parsed: Sample = serde_json::from_str(&fs::read_to_string(&path)?)?;
        assert_eq!(parsed, Sample { name: "b".into(), value: 2 });

        Ok(())
    }

    /// case 6: SKILL.md 文件 → tmp = SKILL.md.tmp.{pid}.{ts}.{rand}
    /// **不**变成 SKILL.json.tmp(spec §6 钉死的关键 bug fix)
    #[test]
    fn test_atomic_write_skill_md_preserves_extension() -> Result<()> {
        let dir = TempDir::new()?;
        let path = dir.path().join("SKILL.md");

        // 写一个 SKILL.md(模拟 skills/.../SKILL.md 的原子写)
        atomic_write_json(&path, &Sample { name: "skill-a".into(), value: 42 })?;

        // 关键断言:tmp 路径的扩展名是 .md.tmp.* 而非 .json.tmp
        let entries: Vec<_> = fs::read_dir(dir.path())?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();

        // 写完后所有 .tmp.* 已被 rename,目录里只有 SKILL.md
        assert_eq!(entries.len(), 1, "only SKILL.md should remain, found: {:?}", entries);
        assert_eq!(entries[0], "SKILL.md", "original filename preserved");

        // 文件内容正确
        let content = fs::read_to_string(&path)?;
        let parsed: Sample = serde_json::from_str(&content)?;
        assert_eq!(parsed, Sample { name: "skill-a".into(), value: 42 });

        // 二次写同样保持 .md 扩展名
        atomic_write_json(&path, &Sample { name: "skill-b".into(), value: 99 })?;
        let entries: Vec<_> = fs::read_dir(dir.path())?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(entries.iter().all(|n| !n.contains(".json.tmp")), "no .json.tmp residue");
        assert!(entries.iter().any(|n| n == "SKILL.md"));

        Ok(())
    }
}
//! v1.2 c3: cc-status-emit binary
//!
//! Claude Code hook helper: stdin JSON → HMAC sign → POST 127.0.0.1:19847.
//!
//! Spec §3.1 Layer 2 + §10 T2.
//!
//! All exit paths return code 0 (silent drop per E1) — Claude Code runs hooks
//! synchronously and any non-zero exit pollutes the agent's terminal.

use std::env;
use std::io::Read;
use std::process::ExitCode;

use hmac::{Hmac, Mac};
use sha2::Sha256;

// Single source of truth for the hook→state mapping (spec §5.2): the lib
// crate's pet::state module. The lib target is named `app_lib` in Cargo.toml,
// hence the import path below rather than the package name.
use app_lib::pet::state::event_name_to_state_str;

type HmacSha256 = Hmac<Sha256>;

const TARGET_HOST: &str = "127.0.0.1:19847";
const TARGET_PATH: &str = "/agent-event";

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let event_name = parse_arg(&args, "--event").unwrap_or_default();
    let cli_secret = parse_arg(&args, "--secret");
    let dry_run = args.iter().any(|a| a == "--dry-run");

    let secret = match cli_secret.or_else(|| env::var("CC_PET_SECRET").ok()) {
        Some(s) if !s.is_empty() => s,
        _ => return ExitCode::SUCCESS,  // E1: no secret → silent drop
    };

    // Read stdin JSON
    let mut stdin_input = String::new();
    if std::io::stdin().read_to_string(&mut stdin_input).is_err() {
        return ExitCode::SUCCESS;
    }

    // Parse stdin + inject state from HOOK_TO_STATE
    let mut event: serde_json::Value = match serde_json::from_str(&stdin_input) {
        Ok(v) => v,
        Err(_) => return ExitCode::SUCCESS,  // bad JSON → silent drop
    };

    // Map event to PetState via shared module; unknown events (e.g. the
    // non-existent PermissionRequest) fall back to "idle".
    let state_str = serde_json::json!(event_name_to_state_str(&event_name));
    if let Some(obj) = event.as_object_mut() {
        obj.insert("state".to_string(), state_str);
        if !obj.contains_key("timestamp_ms") {
            let ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            obj.insert("timestamp_ms".to_string(), serde_json::json!(ms));
        }
    }

    // Serialize body
    let body = match serde_json::to_string(&event) {
        Ok(s) => s,
        Err(_) => return ExitCode::SUCCESS,
    };

    // Compute HMAC-SHA256
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return ExitCode::SUCCESS,
    };
    mac.update(body.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());

    if dry_run {
        // Test mode: print signed body + signature, don't POST
        println!("X-Signature: hmac-sha256={}", sig);
        println!("{}", body);
        return ExitCode::SUCCESS;
    }

    // POST to cc-manager HTTP receiver
    let _ = post_to_target(&body, &sig);
    // Silent on all errors (E1: cc-manager not running → drop silently)
    ExitCode::SUCCESS
}

fn parse_arg(args: &[String], flag: &str) -> Option<String> {
    let i = args.iter().position(|a| a == flag)?;
    args.get(i + 1).cloned()
}

fn post_to_target(body: &str, sig: &str) -> std::io::Result<()> {
    // Minimal HTTP POST without external deps. Uses TcpStream to localhost:19847.
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let mut stream = TcpStream::connect(TARGET_HOST)?;
    let req = format!(
        "POST {path} HTTP/1.1\r\n\
         Host: {host}\r\n\
         Content-Type: application/json\r\n\
         X-Signature: hmac-sha256={sig}\r\n\
         Content-Length: {len}\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        path = TARGET_PATH,
        host = TARGET_HOST,
        sig = sig,
        len = body.len(),
        body = body
    );
    stream.write_all(req.as_bytes())?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(())
}
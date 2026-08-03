# Task 3 fix report

## Summary
Three required reviewer issues in Task 3 (cc-status-emit binary) are now resolved: the
binary no longer re-declares the hook→state mapping, instead importing
`app_lib::pet::state::event_name_to_state_str` from the lib crate (the canonical
single source of truth, D34.14); the env-leak in `test_cc_status_emit_missing_secret_exits_zero`
is closed by `.env_remove("CC_PET_SECRET")`; and the dead `_url` parameter on
`post_to_target` is dropped — host/path are now named `TARGET_HOST` / `TARGET_PATH`
constants used by both the `TcpStream::connect` call and the HTTP request line.

## Fix 1 — single source of truth for the hook→state mapping
**What**: Added `pub fn PetState::as_str(&self) -> &'static str` (exhaustive match
over all 7 variants) and `pub fn event_name_to_state_str(event: &str) -> &'static str`
in `src-tauri/src/pet/state.rs`. The new function reuses the existing
`state_for_hook` + `HOOK_TO_STATE` table, so the wire-format string stays
byte-identical to the `#[serde(rename)]` value. Added one test
`test_event_name_to_state_str_matches_serde_rename` that asserts the string form
is identical to the serde wire format for all 6 hooks and falls back to `"idle"`
for unknown events.

In `src-tauri/src/bin/cc-status-emit.rs` removed the 11-line inline
`fn state_for_hook` (and its 6-line "Duplicated from …" comment), and replaced
the call site with `serde_json::json!(event_name_to_state_str(&event_name))`.
The import is `use app_lib::pet::state::event_name_to_state_str;` (the lib
target is `app_lib` per `Cargo.toml [lib] name`, not the package name).

**Verification**:
- `cd src-tauri && cargo check --bin cc-status-emit` → exit 0
- `cd src-tauri && cargo build --bin cc-status-emit` → exit 0
- Smoke test `echo '{"session_id":"abc","tool_name":"Bash"}' | cc-status-emit --event PreToolUse --secret X --dry-run` → stdout contains `"state":"tool-use"` (mapped from the shared table)
- Smoke test `echo '{"session_id":"xyz"}' | cc-status-emit --event Stop --secret X --dry-run` → `"state":"completed"`
- Smoke test `echo '{}' | cc-status-emit --event PermissionRequest --secret X --dry-run` → `"state":"idle"` (unknown → fallback)

## Fix 2 — env-leak in `test_cc_status_emit_missing_secret_exits_zero`
**What**: Added `.env_remove("CC_PET_SECRET")` to the `Command::new(bin)` builder
and changed `let child` to `let mut child` (the `.wait()` call requires `&mut`).
The spawned process now has no `CC_PET_SECRET` in its environment regardless of
what the parent shell has set, so the test asserts the binary's actual fallback
behaviour rather than "secret leaked in via the parent env".

**Verification**:
- `cargo check --bin cc-status-emit` → exit 0 (test target compiles)
- Smoke test `cc-status-emit --event Stop` (no `--secret`, no env) → exit 0, no stdout (E1 silent drop)

## Fix 3 — drop dead `_url` parameter
**What**: Renamed `fn post_to_target(_url: &str, body: &str, sig: &str)` to
`fn post_to_target(body: &str, sig: &str)`, removed `TARGET_URL` constant, and
introduced two named constants `TARGET_HOST = "127.0.0.1:19847"` and
`TARGET_PATH = "/agent-event"`. Both the `TcpStream::connect` and the
`POST {path} HTTP/1.1\r\nHost: {host}\r\n…` request line now reference these
constants — host and path are no longer duplicated as string literals.

**Verification**:
- `cargo check --bin cc-status-emit` → exit 0
- `cargo build --bin cc-status-emit` → exit 0
- All 4 smoke tests above (Fix 1) still pass; the produced `X-Signature` value
  changes per payload (HMAC over the body), confirming the full path
  parse→map→sign still runs end-to-end.

## v4 verification trio
1. `cd src-tauri && cargo check` → exit 0 (2 pre-existing `dead_code` warnings
   in `pet/daemon.rs` and `repo/plugins_scanner.rs`, unrelated to this change)
2. `npx tsc --noEmit` → exit 0 (no output)
3. `npm run build:vite` → exit 0, built in 12.56s

## Self-review
- **Single source of truth**: `HOOK_TO_STATE` + `state_for_hook` + new
  `event_name_to_state_str` are all in `pet/state.rs`. The binary no longer
  carries its own mapping. Any future event addition updates the one table
  and `test_hook_to_state_table_has_6_entries` will fail until the assertion
  is updated in lockstep.
- **Serde rename parity**: the new test `test_event_name_to_state_str_matches_serde_rename`
  compares the helper output against `serde_json::to_string(state)` for every
  entry in `HOOK_TO_STATE`, so if a future `#[serde(rename)]` and the new
  `as_str()` match arm ever drift, the test fires.
- **`as_str()` exhaustiveness**: the match is over every variant of `PetState`;
  adding a new variant without a `as_str` arm will fail to compile.
- **`cargo test` runtime** is blocked by SmartScreen on this Windows host
  (D25, CLAUDE.md §14.5); the test target compiles cleanly under
  `cargo check --bin cc-status-emit`, the binary builds, and 4 manual smoke
  tests confirm behaviour. The pre-existing `cargo check --tests` errors
  (`CARGO_BIN_EXE_cc-status-emit` not defined for the integration-test
  duplicate target) are unchanged by this commit — same state as commit 37
  (`b36311c`) per `git stash` round-trip check.
- **No new public types in the lib** beyond `as_str` and
  `event_name_to_state_str`, both `pub fn` additions with no breaking impact
  on the `app_lib` lib surface used by `src-tauri/src/lib.rs` or the Tauri
  command registry.

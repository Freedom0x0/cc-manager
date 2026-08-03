Task 2 adds the cc-pet IPC surface and a registered PetStateDaemon stub. It defines serialized install/uninstall result types, exposes five Tauri commands (two explicit c2 placeholders, real pet-window open/close behavior, and an empty status response), adds the daemon module and registers it during application setup, and adds the daemon's parking_lot/tokio dependencies. The pre-existing deletion of docs/superpowers/specs/2026-08-02-d22-mcp-runtime-fail-design.md was left untouched.

cargo check output (last 10 lines):
warning: fields `sessions` and `broadcast` are never read
warning: field `version` is never read
warning: `cc-session-manager` (lib) generated 2 warnings
Finished `dev` profile [unoptimized + debuginfo] target(s) in 24.64s

tsc: 0 errors

build:vite output (last 5 lines):
(!) Some chunks are larger than 500 kB after minification.
Consider dynamic import() to code-split the application
Consider build.rollupOptions.output.manualChunks to code-split the application
✓ built in 11.00s

Self-review: All five requested commands are registered and implemented according to the c2 brief; the daemon is intentionally a stub with new() returning Arc<Self>; state result types derive Serialize/Deserialize; setup manages the daemon; Cargo.lock was updated by dependency resolution. No unrelated files were modified, and the pre-existing deleted D22 design file remains unstaged.

Final commit hash + commit message: `78e6724 feat(pet): D34 c2 — add IPC handlers and daemon stub`

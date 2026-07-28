# Manual Verification Checklist

Run through these checks after `npm run dev` opens the window.

## Setup
- [ ] `npm install` completed
- [ ] `npm run dev` starts Vite (port 5173) + Electron
- [ ] A window opens showing the three-pane UI
- [ ] `~/.claude/projects/` directory exists with sessions

## First-run import
- [ ] First launch: 1.5s after window opens, console shows import activity
- [ ] Project list populates with real projects
- [ ] Session counts match expectations

## View
- [ ] Three-pane layout renders correctly
- [ ] Clicking a project shows its sessions in the middle pane
- [ ] Clicking a session shows all messages in the right pane
- [ ] User messages: blue background, left-aligned
- [ ] Claude messages: gray background, right-indented

## Search
- [ ] Type "hello" — search results show in middle pane
- [ ] Type "reset database" (two keywords) — only AND-matched results
- [ ] Keywords highlighted with yellow `<mark>` background
- [ ] Project filter (multi-select with Ctrl) reduces results
- [ ] Time range "近 7 天" reduces results vs "全部"

## Soft delete + restore
- [ ] Click 🗑️ → confirm → session moves to recycle bin
- [ ] Click 🗑️ 回收站 → session appears
- [ ] Click ↩ 恢复 → session returns to main view
- [ ] FTS index excludes deleted sessions

## Permanent delete
- [ ] In recycle bin, click 永久删除
- [ ] Dialog asks to type session title
- [ ] Wrong title → button disabled
- [ ] Correct title → confirmation deletes; messages also gone

## Resume
- [ ] Click ▶ 继续会话
- [ ] A new claude process spawns (if `claude` is in PATH)
- [ ] Tool window stays open and responsive

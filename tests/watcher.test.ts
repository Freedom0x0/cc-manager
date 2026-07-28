import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDB, closeDB } from '../electron/db/connection';
import { startWatcher } from '../electron/watcher';

// Case 1: startWatcher() 初始化成功,不抛错,能在 sandbox 目录上挂上 chokidar 实例并能关闭
test('startWatcher initializes chokidar watcher on a sandbox directory', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-watch-'));
  const dbPath = path.join(tmp, 'app.db');
  const db = initDB(dbPath);
  const watchDir = path.join(tmp, 'watch-target');
  fs.mkdirSync(watchDir, { recursive: true });

  const handle = await startWatcher(db, watchDir);
  // handle 应有 close() 方法(chokidar.FSWatcher 接口)
  assert.strictEqual(typeof handle.close, 'function', 'startWatcher must return a watcher with close()');
  await handle.close();
  closeDB(db);
});

// Case 2: chokidar 事件能更新 watcher_state(add 事件触发 recordEvent → KV 表出现 key='last_event')
test('chokidar add event updates watcher_state via recordEvent', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-watch-evt-'));
  const dbPath = path.join(tmp, 'app.db');
  const db = initDB(dbPath);
  const watchDir = path.join(tmp, 'watch-target');
  fs.mkdirSync(watchDir, { recursive: true });

  const handle = await startWatcher(db, watchDir);
  // 显式等 chokidar 'ready'(避免 awaitWriteFinish 200ms 稳定性窗口导致 add 被吞)
  await new Promise<void>((resolve) => handle.once('ready', () => resolve()));

  // 给监听目录写一个新文件,触发 chokidar 'add' 事件
  fs.writeFileSync(path.join(watchDir, 'new-session.jsonl'), '{"type":"user"}');

  // 等 chokidar 异步派发事件 + recordEvent 写入 watcher_state
  // awaitWriteFinish.stabilityThreshold=200ms,留 3s 缓冲
  let found = false;
  for (let i = 0; i < 30; i++) {
    const row = db
      .prepare("SELECT value FROM watcher_state WHERE key = 'last_event'")
      .get() as { value: string | null } | undefined;
    if (row !== undefined && row.value !== null) {
      found = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await handle.close();
  closeDB(db);
  assert.strictEqual(found, true, "watcher_state['last_event'] should be set after file add");
});

// Case 3: "no polling" 断言 — watcher.ts 源码不含 setInterval 字面量
test('watcher.ts uses chokidar event-driven only (no setInterval polling)', () => {
  const watcherSrc = fs.readFileSync(
    path.resolve('electron/watcher.ts'),
    'utf8'
  );
  // 严格断言:源码不能出现 setInterval(...) 的调用字面量
  // (匹配 "setInterval(" 含开括号,排除注释里"setInterval"的纯文本提及)
  assert.ok(
    !/\bsetInterval\s*\(/.test(watcherSrc),
    'watcher.ts must not contain setInterval(...) — chokidar is event-driven'
  );
  // 更严格:watcher.ts 非注释代码也不能用 setTimeout 当主循环
  const codeOnly = watcherSrc
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(
    !/\bsetTimeout\s*\(/.test(codeOnly),
    'watcher.ts code (excluding comments) must not contain setTimeout(...) — no polling loop'
  );
});
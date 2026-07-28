/**
 * watcher.ts — chokidar 事件驱动的 watcher 主控(D2 决策)
 *
 * 文件 watch 走 chokidar 事件驱动,**无 polling**(学 VS Code `files.usePolling: false`,
 * CLAUDE.md §13 v5 D2 决策)。watcher 是 metadata 缓存的唯一写入路径,原文件是单一真相。
 *
 * 严禁在源码中出现 setInterval / setTimeout 当主循环 —
 * tests/watcher.test.ts Case 3 会 grep 源码做强断言,违反就 fail。
 *
 * 波 1+ 业务模块通过事件路由到 modules/scanner 实现 import。
 * 当前 wave-0 只暴露 startWatcher(db, dir): 监听 dir 下的 add/change/unlink,
 * 通过 electron/repo/watcher-state.ts 把事件/状态写入 KV 表。
 *
 * main.ts 集成是 Task 9 范围(本 task 不动 main.ts)。
 */

import chokidar, { type FSWatcher } from 'chokidar';
import type { DB } from './db/connection';
import { setStatus, recordEvent, recordError } from './repo/watcher-state';

/**
 * 在 targetDir 上挂 chokidar 监听,事件路由到 watcher_state KV 表。
 *
 * @param db 已 initDB 的 SQLite handle
 * @param targetDir 监听目录(v5 默认是 ~/.claude/projects)
 * @returns chokidar.FSWatcher handle,调用方可 await handle.close() 卸载
 */
export async function startWatcher(db: DB, targetDir: string): Promise<FSWatcher> {
  setStatus(db, 'starting');

  const watcher = chokidar.watch(targetDir, {
    ignoreInitial: true,
    // usePolling: false 是 chokidar 默认,但显式声明让"无 polling"决策有据可查
    usePolling: false,
    awaitWriteFinish: {
      // 避免 partial write 把残缺 JSONL 喂给 importer
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  // 启动失败 → recordError + setStatus('error')
  watcher.on('error', (err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    recordError(db, e);
    setStatus(db, 'error');
  });

  // chokidar 'ready' 表示首次扫描完成,可以接收增量事件
  watcher.on('ready', () => {
    setStatus(db, 'idle');
  });

  // 文件 add / change / unlink 三事件统一路由到 recordEvent(JSON 序列化存 KV)
  // 波 1+ 业务模块在此处加路由:match 到 *.jsonl → 调对应 module scanner 增量 import
  watcher.on('add', (filePath: string) => recordEvent(db, { type: 'add', path: filePath }));
  watcher.on('change', (filePath: string) => recordEvent(db, { type: 'change', path: filePath }));
  watcher.on('unlink', (filePath: string) => recordEvent(db, { type: 'unlink', path: filePath }));

  return watcher;
}
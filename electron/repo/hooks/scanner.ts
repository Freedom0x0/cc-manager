/**
 * electron/repo/hooks/scanner.ts — v5 wave-2 Hooks 配置扫描器
 *
 * 读 ~/.claude/settings.json 的 hooks 字段 → 扁平化返 Hook[]。settings.json
 * 嵌套结构:`{ hooks: { PreToolUse: [{matcher, hooks:[{type,command}]}], ... } }`
 *
 * 每条外层数组项扁平化为一个 Hook(每个 matcher+command 对应一个 Hook)。
 * id 字段:`${event}-${index}`(D7 简化决策),list 时扁平化顺序保持 event
 * 内 index 稳定。
 *
 * enabled 状态**不**从 settings.json 读,而是从 mcp_server_state KV 表读
 * (key 前缀 'hook:enabled:<id>')—— D6 决策延伸:用户 toggle 不污染 settings.json。
 *
 * 容错:
 * - settings.json 不存在 → 返 []
 * - JSON 损坏 → 返 [](不抛错,UI 不应崩)
 * - hooks 字段缺失 → 返 []
 * - 单个 hook 缺 command → 跳过(不污染列表)
 *
 * 路径注入:settingsPath 参数允许测试注入 fixture 路径(避免碰真实
 * ~/.claude/settings.json);生产调用方传 defaultSettingsPath() —
 * CLAUDE.md §13 D8 + D10。
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { DB } from '../../db/connection';
import type { Hook, HookEntry, HookEvent } from './types';

/** 默认生产路径 ~/.claude/settings.json。测试通过 settingsPath 参数覆盖。 */
export function defaultSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

/**
 * 读 ~/.claude/settings.json → 解析 hooks 字段 → 扁平化 → enabled 恒为 true
 * (因为 setEnabled(false) 已经 splice 移除,数组里存在 = 启用)
 * → 返 Hook[]。文件不存在或 JSON 损坏或 hooks 字段缺失返 []。
 *
 * @param db 已 initDB 的 SQLite handle(保留作未来扩展,本函数不再读 KV)
 * @param settingsPath 可选:注入 fixture 路径(测试用);默认走 ~/.claude/settings.json
 */
export async function listHooks(db: DB, settingsPath?: string): Promise<Hook[]> {
  void db;
  const file = settingsPath ?? defaultSettingsPath();
  if (!existsSync(file)) return [];
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  let config: { hooks?: Partial<Record<HookEvent, HookEntry[]>> };
  try {
    config = JSON.parse(raw);
  } catch {
    // JSON 损坏:返空(此处不依赖 logger 避免循环 import)
    return [];
  }
  const hooksByEvent = config.hooks ?? {};
  const out: Hook[] = [];
  for (const event of Object.keys(hooksByEvent) as HookEvent[]) {
    const entries = hooksByEvent[event] ?? [];
    entries.forEach((entry, index) => {
      // 单个 hook 缺 command → 跳过(不污染列表)
      const command = entry.hooks?.[0]?.command;
      if (!command) return;
      const id = `${event}-${index}`;
      out.push({
        id,
        event,
        matcher: entry.matcher,
        command,
        // 真实 enabled 状态 = 在 settings.json 数组中存在(本分支已到)
        enabled: true,
        scope: 'global',
      });
    });
  }
  return out;
}

/**
 * 单 hook 查询。id 不存在返 null。id 格式 `${event}-${index}`,
 * event 不在已知事件列表中也返 null。
 */
export async function getHook(
  db: DB,
  id: string,
  settingsPath?: string
): Promise<Hook | null> {
  const list = await listHooks(db, settingsPath);
  return list.find((h) => h.id === id) ?? null;
}

/**
 * electron/repo/mcp/scanner.ts — v5 wave-1 MCP 配置扫描器
 *
 * 只读 ~/.claude.json 的 mcpServers 字段(全局配置);project 级 MCP 配置
 * 留给未来(本 task 范围小,Simplicity First — D6)。
 *
 * v5 wave-3 改造(2026-07-30 PRD real-disable):
 * enabled 状态从 settings.json 的 disabledMcpjsonServers 黑名单反推
 * (getEnabledFromSettings)。**不**再以 KV 表为真理(避免假停用 — D10)。
 *
 * 容错:
 * - 文件不存在 → 返 [] (prd §1 边界 case)
 * - JSON 损坏 → 返 [](不抛错,前端 UI 不应崩)
 * - mcpServers 字段缺失 → 返 [] (视为空配置)
 *
 * 路径注入:`configPath` 参数允许测试注入 fixture 路径(避免碰真实
 * ~/.claude.json);`settingsPath` 注入 settings.json fixture 路径(避免碰
 * 真实 ~/.claude/settings.json)— CLAUDE.md §13 D8 + D10。
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { DB } from '../../db/connection';
import { getEnabledFromSettings } from './state';
import type { McpServer } from './types';

/** 默认生产路径 ~/.claude.json。测试通过 configPath 参数覆盖。 */
export function defaultMcpConfigPath(): string {
  return join(homedir(), '.claude.json');
}

/**
 * 读 ~/.claude.json → 解析 mcpServers → 注入 enabled(从 settings.json 的
 * disabledMcpjsonServers 反推)→ 返 McpServer[]。
 * 文件不存在或 JSON 损坏返 [];其他错误抛。
 *
 * @param db 已 initDB 的 SQLite handle(保留作未来扩展,本函数不再读 KV)
 * @param configPath 可选:注入 fixture 路径(测试用);默认走 ~/.claude.json
 * @param settingsPath 可选:注入 settings.json 路径(测试用);默认走
 *   ~/.claude/settings.json(真停用字段的真实落点 — D10 决策)
 */
export async function listMcpServers(
  db: DB,
  configPath?: string,
  settingsPath?: string
): Promise<McpServer[]> {
  // db 参数保留(向后兼容,未来可能从 KV 读扩展字段)
  void db;
  const file = configPath ?? defaultMcpConfigPath();
  if (!existsSync(file)) return [];
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  let config: { mcpServers?: Record<string, unknown> };
  try {
    config = JSON.parse(raw);
  } catch {
    // JSON 损坏:返空(此处不依赖 logger 避免循环 import)
    return [];
  }
  const servers = config.mcpServers ?? {};
  const disabled = new Set(getEnabledFromSettings(settingsPath));
  return Object.entries(servers).map(([name, cfg]) => {
    const c = cfg as {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      description?: string;
    };
    return {
      name,
      command: c.command ?? '',
      args: c.args ?? [],
      env: c.env,
      description: c.description,
      enabled: !disabled.has(name),
      source: 'global' as const,
    };
  });
}

/**
 * 单 server 查询。name 不存在返 null。
 */
export async function getMcpServer(
  db: DB,
  name: string,
  configPath?: string,
  settingsPath?: string
): Promise<McpServer | null> {
  const list = await listMcpServers(db, configPath, settingsPath);
  return list.find((s) => s.name === name) ?? null;
}

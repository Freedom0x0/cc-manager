/**
 * electron/repo/mcp/scanner.ts — v5 wave-1 MCP 配置扫描器
 *
 * 只读 ~/.claude.json 的 mcpServers 字段(全局配置);project 级 MCP 配置
 * 留给未来(本 task 范围小,Simplicity First — D6)。
 *
 * 返回的 McpServer.enabled **不**从原文件读,而是从 mcp_server_state KV
 * 表读(`enabled:<name>` key)。原文件只存 command/args/env/description;
 * 用户的 toggle 状态独立存,避免破坏原文件 — D6 决策。
 *
 * 容错:
 * - 文件不存在 → 返 [] (prd §1 边界 case)
 * - JSON 损坏 → 返 [](不抛错,前端 UI 不应崩)
 * - mcpServers 字段缺失 → 返 [] (视为空配置)
 *
 * 路径注入:`configPath` 参数允许测试注入 fixture 路径(避免碰真实
 * ~/.claude.json);生产调用方传 `join(homedir(), '.claude.json')` —
 * CLAUDE.md §13 D8 + D10。
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { DB } from '../../db/connection';
import { getEnabled } from './state';
import type { McpServer } from './types';

/** 默认生产路径 ~/.claude.json。测试通过 configPath 参数覆盖。 */
export function defaultMcpConfigPath(): string {
  return join(homedir(), '.claude.json');
}

/**
 * 读 ~/.claude.json → 解析 mcpServers → 注入 enabled(KV 表) → 返 McpServer[]。
 * 文件不存在或 JSON 损坏返 [];其他错误抛。
 *
 * @param db 已 initDB 的 SQLite handle(读 enabled KV)
 * @param configPath 可选:注入 fixture 路径(测试用);默认走 ~/.claude.json
 */
export async function listMcpServers(db: DB, configPath?: string): Promise<McpServer[]> {
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
      enabled: getEnabled(db, name),
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
  configPath?: string
): Promise<McpServer | null> {
  const list = await listMcpServers(db, configPath);
  return list.find((s) => s.name === name) ?? null;
}

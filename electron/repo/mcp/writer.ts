/**
 * electron/repo/mcp/writer.ts — v5 wave-1 MCP 配置写入
 *
 * createMcpServer / updateMcpServer / deleteMcpServer 都改 ~/.claude.json
 * 的 mcpServers 字段。原子写:**tmp + rename** 模式(CLAUDE.md §7 决策 + 本
 * 任务硬规则)— 写 tmp 文件 → fs.rename 替换原文件,避免 partial write。
 *
 * enabled 状态**不**写到 ~/.claude.json(那是 state.ts 的 mcp_server_state
 * KV 表职责)— D6 决策:UI toggle 不能污染原配置文件。
 *
 * 文件不存在场景:createMcpServer 会**自动初始化**空 JSON {} 然后插入
 * mcpServers[name];不存在时 deleteMcpServer / updateMcpServer 抛错(用户
 * 没创建过 → 不可能 update / delete)。
 *
 * 跨平台:路径用 `MCP_CONFIG_PATH` 常量(scanner.ts 导出),测试用环境变量
 * 注入 fixture — CLAUDE.md §13 D10。
 */

import { readFile, writeFile, rename, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { defaultMcpConfigPath } from './scanner';
import type { McpCreateInput, McpUpdatePatch } from './types';

/**
 * 原子写:写 tmp 文件 → rename 替换。失败回滚:tmp 文件若残留则 unlink。
 * parent 目录已存在(由 readFile 隐含保证)。
 */
async function atomicWriteConfig(config: Record<string, unknown>, filePath: string): Promise<void> {
  const tmp = filePath + `.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
    await rename(tmp, filePath);
  } catch (e) {
    // 清理残留 tmp
    try {
      if (existsSync(tmp)) await unlink(tmp);
    } catch {
      /* swallow */
    }
    throw e;
  }
}

/** 读指定路径的 JSON 配置。文件不存在返 {};JSON 损坏抛错。 */
async function readConfig(filePath: string): Promise<Record<string, unknown>> {
  if (!existsSync(filePath)) return {};
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function resolvePath(configPath?: string): string {
  return configPath ?? defaultMcpConfigPath();
}

/**
 * 新增 mcpServers[name]。name 重复抛错(原文件已有)。
 * 自动初始化文件(不存在时)。
 */
export async function createMcpServer(
  input: McpCreateInput,
  configPath?: string
): Promise<void> {
  const file = resolvePath(configPath);
  const config = await readConfig(file);
  const servers = (config.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (servers[input.name]) {
    throw new Error(`MCP server "${input.name}" already exists`);
  }
  const entry: Record<string, unknown> = {
    command: input.command,
    args: input.args,
  };
  if (input.env) entry.env = input.env;
  if (input.description) entry.description = input.description;
  servers[input.name] = entry;
  config.mcpServers = servers;
  await atomicWriteConfig(config, file);
}

/**
 * 修改 mcpServers[name]。name 不存在抛错。
 * patch 的 undefined 字段不动(merge,不是 replace)— 让前端只传需要改的字段。
 */
export async function updateMcpServer(
  name: string,
  patch: McpUpdatePatch,
  configPath?: string
): Promise<void> {
  const file = resolvePath(configPath);
  const config = await readConfig(file);
  const servers = (config.mcpServers as Record<string, Record<string, unknown>> | undefined) ?? {};
  const existing = servers[name];
  if (!existing) {
    throw new Error(`MCP server "${name}" not found`);
  }
  if (patch.command !== undefined) existing.command = patch.command;
  if (patch.args !== undefined) existing.args = patch.args;
  if (patch.env !== undefined) existing.env = patch.env;
  if (patch.description !== undefined) existing.description = patch.description;
  servers[name] = existing;
  config.mcpServers = servers;
  await atomicWriteConfig(config, file);
}

/**
 * 删除 mcpServers[name]。name 不存在抛错。
 */
export async function deleteMcpServer(name: string, configPath?: string): Promise<void> {
  const file = resolvePath(configPath);
  const config = await readConfig(file);
  const servers = (config.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (!(name in servers)) {
    throw new Error(`MCP server "${name}" not found`);
  }
  delete servers[name];
  config.mcpServers = servers;
  await atomicWriteConfig(config, file);
}

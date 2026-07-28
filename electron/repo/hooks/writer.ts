/**
 * electron/repo/hooks/writer.ts — v5 wave-2 Hooks 配置写入
 *
 * createHook / updateHook / deleteHook 都改 ~/.claude/settings.json 的
 * hooks 字段(嵌套 JSON 数组)。**不是**新建单文件 .md — 这是 Hooks 模块
 * 跟 Sub-Agents / Skills / Commands / MCP 最大的差异(D2 决策)。
 *
 * 原子写策略:与 mcp/writer.ts 同形的 tmp + rename 模式(CLAUDE.md §7 + 本
 * 任务硬规则)—— 读完整 settings.json → 改 hooks 字段 → 写 tmp → rename。
 * 任何写入失败时回滚 tmp 残留,**不能破坏其他字段**(mcpServers /
 * permissions / ...)— 这是 AC-13 的硬要求(D7 决策)。
 *
 * enabled 状态**不**写到 settings.json(那是 state.ts 的 KV 表职责)— D6
 * 决策延伸:UI toggle 不能污染原配置文件。
 *
 * id 解析:`${event}-${index}` 简单方案(D7 简化)— 拆 id → event + index,
 * 在 hooks[event] 数组内定位。create 时 push 到 event 数组末尾;
 * delete / update 时 splice / replace 对应 index。
 *
 * 文件不存在场景:createHook 会**自动初始化** settings.json(空 JSON)然后
 * 创建 hooks 字段;不存在时 deleteHook / updateHook 抛错(用户没创建过 →
 * 不可能 update / delete)。
 *
 * 跨平台:settingsPath 参数允许测试注入 fixture 路径 — CLAUDE.md §13 D10。
 */

import { writeFile, rename, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { defaultSettingsPath } from './scanner';
import type { HookEntry, HookEvent, HookUpdatePatch, HookCreateInput } from './types';

/**
 * 原子写 settings.json:写 tmp → rename 替换。失败回滚:tmp 文件若残留则 unlink。
 * parent 目录不存在则 mkdir -p(避免 settings.json 第一次写入时 ENOENT)。
 */
async function atomicWriteSettings(
  config: Record<string, unknown>,
  filePath: string
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
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

/** 读指定路径的 settings.json。文件不存在返 {};JSON 损坏抛错。 */
async function readSettings(filePath: string): Promise<Record<string, unknown>> {
  if (!existsSync(filePath)) return {};
  const raw = await readFileIfExists(filePath);
  return JSON.parse(raw);
}

async function readFileIfExists(filePath: string): Promise<string> {
  const fs = await import('fs/promises');
  return fs.readFile(filePath, 'utf8');
}

function resolvePath(settingsPath?: string): string {
  return settingsPath ?? defaultSettingsPath();
}

/**
 * 从 id 字符串解析 event + index。id 格式 `${event}-${index}`。
 * 找不到合法 event(必须在已知 6 种内)抛错。
 */
function parseHookId(
  id: string,
  validEvents: readonly string[]
): { event: HookEvent; index: number } {
  const idx = id.lastIndexOf('-');
  if (idx < 0) throw new Error(`Hook id "${id}" malformed`);
  const event = id.slice(0, idx);
  const indexStr = id.slice(idx + 1);
  if (!validEvents.includes(event)) {
    throw new Error(`Hook id "${id}" has unknown event "${event}"`);
  }
  const index = Number.parseInt(indexStr, 10);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Hook id "${id}" has invalid index`);
  }
  return { event: event as HookEvent, index };
}

/** 把字段形态转成 settings.json 内的 HookEntry */
function toEntry(matcher: string | undefined, command: string): HookEntry {
  const entry: HookEntry = { hooks: [{ type: 'command', command }] };
  if (matcher) entry.matcher = matcher;
  return entry;
}

/**
 * 新增 hooks[<event>] 末尾一条。event 数组不存在自动初始化为 [] 后 push。
 * 文件不存在自动创建(settings.json 第一次创建)。
 */
export async function createHook(
  input: HookCreateInput,
  settingsPath?: string
): Promise<void> {
  const file = resolvePath(settingsPath);
  const config = await readSettings(file);
  const hooks = (config.hooks as Partial<Record<HookEvent, HookEntry[]>> | undefined) ?? {};
  const event = input.event;
  const arr = hooks[event] ?? [];
  arr.push(toEntry(input.matcher, input.command));
  hooks[event] = arr;
  config.hooks = hooks;
  await atomicWriteSettings(config, file);
}

/**
 * 修改指定 id 的 hook(id 格式 `${event}-${index}`)。
 * id 不存在(越界 / event 数组缺失)抛错。
 * patch 的 undefined 字段不动 — matcher 的 undefined 也不清空,
 * 仍是 merge 语义(简化;UI 改 matcher 只透传,不清空)。
 */
export async function updateHook(
  id: string,
  patch: HookUpdatePatch,
  validEvents: readonly string[],
  settingsPath?: string
): Promise<void> {
  const file = resolvePath(settingsPath);
  const { event, index } = parseHookId(id, validEvents);
  const config = await readSettings(file);
  const hooks = (config.hooks as Partial<Record<HookEvent, HookEntry[]>> | undefined) ?? {};
  const arr = hooks[event] ?? [];
  const existing = arr[index];
  if (!existing) {
    throw new Error(`Hook "${id}" not found`);
  }
  // 取第一个 hooks[] 命令作为核心 command(matcher 改则保留旧 matcher,创建新 entry 形式)
  const oldCommand = existing.hooks?.[0]?.command ?? '';
  const newMatcher = patch.matcher !== undefined ? patch.matcher : existing.matcher;
  const newCommand = patch.command !== undefined ? patch.command : oldCommand;
  arr[index] = toEntry(newMatcher, newCommand);
  hooks[event] = arr;
  config.hooks = hooks;
  await atomicWriteSettings(config, file);
}

/**
 * 删除指定 id 的 hook(id 格式 `${event}-${index}`)。
 * id 不存在抛错。event 数组删除该 index 后保留(允许变短)。
 */
export async function deleteHook(
  id: string,
  validEvents: readonly string[],
  settingsPath?: string
): Promise<void> {
  const file = resolvePath(settingsPath);
  const { event, index } = parseHookId(id, validEvents);
  const config = await readSettings(file);
  const hooks = (config.hooks as Partial<Record<HookEvent, HookEntry[]>> | undefined) ?? {};
  const arr = hooks[event] ?? [];
  if (index >= arr.length) {
    throw new Error(`Hook "${id}" not found`);
  }
  arr.splice(index, 1);
  hooks[event] = arr;
  config.hooks = hooks;
  await atomicWriteSettings(config, file);
}

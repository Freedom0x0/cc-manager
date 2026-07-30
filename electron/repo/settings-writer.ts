/**
 * electron/repo/settings-writer.ts — v5 wave-3 真停用抽象
 *
 * 6 模块（插件 / MCP / Hooks / Skills / Commands / Sub-Agents）的 toggle
 * 真实落地点统一抽象。本文件**只**提供工具原语（读 / 写 / 改），不改任
 * 何模块行为；调用方（mcp/state.ts 等 6 处）按需替换。
 *
 * 原子写策略：与 hooks/writer.ts 同形的 tmp + rename 模式（CLAUDE.md §7
 * D7 决策延伸）—— 读完整 settings.json → 改字段 → 写 tmp → rename。任
 * 何写入失败时回滚 tmp 残留，**不能破坏其他字段**（permissions / 其它
 * 用户手写内容）— 这是 settings-writer 的硬契约。
 *
 * setDisabledSuffix 是 Skills/Commands/Sub-Agents 的统一实现：把
 * <name>/ 或 <name>.md 重命名为 <name>.disabled/ 或 <name>.md.disabled。
 * 反向操作（恢复）由 enabled=true 触发。Claude Code 实测不读 .disabled
 * 后缀文件（2026-07-30 RD 阶段实测：claude -p "/code-mentor 可用吗?"
 * → NO，/skills 命令列表 grep 无输出）。
 *
 * 跨平台：所有路径参数支持测试注入 fixture 路径（CLAUDE.md §13 D10），
 * 默认走 os.homedir()/.claude/settings.json（D8 决策）。
 *
 * 已知约束（commit 1 refactor 范围不动现有行为）：
 * - hooks 模块当前使用自己的私有 atomicWriteSettings，commit 4 (hooks)
 *   会切到 settings-writer，commit 1 暂不切（避免单 commit 跨模块）。
 * - mcp / plugins / skills / commands / sub-agents 5 个模块当前 toggle
 *   走 mcp_server_state KV 表，commit 2/3/5 会改为调 settings-writer。
 */

import { writeFile, rename, unlink, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

// ============================================================================
// Types
// ============================================================================

/** Claude Code ~/.claude/settings.json 已知字段。其它字段通过 [key: string] 兜底保留。 */
export interface ClaudeSettings {
  /** 插件启用：key = '<name>@<marketplace>'，value = boolean。Claude Code 读此字段决定加载哪些插件。 */
  enabledPlugins?: Record<string, boolean>;
  /** MCP server 定义本身（只读参考，settings-writer 不改此字段；MCP 改 disabledMcpjsonServers）。 */
  mcpServers?: Record<string, McpServerConfig>;
  /** MCP 黑名单：数组里的 server 名字不被加载。空数组/不存在 = 全部加载。 */
  disabledMcpjsonServers?: string[];
  /** Hooks 嵌套数组：按 event 分组（PreToolUse / PostToolUse / ...），每组是 HookEntry[]。 */
  hooks?: Record<string, HookEntry[]>;
  /** 其它已知但本文件不改的字段（保留用户手写） */
  permissions?: Record<string, unknown>;
  /** 兜底：未来 Claude Code 加新字段，本 writer 不会破坏 */
  [key: string]: unknown;
}

export interface McpServerConfig {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  [key: string]: unknown;
}

export interface HookEntry {
  matcher?: string;
  hooks: Array<{
    type: string;
    command: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'Notification'
  | 'UserPromptSubmit';

export const HOOK_EVENTS: readonly HookEvent[] = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'Notification',
  'UserPromptSubmit',
];

export type DisableKind = 'skill' | 'command' | 'agent';

// ============================================================================
// Path resolution
// ============================================================================

/** 默认 settings.json 路径：跨平台 ~/.claude/settings.json（D8 决策） */
export function defaultSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

/** 默认 skills/commands/agents 父目录：~/.claude/ */
export function defaultClaudeDir(): string {
  return join(homedir(), '.claude');
}

function resolvePath(p?: string): string {
  return p ?? defaultSettingsPath();
}

// ============================================================================
// Core atomic read/write
// ============================================================================

/**
 * Windows 上的 rename 不是原子操作(在 POSIX 上才是)。并发 writeSettings
 * 多个 tmp 都准备好后,逐个 rename,后者 rename 时前者持有的目标句柄
 * 偶尔会抛 EPERM/EBUSY(Windows 进程级文件锁)。重试 5 次 + 退避能解决
 * 99% 场景,最后一次失败才抛错让上层 catch(写入失败抛错是 D7 契约)。
 */
async function renameWithRetry(
  src: string,
  dst: string,
  maxRetries = 5
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await rename(src, dst);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY') throw e;
      if (i === maxRetries - 1) break;
      // 退避 10ms * (i+1) — 50ms 总预算内完成
      await new Promise((r) => setTimeout(r, 10 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * 原子写 settings.json：写 tmp → rename 替换。失败回滚：tmp 文件若残留
 * 则 unlink。parent 目录不存在则 mkdir -p（避免 settings.json 第一次写
 * 入时 ENOENT）。
 *
 * 与 hooks/writer.ts:atomicWriteSettings 行为一致；commit 4 之后该私有
 * 函数会被删，调用方统一走本函数。
 */
export async function writeSettings(
  settings: ClaudeSettings,
  settingsPath?: string
): Promise<void> {
  const file = resolvePath(settingsPath);
  await mkdir(dirname(file), { recursive: true });
  // randomBytes 8 字节 = 16 hex 字符，足以避免同进程/跨进程同毫秒 tmp 撞名
  const tmp = file + `.tmp.${process.pid}.${Date.now()}.${randomBytes(8).toString('hex')}`;
  try {
    await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    await renameWithRetry(tmp, file);
  } catch (e) {
    // 清理残留 tmp（D7 模式）
    try {
      if (existsSync(tmp)) await unlink(tmp);
    } catch {
      /* swallow */
    }
    throw e;
  }
}

/**
 * 读指定路径的 settings.json。文件不存在返 {}；JSON 损坏抛 SyntaxError
 * 让上层处理（不静默吞错，避免掩盖真问题）。
 */
export async function readSettings(settingsPath?: string): Promise<ClaudeSettings> {
  const file = resolvePath(settingsPath);
  if (!existsSync(file)) return {};
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw) as ClaudeSettings;
}

// ============================================================================
// 5 个语义化操作（按 PRD 决策的"真停用"位置写入）
// ============================================================================

/**
 * 写 enabledPlugins[name@marketplace] = enabled。
 * - enabled=true → 字段设为 true（也允许原本不存在时新建）
 * - enabled=false → 字段设为 false（也允许原本不存在时新建）
 *
 * **注意**：false 状态不删除键，保留以便 UI 显式显示「已停用」语义
 * （下次 scanner 读 enabledPlugins 字典能区分"未设置"和"已停用"）。
 * 与 MCP 黑白名单语义不同，插件按字典字段值区分。
 */
export async function setPluginEnabled(
  fullName: string,
  enabled: boolean,
  settingsPath?: string
): Promise<void> {
  const file = resolvePath(settingsPath);
  const settings = await readSettings(file);
  const dict = (settings.enabledPlugins ?? {}) as Record<string, boolean>;
  dict[fullName] = enabled;
  settings.enabledPlugins = dict;
  await writeSettings(settings, file);
}

/**
 * 写 disabledMcpjsonServers 数组增删。
 * - disabled=true → name 加入数组（去重）
 * - disabled=false → 从数组移除（不存在则 no-op）
 *
 * 用黑名单语义（PRD Question 2 决策）：数组为空 / 字段不存在 = 全部加载
 * （白名单会让空数组导致全部 MCP 失效，不安全）。
 */
export async function setMcpDisabled(
  name: string,
  disabled: boolean,
  settingsPath?: string
): Promise<void> {
  const file = resolvePath(settingsPath);
  const settings = await readSettings(file);
  const list = settings.disabledMcpjsonServers ?? [];
  const set = new Set(list);
  if (disabled) set.add(name);
  else set.delete(name);
  settings.disabledMcpjsonServers = Array.from(set);
  await writeSettings(settings, file);
}

/**
 * 写 hooks[event] 数组的增删（PRD 决策：splice + push，不加 disabled 标记）。
 * - enabled=false → 从 hooks[event] 数组 splice(index, 1)
 * - enabled=true → 不直接 push（hook 创建走 hooks/writer.ts:createHook，
 *   那是 create/update/delete 流程，与 toggle 分离 — ACL 决定）
 *
 * **设计取舍**：本函数**只**支持 disable。enable 必须有完整 HookEntry
 * 信息（matcher + command + hooks[]），那是 hooks 模块的 createHook
 * 职责。本 toggle 只承诺"我看到它 enabled = 数组里存在"，toggle 后
 * 真要恢复需要走 UI 的"重新创建"流程（确认是 PRD §Non-goals）。
 *
 * event 数组不存在 或 index 越界 → 抛错（不是 silently no-op，避免 UI
 * 显示"已停用"但实际没改）。
 */
export async function setHookEnabled(
  event: HookEvent,
  index: number,
  enabled: boolean,
  settingsPath?: string
): Promise<void> {
  if (!HOOK_EVENTS.includes(event)) {
    throw new Error(`Unknown hook event "${event}"`);
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Hook index must be non-negative integer, got ${index}`);
  }
  const file = resolvePath(settingsPath);
  const settings = await readSettings(file);
  const hooks = settings.hooks ?? {};
  const arr = hooks[event] ?? [];
  if (enabled) {
    // 启用走 hooks/writer.ts:createHook，不在本函数职责内
    throw new Error(
      'setHookEnabled(true) is not supported; use hooks/writer.ts:createHook to re-add'
    );
  }
  if (index >= arr.length) {
    throw new Error(`Hook "${event}[${index}]" not found in settings.json`);
  }
  arr.splice(index, 1);
  hooks[event] = arr;
  settings.hooks = hooks;
  await writeSettings(settings, file);
}

/**
 * 改 skills/commands/agents 的 .disabled 后缀。
 * - disabled=true → mv `<name>/` (skill) / `<name>.md` (command/agent)
 *   → `<name>.disabled/` (skill) / `<name>.md.disabled` (command/agent)
 * - disabled=false → 反向 mv
 *
 * 目标已处于目标状态时 no-op（不抛错），避免 UI 重复点击报"已存在"。
 * 目标处于"既不是启用也不是禁用"（其它诡异后缀）状态 → 抛错让上层处理。
 *
 * 路径处理：
 * - skills 是目录（<name>/SKILL.md 等），整目录 mv
 * - commands/agents 是单文件 <name>.md，单文件 mv
 * - 如果 source 路径不存在但目标是 disabled 状态（false 调用）→ 抛错
 *   （不能"启用"一个不存在的 skill）
 */
export async function setDisabledSuffix(
  kind: DisableKind,
  name: string,
  disabled: boolean,
  baseDir?: string
): Promise<void> {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error(`Invalid ${kind} name "${name}"`);
  }
  const base = baseDir ?? defaultClaudeDir();
  const folderForKind = kind === 'skill' ? 'skills' : kind === 'command' ? 'commands' : 'agents';
  const dir = join(base, folderForKind);

  let src: string;
  let dst: string;

  if (kind === 'skill') {
    // skills 是目录：<name>/ ↔ <name>.disabled/
    src = join(dir, name);
    dst = join(dir, `${name}.disabled`);
  } else {
    // commands/agents 是单文件：<name>.md ↔ <name>.md.disabled
    src = join(dir, `${name}.md`);
    dst = join(dir, `${name}.md.disabled`);
  }

  const { rename } = await import('fs/promises');

  if (disabled) {
    if (existsSync(dst)) {
      // 已 disabled → no-op
      return;
    }
    if (!existsSync(src)) {
      throw new Error(`${kind} "${name}" not found at ${src}`);
    }
    await rename(src, dst);
  } else {
    if (existsSync(src)) {
      // 已 enabled → no-op
      return;
    }
    if (!existsSync(dst)) {
      throw new Error(`Disabled ${kind} "${name}" not found at ${dst}`);
    }
    await rename(dst, src);
  }
}

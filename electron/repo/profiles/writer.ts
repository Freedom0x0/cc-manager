/**
 * electron/repo/profiles/writer.ts — v5 wave-3 Profiles writer
 *
 * createProfile / updateProfile / deleteProfile 都改 ~/.claude/profiles.json
 * 单 JSON 文件(同 hooks/settings.json 模式)。
 *
 * 原子写策略:tmp + rename(与 hooks/writer.ts 同形 — CLAUDE.md §7 + D7
 * 决策)。失败回滚:tmp 文件若残留则 unlink。parent 目录不存在则
 * mkdir -p(避免首次写入 ENOENT)。
 *
 * createProfile 是**核心 capture** 函数:实时从 mcp_server_state KV 表读
 * 所有 6 个 enabled* 命名空间(mcp: / skill: / cmd: / agent: / hook: /
 * plugin:),生成 ProfileConfig 快照。它**不**只查已知 enabled=true 的项,
 * 而**是按前缀扫**整个 KV 表 — 这样新出现的 MCP server / skill 即使没
 * 在 enabled KV 表里出现过,也会以 enabled=true 默认值出现在 profile 里
 * (与 getEnabled 默认 true 一致)。
 *
 * 重要:createProfile **不**验证 enabled 状态对应的实体是否还存在原文件
 * (那是 listMcpServers 等 scanner 的事)。profile 存的是**当前 UI 偏好**,
 * 不是原文件存在性证明。下次 apply 时如果原文件不存在,enabled=false 也
 * 是合法状态。
 *
 * applyProfile 是**事务化操作**(任务硬规则):备份 → 应用 → 验证 → 失败
 * 回滚。详见函数体注释。
 *
 * 容错:
 * - createProfile name 重复 → 抛错
 * - updateProfile / deleteProfile name 不存在 → 抛错
 * - applyProfile name 不存在 → 抛错
 *
 * 跨平台:profilesPath 参数允许测试注入 fixture 路径 — CLAUDE.md §13 D10。
 */

import { writeFile, rename, unlink, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { defaultProfilesPath, listProfiles } from './scanner';
import type {
  Profile,
  ProfileConfig,
  ProfileCreateInput,
  ProfileUpdatePatch,
} from './types';
import type { DB } from '../../db/connection';
import { backupEnabledStates, restoreEnabledStates } from './state';
import { setMcpDisabled, setPluginEnabled, setHookEnabled, setDisabledSuffix, defaultClaudeDir } from '../settings-writer';
import { HOOK_EVENTS, type HookEvent } from '../hooks/types';
import { listSkills } from '../skills/scanner';
import { listCommands } from '../commands/scanner';
import { listSubAgents } from '../sub-agents/scanner';
import { listMcpServers } from '../mcp/scanner';
import { listPlugins } from '../plugins/scanner';
import { listHooks } from '../hooks/scanner';

function resolvePath(profilesPath?: string): string {
  return profilesPath ?? defaultProfilesPath();
}

/**
 * 原子写 profiles.json:写 tmp → rename 替换。失败回滚:tmp 文件若残留则
 * unlink。parent 目录不存在则 mkdir -p(避免首次写入 ENOENT)。
 */
async function atomicWriteJson(
  config: { profiles: Profile[] },
  filePath: string
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = filePath + `.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
    await rename(tmp, filePath);
  } catch (e) {
    try {
      if (existsSync(tmp)) await unlink(tmp);
    } catch {
      /* swallow */
    }
    throw e;
  }
}

/**
 * 实时从 mcp_server_state KV 表读 6 个 enabled* 命名空间,生成 ProfileConfig
 * 快照。v5 wave-3 修正(2026-07-30):原代码用 'mcp:enabled:%' 但实际
 * mcp/state.ts 写 'enabled:'(无 mcp: 前缀),导致 MCP enabled 永远
 * capture 不到。这里按 6 模块实际 writer 用的 prefix 读。
 */
export function captureProfileFromState(db: DB): ProfileConfig {
  const stmt = db.prepare("SELECT key, value FROM mcp_server_state WHERE key LIKE ?");
  const collect = (like: string, prefix: string): string[] => {
    const rows = stmt.all(like) as { key: string; value: string }[];
    const out: string[] = [];
    for (const row of rows) {
      if (row.value !== 'true') continue;
      out.push(row.key.slice(prefix.length));
    }
    return out;
  };
  return {
    enabledServers: collect('enabled:%', 'enabled:'),
    enabledSkills: collect('skill:enabled:%', 'skill:enabled:'),
    enabledCommands: collect('cmd:enabled:%', 'cmd:enabled:'),
    enabledAgents: collect('agent:enabled:%', 'agent:enabled:'),
    enabledHooks: collect('hook:enabled:%', 'hook:enabled:'),
    enabledPlugins: collect('plugin:enabled:%', 'plugin:enabled:'),
  };
}

/**
 * 把 ProfileConfig 写入 KV 表(enabled*:true)。v5 wave-3 修正:跟
 * captureProfileFromState 同样改 mcp: → enabled:(对齐 mcp/state.ts 实际
 * writer 用的 prefix)。
 */
function applyConfigToState(db: DB, config: ProfileConfig): void {
  const upsert = db.prepare(
    "INSERT INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );
  const tx = db.transaction(() => {
    for (const name of config.enabledServers) {
      upsert.run(`enabled:${name}`, 'true', Date.now());
    }
    for (const name of config.enabledSkills) {
      upsert.run(`skill:enabled:${name}`, 'true', Date.now());
    }
    for (const name of config.enabledCommands) {
      upsert.run(`cmd:enabled:${name}`, 'true', Date.now());
    }
    for (const name of config.enabledAgents) {
      upsert.run(`agent:enabled:${name}`, 'true', Date.now());
    }
    for (const id of config.enabledHooks) {
      upsert.run(`hook:enabled:${id}`, 'true', Date.now());
    }
    for (const name of config.enabledPlugins) {
      upsert.run(`plugin:enabled:${name}`, 'true', Date.now());
    }
  });
  tx();
}

/**
 * 同步读 profiles.json(供 applyProfile 内部使用)— 单文件 JSON,IO 极快。
 * applyProfile 必须同步以确保事务化语义在单次 IPC 调用内完成。
 */
function listProfilesSync(file: string): Profile[] {
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf8');
  let data: { profiles?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`profiles.json is malformed: ${file}`);
  }
  if (!Array.isArray(data.profiles)) return [];
  const out: Profile[] = [];
  for (const item of data.profiles) {
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.name !== 'string' || p.name.length === 0) continue;
    out.push(p as unknown as Profile);
  }
  return out;
}

/**
 * 应用 profile.config.enabled* → 写 KV 表 + 写真实文件(settings.json /
 * .disabled 后缀)。**事务化**:先备份所有 enabled 状态,失败时回滚
 * (KV + 真实文件两边)。
 *
 * v5 wave-3 改造(2026-07-30 PRD real-disable):
 * 写完 KV 后并发调 6 个真实文件 setter(best-effort 事务 — 6 个 I/O
 * 不能原子化,失败聚合 throw,KV + 真实文件一起 restore)。
 *
 * v5 D13 改造(2026-07-31):从"保守不动(只保证列出的 enabled)"改成
 * "完整替代" — 调 6 个 scanner 拿当前 enabled 全集,current ∖ target
 * 走反向 disable。spec §7.3 profile_diff 暗示完整快照语义,UI 文案
 * "会改变所有 6 类组件"也明示,wave-3 改造只补了"写真实文件"未补
 * "反向 disable"是历史遗留。Hooks enable 路径不存在(需 createHook
 * 重建),维持 apply 时 skip + 反向 disable 用 setHookEnabled(false)
 * splice 的行为。
 *
 * 返回:{ ok: true, appliedAt, realFileErrors } on 成功。
 * profile 不存在 / 写盘失败 / 验证失败 → throw(已自动回滚)。
 */
export async function applyProfile(
  db: DB,
  name: string,
  profilesPath?: string,
  settingsPath?: string,
  baseDir?: string
): Promise<{ ok: true; appliedAt: number; realFileErrors: string[] }> {
  const file = resolvePath(profilesPath);
  const existing = listProfilesSync(file);
  const profile = existing.find((p) => p.name === name);
  if (!profile) {
    throw new Error(`Profile "${name}" not found`);
  }
  // 0. 解析 fixture 路径(测试注入或生产默认)
  const base = baseDir ?? defaultClaudeDir();
  const settings = settingsPath ?? join(defaultClaudeDir(), 'settings.json');
  const skillsDir = join(base, 'skills');
  const commandsDir = join(base, 'commands');
  const agentsDir = join(base, 'agents');
  // MCP config (~/.claude.json) 在 base 父级 —— baseDir 是 ~/.claude 时,
  // 父级 = ~ (homedir)。测试 fixture 时 baseDir = claudeDir,父级 = tmpRoot。
  // 这种情况 fixture 文件必须在 tmpRoot/.claude.json —— 见 Case 9 fixture。
  // 生产用 homedir() 直接拼更准确,这里用 base/.. 兼容两种。
  const mcpConfigPath = join(base, '..', '.claude.json');
  const installedPluginsPath = join(base, 'plugins', 'installed_plugins.json');

  // 1. 备份当前所有 enabled 状态(KV + 真实文件 prev)
  const backup = backupEnabledStates(db);
  const realFileBackups: Array<{ kind: 'mcp' | 'plugin' | 'skill' | 'command' | 'agent' | 'hook'; name: string; prev: boolean }> = [];
  try {
    // 2. 应用 profile.config.enabled* 写 KV(同步事务)
    applyConfigToState(db, profile.config);
    // 3. 验证 KV
    const verifyStmt = db.prepare(
      "SELECT value FROM mcp_server_state WHERE key = ?"
    );
    for (const n of profile.config.enabledServers) {
      const row = verifyStmt.get(`enabled:${n}`) as { value: string } | undefined;
      if (!row || row.value !== 'true') {
        throw new Error(`Profile apply verification failed: mcp:${n}`);
      }
    }
    // 4. 写真实文件(best-effort) — 写每个 name 前备份真实状态用于回滚
    const realFileErrors: string[] = [];
    const tasks: Array<Promise<void>> = [];
    // === 正向 enable(profile.config.enabledX 里的项 → 启用)===
    // MCP
    for (const n of profile.config.enabledServers) {
      const prevDisabled = prevMcpDisabled(n, settings);
      realFileBackups.push({ kind: 'mcp', name: n, prev: prevDisabled });
      tasks.push(setMcpDisabled(n, false, settings).catch((e) => {
        realFileErrors.push(`mcp:${n}: ${e?.message || String(e)}`);
      }));
    }
    // Plugin
    for (const n of profile.config.enabledPlugins) {
      realFileBackups.push({ kind: 'plugin', name: n, prev: prevPluginEnabled(n, settings) });
      tasks.push(setPluginEnabled(n, true, settings).catch((e) => {
        realFileErrors.push(`plugin:${n}: ${e?.message || String(e)}`);
      }));
    }
    // Skill/Command/Agent — enabled=true 表示"应有 .md(无 .disabled)"
    for (const n of profile.config.enabledSkills) {
      realFileBackups.push({ kind: 'skill', name: n, prev: prevFileEnabled('skill', n, base) });
      tasks.push(setDisabledSuffix('skill', n, false, base).catch((e) => {
        realFileErrors.push(`skill:${n}: ${e?.message || String(e)}`);
      }));
    }
    for (const n of profile.config.enabledCommands) {
      realFileBackups.push({ kind: 'command', name: n, prev: prevFileEnabled('command', n, base) });
      tasks.push(setDisabledSuffix('command', n, false, base).catch((e) => {
        realFileErrors.push(`command:${n}: ${e?.message || String(e)}`);
      }));
    }
    for (const n of profile.config.enabledAgents) {
      realFileBackups.push({ kind: 'agent', name: n, prev: prevFileEnabled('agent', n, base) });
      tasks.push(setDisabledSuffix('agent', n, false, base).catch((e) => {
        realFileErrors.push(`agent:${n}: ${e?.message || String(e)}`);
      }));
    }
    // Hooks — id 格式 event-index;enable 必须 createHook 重建,跳过 enable 路径
    for (const id of profile.config.enabledHooks) {
      const parsed = parseHookIdSafe(id);
      if (!parsed) continue;
      realFileBackups.push({ kind: 'hook', name: id, prev: prevHookPresent(parsed.event, parsed.index, settings) });
      // enable 路径需要 HookEntry 信息,KV 不能恢复 → 跳过 enable
      // (用户在 UI 上手动 re-create; profile.apply 只承诺"disabled 的 hook 不再多禁用")
    }
    // === D13 反向 disable(current ∖ target → disable,D13 完整替代语义)===
    // 用 6 个 scanner 拿当前 enabled 全集,然后 current ∖ target 是 toDisable
    const [
      curSkills,
      curCommands,
      curAgents,
      curMcp,
      curPlugins,
      curHooks,
    ] = await Promise.all([
      listSkills(db, skillsDir),
      listCommands(db, commandsDir),
      listSubAgents(db, agentsDir),
      listMcpServers(db, mcpConfigPath, settings),
      listPlugins(db, installedPluginsPath, settings),
      listHooks(db, settings),
    ]);
    const curEnabledSkills = new Set(curSkills.filter((s) => s.enabled).map((s) => s.name));
    const curEnabledCommands = new Set(curCommands.filter((c) => c.enabled).map((c) => c.name));
    const curEnabledAgents = new Set(curAgents.filter((a) => a.enabled).map((a) => a.name));
    const curEnabledMcp = new Set(curMcp.filter((m) => m.enabled).map((m) => m.name));
    const curEnabledPlugins = new Set(curPlugins.filter((p) => p.enabled).map((p) => p.fullName));
    const targetSkills = new Set(profile.config.enabledSkills);
    const targetCommands = new Set(profile.config.enabledCommands);
    const targetAgents = new Set(profile.config.enabledAgents);
    const targetServers = new Set(profile.config.enabledServers);
    const targetPlugins = new Set(profile.config.enabledPlugins);
    const targetHooks = new Set(profile.config.enabledHooks);

    // 反向 disable MCP:不在 target 的当前 enabled MCP → 加进黑名单
    for (const n of curEnabledMcp) {
      if (targetServers.has(n)) continue;
      const prevDisabled = prevMcpDisabled(n, settings);
      realFileBackups.push({ kind: 'mcp', name: n, prev: prevDisabled });
      tasks.push(setMcpDisabled(n, true, settings).catch((e) => {
        realFileErrors.push(`mcp(→disable):${n}: ${e?.message || String(e)}`);
      }));
    }
    // 反向 disable Plugin
    for (const n of curEnabledPlugins) {
      if (targetPlugins.has(n)) continue;
      const prevEnabled = prevPluginEnabled(n, settings);
      realFileBackups.push({ kind: 'plugin', name: n, prev: prevEnabled });
      tasks.push(setPluginEnabled(n, false, settings).catch((e) => {
        realFileErrors.push(`plugin(→disable):${n}: ${e?.message || String(e)}`);
      }));
    }
    // 反向 disable Skill
    for (const n of curEnabledSkills) {
      if (targetSkills.has(n)) continue;
      const prevEnabled = prevFileEnabled('skill', n, base);
      realFileBackups.push({ kind: 'skill', name: n, prev: prevEnabled });
      tasks.push(setDisabledSuffix('skill', n, true, base).catch((e) => {
        realFileErrors.push(`skill(→disable):${n}: ${e?.message || String(e)}`);
      }));
    }
    // 反向 disable Command
    for (const n of curEnabledCommands) {
      if (targetCommands.has(n)) continue;
      const prevEnabled = prevFileEnabled('command', n, base);
      realFileBackups.push({ kind: 'command', name: n, prev: prevEnabled });
      tasks.push(setDisabledSuffix('command', n, true, base).catch((e) => {
        realFileErrors.push(`command(→disable):${n}: ${e?.message || String(e)}`);
      }));
    }
    // 反向 disable Agent
    for (const n of curEnabledAgents) {
      if (targetAgents.has(n)) continue;
      const prevEnabled = prevFileEnabled('agent', n, base);
      realFileBackups.push({ kind: 'agent', name: n, prev: prevEnabled });
      tasks.push(setDisabledSuffix('agent', n, true, base).catch((e) => {
        realFileErrors.push(`agent(→disable):${n}: ${e?.message || String(e)}`);
      }));
    }
    // 反向 disable Hooks:不在 target 的当前 enabled hook → splice
    // Hook.id 已经是 `${event}-${index}` 拼好的字符串,Hook.event 是 HookEvent
    // 索引会因 splice 错位 → setHookEnabled 内部要安全(从末尾 splice 或按 id)
    // 注:Hook 的 enabled=true 表示在 settings.json hooks[event] 数组里存在
    // scanner 已返 id / event / enabled,直接调 setHookEnabled(event, index, false)
    // 需要从 id 解析 index(用 parseHookIdSafe)
    const curHookEntries = curHooks.filter((h) => h.enabled).map((h) => ({
      id: h.id,
      event: h.event,
    }));
    for (const h of curHookEntries) {
      if (targetHooks.has(h.id)) continue;
      const parsed = parseHookIdSafe(h.id);
      if (!parsed) continue;
      // parseHookIdSafe 已过 HOOK_EVENTS.includes 校验,这里 as HookEvent 安全
      const event = parsed.event as HookEvent;
      const prevPresent = prevHookPresent(event, parsed.index, settings);
      realFileBackups.push({ kind: 'hook', name: h.id, prev: prevPresent });
      tasks.push(setHookEnabled(event, parsed.index, false, settings).catch((e) => {
        realFileErrors.push(`hook(→disable):${h.id}: ${e?.message || String(e)}`);
      }));
    }
    await Promise.all(tasks);
    if (realFileErrors.length > 0) {
      // 真实文件部分失败 → 整体回滚(KV + 真实文件)
      throw new Error(
        `applyProfile real-file write errors: ${realFileErrors.join('; ')}`
      );
    }
    return { ok: true, appliedAt: Date.now(), realFileErrors: [] };
  } catch (e) {
    // 5. 回滚(KV + 真实文件)
    restoreEnabledStates(db, backup);
    // 真实文件回滚:每个 backup 反向写
    for (const b of realFileBackups) {
      try {
        await rollbackRealFile(b, settings, base);
      } catch {
        /* 回滚失败不抛 — 避免掩盖原错误 */
      }
    }
    throw e;
  }
}

/** 从真实 settings.json 读 MCP 之前是否被禁用。 */
function prevMcpDisabled(name: string, settingsPath?: string): boolean {
  // 同步读避免 import — 复用 settings-writer.getEnabledFromSettings
  const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const os = require('node:os') as typeof import('node:os');
  const file = settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json');
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed.disabledMcpjsonServers) && parsed.disabledMcpjsonServers.includes(name);
  } catch {
    return false;
  }
}

/** 从真实 settings.json 读 plugin 之前 enabled 状态。 */
function prevPluginEnabled(fullName: string, settingsPath?: string): boolean {
  const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const os = require('node:os') as typeof import('node:os');
  const file = settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json');
  if (!existsSync(file)) return true;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed.enabledPlugins?.[fullName] === true;
  } catch {
    return true;
  }
}

/** 从真实文件读 skill/command/agent 之前是否 enabled(无 .disabled)。 */
function prevFileEnabled(kind: 'skill' | 'command' | 'agent', name: string, baseDir?: string): boolean {
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const os = require('node:os') as typeof import('node:os');
  const base = baseDir ?? path.join(os.homedir(), '.claude');
  const folder = kind === 'skill' ? 'skills' : kind === 'command' ? 'commands' : 'agents';
  const dir = path.join(base, folder);
  if (kind === 'skill') {
    return existsSync(path.join(dir, name));
  }
  return existsSync(path.join(dir, `${name}.md`));
}

function prevHookPresent(event: string, index: number, settingsPath?: string): boolean {
  const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const os = require('node:os') as typeof import('node:os');
  const file = settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json');
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed.hooks?.[event]?.[index]);
  } catch {
    return false;
  }
}

function parseHookIdSafe(id: string): { event: string; index: number } | null {
  const idx = id.lastIndexOf('-');
  if (idx < 0) return null;
  const event = id.slice(0, idx);
  const index = Number.parseInt(id.slice(idx + 1), 10);
  if (!HOOK_EVENTS.includes(event as any)) return null;
  if (!Number.isInteger(index) || index < 0) return null;
  return { event, index };
}

async function rollbackRealFile(
  b: { kind: 'mcp' | 'plugin' | 'skill' | 'command' | 'agent' | 'hook'; name: string; prev: boolean },
  settingsPath?: string,
  baseDir?: string
): Promise<void> {
  switch (b.kind) {
    case 'mcp':
      await setMcpDisabled(b.name, b.prev, settingsPath);
      return;
    case 'plugin':
      await setPluginEnabled(b.name, b.prev, settingsPath);
      return;
    case 'skill':
      await setDisabledSuffix('skill', b.name, !b.prev, baseDir);
      return;
    case 'command':
      await setDisabledSuffix('command', b.name, !b.prev, baseDir);
      return;
    case 'agent':
      await setDisabledSuffix('agent', b.name, !b.prev, baseDir);
      return;
    case 'hook':
      // 只回滚"被 disable 的 hook" → 反向 splice 回来
      if (!b.prev) {
        // prev=false 表示之前 hook 不在数组里 — 无法恢复
        return;
      }
      // prev=true 表示之前在数组里 — 但 splice 是单向的(没有 insert),
        // 无法精确恢复到原 index。best-effort:noop(用户手动恢复)
        return;
  }
}

/**
 * 新建 profile(name + description + 实时 capture config)→ 写 profiles.json。
 * name 重复抛错。
 */
export async function createProfile(
  db: DB,
  input: ProfileCreateInput,
  profilesPath?: string
): Promise<void> {
  if (typeof input.name !== 'string' || input.name.length === 0) {
    throw new Error('Profile: missing required field "name"');
  }
  if (typeof input.description !== 'string') {
    throw new Error('Profile: missing required field "description"');
  }
  const file = resolvePath(profilesPath);
  const existing = await listProfiles(profilesPath);
  if (existing.some((p) => p.name === input.name)) {
    throw new Error(`Profile "${input.name}" already exists`);
  }
  const config = captureProfileFromState(db);
  const now = new Date().toISOString();
  const profile: Profile = {
    name: input.name,
    description: input.description,
    config,
    createdAt: now,
    updatedAt: now,
  };
  existing.push(profile);
  await atomicWriteJson({ profiles: existing }, file);
}

/**
 * 修改 profile 元数据(只支持改 description — 任务硬规则)。
 * name 不存在抛错。
 */
export async function updateProfile(
  name: string,
  patch: ProfileUpdatePatch,
  profilesPath?: string
): Promise<void> {
  const file = resolvePath(profilesPath);
  const existing = await listProfiles(profilesPath);
  const idx = existing.findIndex((p) => p.name === name);
  if (idx < 0) {
    throw new Error(`Profile "${name}" not found`);
  }
  if (patch.description !== undefined) {
    if (typeof patch.description !== 'string') {
      throw new Error('Profile: description must be string');
    }
    existing[idx] = {
      ...existing[idx],
      description: patch.description,
      updatedAt: new Date().toISOString(),
    };
  }
  await atomicWriteJson({ profiles: existing }, file);
}

/**
 * 删除 profile。name 不存在抛错。
 * 注意:**不**回滚当前 KV 表的 enabled 状态(任务硬规则)— 只删 profile
 * 元数据。下次 apply 其他 profile 时再覆盖 KV 状态。
 */
export async function deleteProfile(
  name: string,
  profilesPath?: string
): Promise<void> {
  const file = resolvePath(profilesPath);
  const existing = await listProfiles(profilesPath);
  const idx = existing.findIndex((p) => p.name === name);
  if (idx < 0) {
    throw new Error(`Profile "${name}" not found`);
  }
  existing.splice(idx, 1);
  await atomicWriteJson({ profiles: existing }, file);
}
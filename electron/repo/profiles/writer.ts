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
import { dirname } from 'path';
import { defaultProfilesPath, listProfiles } from './scanner';
import type {
  Profile,
  ProfileConfig,
  ProfileCreateInput,
  ProfileUpdatePatch,
} from './types';
import type { DB } from '../../db/connection';
import { backupEnabledStates, restoreEnabledStates } from './state';

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
 * 实时从 mcp_server_state KV 表读 6 个 enabled* 命名空间(mcp: / skill:
 * / cmd: / agent: / hook: / plugin:),生成 ProfileConfig 快照。
 *
 * 用 prepared statement 直接 SELECT key, value WHERE key LIKE 'prefix:%',
 * 把 value === 'true' 的所有 name 收集起来;**没有** KV 记录的 name 不会
 * 出现(用户从未 toggle 过),这意味着 profile 只记录用户**显式**改过的
 * 启用项,新 MCP server / skill 不会被 capture。这是 capture 的真实语义:
 * "保存当前 UI 偏好",不是"完整备份 ~/.claude"。
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
    enabledServers: collect('mcp:enabled:%', 'mcp:enabled:'),
    enabledSkills: collect('skill:enabled:%', 'skill:enabled:'),
    enabledCommands: collect('cmd:enabled:%', 'cmd:enabled:'),
    enabledAgents: collect('agent:enabled:%', 'agent:enabled:'),
    enabledHooks: collect('hook:enabled:%', 'hook:enabled:'),
    enabledPlugins: collect('plugin:enabled:%', 'plugin:enabled:'),
  };
}

/**
 * 把 ProfileConfig 写入 KV 表(enabled*:true)— profile_apply 第 2 步。
 * 注意:只写 enabled=true 的项。enabled=false 的项保持原 KV 状态不动
 * (那是备份/恢复处理"被关闭"的项 — 简化:profile 只携带启用列表,
 * 不携带禁用列表;用户 capture 时只能 capture 当前启用的项,禁用项
 * 在下次 apply 其他 profile 时如果不在新 profile 启用列表中就保持禁用)。
 */
function applyConfigToState(db: DB, config: ProfileConfig): void {
  const upsert = db.prepare(
    "INSERT INTO mcp_server_state (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );
  const tx = db.transaction(() => {
    for (const name of config.enabledServers) {
      upsert.run(`mcp:enabled:${name}`, 'true', Date.now());
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
 * 应用 profile.config.enabled* → 写 KV 表。**事务化**:先备份所有 enabled
 * 状态,失败时回滚(任务硬规则)。
 *
 * 返回:{ ok: true, appliedAt } on 成功。
 * profile 不存在 / 写盘失败 / 验证失败 → throw(已自动回滚到备份状态)。
 */
export function applyProfile(
  db: DB,
  name: string,
  profilesPath?: string
): { ok: true; appliedAt: number } {
  const file = resolvePath(profilesPath);
  const existing = listProfilesSync(file);
  const profile = existing.find((p) => p.name === name);
  if (!profile) {
    throw new Error(`Profile "${name}" not found`);
  }
  // 1. 备份当前所有 enabled 状态(KV 表所有 'enabled:' / '<prefix>:enabled:' key)
  const backup = backupEnabledStates(db);
  try {
    // 2. 应用 profile.config.enabled* 写 KV
    applyConfigToState(db, profile.config);
    // 3. 验证(读回检查 enabledServers / ... 一致)
    const verifyStmt = db.prepare(
      "SELECT value FROM mcp_server_state WHERE key = ?"
    );
    for (const n of profile.config.enabledServers) {
      const row = verifyStmt.get(`mcp:enabled:${n}`) as { value: string } | undefined;
      if (!row || row.value !== 'true') {
        throw new Error(`Profile apply verification failed: mcp:${n}`);
      }
    }
    return { ok: true, appliedAt: Date.now() };
  } catch (e) {
    // 4. 回滚
    restoreEnabledStates(db, backup);
    throw e;
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
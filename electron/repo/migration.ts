/**
 * electron/repo/migration.ts — 一次性迁移 KV → 真实文件 (PRD real-disable)
 *
 * 历史背景:V5 D6 决策把 enabled 状态写到 mcp_server_state KV 表,但
 * Claude Code 不读这张表(本机实测),导致假停用。V5 wave-3 改为写真实
 * 文件(commit 2-5)。本模块负责:启动时把 KV 表里 6 模块的 enabled 状态
 * 同步到对应真实位置,让现有用户的"已停用"偏好不丢。
 *
 * 6 个 prefix:
 *   - enabled:<name>                  → MCP disabledMcpjsonServers
 *   - skill:enabled:<name>            → skills/.disabled
 *   - cmd:enabled:<name>              → commands/.md.disabled
 *   - agent:enabled:<name>            → agents/.md.disabled
 *   - hook:enabled:<id>               → settings.json hooks[] splice
 *   - plugin:enabled:<fullName>       → settings.json enabledPlugins
 *
 * 迁移完成后**保留** KV 条目(不删),作为 audit log + profile_capture 快照
 * 源(避免重新启动再迁,profile_capture 也仍能从 KV 读历史偏好)。
 *
 * 失败语义:写真实文件失败 → 跳过该 entry(不抛错),log 失败;KV 保留,
 * 下次启动再尝试。这样**不**破坏现有 KV 状态(已记录的"用户希望" 仍
 * 在),UI 仍能从 KV 兜底读 — 这是 best-effort 语义。
 */

import type { DB } from '../db/connection';
import { setMcpDisabled, setPluginEnabled, setHookEnabled, setDisabledSuffix } from './settings-writer';

export interface MigrationResult {
  /** 6 prefix 的每个迁移条目数 */
  counts: {
    mcp: number;
    skill: number;
    command: number;
    agent: number;
    hook: number;
    plugin: number;
  };
  /** 失败条目(prefix + name) */
  failures: Array<{ prefix: string; name: string; error: string }>;
}

const PREFIXES = {
  mcp: 'enabled:',
  skill: 'skill:enabled:',
  command: 'cmd:enabled:',
  agent: 'agent:enabled:',
  hook: 'hook:enabled:',
  plugin: 'plugin:enabled:',
} as const;

type ModuleKey = keyof typeof PREFIXES;

/**
 * 启动时调一次。读 mcp_server_state 所有 6 prefix 的 enabled 条目,
 * 按 value=true|false 调对应真实文件 setter。
 *
 * settingsPath / baseDir 可注入(测试用);默认走 settings-writer 的
 * 默认路径(跨平台 ~/.claude)。
 */
export async function runMigration(
  db: DB,
  settingsPath?: string,
  baseDir?: string,
  hookEvents?: readonly import('./hooks/types').HookEvent[]
): Promise<MigrationResult> {
  const result: MigrationResult = {
    counts: { mcp: 0, skill: 0, command: 0, agent: 0, hook: 0, plugin: 0 },
    failures: [],
  };

  // 一次性查所有 6 prefix 的 enabled 行
  const rows = db
    .prepare(
      "SELECT key, value FROM mcp_server_state WHERE " +
        Object.keys(PREFIXES)
          .map((k) => `key LIKE ?`)
          .join(' OR ')
    )
    .all(
      ...Object.values(PREFIXES).map((p) => p + '%')
    ) as Array<{ key: string; value: string | null }>;

  for (const row of rows) {
    const enabled = row.value === 'true';
    const moduleKey = detectModule(row.key);
    if (!moduleKey) continue;
    const name = row.key.slice(PREFIXES[moduleKey].length);
    try {
      await applyToReal(moduleKey, name, enabled, settingsPath, baseDir, hookEvents);
      result.counts[moduleKey]++;
    } catch (e) {
      result.failures.push({
        prefix: PREFIXES[moduleKey],
        name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}

function detectModule(key: string): ModuleKey | null {
  // 顺序:长的前缀先匹配(避免 plugin:enabled 误匹配 enabled:)
  if (key.startsWith(PREFIXES.plugin)) return 'plugin';
  if (key.startsWith(PREFIXES.command)) return 'command';
  if (key.startsWith(PREFIXES.skill)) return 'skill';
  if (key.startsWith(PREFIXES.agent)) return 'agent';
  if (key.startsWith(PREFIXES.hook)) return 'hook';
  if (key.startsWith(PREFIXES.mcp)) return 'mcp';
  return null;
}

async function applyToReal(
  moduleKey: ModuleKey,
  name: string,
  enabled: boolean,
  settingsPath?: string,
  baseDir?: string,
  hookEvents?: readonly import('./hooks/types').HookEvent[]
): Promise<void> {
  switch (moduleKey) {
    case 'mcp':
      // KV disabled (enabled=false) → 真实 disabled
      // KV enabled  (enabled=true)  → 真实 enabled(从黑名单移除)
      await setMcpDisabled(name, !enabled, settingsPath);
      return;
    case 'plugin':
      await setPluginEnabled(name, enabled, settingsPath);
      return;
    case 'skill':
      await setDisabledSuffix('skill', name, !enabled, baseDir);
      return;
    case 'command':
      await setDisabledSuffix('command', name, !enabled, baseDir);
      return;
    case 'agent':
      await setDisabledSuffix('agent', name, !enabled, baseDir);
      return;
    case 'hook': {
      // hook id 格式 `${event}-${index}` — 解析后 splice
      // 注意:migration 时如果 settings.json 不存在该 hook,splice 会抛
      // "not found";这种情况视为"用户希望禁用一个已经不存在的 hook"
      // → no-op 不抛错(因为 KV 显示用户希望禁用,那 settings.json 里
      // 反正没有,效果一致)
      if (!hookEvents) throw new Error('hook migration requires hookEvents');
      const idx = name.lastIndexOf('-');
      if (idx < 0) throw new Error(`Hook id "${name}" malformed`);
      const event = name.slice(0, idx);
      const indexStr = name.slice(idx + 1);
      if (!hookEvents.includes(event as any)) return; // 未知 event → 跳过
      const index = Number.parseInt(indexStr, 10);
      if (!Number.isInteger(index) || index < 0) return; // 非法 index → 跳过
      if (!enabled) {
        try {
          await setHookEnabled(event as any, index, false, settingsPath);
        } catch (e) {
          // "not found" → 该 hook 已不在 settings.json,KV 显示禁用但实际
          // 已不存在,跳过
          if (e instanceof Error && /not found/.test(e.message)) return;
          throw e;
        }
      }
      // enable=true 时 hook 必须用 createHook 重建(需要完整 HookEntry
      // 信息),无法从 KV 恢复 — 跳过,KV 保留为"用户希望状态"快照
      return;
    }
  }
}

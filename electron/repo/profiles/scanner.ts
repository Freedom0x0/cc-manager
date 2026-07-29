/**
 * electron/repo/profiles/scanner.ts — v5 wave-3 Profiles scanner
 *
 * 读 ~/.claude/profiles.json → 解析 profiles 数组 → 返 Profile[]。
 * 单文件 JSON 存储,跟 hooks/settings.json / plugins/<name>/plugin.json
 * 同形:走原子写(在 writer.ts)。
 *
 * profiles.json schema:
 *   {
 *     "profiles": [
 *       { "name": "...", "description": "...", "config": {...},
 *         "createdAt": "...", "updatedAt": "..." },
 *       ...
 *     ]
 *   }
 *
 * 容错:
 * - 文件不存在 → 返 [](首次访问视为空配置,UI 显示空列表)
 * - JSON 损坏 → 抛错(任务硬规则:不 silent return — 但实际上 profiles.json
 *   是我们自己写的,损坏概率低;此处抛错帮助快速发现 bug)
 * - profiles 字段缺失 → 返 []
 * - 单个 profile 缺 name → 跳过(读路径宽容)
 *
 * 路径注入:profilesPath 参数允许测试注入 fixture 路径(避免碰真实
 * ~/.claude/profiles.json);生产调用方传 defaultProfilesPath() —
 * CLAUDE.md §13 D8 + D10。
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Profile } from './types';

/** 默认生产路径 ~/.claude/profiles.json。测试通过 profilesPath 参数覆盖。 */
export function defaultProfilesPath(): string {
  return join(homedir(), '.claude', 'profiles.json');
}

/**
 * 读 ~/.claude/profiles.json → 解析 → 返 Profile[]。
 * 文件不存在返 [];profiles 字段缺失返 [];JSON 损坏抛错。
 *
 * @param profilesPath 可选:注入 fixture 路径(测试用);默认走 ~/.claude/profiles.json
 */
export async function listProfiles(profilesPath?: string): Promise<Profile[]> {
  const file = profilesPath ?? defaultProfilesPath();
  if (!existsSync(file)) return [];
  const raw = await readFile(file, 'utf8');
  let data: { profiles?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    // 读路径宽容 + 但 profiles.json 是我们自己写的,损坏说明 bug,抛错有助发现
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
 * 单 profile 查询。name 不存在返 null。
 */
export async function getProfile(
  name: string,
  profilesPath?: string
): Promise<Profile | null> {
  const list = await listProfiles(profilesPath);
  return list.find((p) => p.name === name) ?? null;
}
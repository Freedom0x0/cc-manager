/**
 * electron/repo/skills/scanner.ts — v5 wave-1 Skills 配置扫描器
 *
 * 读 ~/.claude/skills/<name>/SKILL.md → 解析 frontmatter → 注入 enabled(KV 表)
 * → 返 Skill[]。存的是**目录**,每个 skill 一个子目录 + SKILL.md。
 *
 * frontmatter 解析:本项目没装 yaml 包(Simplicity First),用正则手
 * parse — 只支持 key: value 单行形式。Claude Code 官方 SKILL.md 都是
 * 简单 key: value 格式,够用。如果用户用复杂 YAML(嵌套、数组),
 * 需升级到 yaml 包。
 *
 * 容错:
 * - skillsDir 不存在 → 返 [](prd §1 边界 case)
 * - 子目录内无 SKILL.md → 跳过该目录(不报错)
 * - 单 SKILL.md read 失败 → 跳过(stray 文件不污染列表)
 * - SKILL.md 无 frontmatter → description 空,body = 全文
 *
 * 路径注入:skillsDir 参数允许测试注入 fixture 路径(避免碰真实
 * ~/.claude/skills);生产调用方传 defaultSkillsDir() —
 * CLAUDE.md §13 D8 + D10。
 */

import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { DB } from '../../db/connection';
import { getEnabled } from './state';
import type { Skill } from './types';

/** 默认生产路径 ~/.claude/skills。测试通过 skillsDir 参数覆盖。 */
export function defaultSkillsDir(): string {
  return join(homedir(), '.claude', 'skills');
}

/**
 * 简单 frontmatter 解析(只支持 key: value 单行,YAML 复杂特性不支持)。
 * 期望格式:
 *   ---
 *   description: xxx
 *   allowed-tools: a, b, c
 *   version: 1.0.0
 *   ---
 *   <body>
 */
export function parseFrontmatter(
  content: string
): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    meta[key] = value;
  }
  return { meta, body: match[2] };
}

/**
 * 读 ~/.claude/skills/<name>/SKILL.md → 解析 frontmatter → 注入 enabled
 * → 返 Skill[]。skillsDir 不存在或空目录返 []。
 *
 * @param db 已 initDB 的 SQLite handle(读 enabled KV)
 * @param skillsDir 可选:注入 fixture 路径(测试用);默认走 ~/.claude/skills
 */
export async function listSkills(db: DB, skillsDir?: string): Promise<Skill[]> {
  const dir = skillsDir ?? defaultSkillsDir();
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = await readdir(dir, { withFileTypes: true })
      .then((d) => d.filter((e) => e.isDirectory()).map((e) => e.name))
      .catch(() => []);
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const name of entries) {
    const skillDir = join(dir, name);
    const skillFile = join(skillDir, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    try {
      const raw = await readFile(skillFile, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const description = meta.description ?? body.split('\n')[0]?.trim() ?? '';
      const allowedToolsRaw = meta['allowed-tools'];
      const allowedTools = allowedToolsRaw
        ? allowedToolsRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      out.push({
        name,
        path: skillDir,
        description,
        allowedTools,
        enabled: getEnabled(db, name),
        version: meta.version,
        body,
      });
    } catch {
      // 单文件 read 失败 → 跳过(stray 文件不污染列表)
      continue;
    }
  }
  return out;
}

/**
 * 单 skill 查询。name 不存在返 null。
 */
export async function getSkill(
  db: DB,
  name: string,
  skillsDir?: string
): Promise<Skill | null> {
  const list = await listSkills(db, skillsDir);
  return list.find((s) => s.name === name) ?? null;
}

/**
 * 取 SKILL.md 原始内容(供 writer 读改写用)+ 目录路径。
 * name 不存在返 null。
 */
export async function readSkillFile(
  name: string,
  skillsDir?: string
): Promise<{ dir: string; content: string } | null> {
  const dir = skillsDir ?? defaultSkillsDir();
  const skillDir = join(dir, name);
  const skillFile = join(skillDir, 'SKILL.md');
  if (!existsSync(skillFile)) return null;
  const content = await readFile(skillFile, 'utf8');
  return { dir: skillDir, content };
}

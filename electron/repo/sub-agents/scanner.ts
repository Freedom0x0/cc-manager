/**
 * electron/repo/sub-agents/scanner.ts — v5 wave-2 Sub-Agents 配置扫描器
 *
 * 读 ~/.claude/agents/<name>.md → 解析 frontmatter → 注入 enabled(KV 表)
 * → 返 SubAgent[]。存的是**单文件**(同 commands 模式,不像 Skill 子目录)。
 *
 * frontmatter 解析:复用 Commands 写法 — 本项目没装 yaml 包(Simplicity First),
 * 用正则手 parse,只支持 key: value 单行形式。Claude Code 官方 agents.md
 * 都是简单 key: value 格式,够用。
 *
 * 容错:
 * - agentsDir 不存在 → 返 [](prd §1 边界 case)
 * - 非 .md 文件 → 跳过(不污染列表)
 * - 单 .md read 失败 → 跳过
 * - .md 无 frontmatter → description 空,body = 全文
 *
 * 路径注入:agentsDir 参数允许测试注入 fixture 路径(避免碰真实
 * ~/.claude/agents);生产调用方传 defaultAgentsDir() —
 * CLAUDE.md §13 D8 + D10。
 */

import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import type { DB } from '../../db/connection';
import { getEnabled } from './state';
import type { SubAgent } from './types';

/** 默认生产路径 ~/.claude/agents。测试通过 agentsDir 参数覆盖。 */
export function defaultAgentsDir(): string {
  return join(homedir(), '.claude', 'agents');
}

/**
 * 简单 frontmatter 解析(只支持 key: value 单行,YAML 复杂特性不支持)。
 * 期望格式:
 *   ---
 *   description: xxx
 *   argument-hint: <arg>
 *   ---
 *   <body>
 */
export function parseFrontmatter(
  content: string
): { meta: Record<string, string>; body: string } {
  // CRLF + LF 双支持:Windows .md 是 \r\n,Linux/macOS 是 \n
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
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
 * 读 ~/.claude/agents/<name>.md → 解析 frontmatter → 注入 enabled
 * → 返 SubAgent[]。agentsDir 不存在或空目录返 []。
 *
 * @param db 已 initDB 的 SQLite handle(读 enabled KV)
 * @param agentsDir 可选:注入 fixture 路径(测试用);默认走 ~/.claude/agents
 */
export async function listSubAgents(db: DB, agentsDir?: string): Promise<SubAgent[]> {
  const dir = agentsDir ?? defaultAgentsDir();
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = await readdir(dir).catch(() => []);
  } catch {
    return [];
  }
  const out: SubAgent[] = [];
  for (const filename of entries) {
    if (!filename.endsWith('.md')) continue;
    const name = basename(filename, '.md');
    const filePath = join(dir, filename);
    if (!existsSync(filePath)) continue;
    try {
      const raw = await readFile(filePath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const description = meta.description ?? body.split('\n')[0]?.trim() ?? '';
      const argumentHint = meta['argument-hint'];
      out.push({
        name,
        path: filePath,
        description,
        argumentHint,
        enabled: getEnabled(db, name),
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
 * 单 sub-agent 查询。name 不存在返 null。
 */
export async function getSubAgent(
  db: DB,
  name: string,
  agentsDir?: string
): Promise<SubAgent | null> {
  const list = await listSubAgents(db, agentsDir);
  return list.find((a) => a.name === name) ?? null;
}

/**
 * 取 <name>.md 原始内容(供 writer 读改写用)+ 目录路径。
 * name 不存在返 null。
 */
export async function readSubAgentFile(
  name: string,
  agentsDir?: string
): Promise<{ dir: string; content: string } | null> {
  const dir = agentsDir ?? defaultAgentsDir();
  const filePath = join(dir, `${name}.md`);
  if (!existsSync(filePath)) return null;
  const content = await readFile(filePath, 'utf8');
  return { dir, content };
}

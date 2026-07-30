/**
 * electron/repo/commands/scanner.ts — v5 wave-1 Commands 配置扫描器
 *
 * 读 ~/.claude/commands/<name>.md → 解析 frontmatter → 注入 enabled(KV 表)
 * → 返 Command[]。存的是**单文件**(不像 Skill 那种目录 + SKILL.md)。
 *
 * frontmatter 解析:复用 Skills 写法 — 本项目没装 yaml 包(Simplicity First),
 * 用正则手 parse,只支持 key: value 单行形式。Claude Code 官方 commands.md
 * 都是简单 key: value 格式,够用。
 *
 * 容错:
 * - commandsDir 不存在 → 返 [](prd §1 边界 case)
 * - 非 .md 文件 → 跳过(不污染列表)
 * - 单 .md read 失败 → 跳过
 * - .md 无 frontmatter → description 空,body = 全文
 *
 * 路径注入:commandsDir 参数允许测试注入 fixture 路径(避免碰真实
 * ~/.claude/commands);生产调用方传 defaultCommandsDir() —
 * CLAUDE.md §13 D8 + D10。
 */

import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import type { DB } from '../../db/connection';
import type { Command } from './types';

/** 默认生产路径 ~/.claude/commands。测试通过 commandsDir 参数覆盖。 */
export function defaultCommandsDir(): string {
  return join(homedir(), '.claude', 'commands');
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
 * 读 ~/.claude/commands/<name>.md → 解析 frontmatter → 注入 enabled
 * → 返 Command[]。commandsDir 不存在或空目录返 []。
 *
 * @param db 已 initDB 的 SQLite handle(读 enabled KV)
 * @param commandsDir 可选:注入 fixture 路径(测试用);默认走 ~/.claude/commands
 */
export async function listCommands(db: DB, commandsDir?: string): Promise<Command[]> {
  const dir = commandsDir ?? defaultCommandsDir();
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = await readdir(dir).catch(() => []);
  } catch {
    return [];
  }
  const out: Command[] = [];
  for (const filename of entries) {
    if (!filename.endsWith('.md')) continue;
    // 跳过 .disabled 后缀(真停用) — Claude Code 不读
    if (filename.endsWith('.md.disabled')) continue;
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
        // 真实 enabled = 在 commands 目录中存在(本分支已到 + 非 .disabled)
        enabled: true,
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
 * 单 command 查询。name 不存在返 null。
 */
export async function getCommand(
  db: DB,
  name: string,
  commandsDir?: string
): Promise<Command | null> {
  const list = await listCommands(db, commandsDir);
  return list.find((c) => c.name === name) ?? null;
}

/**
 * 取 <name>.md 原始内容(供 writer 读改写用)+ 目录路径。
 * name 不存在返 null。
 */
export async function readCommandFile(
  name: string,
  commandsDir?: string
): Promise<{ dir: string; content: string } | null> {
  const dir = commandsDir ?? defaultCommandsDir();
  const filePath = join(dir, `${name}.md`);
  if (!existsSync(filePath)) return null;
  const content = await readFile(filePath, 'utf8');
  return { dir, content };
}

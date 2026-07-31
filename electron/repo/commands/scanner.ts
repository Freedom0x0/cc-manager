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
 * 读 ~/.claude/commands/<name>.md(enabled)+ ~/.claude/commands/<name>.md.disabled
 * (disabled) → 解析 frontmatter → 注入 enabled(文件后缀决定)→ 返 Command[]。
 * commandsDir 不存在或空目录返 []。
 *
 * v5 D14 改造(2026-07-31):之前跳过 .md.disabled 后缀文件,导致 UI 上看不到
 * 停用的 command,跟 skills 的 disabled_skills/ 镜像方案(D12)对称 — 同
 * "写完不算完,UI 也要双向验证"教训。Command enable 路径(.md ↔ .md.disabled)
 * 跟 skills 镜像方案等价,scanner 也应返 disabled 项以便 UI 显式展示。
 *
 * @param db 已 initDB 的 SQLite handle(scanner 不再读 KV,enabled 由文件
 *           后缀决定;DB 保留以便未来切回 KV source of truth)
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
    // 只处理 .md(enabled)和 .md.disabled(disabled)两种文件
    // 注意:"review.md.disabled".endsWith(".md") === false(末尾是 "led")
    // 所以必须显式判断两种后缀
    const isDisabled = filename.endsWith('.md.disabled');
    const isEnabled = !isDisabled && filename.endsWith('.md');
    if (!isDisabled && !isEnabled) continue;
    const name = basename(filename, isDisabled ? '.md.disabled' : '.md');
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
        // enabled 由文件后缀决定(.md = true, .md.disabled = false)。
        enabled: !isDisabled,
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

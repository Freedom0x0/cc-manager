/**
 * electron/repo/skills/scanner.ts — v5 wave-1 Skills 配置扫描器
 *
 * 读 ~/.claude/skills/<name>/SKILL.md 和 ~/.claude/disabled_skills/<name>/SKILL.md
 * → 解析 frontmatter → 注入 enabled(主目录=true / 镜像目录=false)
 * → 返 Skill[]。存的是**目录**,每个 skill 一个子目录 + SKILL.md。
 *
 * frontmatter 解析:本项目没装 yaml 包(Simplicity First),用正则手
 * parse — 只支持 key: value 单行形式。Claude Code 官方 SKILL.md 都是
 * 简单 key: value 格式,够用。如果用户用复杂 YAML(嵌套、数组),
 * 需升级到 yaml 包。
 *
 * 容错:
 * - skillsDir 不存在 → 返 [](prd §1 边界 case)
 * - disabledSkillsDir 不存在 / 未传 → 只扫主目录,镜像目录部分返 0 条
 * - 子目录内无 SKILL.md → 跳过该目录(不报错)
 * - 单 SKILL.md read 失败 → 跳过(stray 文件不污染列表)
 * - SKILL.md 无 frontmatter → description 空,body = 全文
 * - 主目录和镜像目录同名冲突 → 主目录赢 + console.warn(让用户看清)
 *
 * 路径注入:skillsDir 参数允许测试注入 fixture 路径(避免碰真实
 * ~/.claude/skills);生产调用方(main.ts:219)不传 → 走 defaultSkillsDir()。
 * CLAUDE.md §13 D8 + D10 + D11。
 */

import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { DB } from '../../db/connection';
import type { Skill } from './types';

/** 默认生产路径 ~/.claude/skills。测试通过 skillsDir 参数覆盖。 */
export function defaultSkillsDir(): string {
  return join(homedir(), '.claude', 'skills');
}

/** 默认生产路径 ~/.claude/disabled_skills。 commit 10 (UI 修复) 新增。 */
export function defaultDisabledSkillsDir(): string {
  return join(homedir(), '.claude', 'disabled_skills');
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
  // CRLF + LF 双支持:Windows SKILL.md 是 \r\n,Linux/macOS 是 \n
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

/** commit 10: listSkills() 第三参,可注入 disabled_skills/ 路径。
 *  不传则只扫主目录(向后兼容 main.ts:219 的旧调用)。
 *  opts.claudeHome 用于把 disabledSkillsDir 解析成相对路径的兄弟目录
 *  (避免主目录和镜像目录不在同一父级时拿不到对方)。默认从 skillsDir 上溯一级。 */
export interface ListSkillsOptions {
  disabledSkillsDir?: string;
}

/**
 * 读两个目录合并 → 返 Skill[]。skillsDir 不存在或空目录返 []。
 *
 * commit 10 (UI 修复):扫描 disabled_skills/ 镜像目录,合并后返 enabled=
 * (fromMainDir ? true : false);同名冲突主目录赢 + console.warn。
 *
 * @param db 已 initDB 的 SQLite handle(目前 scanner 不直接读 KV,enabled
 *           由"目录来源"决定;DB 保留以便未来切回 KV source of truth)
 * @param skillsDir 可选:注入 fixture 路径(测试用);默认走 ~/.claude/skills
 * @param opts.disabledSkillsDir 可选:注入镜像目录路径;默认 undefined
 *        → 不扫镜像目录(main.ts 不传仍是主目录单扫,向后兼容)
 */
export async function listSkills(
  db: DB,
  skillsDir?: string,
  opts?: ListSkillsOptions
): Promise<Skill[]> {
  const mainDir = skillsDir ?? defaultSkillsDir();
  if (!existsSync(mainDir)) return [];

  // 抽单目录扫描成内部函数,主目录 / 镜像目录复用
  async function scanOneDir(dir: string, enabledFlag: boolean): Promise<Skill[]> {
    if (!existsSync(dir)) return [];
    let entries: string[];
    try {
      // e.isDirectory() 对 symlink 返 false; 改用 lstat 判断,
      // symlink 或目录都接受(后续 statSync 跟随后确认有 SKILL.md)
      entries = await readdir(dir, { withFileTypes: true })
        .then((d) => d.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name))
        .catch(() => []);
    } catch {
      return [];
    }
    const out: Skill[] = [];
    for (const name of entries) {
      // 跳过 .disabled 后缀的目录 — commit 5 老方案残留/用户手动加的,
      // commit 9 之后真停用走 disabled_skills/ 镜像, .disabled 后缀不再使用。
      // 仍跳过是为了避免 setDisabledSuffix 写一半中断的中间态被扫到。
      if (name.endsWith('.disabled')) continue;
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
          enabled: enabledFlag,
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

  // 1. 主目录扫描(恒扫)
  const mainEntries = await scanOneDir(mainDir, true);

  // 2. 镜像目录扫描 — opts.disabledSkillsDir 不传则跳过(向后兼容)
  if (!opts?.disabledSkillsDir) {
    return mainEntries;
  }
  const mirrorDir = opts.disabledSkillsDir;
  if (!existsSync(mirrorDir)) return mainEntries;
  const mirrorEntries = await scanOneDir(mirrorDir, false);

  // 3. 合并 + 同名冲突主目录赢 + warn
  // 用 Map 而非 array.find,O(1) 查找,避免 N×M 退化
  const mainByName = new Map(mainEntries.map((s) => [s.name, s]));
  const seenWarn = new Set<string>();
  for (const m of mirrorEntries) {
    if (mainByName.has(m.name)) {
      // 同名冲突 — 主目录赢,warn 一次(去重警告避免同一冲突刷屏)
      if (!seenWarn.has(m.name)) {
        console.warn(
          `[skills] name conflict "${m.name}": main dir wins, mirror entry at ${join(mirrorDir, m.name)} is shadowed`
        );
        seenWarn.add(m.name);
      }
      continue;
    }
    mainByName.set(m.name, m);
  }
  return Array.from(mainByName.values());
}

/**
 * 单 skill 查询。name 不存在返 null。
 */
export async function getSkill(
  db: DB,
  name: string,
  skillsDir?: string,
  opts?: ListSkillsOptions
): Promise<Skill | null> {
  const list = await listSkills(db, skillsDir, opts);
  return list.find((s) => s.name === name) ?? null;
}

/**
 * 取 SKILL.md 原始内容(供 writer 读改写用)+ 目录路径。
 * name 不存在返 null。
 *
 * 注意:本函数只读主目录(committed 但只供编辑器路径调用,
 * 不会被 UI 调)。停用的 skill 编辑需要先重新启用(D11 决策:
 * scanner/writer 不支持跨目录编辑,因为可能改一半时进程 kill
 * 导致镜像目录半残)。
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

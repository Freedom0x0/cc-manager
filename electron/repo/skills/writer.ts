/**
 * electron/repo/skills/writer.ts — v5 wave-1 Skills 配置写入
 *
 * createSkill / updateSkill / deleteSkill 都改 ~/.claude/skills/<name>/
 * 目录里的 SKILL.md。原子写:写 tmp → rename 替换(避免 partial write)。
 *
 * enabled 状态**不**写到 SKILL.md(那是 state.ts 的 KV 表职责)—
 * D6 决策延伸:UI toggle 不能污染原文件。
 *
 * 容错:
 * - createSkill name 重复 → 抛错(目录已存在)
 * - updateSkill / deleteSkill name 不存在 → 抛错
 */

import { mkdir, writeFile, rename, unlink, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { defaultSkillsDir, parseFrontmatter, readSkillFile } from './scanner';
import type { SkillCreateInput, SkillUpdatePatch } from './types';

function resolvePath(skillsDir?: string): string {
  return skillsDir ?? defaultSkillsDir();
}

/**
 * 序列化 frontmatter + body 成 SKILL.md 全文。
 * key 顺序按字母排序,确保可读性 + git diff 稳定。
 */
function serializeSkill(meta: Record<string, string>, body: string): string {
  const keys = Object.keys(meta).sort();
  const front = keys.length > 0 ? '---\n' + keys.map((k) => `${k}: ${meta[k]}`).join('\n') + '\n---\n' : '';
  return front + body;
}

/** 把 array 拼成 allowed-tools 字符串(逗号分隔,无空值) */
function allowedToolsToString(allowedTools?: string[]): string | undefined {
  if (!allowedTools) return undefined;
  const filtered = allowedTools.map((s) => s.trim()).filter(Boolean);
  return filtered.length > 0 ? filtered.join(', ') : undefined;
}

/** 解析 allowed-tools 字符串成 array */
function allowedToolsFromString(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const arr = s.split(',').map((x) => x.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

/**
 * 原子写:写 tmp 文件 → rename 替换。失败回滚:tmp 文件若残留则 unlink。
 * parent 目录已存在(由 mkdir 隐含保证)。
 */
async function atomicWriteFile(content: string, filePath: string): Promise<void> {
  const tmp = filePath + `.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, content, 'utf8');
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
 * 新建 ~.claude/skills/<name>/SKILL.md。name 重复抛错。
 */
export async function createSkill(input: SkillCreateInput, skillsDir?: string): Promise<void> {
  const dir = resolvePath(skillsDir);
  const skillDir = join(dir, input.name);
  if (existsSync(skillDir)) {
    throw new Error(`Skill "${input.name}" already exists`);
  }
  await mkdir(skillDir, { recursive: true });
  const meta: Record<string, string> = { description: input.description };
  if (input.version) meta.version = input.version;
  const allowedTools = allowedToolsToString(input.allowedTools);
  if (allowedTools) meta['allowed-tools'] = allowedTools;
  const content = serializeSkill(meta, input.body ?? '');
  await atomicWriteFile(content, join(skillDir, 'SKILL.md'));
}

/**
 * 修改 ~.claude/skills/<name>/SKILL.md。name 不存在抛错。
 * patch 的 undefined 字段不动(merge,不是 replace)— 让前端只传需要改的字段。
 * body 为空字符串 '' 表示清空 body;undefined 表示不动。
 */
export async function updateSkill(
  name: string,
  patch: SkillUpdatePatch,
  skillsDir?: string
): Promise<void> {
  const file = await readSkillFile(name, skillsDir);
  if (!file) {
    throw new Error(`Skill "${name}" not found`);
  }
  const { meta, body } = parseFrontmatter(file.content);
  if (patch.description !== undefined) meta.description = patch.description;
  if (patch.version !== undefined) meta.version = patch.version;
  if (patch.allowedTools !== undefined) {
    const s = allowedToolsToString(patch.allowedTools);
    if (s) meta['allowed-tools'] = s;
    else delete meta['allowed-tools'];
  }
  const newBody = patch.body !== undefined ? patch.body : body;
  const content = serializeSkill(meta, newBody);
  await atomicWriteFile(content, join(file.dir, 'SKILL.md'));
}

/**
 * 删除 ~.claude/skills/<name>/ 目录。name 不存在抛错。
 * 用 rm({ recursive: true, force: true }) 异步删整目录(rm -rf 等价)。
 */
export async function deleteSkill(name: string, skillsDir?: string): Promise<void> {
  const dir = resolvePath(skillsDir);
  const skillDir = join(dir, name);
  if (!existsSync(skillDir)) {
    throw new Error(`Skill "${name}" not found`);
  }
  await rm(skillDir, { recursive: true, force: true });
}

/**
 * 读取本地 .md 文件，解析 frontmatter，返回可直接传入 createSkill 的 SkillCreateInput。
 *
 * name 推断规则（与 ~/.claude/skills/<name>/SKILL.md 的目录结构对齐）：
 * - 文件名是 SKILL.md（大小写不敏感）→ 用**父目录名**推断 name（标准格式）
 * - 其他 .md 文件 → 用文件名（去 .md 后缀）推断 name（兼容散装文件）
 * 推断后 slug 化：转小写，非 [a-z0-9_-] 替换为 -，去首尾 -。
 *
 * description 若 frontmatter 无，取正文首行（与 scanner 逻辑一致）。
 *
 * 用途：UI "从文件导入" → dialog 选文件路径 → 调本函数 → 预填新建表单。
 */
export async function readSkillFromFile(filePath: string): Promise<SkillCreateInput> {
  const raw = await readFile(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  // 文件名是 SKILL.md → 用父目录名作为 skill name；否则用文件名
  const fileName = basename(filePath);
  const rawName = /^skill\.md$/i.test(fileName)
    ? basename(join(filePath, '..'))          // 父目录名
    : fileName.replace(/\.md$/i, '');         // 文件名去后缀
  const name = rawName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'imported-skill';
  const description = meta.description ?? body.split('\n').find((l) => l.trim()) ?? '';
  const allowedToolsRaw = meta['allowed-tools'];
  const allowedTools = allowedToolsRaw
    ? allowedToolsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  return {
    name,
    description,
    body,
    allowedTools,
    version: meta.version,
  };
}

// re-export 让外部统一从 writer.ts 拿解析函数 — 避免散落
export { parseFrontmatter, allowedToolsFromString };

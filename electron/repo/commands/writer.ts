/**
 * electron/repo/commands/writer.ts — v5 wave-1 Commands 配置写入
 *
 * createCommand / updateCommand / deleteCommand 都改 ~/.claude/commands/<name>.md
 * 单文件。原子写:写 tmp → rename 替换(避免 partial write)。
 *
 * enabled 状态**不**写到 .md(那是 state.ts 的 KV 表职责)— D6 决策延伸:
 * UI toggle 不能污染原文件。
 *
 * 容错:
 * - createCommand name 重复 → 抛错(.md 已存在)
 * - updateCommand / deleteCommand name 不存在 → 抛错
 */

import { mkdir, writeFile, rename, unlink, unlink as unlinkFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { defaultCommandsDir, parseFrontmatter, readCommandFile } from './scanner';
import type { CommandCreateInput, CommandUpdatePatch } from './types';

function resolvePath(commandsDir?: string): string {
  return commandsDir ?? defaultCommandsDir();
}

/**
 * 序列化 frontmatter + body 成 commands .md 全文。
 * key 顺序按字母排序,确保可读性 + git diff 稳定。
 */
function serializeCommand(meta: Record<string, string>, body: string): string {
  const keys = Object.keys(meta).sort();
  const front = keys.length > 0 ? '---\n' + keys.map((k) => `${k}: ${meta[k]}`).join('\n') + '\n---\n' : '';
  return front + body;
}

/**
 * 原子写:写 tmp 文件 → rename 替换。失败回滚:tmp 文件若残留则 unlink。
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
 * 新建 ~.claude/commands/<name>.md。name 重复抛错。
 */
export async function createCommand(input: CommandCreateInput, commandsDir?: string): Promise<void> {
  const dir = resolvePath(commandsDir);
  const filePath = join(dir, `${input.name}.md`);
  if (existsSync(filePath)) {
    throw new Error(`Command "${input.name}" already exists`);
  }
  await mkdir(dir, { recursive: true });
  const meta: Record<string, string> = { description: input.description };
  if (input.argumentHint) meta['argument-hint'] = input.argumentHint;
  const content = serializeCommand(meta, input.body ?? '');
  await atomicWriteFile(content, filePath);
}

/**
 * 修改 ~.claude/commands/<name>.md。name 不存在抛错。
 * patch 的 undefined 字段不动(merge,不是 replace)— 让前端只传需要改的字段。
 * body 为空字符串 '' 表示清空 body;undefined 表示不动。
 */
export async function updateCommand(
  name: string,
  patch: CommandUpdatePatch,
  commandsDir?: string
): Promise<void> {
  const file = await readCommandFile(name, commandsDir);
  if (!file) {
    throw new Error(`Command "${name}" not found`);
  }
  const { meta, body } = parseFrontmatter(file.content);
  if (patch.description !== undefined) meta.description = patch.description;
  if (patch.argumentHint !== undefined) {
    if (patch.argumentHint) meta['argument-hint'] = patch.argumentHint;
    else delete meta['argument-hint'];
  }
  const newBody = patch.body !== undefined ? patch.body : body;
  const filePath = join(file.dir, `${name}.md`);
  const content = serializeCommand(meta, newBody);
  await atomicWriteFile(content, filePath);
}

/**
 * 删除 ~.claude/commands/<name>.md 单文件。name 不存在抛错。
 */
export async function deleteCommand(name: string, commandsDir?: string): Promise<void> {
  const dir = resolvePath(commandsDir);
  const filePath = join(dir, `${name}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Command "${name}" not found`);
  }
  await unlinkFile(filePath);
}

// re-export 让外部统一从 writer.ts 拿解析函数 — 避免散落
export { parseFrontmatter };

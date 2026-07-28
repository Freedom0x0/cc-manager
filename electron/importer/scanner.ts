import * as fs from 'fs';
import * as path from 'path';

export interface ProjectFolder {
  /** folder 绝对路径 = ~/.claude/projects/<encoded-name> */
  folderPath: string;
  /** 该 folder 下的 <uuid>.jsonl 文件列表(不含子目录) */
  jsonlFiles: string[];
}

/**
 * 扫描 ~/.claude/projects/ 一级子目录,每个子目录视为一个 project。
 * 不再递归进 jsonl,因为 Claude Code 的设计就是:
 *   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 *   ~/.claude/projects/<encoded-cwd>/<session-uuid>/  (运行时工作区,跳过)
 * 一个 folder = 一个项目;folder 下所有 jsonl = 该项目的会话。
 */
export function scanProjectFolders(sourceDir: string): ProjectFolder[] {
  const out: ProjectFolder[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(sourceDir, e.name);
    const files: string[] = [];
    for (const inner of fs.readdirSync(full, { withFileTypes: true })) {
      if (inner.isFile() && inner.name.endsWith('.jsonl')) {
        files.push(path.join(full, inner.name));
      }
    }
    if (files.length > 0) {
      out.push({ folderPath: full, jsonlFiles: files });
    }
  }
  return out;
}

/** 保留旧接口向后兼容(测试和可能的回退);递归扫所有 jsonl。 */
export function scanSourceDir(dir: string): string[] {
  const out: string[] = [];
  walk(dir, out);
  return out;
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
}

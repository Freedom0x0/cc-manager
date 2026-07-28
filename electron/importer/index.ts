import * as fs from 'fs';
import * as path from 'path';
import { DB } from '../db/connection';
import { parseLine } from './parser';
import { scanProjectFolders, scanSourceDir, type ProjectFolder } from './scanner';

export { scanSourceDir, scanProjectFolders, type ProjectFolder } from './scanner';
export { parseLine } from './parser';
export { archiveLegacyFakeProjects } from './migrate';
export type { RawMessage } from './types';

export interface ImportStats {
  sessionsAdded: number;
  messagesAdded: number;
}

/** 旧入口:单文件导入(v3 语义,按 message.cwd 入库)。保留供测试 + 回退。 */
export function importFile(db: DB, filePath: string): ImportStats {
  const content = fs.readFileSync(filePath, 'utf-8');
  let sessionsAdded = 0;
  let messagesAdded = 0;

  const findSession = db.prepare('SELECT id FROM sessions WHERE session_id = ?');
  const insertSession = db.prepare(
    'INSERT INTO sessions (session_id, project_id, title, cwd, started_at, last_message_at, message_count, source_file) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  );
  const insertMessage = db.prepare(
    'INSERT OR IGNORE INTO messages (uuid, session_id, role, content, content_blocks, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const updateSession = db.prepare(
    'UPDATE sessions SET last_message_at = MAX(last_message_at, ?), message_count = message_count + 1 WHERE session_id = ?'
  );

  const tx = db.transaction(() => {
    const projectCache = new Map<string, number>();
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const msg = parseLine(line);
      if (!msg) continue;

      let projectId = projectCache.get(msg.projectPath);
      if (!projectId) {
        const subName = path.basename(msg.projectPath) || msg.projectPath;
        projectId = ensureProject(db, msg.projectPath, subName, msg.projectPath, null);
        projectCache.set(msg.projectPath, projectId);
      }

      const existingSession = findSession.get(msg.sessionId);
      if (!existingSession) {
        const title = msg.role === 'user' ? msg.content.slice(0, 50) : null;
        insertSession.run(
          msg.sessionId,
          projectId,
          title,
          msg.projectPath,
          msg.createdAtMs,
          msg.createdAtMs,
          filePath
        );
        sessionsAdded++;
      }
      const blocksJson = msg.blocks.length > 0 ? JSON.stringify(msg.blocks) : null;
      const result = insertMessage.run(
        msg.uuid,
        msg.sessionId,
        msg.role,
        msg.content,
        blocksJson,
        msg.createdAtMs
      );
      if (result.changes > 0) {
        updateSession.run(msg.createdAtMs, msg.sessionId);
        messagesAdded++;
      }
    }
  });
  tx();
  return { sessionsAdded, messagesAdded };
}

/**
 * v4 主入口:把一个 project folder 下所有 jsonl 入库。
 * - project.project_path = folder 绝对路径
 * - project.name = 第一条 message 的 cwd basename(回退到 folder 末段)
 * - project.cwd = 第一条 message 的 cwd(存真实路径)
 * - sessions.cwd 记每条 session 的真实 cwd(用于 resumer 拼命令)
 */
export function importProjectFolder(db: DB, folder: ProjectFolder): ImportStats {
  let sessionsAdded = 0;
  let messagesAdded = 0;
  let firstCwd: string | null = null;

  const findSession = db.prepare('SELECT id, cwd, source_file, project_id FROM sessions WHERE session_id = ?');
  const reassignSession = db.prepare(
    'UPDATE sessions SET project_id = ? WHERE session_id = ? AND project_id != ?'
  );
  const insertSession = db.prepare(
    'INSERT INTO sessions (session_id, project_id, title, cwd, started_at, last_message_at, message_count, source_file) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  );
  const updateSessionCwd = db.prepare(
    'UPDATE sessions SET cwd = COALESCE(cwd, ?) WHERE session_id = ?'
  );
  const updateSessionSource = db.prepare(
    "UPDATE sessions SET source_file = ? WHERE session_id = ? AND (source_file IS NULL OR source_file = '')"
  );
  const insertMessage = db.prepare(
    'INSERT OR IGNORE INTO messages (uuid, session_id, role, content, content_blocks, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const updateSession = db.prepare(
    'UPDATE sessions SET last_message_at = MAX(last_message_at, ?), message_count = message_count + 1 WHERE session_id = ?'
  );

  const tx = db.transaction(() => {
    let projectId: number | null = null;

    for (const file of folder.jsonlFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        const msg = parseLine(line);
        if (!msg) continue;

        if (firstCwd === null) firstCwd = msg.projectPath;

        if (projectId === null) {
          const subName = path.basename(msg.projectPath) || path.basename(folder.folderPath);
          projectId = ensureProject(db, folder.folderPath, subName, msg.projectPath, null);
        }

        const existing = findSession.get(msg.sessionId) as
          | { id: number; cwd: string | null; source_file: string | null; project_id: number }
          | undefined;
        if (!existing) {
          const title = msg.role === 'user' ? msg.content.slice(0, 50) : null;
          insertSession.run(
            msg.sessionId,
            projectId,
            title,
            msg.projectPath,
            msg.createdAtMs,
            msg.createdAtMs,
            file
          );
          sessionsAdded++;
        } else {
          // v4:如果老 session 关联到 v1-v3 假 project(archived=1 且 path 是 cwd-style),
          // 接管到当前 folder project
          reassignSession.run(projectId, msg.sessionId, projectId);
          updateSessionCwd.run(msg.projectPath, msg.sessionId);
          updateSessionSource.run(file, msg.sessionId);
        }
        const blocksJson = msg.blocks.length > 0 ? JSON.stringify(msg.blocks) : null;
        const result = insertMessage.run(
          msg.uuid,
          msg.sessionId,
          msg.role,
          msg.content,
          blocksJson,
          msg.createdAtMs
        );
        if (result.changes > 0) {
          updateSession.run(msg.createdAtMs, msg.sessionId);
          messagesAdded++;
        }
      }
    }
  });
  tx();
  return { sessionsAdded, messagesAdded };
}

function ensureProject(
  db: DB,
  projectPath: string,
  name: string,
  cwd: string,
  parentId: number | null
): number {
  const existing = db
    .prepare('SELECT id, name, cwd FROM projects WHERE project_path = ?')
    .get(projectPath) as { id: number; name: string; cwd: string | null } | undefined;
  if (existing) {
    // 升级:补 name(若当时是 fallback)和 cwd
    if (!existing.cwd || existing.name === path.basename(projectPath)) {
      db.prepare('UPDATE projects SET name = ?, cwd = COALESCE(cwd, ?) WHERE id = ?').run(
        name,
        cwd,
        existing.id
      );
    }
    return existing.id;
  }
  db.prepare(
    'INSERT INTO projects (project_path, name, cwd, parent_project_id, imported_at) VALUES (?, ?, ?, ?, ?)'
  ).run(projectPath, name, cwd, parentId, Date.now());
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

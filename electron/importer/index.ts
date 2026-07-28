import * as fs from 'fs';
import { DB } from '../db/connection';
import { parseLine } from './parser';
import { clusterPath, topPath } from './cluster';

export { scanSourceDir } from './scanner';
export { parseLine } from './parser';
export { clusterPath, topPath } from './cluster';
export type { RawMessage } from './types';

export interface ImportStats {
  sessionsAdded: number;
  messagesAdded: number;
}

function ensureProject(db: DB, projectPath: string, name: string, parentId: number | null): number {
  const existing = db
    .prepare('SELECT id FROM projects WHERE project_path = ?')
    .get(projectPath) as { id: number } | undefined;
  if (existing) return existing.id;
  db.prepare(
    'INSERT INTO projects (project_path, name, parent_project_id, imported_at) VALUES (?, ?, ?, ?)'
  ).run(projectPath, name, parentId, Date.now());
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

export function importFile(db: DB, filePath: string): ImportStats {
  const content = fs.readFileSync(filePath, 'utf-8');
  let sessionsAdded = 0;
  let messagesAdded = 0;

  const findSession = db.prepare('SELECT id FROM sessions WHERE session_id = ?');
  const insertSession = db.prepare(
    'INSERT INTO sessions (session_id, project_id, title, started_at, last_message_at, message_count, source_file) VALUES (?, ?, ?, ?, ?, 0, ?)'
  );
  const insertMessage = db.prepare(
    'INSERT OR IGNORE INTO messages (uuid, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
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
        const { topName, subName } = clusterPath(msg.projectPath);
        const topId = ensureProject(db, topPath(topName), topName, null);
        // The leaf project is the one the session row points at
        const leafId = topName === subName
          ? topId
          : ensureProject(db, msg.projectPath, subName, topId);
        projectId = leafId;
        projectCache.set(msg.projectPath, projectId);
      }

      const existingSession = findSession.get(msg.sessionId);
      if (!existingSession) {
        const title = msg.role === 'user' ? msg.content.slice(0, 50) : null;
        insertSession.run(
          msg.sessionId,
          projectId,
          title,
          msg.createdAtMs,
          msg.createdAtMs,
          filePath
        );
        sessionsAdded++;
      }
      const result = insertMessage.run(msg.uuid, msg.sessionId, msg.role, msg.content, msg.createdAtMs);
      if (result.changes > 0) {
        updateSession.run(msg.createdAtMs, msg.sessionId);
        messagesAdded++;
      }
    }
  });
  tx();
  return { sessionsAdded, messagesAdded };
}

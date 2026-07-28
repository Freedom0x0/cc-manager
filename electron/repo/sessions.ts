import { DB } from '../db/connection';
import { SessionRow } from './types';

const SELECT_FIELDS = `
  s.id, s.session_id AS sessionId, s.project_id AS projectId, s.title, s.cwd,
  s.started_at AS startedAt, s.last_message_at AS lastMessageAt,
  s.message_count AS messageCount, s.source_file AS sourceFile,
  (SELECT content FROM messages WHERE session_id = s.session_id AND role = 'user' ORDER BY created_at ASC LIMIT 1) AS firstUserMessage
`;

export function listByProject(db: DB, projectId: number, includeDeleted: boolean): SessionRow[] {
  const where = includeDeleted ? 's.project_id = ?' : 's.project_id = ? AND s.is_deleted = 0';
  return db
    .prepare(`SELECT ${SELECT_FIELDS} FROM sessions s WHERE ${where} ORDER BY s.last_message_at DESC`)
    .all(projectId) as SessionRow[];
}

export function get(db: DB, sessionId: string): SessionRow | null {
  const row = db
    .prepare(`SELECT ${SELECT_FIELDS} FROM sessions s WHERE s.session_id = ?`)
    .get(sessionId) as SessionRow | undefined;
  return row ?? null;
}

export function listDeleted(db: DB): SessionRow[] {
  return db
    .prepare(`SELECT ${SELECT_FIELDS} FROM sessions s WHERE s.is_deleted = 1 ORDER BY s.deleted_at DESC`)
    .all() as SessionRow[];
}

export function softDelete(db: DB, sessionId: string): void {
  db.prepare('UPDATE sessions SET is_deleted = 1, deleted_at = ? WHERE session_id = ?').run(Date.now(), sessionId);
}

export function restore(db: DB, sessionId: string): void {
  db.prepare('UPDATE sessions SET is_deleted = 0, deleted_at = NULL WHERE session_id = ?').run(sessionId);
}

export function permanentDelete(db: DB, sessionId: string): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
  });
  tx();
}

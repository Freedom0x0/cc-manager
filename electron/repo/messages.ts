import { DB } from '../db/connection';
import { MessageRow } from './types';

export function listBySession(db: DB, sessionId: string): MessageRow[] {
  return db
    .prepare(
      'SELECT id, uuid, session_id AS sessionId, role, content, created_at AS createdAt FROM messages WHERE session_id = ? ORDER BY created_at ASC'
    )
    .all(sessionId) as MessageRow[];
}

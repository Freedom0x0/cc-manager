import { DB } from '../db/connection';
import { MessageRow, ContentBlock } from './types';

export function listBySession(db: DB, sessionId: string): MessageRow[] {
  const rows = db
    .prepare(
      'SELECT id, uuid, session_id AS sessionId, role, content, content_blocks AS contentBlocksJson, created_at AS createdAt FROM messages WHERE session_id = ? ORDER BY created_at ASC'
    )
    .all(sessionId) as Array<{
      id: number;
      uuid: string;
      sessionId: string;
      role: 'user' | 'assistant';
      content: string;
      contentBlocksJson: string | null;
      createdAt: number;
    }>;
  return rows.map((r) => ({
    id: r.id,
    uuid: r.uuid,
    sessionId: r.sessionId,
    role: r.role,
    content: r.content,
    blocks: parseBlocks(r.contentBlocksJson),
    createdAt: r.createdAt,
  }));
}

function parseBlocks(json: string | null): ContentBlock[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as ContentBlock[]) : [];
  } catch {
    return [];
  }
}

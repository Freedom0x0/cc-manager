import { DB } from '../db/connection';
import { SearchHit, MessageRow } from './types';

export interface GlobalSearchHit {
  id: string;
  kind: 'project' | 'session' | 'message';
  title: string;
  subtitle?: string;
}

export function globalSearch(db: DB, query: string, limit: number): GlobalSearchHit[] {
  if (query.length === 0) return [];

  const rows = db.prepare(`
    SELECT id, name AS title, project_path AS subtitle
    FROM projects
    WHERE name LIKE ?
    LIMIT ?
  `).all(`%${query}%`, limit) as Array<{ id: number; title: string; subtitle: string }>;

  return rows.map((row) => ({
    id: String(row.id),
    kind: 'project',
    title: row.title,
    subtitle: row.subtitle,
  }));
}

export function search(
  db: DB,
  query: string,
  projectIds: number[] | null,
  timeRange: { from: number; to: number } | null
): SearchHit[] {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ''))
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`);
  if (tokens.length === 0) return [];
  const ftsQuery = tokens.join(' ');

  let sql = `
    SELECT m.id, m.uuid, m.session_id AS sessionId, m.role, m.content,
           m.created_at AS createdAt,
           snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet,
           s.title AS sessionTitle, p.name AS projectName, p.id AS projectId
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    JOIN sessions s ON s.session_id = m.session_id
    JOIN projects p ON p.id = s.project_id
    WHERE messages_fts MATCH ?
      AND s.is_deleted = 0
  `;
  const params: unknown[] = [ftsQuery];

  if (projectIds && projectIds.length > 0) {
    sql += ` AND p.id IN (${projectIds.map(() => '?').join(',')})`;
    params.push(...projectIds);
  }
  if (timeRange) {
    sql += ' AND m.created_at >= ? AND m.created_at <= ?';
    params.push(timeRange.from, timeRange.to);
  }
  sql += ' ORDER BY rank LIMIT 200';

  const rows = db.prepare(sql).all(...params) as Array<{
    id: number; uuid: string; sessionId: string; role: 'user' | 'assistant';
    content: string; createdAt: number; snippet: string;
    sessionTitle: string | null; projectName: string; projectId: number;
  }>;
  return rows.map((r) => ({
    message: {
      id: r.id,
      uuid: r.uuid,
      sessionId: r.sessionId,
      role: r.role,
      content: r.content,
      blocks: [], // 搜索结果不需要 blocks(前端只显示 snippet)
      createdAt: r.createdAt,
    } as MessageRow,
    snippet: r.snippet,
    sessionTitle: r.sessionTitle,
    projectName: r.projectName,
    projectId: r.projectId,
  }));
}

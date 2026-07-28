import { DB } from '../db/connection';
import { ProjectRow } from './types';

export function listWithCounts(db: DB): ProjectRow[] {
  return db
    .prepare(
      `SELECT p.id, p.project_path AS path, p.name, COALESCE(c.cnt, 0) AS sessionCount
       FROM projects p
       LEFT JOIN (
         SELECT project_id, COUNT(*) AS cnt
         FROM sessions
         WHERE is_deleted = 0
         GROUP BY project_id
       ) c ON c.project_id = p.id
       ORDER BY p.name`
    )
    .all() as ProjectRow[];
}

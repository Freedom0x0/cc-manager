import { DB } from '../db/connection';
import { ProjectTreeNode } from './types';

export function listProjectTree(db: DB): ProjectTreeNode[] {
  // Flat list: every project is independent (no parent/child).
  return db
    .prepare(
      `SELECT p.id, p.name, p.project_path AS path,
              COALESCE(c.cnt, 0) AS sessionCount
       FROM projects p
       LEFT JOIN (
         SELECT project_id, COUNT(*) AS cnt
         FROM sessions
         WHERE is_deleted = 0
         GROUP BY project_id
       ) c ON c.project_id = p.id
       ORDER BY p.name`
    )
    .all() as ProjectTreeNode[];
}

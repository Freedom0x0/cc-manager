import { DB } from '../db/connection';
import { ProjectTreeNode } from './types';

export function listProjectTree(db: DB): ProjectTreeNode[] {
  // Two-step: gather tops, then children, then map
  const tops = db
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
       WHERE p.parent_project_id IS NULL
       ORDER BY p.name`
    )
    .all() as { id: number; name: string; path: string; sessionCount: number }[];

  const children = db
    .prepare(
      `SELECT p.id, p.name, p.parent_project_id AS parentId, p.project_path AS path,
              COALESCE(c.cnt, 0) AS sessionCount
       FROM projects p
       LEFT JOIN (
         SELECT project_id, COUNT(*) AS cnt
         FROM sessions
         WHERE is_deleted = 0
         GROUP BY project_id
       ) c ON c.project_id = p.id
       WHERE p.parent_project_id IS NOT NULL
       ORDER BY p.name`
    )
    .all() as { id: number; name: string; parentId: number; path: string; sessionCount: number }[];

  const byParent = new Map<number, ProjectTreeNode[]>();
  for (const c of children) {
    const list = byParent.get(c.parentId) ?? [];
    list.push({
      id: c.id,
      name: c.name,
      path: c.path,
      sessionCount: c.sessionCount,
      children: [],
    });
    byParent.set(c.parentId, list);
  }
  return tops.map((t) => ({
    id: t.id,
    name: t.name,
    path: t.path,
    sessionCount: t.sessionCount,
    children: byParent.get(t.id) ?? [],
  }));
}

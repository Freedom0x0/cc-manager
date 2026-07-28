import { DB } from '../db/connection';

/**
 * 一次性迁移:把 v1-v3 误入库的"假 project"(path 是 cwd,不是 ~/.claude/projects/xxx)
 * 标记 is_archived=1,UI 不再显示。
 *
 * 判定规则:project_path 不在 claudeProjectsDir 子树下,就是假 project。
 * cwd-style 路径通常形如 C:\Users\xxx\Desktop\xxx,没有 .claude/projects 段。
 */
export function archiveLegacyFakeProjects(db: DB, claudeProjectsDir: string): number {
  const prefix = claudeProjectsDir.replace(/\\/g, '/').toLowerCase();
  const rows = db
    .prepare('SELECT id, project_path FROM projects WHERE is_archived = 0')
    .all() as { id: number; project_path: string }[];
  let archived = 0;
  const stmt = db.prepare('UPDATE projects SET is_archived = 1 WHERE id = ?');
  const tx = db.transaction(() => {
    for (const r of rows) {
      const normalized = r.project_path.replace(/\\/g, '/').toLowerCase();
      if (!normalized.startsWith(prefix + '/') && normalized !== prefix) {
        stmt.run(r.id);
        archived++;
      }
    }
  });
  tx();
  return archived;
}

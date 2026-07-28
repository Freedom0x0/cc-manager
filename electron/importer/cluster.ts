// Path clustering — simple "last segment" model.
// Each project is identified by the last directory in its path; no parent/child.
// e.g. C:\Users\foo\Desktop\prompt\react-prompt-editor → "react-prompt-editor"
//      C:\Users\foo\Desktop\prompt                       → "prompt"

import * as path from 'path';

export interface ClusterResult {
  topName: string; // for v1 compat: same as subName
  subName: string;
}

export function clusterPath(projectPath: string): ClusterResult {
  const name = path.basename(projectPath) || projectPath;
  return { topName: name, subName: name };
}

export function topPath(topName: string): string {
  return `<top:${topName}>`;
}

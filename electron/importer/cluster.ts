// Path clustering: strip leading noise + identifier segments until the
// remaining path has at most 2 segments. Then top = segments[0], sub = segments[1].
// If only 1 remains, top == sub.
//
// Noise (always stripped regardless of length): drive letter, Users, Desktop, Documents, home
// Identifier (stripped only while path has > 2 segments): all-digits, ≤ 4 chars, or short names

const NOISE_DIRS = /^(Users|home|Desktop|Documents)$/i;
const DRIVE_LETTER = /^[A-Z]:$/i;

function isIdentifier(s: string): boolean {
  // Numeric: "15532"
  if (/^\d+$/.test(s)) return true;
  // Short: ≤ 4 chars and no dash (e.g. "xj", "dev", "work")
  if (s.length <= 4 && !s.includes('-')) return true;
  return false;
}

export interface ClusterResult {
  topName: string;
  subName: string;
}

export function clusterPath(projectPath: string): ClusterResult {
  const norm = projectPath.replace(/\\/g, '/');
  let segments = norm.split('/').filter((s) => s.length > 0);

  // 1. Drop drive letter
  if (segments.length > 0 && DRIVE_LETTER.test(segments[0])) {
    segments = segments.slice(1);
  }

  // 2. Single pass: strip leading identifier OR noise segments, one at a time.
  //    Stop when we have ≤ 2 segments, or the head is a "real" name.
  while (
    segments.length > 2 &&
    (isIdentifier(segments[0]) || NOISE_DIRS.test(segments[0]))
  ) {
    segments = segments.slice(1);
  }

  if (segments.length === 0) {
    return { topName: projectPath, subName: projectPath };
  }
  if (segments.length === 1) {
    return { topName: segments[0], subName: segments[0] };
  }
  return { topName: segments[0], subName: segments[1] };
}

export function topPath(topName: string): string {
  return `<top:${topName}>`;
}

import { RawMessage } from './types';

interface RawLine {
  type?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  message?: { role?: string; content?: unknown };
}

export function parseLine(line: string): RawMessage | null {
  let raw: RawLine;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (raw.type !== 'user' && raw.type !== 'assistant') return null;
  if (!raw.uuid || !raw.sessionId || !raw.timestamp || !raw.cwd || !raw.message) return null;
  const role = raw.message.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const content = extractContent(raw.message.content);
  if (content === null) return null;
  const createdAtMs = Date.parse(raw.timestamp);
  if (isNaN(createdAtMs)) return null;
  return {
    uuid: raw.uuid,
    sessionId: raw.sessionId,
    role,
    content,
    createdAtMs,
    projectPath: raw.cwd,
  };
}

function extractContent(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (const item of v) {
      if (item && typeof item === 'object' && 'text' in item && typeof (item as { text: unknown }).text === 'string') {
        parts.push((item as { text: string }).text);
      }
    }
    return parts.join('\n');
  }
  return null;
}

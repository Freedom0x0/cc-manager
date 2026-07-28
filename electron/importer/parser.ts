// JSONL line parser for ~/.claude/projects/<folder>/<uuid>.jsonl.
// 每行是一条 message: type=user/assistant, message.content 是 string 或 array。
// array 形态: [{type:'text', text:'...'}, {type:'tool_use', name, input},
//               {type:'tool_result', content}, {type:'thinking', thinking:'...'}]
//
// parseLine 返回 text(所有 text 块拼起来的纯文本,保持 v1-v3 兼容) + blocks
// (结构化数组,前端可按 type 渲染)。

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; content: unknown; isError?: boolean }
  | { type: 'thinking'; thinking: string }
  | { type: 'unknown'; raw: unknown };

export interface RawMessage {
  uuid: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string; // 纯文本拼接,空 content 不再被丢掉(原来 return null)
  blocks: ContentBlock[]; // 结构化 blocks(可能为空)
  createdAtMs: number;
  projectPath: string;
}

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
  const { text, blocks } = extractContent(raw.message.content);
  const createdAtMs = Date.parse(raw.timestamp);
  if (isNaN(createdAtMs)) return null;
  return {
    uuid: raw.uuid,
    sessionId: raw.sessionId,
    role,
    content: text,
    blocks,
    createdAtMs,
    projectPath: raw.cwd,
  };
}

function extractContent(v: unknown): { text: string; blocks: ContentBlock[] } {
  if (typeof v === 'string') {
    return { text: v, blocks: [{ type: 'text', text: v }] };
  }
  if (Array.isArray(v)) {
    const textParts: string[] = [];
    const blocks: ContentBlock[] = [];
    for (const item of v) {
      if (!item || typeof item !== 'object') {
        blocks.push({ type: 'unknown', raw: item });
        continue;
      }
      const t = (item as { type?: unknown }).type;
      if (t === 'text' && typeof (item as { text?: unknown }).text === 'string') {
        const s = (item as { text: string }).text;
        textParts.push(s);
        blocks.push({ type: 'text', text: s });
      } else if (t === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          name: String((item as { name?: unknown }).name ?? 'unknown'),
          input: (item as { input?: unknown }).input,
        });
      } else if (t === 'tool_result') {
        blocks.push({
          type: 'tool_result',
          content: (item as { content?: unknown }).content,
          isError: Boolean((item as { is_error?: unknown }).is_error),
        });
      } else if (t === 'thinking' && typeof (item as { thinking?: unknown }).thinking === 'string') {
        blocks.push({ type: 'thinking', thinking: (item as { thinking: string }).thinking });
      } else {
        blocks.push({ type: 'unknown', raw: item });
      }
    }
    return { text: textParts.join('\n'), blocks };
  }
  // 其它形态(string 以外的非 array)→ 当作空 + unknown block
  return { text: '', blocks: [{ type: 'unknown', raw: v }] };
}

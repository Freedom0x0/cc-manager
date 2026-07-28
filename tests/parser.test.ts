import { test } from 'node:test';
import assert from 'node:assert';
import { parseLine } from '../electron/importer/parser';

test('parses valid user message', () => {
  const line = '{"type":"user","uuid":"abc-123","sessionId":"sess-1","timestamp":"2026-07-28T10:00:00.000Z","cwd":"/home/user/proj","message":{"role":"user","content":"hello world"}}';
  const msg = parseLine(line);
  assert.ok(msg);
  assert.strictEqual(msg!.uuid, 'abc-123');
  assert.strictEqual(msg!.sessionId, 'sess-1');
  assert.strictEqual(msg!.role, 'user');
  assert.strictEqual(msg!.content, 'hello world');
  assert.strictEqual(msg!.projectPath, '/home/user/proj');
  assert.strictEqual(msg!.createdAtMs, Date.parse('2026-07-28T10:00:00.000Z'));
});

test('parses assistant message with array content', () => {
  const line = '{"type":"assistant","uuid":"xyz-456","sessionId":"sess-1","timestamp":"2026-07-28T10:00:01.000Z","cwd":"/home/user/proj","message":{"role":"assistant","content":[{"type":"text","text":"hi there"}]}}';
  const msg = parseLine(line);
  assert.ok(msg);
  assert.strictEqual(msg!.role, 'assistant');
  assert.strictEqual(msg!.content, 'hi there');
});

test('returns null on malformed json', () => {
  assert.strictEqual(parseLine('not json'), null);
});

test('returns null for non-message lines', () => {
  assert.strictEqual(parseLine('{"type":"summary","data":"x"}'), null);
});

test('v4: parses array content with tool_use + tool_result + thinking blocks', () => {
  const line =
    '{"type":"assistant","uuid":"a1","sessionId":"s1","timestamp":"2026-07-28T10:00:00.000Z",' +
    '"cwd":"/home/p","message":{"role":"assistant","content":[' +
    '{"type":"text","text":"Let me check the file."},' +
    '{"type":"tool_use","name":"Read","input":{"file_path":"/etc/hosts"}},' +
    '{"type":"tool_result","content":"127.0.0.1 localhost","is_error":false},' +
    '{"type":"thinking","thinking":"I should look at the file first."}' +
    ']}}';
  const msg = parseLine(line);
  assert.ok(msg);
  assert.strictEqual(msg!.content, 'Let me check the file.');
  assert.strictEqual(msg!.blocks.length, 4);
  assert.strictEqual(msg!.blocks[0].type, 'text');
  assert.strictEqual(msg!.blocks[1].type, 'tool_use');
  assert.strictEqual((msg!.blocks[1] as { name: string }).name, 'Read');
  assert.strictEqual(msg!.blocks[2].type, 'tool_result');
  assert.strictEqual((msg!.blocks[2] as { isError?: boolean }).isError, false);
  assert.strictEqual(msg!.blocks[3].type, 'thinking');
});

test('v4: parses array content with only tool_use (no text) — content empty but blocks populated', () => {
  const line =
    '{"type":"assistant","uuid":"a2","sessionId":"s1","timestamp":"2026-07-28T10:00:00.000Z",' +
    '"cwd":"/home/p","message":{"role":"assistant","content":[' +
    '{"type":"tool_use","name":"Bash","input":{"command":"ls"}}' +
    ']}}';
  const msg = parseLine(line);
  assert.ok(msg);
  assert.strictEqual(msg!.content, '');
  assert.strictEqual(msg!.blocks.length, 1);
  assert.strictEqual(msg!.blocks[0].type, 'tool_use');
});

test('v4: unknown block type is preserved as unknown', () => {
  const line =
    '{"type":"assistant","uuid":"a3","sessionId":"s1","timestamp":"2026-07-28T10:00:00.000Z",' +
    '"cwd":"/home/p","message":{"role":"assistant","content":[' +
    '{"type":"image","data":"base64..."}' +
    ']}}';
  const msg = parseLine(line);
  assert.ok(msg);
  assert.strictEqual(msg!.content, '');
  assert.strictEqual(msg!.blocks.length, 1);
  assert.strictEqual(msg!.blocks[0].type, 'unknown');
});

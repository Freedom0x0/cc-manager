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

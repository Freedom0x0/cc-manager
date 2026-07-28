import { test } from 'node:test';
import assert from 'node:assert';
import { buildResumeCommand, buildResumeCommandString } from '../electron/resumer';

test('buildResumeCommand: returns command string with --resume flag', () => {
  const cmd = buildResumeCommand('sess-abc');
  assert.strictEqual(cmd.command, 'claude --resume sess-abc');
  assert.strictEqual(cmd.cwd, undefined);
});

test('buildResumeCommand: includes cwd when provided', () => {
  const cmd = buildResumeCommand('sess-abc', 'C:/some/dir');
  assert.strictEqual(cmd.command, 'claude --resume sess-abc');
  assert.strictEqual(cmd.cwd, 'C:/some/dir');
});

test('buildResumeCommandString: without cwd returns just the command', () => {
  assert.strictEqual(buildResumeCommandString('sess-abc'), 'claude --resume sess-abc');
});

test('buildResumeCommandString: with cwd appends inline comment', () => {
  const s = buildResumeCommandString('sess-abc', 'C:/some/dir');
  assert.ok(s.startsWith('claude --resume sess-abc'));
  assert.ok(s.includes('C:/some/dir'));
});

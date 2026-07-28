import { test } from 'node:test';
import assert from 'node:assert';
import { buildResumeCommand } from '../electron/resumer';

test('command uses claude.cmd and --resume flag', () => {
  const cmd = buildResumeCommand('sess-abc');
  assert.strictEqual(cmd.command, 'claude.cmd');
  assert.deepStrictEqual(cmd.args, ['--resume', 'sess-abc']);
});

test('command respects cwd', () => {
  const cmd = buildResumeCommand('sess-abc', 'C:/some/dir');
  assert.strictEqual(cmd.cwd, 'C:/some/dir');
});

test('cwd is undefined when not provided', () => {
  const cmd = buildResumeCommand('sess-abc');
  assert.strictEqual(cmd.cwd, undefined);
});

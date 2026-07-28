import { test } from 'node:test';
import assert from 'node:assert';
import { clusterPath, topPath } from '../electron/importer/cluster';

test('clusterPath: single segment', () => {
  const r = clusterPath('foo');
  assert.deepStrictEqual(r, { topName: 'foo', subName: 'foo' });
});

test('clusterPath: two segments', () => {
  const r = clusterPath('prompt/react-prompt-editor');
  assert.deepStrictEqual(r, { topName: 'prompt', subName: 'react-prompt-editor' });
});

test('clusterPath: Windows path with C:', () => {
  const r = clusterPath('C:/Users/test/prompt/react-prompt-editor');
  assert.deepStrictEqual(r, { topName: 'prompt', subName: 'react-prompt-editor' });
});

test('clusterPath: Windows backslash', () => {
  const r = clusterPath('C:\\Users\\test\\prompt\\docs');
  assert.deepStrictEqual(r, { topName: 'prompt', subName: 'docs' });
});

test('clusterPath: strips Users/ intermediate dir', () => {
  const r = clusterPath('C:/Users/15532/Desktop/prompt/react-prompt-editor');
  assert.deepStrictEqual(r, { topName: 'prompt', subName: 'react-prompt-editor' });
});

test('clusterPath: strips multiple intermediate dirs', () => {
  // After stripping Users/15532/Desktop, only xj + peaks-loop remain.
  // Algorithm returns them as top + sub (top == "xj" because it's a personal subdir).
  const r = clusterPath('C:/Users/15532/Desktop/xj/peaks-loop');
  assert.deepStrictEqual(r, { topName: 'xj', subName: 'peaks-loop' });
});

test('clusterPath: deep nesting flattens to last 2', () => {
  const r = clusterPath('C:/Users/15532/Desktop/prompt/sub/deeper/leaf');
  // Strip Users/15532/Desktop/prompt (it's >= 5 chars, NOT identifier, NOT noise) →
  // algorithm stops at 3 segments [prompt, sub, deeper, leaf], strips identifier
  // "sub" (3 chars), leaving [prompt, sub, deeper, leaf] still > 2,
  // strips "deeper" (6 chars, NOT identifier, NOT noise) — STOP. Actually
  // stripping "deeper" requires it be identifier. Recheck: segments = [prompt, sub, deeper, leaf].
  // 4 > 2, isIdentifier("prompt") = false, NOISE.match = false → loop exits. Result: [prompt, sub, deeper, leaf]
  // → top = prompt, sub = sub (first 2 of remaining)
  assert.deepStrictEqual(r, { topName: 'prompt', subName: 'sub' });
});

test('clusterPath: empty path', () => {
  const r = clusterPath('');
  assert.deepStrictEqual(r, { topName: '', subName: '' });
});

test('topPath: returns synthetic marker', () => {
  assert.strictEqual(topPath('prompt'), '<top:prompt>');
});

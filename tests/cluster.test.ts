import { test } from 'node:test';
import assert from 'node:assert';
import { clusterPath, topPath } from '../electron/importer/cluster';

test('clusterPath: returns last segment of path', () => {
  const r = clusterPath('C:/Users/test/prompt/react-prompt-editor');
  assert.deepStrictEqual(r, { topName: 'react-prompt-editor', subName: 'react-prompt-editor' });
});

test('clusterPath: single segment', () => {
  const r = clusterPath('prompt');
  assert.deepStrictEqual(r, { topName: 'prompt', subName: 'prompt' });
});

test('clusterPath: two segments', () => {
  const r = clusterPath('prompt/react-prompt-editor');
  assert.deepStrictEqual(r, { topName: 'react-prompt-editor', subName: 'react-prompt-editor' });
});

test('clusterPath: Windows backslash', () => {
  const r = clusterPath('C:\\Users\\test\\Desktop\\cc-session-manager');
  assert.deepStrictEqual(r, { topName: 'cc-session-manager', subName: 'cc-session-manager' });
});

test('clusterPath: deep path returns last dir', () => {
  const r = clusterPath('C:/Users/15532/Desktop/xj/peaks-loop/peaks-code');
  assert.deepStrictEqual(r, { topName: 'peaks-code', subName: 'peaks-code' });
});

test('clusterPath: empty path returns as-is', () => {
  const r = clusterPath('');
  assert.deepStrictEqual(r, { topName: '', subName: '' });
});

test('clusterPath: root Desktop', () => {
  const r = clusterPath('C:/Users/15532/Desktop');
  assert.deepStrictEqual(r, { topName: 'Desktop', subName: 'Desktop' });
});

test('topPath: returns synthetic marker', () => {
  assert.strictEqual(topPath('prompt'), '<top:prompt>');
});

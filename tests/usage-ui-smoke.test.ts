/**
 * tests/usage-ui-smoke.test.ts — v5 wave-3 用量分析 UI smoke 测试(3 case)
 *
 * 同 profiles-ui-smoke.test.ts 模式:不写 React UI 测试,只验 renderer
 * 侧 3 个数据契约层都正确就位。
 *
 * Case 1: src/api.ts 6 函数包装都导出
 *   - 验证 api.usageSummary / usageGetSessionCost / usageGetSessionTimeline /
 *     usageGetProjectBreakdown / usageGetDailyBreakdown / usageGetTopTools
 *     都存在(类型 = function)。
 *
 * Case 2: src/types.ts 导出 UsageSummary 接口
 *   - 跨层共享类型在位(UI 组件依赖它 props)。
 *
 * Case 3: src/mock.ts 6 mock 实现都存在
 *   - 浏览器 dev 模式(纯 vite serve)能正常加载 fixture 数据。
 */

import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { api } from '../src/api';

// src/ 路径解析(测试在仓库根目录跑)
const SRC = path.resolve(__dirname, '..', 'src');

// Case 1: api 6 包装函数都导出且都是函数
test('api.usage* — 6 wrapper functions are exported', () => {
  const expected = [
    'usageSummary',
    'usageGetSessionCost',
    'usageGetSessionTimeline',
    'usageGetProjectBreakdown',
    'usageGetDailyBreakdown',
    'usageGetTopTools',
  ];
  for (const name of expected) {
    assert.strictEqual(
      typeof (api as unknown as Record<string, unknown>)[name],
      'function',
      `api.${name} 应是 function,实际是 ${typeof (api as unknown as Record<string, unknown>)[name]}`
    );
  }
});

// Case 2: types.ts 导出 UsageSummary + 关键子类型
test('types.ts exports UsageSummary interface (cross-layer contract)', () => {
  const typesSrc = fs.readFileSync(path.join(SRC, 'types.ts'), 'utf8');
  assert.match(typesSrc, /export\s+interface\s+UsageSummary\b/, 'types.ts 应导出 UsageSummary interface');
  // 关键字段都在(防字段意外改名)
  const summaryBlock = typesSrc.match(/export\s+interface\s+UsageSummary\s*\{([^}]+)\}/);
  assert.ok(summaryBlock, '应能匹配 UsageSummary interface 体');
  for (const field of [
    'totalSessions',
    'totalMessages',
    'totalTokens',
    'totalDurationMs',
    'byProject',
    'byDay',
    'byTool',
    'generatedAt',
  ]) {
    assert.ok(summaryBlock![1].includes(field), `UsageSummary 应包含字段 ${field}`);
  }
  // 子类型也应导出
  assert.match(typesSrc, /export\s+interface\s+SessionCost\b/);
  assert.match(typesSrc, /export\s+interface\s+SessionTimeline\b/);
});

// Case 3: mock.ts 6 mock 实现都存在
test('mock.ts implements 6 usage* methods (browser dev fixture)', () => {
  const mockSrc = fs.readFileSync(path.join(SRC, 'mock.ts'), 'utf8');
  for (const name of [
    'usageSummary',
    'usageGetSessionCost',
    'usageGetSessionTimeline',
    'usageGetProjectBreakdown',
    'usageGetDailyBreakdown',
    'usageGetTopTools',
  ]) {
    // 用宽松正则:匹配 `name:(` 或 `name: (` 形式
    const re = new RegExp(`\\b${name}\\s*:\\s*[\\(\\(]?\\s*(?:\\(|async|function|ok)`, 'm');
    assert.ok(re.test(mockSrc), `mock.ts 应实现 ${name} 方法`);
  }
});
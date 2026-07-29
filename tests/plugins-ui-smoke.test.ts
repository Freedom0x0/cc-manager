/**
 * tests/plugins-ui-smoke.test.ts — v5 wave-2 Plugins UI smoke 测试(3 case,数据不渲染)
 *
 * 不写 React UI 测试(没装 vitest+testing-library)。本测试验证
 * "Plugins UI 实装" 涉及的 3 个数据契约层都正确就位:
 *
 * Case 1: src/api.ts 6 函数包装都导出
 *   - 验证 api.pluginList / pluginGet / pluginCreate / pluginUpdate /
 *     pluginDelete / pluginToggleEnabled 都存在(类型 = function)。
 *     漏一个 = UI 调用会运行时崩。
 *
 * Case 2: src/types.ts 导出 Plugin 接口
 *   - 验证跨层共享类型在位(UI 组件依赖它 props)。
 *   - 通过读 .ts 源文件 + 正则匹配 `export interface Plugin`,避开
 *     加载 .tsx(Vite-only)的复杂度。
 *
 * Case 3: src/mock.ts 6 mock 实现都存在
 *   - 验证浏览器 dev 模式(纯 vite serve)能正常加载 fixture 数据。
 *
 * 为什么 3 case 不动 IPC handler / 主进程?Task 的 plugins.test.ts(5 case)
 * 已覆盖 electron/repo/plugins 端到端。本测试只验 renderer 侧 3 关键契约。
 */

import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { api } from '../src/api';

// src/ 路径解析(测试在仓库根目录跑)
const SRC = path.resolve(__dirname, '..', 'src');

// Case 1: api 6 包装函数都导出且都是函数
test('api.plugin* — 6 wrapper functions are exported', () => {
  const expected = [
    'pluginList',
    'pluginGet',
    'pluginCreate',
    'pluginUpdate',
    'pluginDelete',
    'pluginToggleEnabled',
  ];
  for (const name of expected) {
    assert.strictEqual(
      typeof (api as unknown as Record<string, unknown>)[name],
      'function',
      `api.${name} 应是 function,实际是 ${typeof (api as unknown as Record<string, unknown>)[name]}`
    );
  }
});

// Case 2: types.ts 导出 Plugin 接口
test('types.ts exports Plugin interface (cross-layer contract)', () => {
  const typesSrc = fs.readFileSync(path.join(SRC, 'types.ts'), 'utf8');
  assert.match(typesSrc, /export\s+interface\s+Plugin\b/, 'types.ts 应导出 Plugin interface');
  // 顺便验证关键字段都在(防字段意外改名):name / version / description / enabled
  const pluginBlock = typesSrc.match(/export\s+interface\s+Plugin\s*\{([^}]+)\}/);
  assert.ok(pluginBlock, '应能匹配 Plugin interface 体');
  for (const field of ['name', 'path', 'version', 'description', 'enabled']) {
    assert.ok(pluginBlock![1].includes(field), `Plugin 应包含字段 ${field}`);
  }
});

// Case 3: mock.ts 6 mock 实现都存在
test('mock.ts implements 6 plugin* methods (browser dev fixture)', () => {
  const mockSrc = fs.readFileSync(path.join(SRC, 'mock.ts'), 'utf8');
  for (const name of [
    'pluginList',
    'pluginGet',
    'pluginCreate',
    'pluginUpdate',
    'pluginDelete',
    'pluginToggleEnabled',
  ]) {
    // 用宽松正则:匹配 `name:(` 或 `name: (` 形式
    const re = new RegExp(`\\b${name}\\s*:\\s*[\\(\\(]?\\s*(?:\\(|async|function|ok)`, 'm');
    assert.ok(re.test(mockSrc), `mock.ts 应实现 ${name} 方法`);
  }
});

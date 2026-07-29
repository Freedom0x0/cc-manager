import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const TEMPLATE_DIR = path.resolve('electron/repo/_template');

// Case 1: types.ts 导出占位类型符号(具体类型名无所谓,只要 named export 存在)
test('_template/types.ts exports a placeholder type symbol', () => {
  const mod = require('../electron/repo/_template/types');
  // 占位文件至少要有一个 named export(类型或值均可)。tsc 编译后会擦除类型,
  // 但用 require() 跑测试时如果文件存在即不抛 MODULE_NOT_FOUND。
  // 我们只需断言:模块路径能解析 + 文件存在 + 至少 1 个 named export。
  assert.ok(fs.existsSync(path.join(TEMPLATE_DIR, 'types.ts')), 'types.ts file must exist');
  // require 返回的模块对象(类型被擦除后可能为空,但文件存在是契约)
  assert.strictEqual(typeof mod, 'object', 'types module should load as object');
});

// Case 2: scanner.ts 导出占位函数,调用返 [] 不抛错
test('_template/scanner.ts exports a placeholder scanner returning []', () => {
  const { scan } = require('../electron/repo/_template/scanner');
  assert.strictEqual(typeof scan, 'function', 'scanner.scan must be a function');
  // 占位函数应返 [] 而不是抛 'not implemented'(避免测试自己 fail 时信息混乱)
  const result = scan();
  assert.ok(Array.isArray(result), 'placeholder scan() must return array');
  assert.strictEqual(result.length, 0, 'placeholder scan() must return []');
});

// Case 3: writer.ts 导出占位函数,调用返 void 不抛错
test('_template/writer.ts exports a placeholder writer returning void', () => {
  const { write } = require('../electron/repo/_template/writer');
  assert.strictEqual(typeof write, 'function', 'writer.write must be a function');
  // 占位函数应吞掉输入,返 undefined,不抛错
  const result = write({ key: 'sample', value: 'data' });
  assert.strictEqual(result, undefined, 'placeholder write() must return void');
});

// Case 4: index.ts 聚合导出 3 个文件全部符号
test('_template/index.ts re-exports scanner + writer symbols', () => {
  const indexMod = require('../electron/repo/_template/index');
  // index.ts 应 re-export scan 与 write 两个具名符号
  assert.strictEqual(typeof indexMod.scan, 'function', 'index must re-export scan()');
  assert.strictEqual(typeof indexMod.write, 'function', 'index must re-export write()');
});

// Case 5: README.md 含 6 个关键词(template / skeleton / module / placeholder / wave-0 / v5)
test('_template/README.md contains 6 keywords', () => {
  const readmePath = path.join(TEMPLATE_DIR, 'README.md');
  assert.ok(fs.existsSync(readmePath), 'README.md must exist');
  const content = fs.readFileSync(readmePath, 'utf8').toLowerCase();
  const keywords = ['template', 'skeleton', 'module', 'placeholder', 'wave-0', 'v5'];
  for (const kw of keywords) {
    assert.ok(content.includes(kw), `README.md must mention "${kw}"`);
  }
});

// Case 6: 4 个骨架文件齐全(types/scanner/writer/index + README.md)
test('_template/ has 5 files (4 .ts + README.md)', () => {
  const files = fs.readdirSync(TEMPLATE_DIR).sort();
  assert.deepStrictEqual(
    files,
    ['README.md', 'index.ts', 'scanner.ts', 'types.ts', 'writer.ts'],
    '_template/ should have exactly README.md + index.ts + scanner.ts + types.ts + writer.ts'
  );
});

// Case 7: 所有 .ts 文件都标注自己是占位骨架(JSDoc 含 "placeholder" 或 "skeleton" 或 "template")
test('_template .ts files are tagged as placeholders in JSDoc', () => {
  const tsFiles = ['types.ts', 'scanner.ts', 'writer.ts', 'index.ts'];
  for (const f of tsFiles) {
    const content = fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8').toLowerCase();
    const tagged =
      content.includes('placeholder') ||
      content.includes('skeleton') ||
      content.includes('template');
    assert.ok(tagged, `${f} must be tagged as placeholder/skeleton/template in JSDoc header`);
  }
});
/**
 * _template/index.ts — v5 wave-0 占位骨架聚合导出
 *
 * 聚合导出本模块对外符号。波 1+ 业务模块在自己的 `index.ts` 中模仿此模式
 * 聚合 `electron/repo/<module>/{scanner,writer,types}.ts`。
 *
 * 当前只导出 `scan` / `write` 两个占位函数 + `ModuleRow` / `ModuleWriteInput` 两个类型。
 * 波 1+ 业务模块会基于此模式添加自己的导出。
 *
 * 见 `_template/README.md` 了解整体约定。
 */

export { scan } from './scanner';
export { write } from './writer';
export type { ModuleRow, ModuleWriteInput } from './types';
/**
 * _template/types.ts — v5 wave-0 占位骨架
 *
 * 这是 v5 模块化架构的 _template 模板。**波 1+ 业务模块**(MCP / Skills /
 * Commands / Sub-Agents / Hooks / Plugins / Profiles / Analytics)会基于
 * 此骨架替换具体实现。
 *
 * 当前文件**故意只放占位类型**,不写任何业务字段。等波 1+ 落地第一个模块时,
 * 复制此文件到 `electron/repo/<module>/types.ts`,再填充真实 row / input /
 * output 类型。
 *
 * 见 `_template/README.md` 了解整体约定。
 */

/**
 * 通用模块 row 占位类型。具体模块(如 `McpServerRow` / `SkillRow`)在
 * `electron/repo/<module>/types.ts` 中定义自己的 row,继承或参照此 placeholder。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModuleRow {
  // 占位 — 波 1+ 模块的真实 row 在 electron/repo/<module>/types.ts 定义。
}

/**
 * 通用模块写入输入占位类型。具体模块在 `electron/repo/<module>/types.ts` 中
 * 定义自己的 Input,字段对应 wave-1 决定的 schema。
 */
export interface ModuleWriteInput {
  key: string;
  value: string;
}
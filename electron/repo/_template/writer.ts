/**
 * _template/writer.ts — v5 wave-0 占位骨架
 *
 * 占位 writer 函数 `write()`:波 1+ 业务模块会基于此签名替换真实实现,
 * 例如 `electron/repo/mcp/writer.ts` 写 mcp.json / `electron/repo/skills/writer.ts`
 * 写 skill 文件等。
 *
 * 当前实现吞掉输入返 `undefined`,**不**抛 'not implemented':与 scanner
 * 同理,避免 _template 自身被引用时引入二次失败。
 *
 * 见 `_template/README.md` 了解整体约定。
 */

import type { ModuleWriteInput } from './types';

/**
 * 占位写入函数。波 1+ 模块替换为真实实现(写 JSONL / DB row / 文件覆盖等)。
 *
 * @param _input 写入输入。波 1+ 替换后用真实 `McpWriteInput` / `SkillWriteInput` 等。
 * @returns 永远返 `undefined`。波 1+ 替换后返 `void` 或写入结果 ID。
 */
export function write(_input: ModuleWriteInput): void {
  // 占位骨架:波 1+ 模块在此函数体内实现真实写入逻辑。
  // 当前故意吞掉输入返 void,便于 _template 自身被其他模块引用时不破坏链路。
  return;
}
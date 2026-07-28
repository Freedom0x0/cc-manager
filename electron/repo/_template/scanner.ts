/**
 * _template/scanner.ts — v5 wave-0 占位骨架
 *
 * 占位 scanner 函数 `scan()`:波 1+ 业务模块会基于此签名替换真实实现,
 * 例如 `electron/repo/mcp/scanner.ts` 扫 `~/.claude/mcp.json`,
 * `electron/repo/skills/scanner.ts` 扫 `~/.claude/skills/*` 等。
 *
 * 当前实现返 `[]`,**不**抛 'not implemented':测试自己的 fail 应是
 * 红 → 绿路径的预期失败,而不是被 throw 二次混淆。
 *
 * 见 `_template/README.md` 了解整体约定。
 */

/**
 * 占位扫描函数。波 1+ 模块替换为真实实现(读目录 / 解析 JSONL / 读 *.json 等)。
 *
 * @returns 永远返空数组。波 1+ 替换后返该模块的 entity 列表。
 */
export function scan(): unknown[] {
  // 占位骨架:波 1+ 模块在此函数体内实现真实扫描逻辑。
  // 当前故意返 [] 而不是 throw 'not implemented',便于 _template 自身被其他
  // 模块引用时不破坏链路。
  return [];
}
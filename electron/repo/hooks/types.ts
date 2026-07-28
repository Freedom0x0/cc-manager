/**
 * electron/repo/hooks/types.ts — v5 wave-2 Hooks 模块跨层共享类型
 *
 * 跨层复用约定(CLAUDE.md §5):electron 主进程不 import src/types.ts(主进程
 * 不能跑浏览器模块),所以 Hook 实体类型在本文件定义,再由 src/types.ts
 * 同样形状地再声明一次。两边必须保持字段一致。
 *
 * Hook 是**对外契约**:scanner 读 ~/.claude/settings.json 的 hooks 字段
 * (PreToolUse: [...], PostToolUse: [...], ...)→ 扁平化 + 注入 enabled
 * (从 mcp_server_state KV 表读,key 前缀 'hook:enabled:<id>')后返回。
 *
 * 与 SubAgent 不同:Hook 是**改 settings.json**(单文件嵌套 JSON),不是新建
 * 单文件 .md。原子写策略 tmp + rename(同 mcp/writer.ts 模式)。
 *
 * scope 字段:本 task 只支持 'global',UI 隐藏选项 / 固定为 global。
 *
 * id 设计:${event}-${index} 简单方案(D7 简化决策),list 时按 event 分组
 * 扁平化后,index 在 event 数组内稳定。create 后 index 可能变(数组 push),
 * 这是已知简化、UI 接受。
 */

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'Notification'
  | 'UserPromptSubmit';

export const HOOK_EVENTS: HookEvent[] = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'Notification',
  'UserPromptSubmit',
];

/** settings.json 内部 hook 条目格式(嵌套数组里每项的形态) */
export interface HookEntry {
  matcher?: string;
  hooks: { type: 'command'; command: string }[];
}

/**
 * Hook — 跨层共享实体类型
 *
 * id 字段:由 scanner 拼装 `${event}-${index}` 给出,作为 UI 的主键
 * (用于 switch / delete / update 的目标定位)。create 时由 writer 反向
 * 解析 event + 在 event 数组末尾 push 一条;update/delete 通过 id 找到
 * event + index 后操作。
 */
export interface Hook {
  id: string;
  event: HookEvent;
  matcher?: string;
  command: string;
  enabled: boolean;
  scope: 'global';
}

/** createHook 接收的输入 */
export interface HookCreateInput {
  event: HookEvent;
  matcher?: string;
  command: string;
}

/** updateHook 接收的 patch:除 id/event/enabled 外都可改 */
export interface HookUpdatePatch {
  matcher?: string;
  command?: string;
}

/**
 * electron/repo/profiles/types.ts — v5 wave-3 Profiles 模块跨层共享类型
 *
 * 跨层复用约定(CLAUDE.md §5):electron 主进程不 import src/types.ts(主进程
 * 不能跑浏览器模块),所以 Profile 实体类型在本文件定义,再由 src/types.ts
 * 同样形状地再声明一次。两边必须保持字段一致。
 *
 * Profile 是**整个 ~/.claude 状态的快照**:config.enabled* 字段记录 6 个
 * 业务模块(MCP / Skills / Commands / Sub-Agents / Hooks / Plugins)中当前
 * 启用项的列表。profile_apply 把 enabled* 列表写回 mcp_server_state KV 表
 * (D6 + D9 决策延伸:enabled 状态独立存,profile 是 KV 状态的多模块合并视图)。
 *
 * profiles.json 单文件存储:{ profiles: Profile[] } — 走原子写(同 hooks /
 * plugins 模式)。
 *
 * profile_apply 事务化语义(任务硬规则):
 *   1. 备份当前 KV 表所有 'enabled:' / '<prefix>:enabled:' 状态
 *   2. 应用 profile.config.enabled* → setEnabled(...) 写 KV
 *   3. 验证(读回检查)
 *   4. 任何步骤失败 → 回滚 KV 表到备份状态
 * 不备份原文件 ~/.claude.json / SKILL.md / commands/*.md — profile_apply
 * 只切换 enabled 状态(沿用 D6 决策)。
 */

export interface ProfileConfig {
  /** MCP server 启用名列表 — KV key 前缀 'mcp:'(对应 mcp/state.ts) */
  enabledServers: string[];
  /** Skill 启用名列表 — KV key 前缀 'skill:' */
  enabledSkills: string[];
  /** Command 启用名列表 — KV key 前缀 'cmd:' */
  enabledCommands: string[];
  /** Sub-Agent 启用名列表 — KV key 前缀 'agent:' */
  enabledAgents: string[];
  /** Hook 启用 ID 列表 — KV key 前缀 'hook:' */
  enabledHooks: string[];
  /** Plugin 启用名列表 — KV key 前缀 'plugin:' */
  enabledPlugins: string[];
}

export interface Profile {
  /** 主键 */
  name: string;
  /** 用户备注 */
  description: string;
  /** 整个 ~/.claude 状态的快照(capture 时从 KV 表读) */
  config: ProfileConfig;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp */
  updatedAt: string;
}

/**
 * createProfile 接收的输入:必填 name + description,config 由 capture 函数
 * 实时从 KV 表读(用户在 UI 上选 "Capture" 时调用)。
 */
export interface ProfileCreateInput {
  name: string;
  description: string;
}

/**
 * updateProfile 接收的 patch:目前只能改 description(不重生成 config)。
 * 想重生成 config 就 deleteProfile + createProfile。
 */
export interface ProfileUpdatePatch {
  description?: string;
}
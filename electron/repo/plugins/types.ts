/**
 * electron/repo/plugins/types.ts — v5 wave-2 Plugins 模块跨层共享类型
 *
 * 数据源(2026-07-30 修):
 * Claude Code 实际 schema 是 ~/.claude/plugins/installed_plugins.json 单文件:
 *   {
 *     "version": 2,
 *     "plugins": {
 *       "code-review@claude-plugins-official": [
 *         { "scope": "user", "installPath": "...", "version": "...",
 *           "installedAt": "...", "lastUpdated": "...", "gitCommitSha": "..." }
 *       ],
 *       ...
 *     }
 *   }
 *
 * key 格式: `<shortName>@<marketplace>`(如 code-review@claude-plugins-official)
 * value: array of installed versions(同 plugin 可装多个 version,目前通常 1 个)
 *
 * 跨层复用约定(CLAUDE.md §5):electron 主进程不 import src/types.ts,所以
 * Plugin 实体类型在本文件定义,再由 src/types.ts 同样形状地再声明一次。
 */

export interface Plugin {
  /** 完整 name@marketplace,主键 */
  fullName: string;
  /** 解析后的 shortName,如 'code-review' */
  name: string;
  /** 解析后的 marketplace,如 'claude-plugins-official' */
  marketplace: string;
  /** 实际安装路径 */
  installPath: string;
  /** version 字符串(可能是 git commit sha 或 semver) */
  version: string;
  /** 安装 scope:user(全局)或 project(项目级)— 本 task 只支持 user */
  scope: 'user' | 'project';
  /** 安装时间 ISO */
  installedAt: string;
  /** 最后更新时间 ISO */
  lastUpdated: string;
  /** git commit sha */
  gitCommitSha: string;
  /** 用户 toggle 的启用状态,从 mcp_server_state KV 表读(默认 true) */
  enabled: boolean;
}

/**
 * installed_plugins.json 顶层结构(只读 type)
 */
export interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, InstalledPluginVersion[]>;
}

export interface InstalledPluginVersion {
  scope: 'user' | 'project';
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha: string;
}

/**
 * createPlugin 接收的输入(在主进程严格校验)。
 * 注意:Claude Code plugins 是从 marketplace 装,本应用**不实际**安装新 plugin
 * (那需要 marketplace API + git clone)。createPlugin 仅作 UI 占位。
 */
export interface PluginCreateInput {
  fullName: string;       // 含 @marketplace
  installPath: string;
  version: string;
  scope: 'user' | 'project';
}

export interface PluginUpdatePatch {
  scope?: 'user' | 'project';
  version?: string;
}

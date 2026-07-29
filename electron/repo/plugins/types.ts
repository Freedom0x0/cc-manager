/**
 * electron/repo/plugins/types.ts — v5 wave-2 Plugins 模块跨层共享类型
 *
 * 跨层复用约定(CLAUDE.md §5):electron 主进程不 import src/types.ts(主进程
 * 不能跑浏览器模块),所以 Plugin 实体类型在本文件定义,再由 src/types.ts
 * 同样形状地再声明一次。两边必须保持字段一致。
 *
 * Plugin 是**对外契约**:scanner 读 ~/.claude/plugins/<name>/plugin.json
 * 单文件 → 注入 enabled 状态(从 mcp_server_state KV 表读,key 前缀
 * 'plugin:enabled:<name>')后返回。
 *
 * 与 Skill 类似(都存子目录),但用 JSON 而非 frontmatter,且 schema 严格
 * 校验(name / version / description 必填)— wave-2-spec §2.3。
 *
 * pluginsDir 参数是模块级 fixture 注入点(CLAUDE.md §13 D10)。
 */

export interface Plugin {
  /** 子目录名,主键 */
  name: string;
  /** 完整路径:~/.claude/plugins/<name>/ */
  path: string;
  /** plugin.json.version — semver 字符串(必填,非空) */
  version: string;
  /** plugin.json.description(必填,非空) */
  description: string;
  /** plugin.json.author(可选) */
  author?: string;
  /** plugin.json.dependencies(可选,字符串数组) */
  dependencies?: string[];
  /** plugin.json.entry(可选,主入口文件) */
  entry?: string;
  /** 用户 toggle 的启用状态,从 mcp_server_state KV 表读(默认 true) */
  enabled: boolean;
}

/**
 * createPlugin 接收的输入:必填 name/version/description 严格校验
 * (writer.ts 用 validatePluginInput 抛错,不是 silent return null)
 */
export interface PluginCreateInput {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: string[];
  entry?: string;
}

/** updatePlugin 接收的 patch:除 name/path/enabled 外都可改 */
export interface PluginUpdatePatch {
  version?: string;
  description?: string;
  author?: string;
  dependencies?: string[];
  entry?: string;
}

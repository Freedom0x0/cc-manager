// Rich fixture data for the browser mock — covers 3 projects with varied sessions
// so the UI is visually informative in screenshots.

import type { SessionRow, ProjectTreeNode } from './types';

export const testProjects = [
  { id: 1, path: 'C:/Users/15532/Desktop/prompt', name: 'prompt', sessionCount: 3 },
  { id: 2, path: 'C:/Users/15532/Desktop/cc-session-manager', name: 'cc-session-manager', sessionCount: 2 },
  { id: 3, path: 'C:/Users/15532/Desktop/xj/peaks-loop', name: 'peaks-loop', sessionCount: 4 },
];

export const testProjectTree: ProjectTreeNode[] = [
  { id: 100, name: 'react-prompt-editor', path: 'C:/Users/15532/Desktop/prompt/react-prompt-editor', sessionCount: 2 },
  { id: 101, name: 'boss-prompts-manager', path: 'C:/Users/15532/Desktop/prompt/boss-prompts-manager', sessionCount: 0 },
  { id: 200, name: 'cc-session-manager', path: 'C:/Users/15532/Desktop/cc-session-manager', sessionCount: 2 },
  { id: 300, name: 'peaks-loop', path: 'C:/Users/15532/Desktop/xj/peaks-loop', sessionCount: 1 },
  { id: 301, name: 'peaks-code', path: 'C:/Users/15532/Desktop/xj/peaks-loop/peaks-code', sessionCount: 0 },
];

export type TestSession = SessionRow & { isDeleted?: 0 | 1 };

export const testSessions: TestSession[] = [
  {
    id: 1,
    sessionId: 'sess-prompt-1',
    projectId: 1,
    title: '用 claude code 改写登录 token 过期逻辑',
    startedAt: Date.parse('2026-07-26T10:00:00.000Z'),
    lastMessageAt: Date.parse('2026-07-26T11:23:00.000Z'),
    messageCount: 8,
    sourceFile: 'C:/Users/15532/Desktop/prompt/sess-prompt-1.jsonl',
    firstUserMessage: '用 claude code 改写登录 token 过期逻辑',
  },
  {
    id: 2,
    sessionId: 'sess-prompt-2',
    projectId: 1,
    title: '新增 /api/users 路由',
    startedAt: Date.parse('2026-07-25T14:00:00.000Z'),
    lastMessageAt: Date.parse('2026-07-25T15:30:00.000Z'),
    messageCount: 12,
    sourceFile: 'C:/Users/15532/Desktop/prompt/sess-prompt-2.jsonl',
    firstUserMessage: '新增 /api/users 路由',
  },
  {
    id: 3,
    sessionId: 'sess-prompt-3',
    projectId: 1,
    title: '修复 react-prompt-editor 选区 bug',
    startedAt: Date.parse('2026-07-20T09:00:00.000Z'),
    lastMessageAt: Date.parse('2026-07-20T09:45:00.000Z'),
    messageCount: 5,
    sourceFile: 'C:/Users/15532/Desktop/prompt/sess-prompt-3.jsonl',
    firstUserMessage: '修复 react-prompt-editor 选区 bug',
  },
  {
    id: 4,
    sessionId: 'sess-ccsm-1',
    projectId: 2,
    title: '如何高效管理 Claude Code 会话',
    startedAt: Date.parse('2026-07-27T22:00:00.000Z'),
    lastMessageAt: Date.parse('2026-07-28T00:30:00.000Z'),
    messageCount: 6,
    sourceFile: 'C:/Users/15532/Desktop/cc-session-manager/sess-ccsm-1.jsonl',
    firstUserMessage: '目前我在用claude code做开发，但是我发现会话很难管理',
  },
  {
    id: 5,
    sessionId: 'sess-ccsm-2',
    projectId: 2,
    title: 'Tauri vs Electron 选型对比',
    startedAt: Date.parse('2026-07-27T23:00:00.000Z'),
    lastMessageAt: Date.parse('2026-07-27T23:45:00.000Z'),
    messageCount: 4,
    sourceFile: 'C:/Users/15532/Desktop/cc-session-manager/sess-ccsm-2.jsonl',
    firstUserMessage: 'Tauri 还是 Electron',
  },
  {
    id: 6,
    sessionId: 'sess-peaks-1',
    projectId: 3,
    title: 'peaks-loop 子代理调度',
    startedAt: Date.parse('2026-07-15T10:00:00.000Z'),
    lastMessageAt: Date.parse('2026-07-15T11:30:00.000Z'),
    messageCount: 10,
    sourceFile: 'C:/Users/15532/Desktop/xj/peaks-loop/sess-peaks-1.jsonl',
    firstUserMessage: 'peaks-loop 子代理调度',
  },
  {
    id: 7,
    sessionId: 'sess-peaks-2',
    projectId: 3,
    title: 'Karpathy 4 准则落地',
    startedAt: Date.parse('2026-07-10T14:00:00.000Z'),
    lastMessageAt: Date.parse('2026-07-10T16:00:00.000Z'),
    messageCount: 14,
    sourceFile: 'C:/Users/15532/Desktop/xj/peaks-loop/sess-peaks-2.jsonl',
    firstUserMessage: 'Karpathy 4 准则落地',
  },
  {
    id: 8,
    sessionId: 'sess-peaks-3',
    projectId: 3,
    title: 'brainstorming skill 触发条件',
    startedAt: Date.parse('2026-07-05T09:00:00.000Z'),
    lastMessageAt: Date.parse('2026-07-05T10:30:00.000Z'),
    messageCount: 7,
    sourceFile: 'C:/Users/15532/Desktop/xj/peaks-loop/sess-peaks-3.jsonl',
    firstUserMessage: 'brainstorming skill 触发条件',
  },
  {
    id: 9,
    sessionId: 'sess-peaks-4',
    projectId: 3,
    title: 'session checkpoint 上下文溢出处理',
    startedAt: Date.parse('2026-07-01T10:00:00.000Z'),
    lastMessageAt: Date.parse('2026-07-01T12:00:00.000Z'),
    messageCount: 9,
    sourceFile: 'C:/Users/15532/Desktop/xj/peaks-loop/sess-peaks-4.jsonl',
    firstUserMessage: 'session checkpoint 上下文溢出处理',
    isDeleted: 1, // demo: one session already in recycle bin
  },
];

export const testMessages = [
  // sess-prompt-1
  { id: 1, uuid: 'u-p1-1', sessionId: 'sess-prompt-1', role: 'user' as const, content: '用 claude code 改写登录 token 过期逻辑', createdAt: Date.parse('2026-07-26T10:00:00.000Z') },
  { id: 2, uuid: 'a-p1-1', sessionId: 'sess-prompt-1', role: 'assistant' as const, content: '好的，先看现有代码。我先打开 src/auth/token.ts 看下当前实现。', createdAt: Date.parse('2026-07-26T10:00:30.000Z') },
  { id: 3, uuid: 'u-p1-2', sessionId: 'sess-prompt-1', role: 'user' as const, content: '改成自动续期：accessToken 过期前 5 分钟自动 refresh', createdAt: Date.parse('2026-07-26T10:05:00.000Z') },
  { id: 4, uuid: 'a-p1-2', sessionId: 'sess-prompt-1', role: 'assistant' as const, content: '我建议用一个 interceptor 拦截 401 响应，统一处理 refresh。\n\n```ts\naxios.interceptors.response.use(undefined, async (err) => {\n  if (err.response?.status === 401) {\n    const newToken = await refreshToken();\n    err.config.headers.Authorization = `Bearer ${newToken}`;\n    return axios(err.config);\n  }\n  return Promise.reject(err);\n});\n```\n\n这样所有 401 都会自动重试一次，不用每个 API 调用都单独处理。', createdAt: Date.parse('2026-07-26T10:08:00.000Z') },
  { id: 5, uuid: 'u-p1-3', sessionId: 'sess-prompt-1', role: 'user' as const, content: '并发请求 401 怎么办？会触发多次 refresh', createdAt: Date.parse('2026-07-26T10:10:00.000Z') },
  { id: 6, uuid: 'a-p1-3', sessionId: 'sess-prompt-1', role: 'assistant' as const, content: '对，要加一个单例 Promise。我改成：\n\n```ts\nlet refreshing: Promise<string> | null = null;\n\nasync function refreshOnce() {\n  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });\n  return refreshing;\n}\n```\n\n这样 100 个并发 401 也只 refresh 一次。', createdAt: Date.parse('2026-07-26T10:12:00.000Z') },
  { id: 7, uuid: 'u-p1-4', sessionId: 'sess-prompt-1', role: 'user' as const, content: '好，就这样改', createdAt: Date.parse('2026-07-26T11:20:00.000Z') },
  { id: 8, uuid: 'a-p1-4', sessionId: 'sess-prompt-1', role: 'assistant' as const, content: '改完了，测试通过。提交 commit: `feat(auth): auto-refresh token on 401, dedup concurrent refresh`', createdAt: Date.parse('2026-07-26T11:23:00.000Z') },

  // sess-prompt-2
  { id: 10, uuid: 'u-p2-1', sessionId: 'sess-prompt-2', role: 'user' as const, content: '新增 /api/users 路由', createdAt: Date.parse('2026-07-25T14:00:00.000Z') },
  { id: 11, uuid: 'a-p2-1', sessionId: 'sess-prompt-2', role: 'assistant' as const, content: '用什么技术栈？Express 还是 Hono？要不要接数据库？', createdAt: Date.parse('2026-07-25T14:00:30.000Z') },
  { id: 12, uuid: 'u-p2-2', sessionId: 'sess-prompt-2', role: 'user' as const, content: 'Express，MySQL 已有用户表 users(id, name, email, created_at)', createdAt: Date.parse('2026-07-25T14:02:00.000Z') },
  { id: 13, uuid: 'a-p2-2', sessionId: 'sess-prompt-2', role: 'assistant' as const, content: '好，路由如下：\n- GET /api/users — 列表（分页 ?page&size）\n- GET /api/users/:id — 详情\n- POST /api/users — 创建\n- PUT /api/users/:id — 更新\n- DELETE /api/users/:id — 删除\n\n参数校验用 zod。', createdAt: Date.parse('2026-07-25T14:05:00.000Z') },
  { id: 14, uuid: 'u-p2-3', sessionId: 'sess-prompt-2', role: 'user' as const, content: 'POST 加唯一性校验，email 重复返回 409', createdAt: Date.parse('2026-07-25T15:00:00.000Z') },
  { id: 15, uuid: 'a-p2-3', sessionId: 'sess-prompt-2', role: 'assistant' as const, content: '好的，service 层捕获 ER_DUP_ENTRY (errno 1062) 映射成 409 Conflict。', createdAt: Date.parse('2026-07-25T15:25:00.000Z') },

  // sess-ccsm-1
  { id: 20, uuid: 'u-cc1', sessionId: 'sess-ccsm-1', role: 'user' as const, content: '目前我在用claude code做开发，但是我发现会话很难管理，但我又得频繁的开新会话，有没有办法高效地管理会话', createdAt: Date.parse('2026-07-27T22:00:00.000Z') },
  { id: 21, uuid: 'a-cc1', sessionId: 'sess-ccsm-1', role: 'assistant' as const, content: '好问题。常见做法：\n1. 用 CLAUDE.md 把项目上下文固化下来\n2. 用 /compact 控制上下文\n3. 自己写一个会话管理工具\n\n你想做哪种？', createdAt: Date.parse('2026-07-27T22:01:00.000Z') },
  { id: 22, uuid: 'u-cc2', sessionId: 'sess-ccsm-1', role: 'user' as const, content: '先做一个最简单的，类似 cc_switch', createdAt: Date.parse('2026-07-27T22:05:00.000Z') },
  { id: 23, uuid: 'a-cc2', sessionId: 'sess-ccsm-1', role: 'assistant' as const, content: 'cc_switch 主要问题：搜索弱，没有关键词检索。\n\n建议：\n- 完全接管：把 ~/.claude/projects/ 复制到自己库\n- 软删除 + 回收站\n- FTS5 全文搜索（毫秒级）\n- Tauri 桌面应用', createdAt: Date.parse('2026-07-27T22:08:00.000Z') },
  { id: 24, uuid: 'u-cc3', sessionId: 'sess-ccsm-1', role: 'user' as const, content: '按你推荐的来', createdAt: Date.parse('2026-07-27T22:10:00.000Z') },
  { id: 25, uuid: 'a-cc3', sessionId: 'sess-ccsm-1', role: 'assistant' as const, content: '好，进 brainstorming。', createdAt: Date.parse('2026-07-28T00:30:00.000Z') },
];

export const testSearchHits = [
  {
    message: testMessages[3],
    snippet: '我建议用一个 <mark>interceptor</mark> 拦截 401 响应，统一处理 refresh',
    sessionTitle: '用 claude code 改写登录 token 过期逻辑',
    projectName: 'prompt',
    projectId: 1,
  },
  {
    message: testMessages[5],
    snippet: '对，要加一个单例 <mark>Promise</mark>。我改成',
    sessionTitle: '用 claude code 改写登录 token 过期逻辑',
    projectName: 'prompt',
    projectId: 1,
  },
];

// Dev-only mock: when window.api is missing (i.e. opened in plain browser via Vite,
// not inside Electron), provide a fixture-backed implementation so we can preview the UI
// and take screenshots. The real Electron IPC is unaffected.

import { testProjects, testSessions, testMessages, testSearchHits, testProjectTree } from './mock-data';
import type { McpServer, Skill, Command, SubAgent, Hook, Plugin, Profile } from './types';

// v5 wave-1 MCP 模块 fixture。浏览器 dev 模式(纯 vite serve)用,
const testMcpServers: McpServer[] = [
  {
    name: 'filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    env: { ROOT: 'C:/Users/15532/Desktop' },
    description: 'Local filesystem access',
    enabled: true,
    source: 'global',
  },
  {
    name: 'github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    description: 'GitHub integration',
    enabled: false,
    source: 'global',
  },
];

// v5 wave-1 Commands 模块 fixture。浏览器 dev 模式(纯 vite serve)用,
const testCommands: Command[] = [
  {
    name: 'review',
    path: 'C:/Users/15532/.claude/commands/review.md',
    description: 'Review changed files in the current branch',
    argumentHint: '[path]',
    enabled: true,
    body: 'Run git diff and review each change for correctness and style.',
  },
  {
    name: 'release',
    path: 'C:/Users/15532/.claude/commands/release.md',
    description: 'Bump version, tag, and push release commit',
    enabled: false,
    body: 'Increment version, update changelog, git tag and push.',
  },
];

// v5 wave-1 Skills 模块 fixture。浏览器 dev 模式(纯 vite serve)用,
const testSkills: Skill[] = [
  {
    name: 'commit-helper',
    path: 'C:/Users/15532/.claude/skills/commit-helper',
    description: 'Generate commit message from staged diff',
    allowedTools: ['Bash', 'Read'],
    enabled: true,
    version: '1.0.0',
    body: 'When the user asks to commit, generate a message following Conventional Commits.',
  },
  {
    name: 'code-review',
    path: 'C:/Users/15532/.claude/skills/code-review',
    description: 'Review code for style and bugs',
    allowedTools: ['Read', 'Grep'],
    enabled: false,
    body: 'Review the code in the current directory.',
  },
];

// v5 wave-2 Sub-Agents 模块 fixture。浏览器 dev 模式(纯 vite serve)用,
// 同 commands/skills 结构但存 ~/.claude/agents/<name>.md 单文件。
const testSubAgents: SubAgent[] = [
  {
    name: 'explore',
    path: 'C:/Users/15532/.claude/agents/explore.md',
    description: 'Read-only code exploration agent',
    argumentHint: '<path>',
    enabled: true,
    body: 'Use Glob/Grep/Read to explore the codebase without modifying files.',
  },
  {
    name: 'plan',
    path: 'C:/Users/15532/.claude/agents/plan.md',
    description: 'Plan a multi-step implementation',
    enabled: false,
    body: 'Analyze requirements and propose a phased plan before code changes.',
  },
];

// v5 wave-2 Plugins 模块 fixture。浏览器 dev 模式(纯 vite serve)用,
// 数据来源是 ~/.claude/plugins/<name>/plugin.json JSON,严格 schema 校验。
const testPlugins: Plugin[] = [
  {
    name: 'gh',
    path: 'C:/Users/15532/.claude/plugins/gh',
    version: '1.2.0',
    description: 'GitHub CLI helpers',
    author: 'octocat',
    dependencies: ['git', 'gh-cli'],
    entry: 'index.js',
    enabled: true,
  },
  {
    name: 'docker-tools',
    path: 'C:/Users/15532/.claude/plugins/docker-tools',
    version: '0.1.0',
    description: 'Docker workflow shortcuts',
    enabled: false,
  },
];

// v5 wave-2 Hooks 模块 fixture。浏览器 dev 模式(纯 vite serve)用,
// 数据来源是 ~/.claude/settings.json 的 hooks 字段嵌套数组(扁平化为 Hook)。
const testHooks: Hook[] = [
  {
    id: 'PreToolUse-0',
    event: 'PreToolUse',
    matcher: 'Bash',
    command: 'echo "before bash tool"',
    enabled: true,
    scope: 'global',
  },
  {
    id: 'PostToolUse-0',
    event: 'PostToolUse',
    command: 'echo "after tool"',
    enabled: true,
    scope: 'global',
  },
  {
    id: 'Stop-0',
    event: 'Stop',
    matcher: '*',
    command: 'echo "on stop"',
    enabled: false,
    scope: 'global',
  },
];

// v5 wave-3 Profiles 模块 fixture。浏览器 dev 模式(纯 vite serve)用,
// 数据来源是 ~/.claude/profiles.json 单文件 JSON。Profile.config 是整个
// ~/.claude 状态的快照 — 6 个 enabled* 命名空间的合并视图。
const testProfiles: Profile[] = [
  {
    name: 'default',
    description: 'Default workspace — everything enabled',
    config: {
      enabledServers: ['filesystem'],
      enabledSkills: ['commit-helper'],
      enabledCommands: ['review'],
      enabledAgents: ['explore'],
      enabledHooks: ['PreToolUse-0'],
      enabledPlugins: ['gh'],
    },
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  {
    name: 'minimal',
    description: 'Minimal workspace — only essential tools',
    config: {
      enabledServers: [],
      enabledSkills: ['commit-helper'],
      enabledCommands: [],
      enabledAgents: ['explore'],
      enabledHooks: [],
      enabledPlugins: [],
    },
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
];

function ok<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

if (typeof window !== 'undefined' && !window.api) {
  const deleted = new Set<string>();
  window.api = {
    listProjects: () => ok(testProjects),
    listProjectTree: () => ok(testProjectTree),
    listSessions: (_projectId, includeDeleted) =>
      ok(
        testSessions.filter(
          (s) => (includeDeleted || !deleted.has(s.sessionId)) && !s.isDeleted
        )
      ),
    listDeletedSessions: () =>
      ok(testSessions.filter((s) => s.isDeleted === 1 || deleted.has(s.sessionId))),
    listMessages: (sessionId) =>
      ok(testMessages.filter((m) => m.sessionId === sessionId)),
    searchMessages: (query) => {
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = testSearchHits.filter((h) =>
        tokens.every((t) => h.message.content.toLowerCase().includes(t))
      );
      return ok(hits);
    },
    globalSearch: (query, limit) => {
      if (query.length === 0) return ok([]);
      const normalized = query.toLowerCase();
      return ok(
        testProjects
          .filter((project) => project.name.toLowerCase().includes(normalized))
          .slice(0, limit)
          .map((project) => ({
            id: String(project.id),
            kind: 'project' as const,
            title: project.name,
            subtitle: project.path,
          }))
      );
    },
    watcherRescanAll: () => ok({ ok: true as const }),
    watcherGetStatus: () => ok({ status: 'idle' as const }),
    softDeleteSession: (id) => {
      deleted.add(id);
      return ok(undefined);
    },
    restoreSession: (id) => {
      deleted.delete(id);
      return ok(undefined);
    },
    permanentDeleteSession: (id) => {
      deleted.add(id);
      return ok(undefined);
    },
    resumeSession: (sessionId) =>
      ok({ command: `claude --resume ${sessionId}`, cwd: 'C:/Users/15532/Desktop' }),
    // v5 wave-1 MCP 模块 — 6 mock(浏览器 dev 用,内存 fixture)
    mcpList: () => ok(testMcpServers),
    mcpGet: (name) => ok(testMcpServers.find((s) => s.name === name) ?? null),
    mcpCreate: (input) => {
      testMcpServers.push({ ...input, enabled: true, source: 'global' });
      return ok(undefined);
    },
    mcpUpdate: (name, patch) => {
      const idx = testMcpServers.findIndex((s) => s.name === name);
      if (idx >= 0) testMcpServers[idx] = { ...testMcpServers[idx], ...patch };
      return ok(undefined);
    },
    mcpDelete: (name) => {
      const idx = testMcpServers.findIndex((s) => s.name === name);
      if (idx >= 0) testMcpServers.splice(idx, 1);
      return ok(undefined);
    },
    mcpToggleEnabled: (name, enabled) => {
      const idx = testMcpServers.findIndex((s) => s.name === name);
      if (idx >= 0) testMcpServers[idx] = { ...testMcpServers[idx], enabled };
      return ok(undefined);
    },
    // v5 wave-1 Skills 模块 — 6 mock(浏览器 dev 用,内存 fixture)
    skillList: () => ok(testSkills),
    skillGet: (name) => ok(testSkills.find((s) => s.name === name) ?? null),
    skillCreate: (input) => {
      testSkills.push({
        ...input,
        path: `C:/Users/15532/.claude/skills/${input.name}`,
        enabled: true,
        body: input.body ?? '',
      });
      return ok(undefined);
    },
    skillUpdate: (name, patch) => {
      const idx = testSkills.findIndex((s) => s.name === name);
      if (idx >= 0) testSkills[idx] = { ...testSkills[idx], ...patch };
      return ok(undefined);
    },
    skillDelete: (name) => {
      const idx = testSkills.findIndex((s) => s.name === name);
      if (idx >= 0) testSkills.splice(idx, 1);
      return ok(undefined);
    },
    skillToggleEnabled: (name, enabled) => {
      const idx = testSkills.findIndex((s) => s.name === name);
      if (idx >= 0) testSkills[idx] = { ...testSkills[idx], enabled };
      return ok(undefined);
    },
    // v5 wave-1 Commands 模块 — 6 mock(浏览器 dev 用,内存 fixture)
    commandList: () => ok(testCommands),
    commandGet: (name) => ok(testCommands.find((c) => c.name === name) ?? null),
    commandCreate: (input) => {
      testCommands.push({
        ...input,
        path: `C:/Users/15532/.claude/commands/${input.name}.md`,
        enabled: true,
        body: input.body ?? '',
      });
      return ok(undefined);
    },
    commandUpdate: (name, patch) => {
      const idx = testCommands.findIndex((c) => c.name === name);
      if (idx >= 0) testCommands[idx] = { ...testCommands[idx], ...patch };
      return ok(undefined);
    },
    commandDelete: (name) => {
      const idx = testCommands.findIndex((c) => c.name === name);
      if (idx >= 0) testCommands.splice(idx, 1);
      return ok(undefined);
    },
    commandToggleEnabled: (name, enabled) => {
      const idx = testCommands.findIndex((c) => c.name === name);
      if (idx >= 0) testCommands[idx] = { ...testCommands[idx], enabled };
      return ok(undefined);
    },
    // v5 wave-2 Sub-Agents 模块 — 6 mock(浏览器 dev 用,内存 fixture)
    subagentList: () => ok(testSubAgents),
    subagentGet: (name) => ok(testSubAgents.find((a) => a.name === name) ?? null),
    subagentCreate: (input) => {
      testSubAgents.push({
        ...input,
        path: `C:/Users/15532/.claude/agents/${input.name}.md`,
        enabled: true,
        body: input.body ?? '',
      });
      return ok(undefined);
    },
    subagentUpdate: (name, patch) => {
      const idx = testSubAgents.findIndex((a) => a.name === name);
      if (idx >= 0) testSubAgents[idx] = { ...testSubAgents[idx], ...patch };
      return ok(undefined);
    },
    subagentDelete: (name) => {
      const idx = testSubAgents.findIndex((a) => a.name === name);
      if (idx >= 0) testSubAgents.splice(idx, 1);
      return ok(undefined);
    },
    subagentToggleEnabled: (name, enabled) => {
      const idx = testSubAgents.findIndex((a) => a.name === name);
      if (idx >= 0) testSubAgents[idx] = { ...testSubAgents[idx], enabled };
      return ok(undefined);
    },
    // v5 wave-2 Hooks 模块 — 6 mock(浏览器 dev 用,内存 fixture)
    hookList: () => ok(testHooks),
    hookGet: (id) => ok(testHooks.find((h) => h.id === id) ?? null),
    hookCreate: (input) => {
      // id 自动分配:`${event}-${nextIndex}` — 简化,匹配后端 ${event}-${index}
      const existing = testHooks.filter((h) => h.event === input.event);
      const id = `${input.event}-${existing.length}`;
      testHooks.push({
        id,
        event: input.event,
        matcher: input.matcher,
        command: input.command,
        enabled: true,
        scope: 'global',
      });
      return ok(undefined);
    },
    hookUpdate: (id, patch) => {
      const idx = testHooks.findIndex((h) => h.id === id);
      if (idx >= 0) testHooks[idx] = { ...testHooks[idx], ...patch };
      return ok(undefined);
    },
    hookDelete: (id) => {
      const idx = testHooks.findIndex((h) => h.id === id);
      if (idx >= 0) testHooks.splice(idx, 1);
      return ok(undefined);
    },
    hookToggleEnabled: (id, enabled) => {
      const idx = testHooks.findIndex((h) => h.id === id);
      if (idx >= 0) testHooks[idx] = { ...testHooks[idx], enabled };
      return ok(undefined);
    },
    // v5 wave-2 Plugins 模块 — 6 mock(浏览器 dev 用,内存 fixture)
    pluginList: () => ok(testPlugins),
    pluginGet: (name) => ok(testPlugins.find((p) => p.name === name) ?? null),
    pluginCreate: (input) => {
      testPlugins.push({
        ...input,
        path: `C:/Users/15532/.claude/plugins/${input.name}`,
        enabled: true,
      });
      return ok(undefined);
    },
    pluginUpdate: (name, patch) => {
      const idx = testPlugins.findIndex((p) => p.name === name);
      if (idx >= 0) testPlugins[idx] = { ...testPlugins[idx], ...patch };
      return ok(undefined);
    },
    pluginDelete: (name) => {
      const idx = testPlugins.findIndex((p) => p.name === name);
      if (idx >= 0) testPlugins.splice(idx, 1);
      return ok(undefined);
    },
    pluginToggleEnabled: (name, enabled) => {
      const idx = testPlugins.findIndex((p) => p.name === name);
      if (idx >= 0) testPlugins[idx] = { ...testPlugins[idx], enabled };
      return ok(undefined);
    },
    // v5 wave-3 Profiles 模块 — 6 mock(浏览器 dev 用,内存 fixture)
    profileList: () => ok(testProfiles),
    profileGet: (name) => ok(testProfiles.find((p) => p.name === name) ?? null),
    profileCapture: (name, description) => {
      // 实时 capture(从各 enabled fixture 数组生成)
      const config = {
        enabledServers: testMcpServers.filter((s) => s.enabled).map((s) => s.name),
        enabledSkills: testSkills.filter((s) => s.enabled).map((s) => s.name),
        enabledCommands: testCommands.filter((c) => c.enabled).map((c) => c.name),
        enabledAgents: testSubAgents.filter((a) => a.enabled).map((a) => a.name),
        enabledHooks: testHooks.filter((h) => h.enabled).map((h) => h.id),
        enabledPlugins: testPlugins.filter((p) => p.enabled).map((p) => p.name),
      };
      const now = new Date().toISOString();
      const idx = testProfiles.findIndex((p) => p.name === name);
      if (idx >= 0) {
        testProfiles[idx] = {
          ...testProfiles[idx],
          description,
          config,
          updatedAt: now,
        };
      } else {
        testProfiles.push({ name, description, config, createdAt: now, updatedAt: now });
      }
      return ok(undefined);
    },
    profileApply: (name) => {
      const profile = testProfiles.find((p) => p.name === name);
      if (!profile) throw new Error(`Profile "${name}" not found`);
      // 应用到 fixture
      for (const s of testMcpServers) s.enabled = profile.config.enabledServers.includes(s.name);
      for (const s of testSkills) s.enabled = profile.config.enabledSkills.includes(s.name);
      for (const c of testCommands) c.enabled = profile.config.enabledCommands.includes(c.name);
      for (const a of testSubAgents) a.enabled = profile.config.enabledAgents.includes(a.name);
      for (const h of testHooks) h.enabled = profile.config.enabledHooks.includes(h.id);
      for (const p of testPlugins) p.enabled = profile.config.enabledPlugins.includes(p.name);
      return ok({ ok: true as const, appliedAt: Date.now() });
    },
    profileDelete: (name) => {
      const idx = testProfiles.findIndex((p) => p.name === name);
      if (idx >= 0) testProfiles.splice(idx, 1);
      return ok(undefined);
    },
    profileUpdate: (name, patch) => {
      const idx = testProfiles.findIndex((p) => p.name === name);
      if (idx >= 0) {
        testProfiles[idx] = {
          ...testProfiles[idx],
          ...patch,
          updatedAt: new Date().toISOString(),
        };
      }
      return ok(undefined);
    },
  };
  console.log('[mock] window.api stub installed (browser dev mode)');
}

export {};

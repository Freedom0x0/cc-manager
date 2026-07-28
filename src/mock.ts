// Dev-only mock: when window.api is missing (i.e. opened in plain browser via Vite,
// not inside Electron), provide a fixture-backed implementation so we can preview the UI
// and take screenshots. The real Electron IPC is unaffected.

import { testProjects, testSessions, testMessages, testSearchHits, testProjectTree } from './mock-data';
import type { McpServer, Skill, Command, SubAgent } from './types';

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
  };
  console.log('[mock] window.api stub installed (browser dev mode)');
}

export {};

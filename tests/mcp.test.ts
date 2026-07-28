/**
 * tests/mcp.test.ts — v5 wave-1 MCP 模块 5 case
 *
 * Case 1: listMcpServers() on 不存在文件 → 返 []
 * Case 2: listMcpServers() on fixture 文件 → 返 fixture server + enabled 注入
 * Case 3: createMcpServer() 写文件 + 原子写(tmp + rename)
 * Case 4: updateMcpServer() 修改 command
 * Case 5: deleteMcpServer() 删 server
 *
 * Fixture 设计(CLAUDE.md §13 D10):
 * - DB 用 initDB(':memory:') — 内存 DB,沙箱干净
 * - MCP 配置文件用 `os.tmpdir()` 临时路径,**不**碰真实 ~/.claude.json
 * - 通过 configPath 参数显式注入(不依赖环境变量,避免 ESM 模块求值时序坑)
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDB, closeDB, type DB } from '../electron/db/connection';
import {
  listMcpServers,
  getMcpServer,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  setEnabled,
} from '../electron/repo/mcp';

// 模块级 fixture 路径 — 所有 case 共享一个 tmp 目录
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-mcp-test-'));
const fixturePath = path.join(tmpRoot, '.claude.json');

let db: DB;

beforeEach(() => {
  db = initDB(':memory:');
  // 每个 case 起始清空 fixture 文件(让 case 1 验证"不存在"场景)
  if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
});

function writeFixture(servers: Record<string, unknown>): void {
  fs.writeFileSync(fixturePath, JSON.stringify({ mcpServers: servers }, null, 2) + '\n');
}

// Case 1: 文件不存在 → 返 []
test('listMcpServers returns [] when MCP config file does not exist', async () => {
  const list = await listMcpServers(db, fixturePath);
  assert.deepStrictEqual(list, [], '不存在文件应返空数组');
  closeDB(db);
});

// Case 2: fixture 文件 → 返 fixture server + enabled 注入
test('listMcpServers reads fixture file and injects enabled state from KV', async () => {
  writeFixture({
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: { ROOT: '/tmp' },
      description: 'File system access',
    },
  });
  // 默认 enabled = true(KV 表无 key)
  const list = await listMcpServers(db, fixturePath);
  assert.strictEqual(list.length, 1, '应读出 1 个 server');
  const fs0 = list[0];
  assert.strictEqual(fs0.name, 'filesystem');
  assert.strictEqual(fs0.command, 'npx');
  assert.deepStrictEqual(fs0.args, ['-y', '@modelcontextprotocol/server-filesystem']);
  assert.deepStrictEqual(fs0.env, { ROOT: '/tmp' });
  assert.strictEqual(fs0.description, 'File system access');
  assert.strictEqual(fs0.enabled, true, '默认 enabled=true(KV 表无 key)');
  assert.strictEqual(fs0.source, 'global');

  // 设 enabled=false 后应读出来
  setEnabled(db, 'filesystem', false);
  const list2 = await listMcpServers(db, fixturePath);
  assert.strictEqual(list2[0].enabled, false, 'KV 表写入后 enabled=false');
  closeDB(db);
});

// Case 3: createMcpServer 写文件 + 原子写(tmp + rename)
test('createMcpServer writes fixture file atomically (tmp + rename)', async () => {
  // 文件不存在场景:自动初始化
  await createMcpServer(
    {
      name: 'github',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'xxx' },
      description: 'GitHub integration',
    },
    fixturePath
  );

  // 文件应存在
  assert.ok(fs.existsSync(fixturePath), 'createMcpServer 应创建文件');
  // 写入内容正确
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.mcpServers.github.command, 'npx');
  assert.deepStrictEqual(parsed.mcpServers.github.args, ['-y', '@modelcontextprotocol/server-github']);
  assert.deepStrictEqual(parsed.mcpServers.github.env, { GITHUB_TOKEN: 'xxx' });
  assert.strictEqual(parsed.mcpServers.github.description, 'GitHub integration');
  // 没有 .tmp.* 残留文件
  const stray = fs.readdirSync(tmpRoot).filter((f) => f.includes('.tmp.'));
  assert.deepStrictEqual(stray, [], '原子写不应残留 tmp 文件');
  closeDB(db);
});

// Case 4: updateMcpServer 修改 command
test('updateMcpServer patches command (and only command) without losing other fields', async () => {
  writeFixture({
    github: {
      command: 'old',
      args: ['-y', 'old'],
      env: { TOKEN: 'old' },
      description: 'old desc',
    },
  });
  await updateMcpServer('github', { command: 'new' }, fixturePath);

  const raw = fs.readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.mcpServers.github.command, 'new', 'command 应被更新');
  assert.deepStrictEqual(parsed.mcpServers.github.args, ['-y', 'old'], 'args 应保留');
  assert.deepStrictEqual(parsed.mcpServers.github.env, { TOKEN: 'old' }, 'env 应保留');
  assert.strictEqual(parsed.mcpServers.github.description, 'old desc', 'description 应保留');
  closeDB(db);
});

// Case 5: deleteMcpServer 删 server
test('deleteMcpServer removes the named server', async () => {
  writeFixture({
    github: { command: 'npx', args: [] },
    slack: { command: 'npx', args: [] },
  });
  await deleteMcpServer('github', fixturePath);

  const raw = fs.readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.mcpServers.github, undefined, 'github 应被删除');
  assert.ok(parsed.mcpServers.slack, 'slack 应保留');

  // 顺便验证 getMcpServer:删后 null
  const got = await getMcpServer(db, 'github', fixturePath);
  assert.strictEqual(got, null, 'getMcpServer 在删后应返 null');
  const got2 = await getMcpServer(db, 'slack', fixturePath);
  assert.ok(got2, 'getMcpServer 应能找到 slack');
  assert.strictEqual(got2?.name, 'slack');
  closeDB(db);
});

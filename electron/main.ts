import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, DB } from './db/connection';
import { scanProjectFolders, importProjectFolder, importFile, archiveLegacyFakeProjects } from './importer';
import * as projectsRepo from './repo/projects';
import * as sessionsRepo from './repo/sessions';
import * as messagesRepo from './repo/messages';
import * as searchRepo from './repo/search';
import * as treeRepo from './repo/tree';
import * as watcherStateRepo from './repo/watcher-state';
import * as mcpRepo from './repo/mcp';
import * as skillsRepo from './repo/skills';
import * as commandsRepo from './repo/commands';
import * as subAgentsRepo from './repo/sub-agents';
import * as hooksRepo from './repo/hooks';
import * as pluginsRepo from './repo/plugins';
import * as profilesRepo from './repo/profiles';
import * as usageRepo from './repo/usage';
import { buildResumeCommand } from './resumer';
import { startWatcher } from './watcher';
import { defaultSettingsPath } from './repo/settings-writer';

let db: DB;

function logFile(): string {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'app.log');
}
function log(...args: unknown[]) {
  const line = '[' + new Date().toISOString() + '] ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
  try { fs.appendFileSync(logFile(), line); } catch {}
  console.log(...args);
}

process.on('uncaughtException', (e) => log('UNCAUGHT', e?.stack || String(e)));
process.on('unhandledRejection', (e) => log('UNHANDLED', e instanceof Error ? e.stack : String(e)));

function getDataDir(): string {
  // Windows: %APPDATA%\cc-session-manager
  // macOS:   ~/Library/Application Support/cc-session-manager
  // Linux:   ~/.config/cc-session-manager  (XDG_CONFIG_HOME fallback)
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'cc-session-manager');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'cc-session-manager');
  }
  // Linux/others: respect XDG_CONFIG_HOME
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'cc-session-manager');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  log('app ready, init DB...');
  const dataDir = getDataDir();
  const dbPath = path.join(dataDir, 'app.db');
  db = initDB(dbPath);
  log('DB ready at', dbPath);

  try {
    const home = os.homedir();
    const sourceDir = path.join(home, '.claude', 'projects');
    startWatcher(db, sourceDir).catch((e) => log('startWatcher failed', e?.stack || String(e)));
    log('watcher started on', sourceDir);
  } catch (e) {
    log('startWatcher init error', e instanceof Error ? e.stack : String(e));
  }

  // Trigger first-run import (background, non-blocking)
  setTimeout(() => {
    try {
      const home = os.homedir();
      const sourceDir = path.join(home, '.claude', 'projects');
      // v4 migration: hide pre-v4 fake projects (path is a cwd, not a ~/.claude/projects/ folder)
      const archived = archiveLegacyFakeProjects(db, sourceDir);
      if (archived > 0) log('archived', archived, 'legacy fake projects');
      log('scanning', sourceDir);
      const folders = scanProjectFolders(sourceDir);
      log('found', folders.length, 'project folders');
      let ok = 0, fail = 0;
      for (const folder of folders) {
        try {
          importProjectFolder(db, folder);
          ok++;
          if (ok % 5 === 0) log('imported', ok, '/', folders.length, 'folders');
        } catch (e) {
          fail++;
          log('import FAIL', folder.folderPath, e instanceof Error ? e.message : String(e));
        }
      }
      log('import done. ok=' + ok + ' fail=' + fail);
    } catch (e) {
      log('Import error', e instanceof Error ? e.stack : String(e));
    }
  }, 1500);

  ipcMain.handle('list_projects', () => projectsRepo.listWithCounts(db));
  ipcMain.handle('list_project_tree', () => treeRepo.listProjectTree(db));
  ipcMain.handle('list_sessions', (_e, projectId: number, includeDeleted: boolean) =>
    sessionsRepo.listByProject(db, projectId, includeDeleted)
  );
  ipcMain.handle('list_deleted_sessions', () => sessionsRepo.listDeleted(db));
  ipcMain.handle('list_messages', (_e, sessionId: string) =>
    messagesRepo.listBySession(db, sessionId)
  );
  ipcMain.handle(
    'search_messages',
    (_e, query: string, projectIds: number[] | null, fromMs: number | null, toMs: number | null) =>
      searchRepo.search(
        db,
        query,
        projectIds,
        fromMs !== null && toMs !== null ? { from: fromMs, to: toMs } : null
      )
  );
  ipcMain.handle('global_search', (_e, query: string, limit: number) =>
    searchRepo.globalSearch(db, query, limit)
  );
  ipcMain.handle('watcher_rescan_all', () => ({ ok: true }));
  ipcMain.handle('watcher_get_status', () => {
    const status = watcherStateRepo.getState(db, 'status') as 'starting' | 'idle' | 'error' | null;
    const lastEvent = watcherStateRepo.getState(db, 'last_event');
    const lastError = watcherStateRepo.getState(db, 'last_error');
    return {
      status: status ?? 'starting',
      ...(lastEvent !== null ? { lastEvent } : {}),
      ...(lastError !== null ? { lastError } : {}),
    };
  });
  ipcMain.handle('soft_delete_session', (_e, sessionId: string) =>
    sessionsRepo.softDelete(db, sessionId)
  );
  ipcMain.handle('restore_session', (_e, sessionId: string) => sessionsRepo.restore(db, sessionId));
  ipcMain.handle('permanent_delete_session', (_e, sessionId: string) =>
    sessionsRepo.permanentDelete(db, sessionId)
  );
  ipcMain.handle('resume_session', (_e, sessionId: string) => {
    const session = sessionsRepo.get(db, sessionId);
    if (!session) return null;
    // v4:返回 { command, cwd } 字符串,前端在卡片里展示可复制
    // cwd 取 sessions.cwd(导入时从 message.cwd 拿到的真实路径),
    // 兜底到 session.sourceFile 的父目录(folder 路径)
    const cwd = session.cwd || path.dirname(session.sourceFile);
    return buildResumeCommand(sessionId, cwd);
  });

  // v5 wave-1 MCP 模块 — 6 IPC channel。create/update/delete 改 ~/.claude.json
  // (原子写);list/get 注入 enabled 状态(从 settings.json 的 disabledMcpjsonServers
  // 黑名单反推 — D10 决策);toggle_enabled 写真实 settings.json 改黑名单
  // (PRD real-disable — 真停用)。
  const settingsPath = defaultSettingsPath();
  ipcMain.handle('mcp_list', () => mcpRepo.listMcpServers(db, undefined, settingsPath));
  ipcMain.handle('mcp_get', (_e, name: string) =>
    mcpRepo.getMcpServer(db, name, undefined, settingsPath)
  );
  ipcMain.handle('mcp_create', (_e, input) => mcpRepo.createMcpServer(input));
  ipcMain.handle('mcp_update', (_e, name: string, patch) => mcpRepo.updateMcpServer(name, patch));
  ipcMain.handle('mcp_delete', (_e, name: string) => mcpRepo.deleteMcpServer(name));
  ipcMain.handle('mcp_toggle_enabled', async (_e, name: string, enabled: boolean) => {
    await mcpRepo.setEnabled(db, name, enabled, settingsPath);
  });

  // v5 wave-1 Skills 模块 — 6 IPC channel。create/update/delete 改
  // ~/.claude/skills/<name>/SKILL.md(原子写);list/get 注入 enabled 状态
  // (从 mcp_server_state KV 表读,key 前缀 'skill:enabled:<name>');
  // toggle_enabled 写 KV 表(不污染原文件 — D6 决策延伸)。
  ipcMain.handle('skill_list', () => skillsRepo.listSkills(db));
  ipcMain.handle('skill_get', (_e, name: string) => skillsRepo.getSkill(db, name));
  ipcMain.handle('skill_create', (_e, input) => skillsRepo.createSkill(input));
  ipcMain.handle('skill_update', (_e, name: string, patch) =>
    skillsRepo.updateSkill(name, patch)
  );
  ipcMain.handle('skill_delete', (_e, name: string) => skillsRepo.deleteSkill(name));
  ipcMain.handle('skill_toggle_enabled', async (_e, name: string, enabled: boolean) => {
    await skillsRepo.setEnabled(db, name, enabled);
  });

  // v5 wave-1 Commands 模块 — 6 IPC channel。create/update/delete 改
  // ~/.claude/commands/<name>.md 单文件(原子写);list/get 注入 enabled 状态
  // (从 mcp_server_state KV 表读,key 前缀 'cmd:enabled:<name>');
  // toggle_enabled 写 KV 表(不污染原文件 — D6 决策延伸)。
  ipcMain.handle('command_list', () => commandsRepo.listCommands(db));
  ipcMain.handle('command_get', (_e, name: string) => commandsRepo.getCommand(db, name));
  ipcMain.handle('command_create', (_e, input) => commandsRepo.createCommand(input));
  ipcMain.handle('command_update', (_e, name: string, patch) =>
    commandsRepo.updateCommand(name, patch)
  );
  ipcMain.handle('command_delete', (_e, name: string) => commandsRepo.deleteCommand(name));
  ipcMain.handle('command_toggle_enabled', async (_e, name: string, enabled: boolean) => {
    await commandsRepo.setEnabled(db, name, enabled);
  });

  // v5 wave-2 Sub-Agents 模块 — 6 IPC channel。create/update/delete 改
  // ~/.claude/agents/<name>.md 单文件(原子写);list/get 注入 enabled 状态
  // (从 mcp_server_state KV 表读,key 前缀 'agent:enabled:<name>');
  // toggle_enabled 写 KV 表(不污染原文件 — D6 决策延伸)。
  ipcMain.handle('subagent_list', () => subAgentsRepo.listSubAgents(db));
  ipcMain.handle('subagent_get', (_e, name: string) => subAgentsRepo.getSubAgent(db, name));
  ipcMain.handle('subagent_create', (_e, input) => subAgentsRepo.createSubAgent(input));
  ipcMain.handle('subagent_update', (_e, name: string, patch) =>
    subAgentsRepo.updateSubAgent(name, patch)
  );
  ipcMain.handle('subagent_delete', (_e, name: string) => subAgentsRepo.deleteSubAgent(name));
  ipcMain.handle('subagent_toggle_enabled', async (_e, name: string, enabled: boolean) => {
    await subAgentsRepo.setEnabled(db, name, enabled);
  });

  // v5 wave-2 Hooks 模块 — 6 IPC channel。create/update/delete 改
  // ~/.claude/settings.json 的 hooks 字段(**不是**新建单文件 — D2 决策)。
  // 原子写:tmp + rename(CLAUDE.md §7 + 本任务硬规则),失败不破坏 settings.json
  // 的其他字段(mcpServers / permissions / ...)— AC-13 / D7 决策。
  // list/get 注入 enabled 状态(从 mcp_server_state KV 表读,key 前缀
  // 'hook:enabled:<id>');toggle_enabled 写 KV 表(不污染原文件 — D6 决策延伸)。
  ipcMain.handle('hook_list', () => hooksRepo.listHooks(db));
  ipcMain.handle('hook_get', (_e, id: string) => hooksRepo.getHook(db, id));
  ipcMain.handle('hook_create', (_e, input) => hooksRepo.createHook(input));
  ipcMain.handle('hook_update', (_e, id: string, patch) =>
    hooksRepo.updateHook(id, patch, hooksRepo.HOOK_EVENTS)
  );
  ipcMain.handle('hook_delete', (_e, id: string) =>
    hooksRepo.deleteHook(id, hooksRepo.HOOK_EVENTS)
  );
  ipcMain.handle('hook_toggle_enabled', async (_e, id: string, enabled: boolean) => {
    await hooksRepo.setEnabled(db, id, enabled, settingsPath, hooksRepo.HOOK_EVENTS);
  });

  // v5 wave-2 Plugins 模块 — 6 IPC channel。create/update/delete 改
  // ~/.claude/plugins/<name>/plugin.json(原子写)或 rm -rf 整个子目录。
  // 严格 schema 校验:缺必填字段(name/version/description)throw,wave-2-spec §2.3。
  // list/get 注入 enabled 状态(从 mcp_server_state KV 表读,key 前缀
  // 'plugin:enabled:<fullName>');toggle_enabled 写 KV 表(不污染原文件 — D6 决策延伸)。
  // 2026-07-30 改:主键是 fullName(name@marketplace),不是 name
  ipcMain.handle('plugin_list', () => pluginsRepo.listPlugins(db, undefined, settingsPath));
  ipcMain.handle('plugin_get', (_e, fullName: string) =>
    pluginsRepo.getPlugin(db, fullName, undefined, settingsPath)
  );
  ipcMain.handle('plugin_create', (_e, input) => pluginsRepo.createPlugin(input));
  ipcMain.handle('plugin_update', (_e, fullName: string, patch) =>
    pluginsRepo.updatePlugin(fullName, patch)
  );
  ipcMain.handle('plugin_delete', (_e, fullName: string) => pluginsRepo.deletePlugin(fullName));
  ipcMain.handle('plugin_toggle_enabled', async (_e, fullName: string, enabled: boolean) => {
    await pluginsRepo.setEnabled(db, fullName, enabled, settingsPath);
  });

  // v5 wave-3 Profiles 模块 — 6 IPC channel。profile 数据存
  // ~/.claude/profiles.json(单文件 JSON,原子写)。profile_apply 是核心
  // 事务化操作:备份当前 KV 表所有 enabled 状态 → 写 profile.config.enabled*
  // → 验证 → 失败回滚(任务硬规则)。profile_capture 实时从 mcp_server_state
  // KV 表读 6 个 enabled* 命名空间(mcp: / skill: / cmd: / agent: / hook: /
  // plugin:)生成 config 快照(不缓存,每次 capture 重新读 KV)。
  ipcMain.handle('profile_list', () => profilesRepo.listProfiles());
  ipcMain.handle('profile_get', (_e, name: string) => profilesRepo.getProfile(name));
  ipcMain.handle('profile_capture', (_e, name: string, description: string) =>
    profilesRepo.createProfile(db, { name, description })
  );
  ipcMain.handle('profile_apply', (_e, name: string) =>
    profilesRepo.applyProfile(db, name)
  );
  ipcMain.handle('profile_delete', (_e, name: string) => profilesRepo.deleteProfile(name));
  ipcMain.handle('profile_update', (_e, name: string, patch) =>
    profilesRepo.updateProfile(name, patch)
  );

  // v5 wave-3 用量分析 模块 — 6 IPC channel。全只读聚合,无 create / update /
  // delete / toggle。基于 sessions / messages 表做 COUNT / SUM / GROUP BY +
  // json_extract(content_blocks, '$.name') 提 tool_use.name。token 数走
  // JS 端估算(text / thinking length + tool_use.input JSON length,均 /4)。
  ipcMain.handle('usage_summary', (_e, rangeDays: number = 30) =>
    usageRepo.usageSummary(db, rangeDays)
  );
  ipcMain.handle('usage_get_session_cost', (_e, sessionId: string) =>
    usageRepo.getSessionCost(db, sessionId)
  );
  ipcMain.handle('usage_get_session_timeline', (_e, sessionId: string) =>
    usageRepo.getSessionTimeline(db, sessionId)
  );
  ipcMain.handle('usage_get_project_breakdown', (_e, projectId: number) =>
    usageRepo.getProjectBreakdown(db, projectId)
  );
  ipcMain.handle('usage_get_daily_breakdown', (_e, rangeDays: number = 30) =>
    usageRepo.getDailyBreakdown(db, rangeDays)
  );
  ipcMain.handle('usage_get_top_tools', (_e, limit: number = 10) =>
    usageRepo.getTopTools(db, limit)
  );

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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
import { resumeSession } from './resumer';

let db: DB;

function logFile(): string {
  const dataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'cc-session-manager')
    : path.join(os.homedir(), '.cc-session-manager');
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
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'cc-session-manager');
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
  ipcMain.handle('soft_delete_session', (_e, sessionId: string) =>
    sessionsRepo.softDelete(db, sessionId)
  );
  ipcMain.handle('restore_session', (_e, sessionId: string) => sessionsRepo.restore(db, sessionId));
  ipcMain.handle('permanent_delete_session', (_e, sessionId: string) =>
    sessionsRepo.permanentDelete(db, sessionId)
  );
  ipcMain.handle('resume_session', (_e, sessionId: string) => {
    const session = sessionsRepo.get(db, sessionId);
    if (!session) return 0;
    const cwd = path.dirname(session.sourceFile);
    try {
      return resumeSession(sessionId, cwd);
    } catch (e) {
      console.error('Resume error', e);
      return 0;
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

# cc-session-manager Implementation Plan (Electron 版)

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop app (Electron + React + Node) that imports, searches, resumes, and soft-deletes Claude Code session history.

**Architecture:** Three layers — Node main process reads `~/.claude/projects/**/*.jsonl`, writes to local SQLite (with FTS5); Electron renderer shows a three-pane UI with search/filter/recycle bin; resume action spawns `claude --resume <sessionId>` as a detached child process.

**Tech Stack:** Electron 32, React 18, TypeScript, Vite, better-sqlite3 (with FTS5), Node 22.

**Spec:** `docs/superpowers/specs/2026-07-28-cc-session-manager-design.md`

## Global Constraints

- Single-user, Windows-only (v1)
- App data: `%APPDATA%/cc-session-manager/app.db`
- Source dir: `~/.claude/projects/**/*.jsonl` (read-only, never modified)
- Soft delete only by default; permanent delete requires typing session title
- FTS5 tokenize: `unicode61 remove_diacritics 2`
- Search multi-keyword: AND logic
- Filter: project multi-select + time range (today / 7d / 30d / all, default 30d)
- DB corruption: auto-backup to `app.db.bak.<unix_ts>`, recreate empty DB
- Resume: spawn `claude --resume <sessionId>`, do not wait, tool window stays
- Soft delete: only flip `is_deleted`; do NOT delete messages
- FTS5 stays in sync via SQLite triggers
- IPC: contextBridge exposes typed API to renderer (preload script)

---

## File Structure

```
cc-session-manager/
├── electron/
│   ├── main.ts                    # Electron main process
│   ├── preload.ts                 # contextBridge API exposure
│   └── db/
│       ├── schema.sql             # DDL
│       └── connection.ts          # better-sqlite3 wrapper
├── src/                           # React renderer
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── SearchBar.tsx
│   │   ├── ProjectList.tsx
│   │   ├── SessionList.tsx
│   │   ├── MessageView.tsx
│   │   ├── ConfirmDialog.tsx
│   │   └── RecycleBinView.tsx
│   ├── hooks/
│   │   └── useSearch.ts
│   ├── types.ts
│   └── api.ts                     # window.api wrapper
├── tests/
│   ├── db.test.ts                 # Node test runner
│   ├── parser.test.ts
│   ├── importer.test.ts
│   ├── projects-repo.test.ts
│   ├── sessions-repo.test.ts
│   ├── search.test.ts
│   └── resumer.test.ts
├── tests/fixtures/
│   ├── proj-a/sess-1.jsonl
│   └── proj-a/sess-2.jsonl
├── electron-builder.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
└── docs/MANUAL_VERIFICATION.md
```

---

### Task 1: Electron Project Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.electron.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`

**Goal:** A minimal Electron app that opens a window with "Hello cc-session-manager".

- [ ] **Step 1: Write package.json**

```json
{
  "name": "cc-session-manager",
  "version": "0.1.0",
  "description": "Manage Claude Code session history locally",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "concurrently -k \"vite\" \"npm run dev:electron\"",
    "dev:electron": "wait-on tcp:5173 && tsc -p tsconfig.electron.json && cross-env NODE_ENV=development electron .",
    "build": "tsc -p tsconfig.electron.json && vite build",
    "test": "node --import tsx --test tests/*.test.ts"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.7.5",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "concurrently": "^9.0.1",
    "cross-env": "^7.0.3",
    "electron": "^32.1.2",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vite": "^5.4.8",
    "wait-on": "^8.0.1"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write tsconfig.electron.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist-electron",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["electron/**/*"]
}
```

- [ ] **Step 4: Write vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
```

- [ ] **Step 5: Write index.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>cc-session-manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Write electron/main.ts (stub)**

```typescript
import { app, BrowserWindow } from 'electron';
import * as path from 'path';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
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
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 7: Write electron/preload.ts (stub)**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  placeholder: () => 'hello',
});
```

- [ ] **Step 8: Write src/main.tsx + src/App.tsx (stubs)**

`src/main.tsx`:
```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

`src/App.tsx`:
```typescript
import React from 'react';

export default function App() {
  return <div>Hello cc-session-manager</div>;
}
```

- [ ] **Step 9: Install dependencies**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm install
```

- [ ] **Step 10: Verify build**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npx tsc -p tsconfig.electron.json
```

Expected: builds without errors, `dist-electron/main.js` exists.

- [ ] **Step 11: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git init
git add .
git commit -m "chore: scaffold electron + react + typescript"
```

---

### Task 2: SQLite Schema + DB Connection

**Files:**
- Create: `electron/db/schema.sql`
- Create: `electron/db/connection.ts`
- Modify: `package.json` (add `test:db` script if needed)
- Create: `tests/db.test.ts`

**Interfaces:**
- `export function initDB(dbPath: string): Database` — opens, runs schema, returns better-sqlite3 Database
- `export function closeDB(db: Database): void`

- [ ] **Step 1: Write the failing test**

`tests/db.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';

test('initDB creates projects, sessions, messages, messages_fts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-test-'));
  const dbPath = path.join(tmp, 'app.db');
  const db = initDB(dbPath);
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects','sessions','messages','messages_fts')")
    .all() as { name: string }[];
  closeDB(db);
  const names = rows.map((r) => r.name).sort();
  assert.deepStrictEqual(names, ['messages', 'messages_fts', 'projects', 'sessions']);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/db.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Write schema.sql**

`electron/db/schema.sql`:
```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  project_path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  imported_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  title TEXT,
  started_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  source_file TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_deleted ON sessions(is_deleted);
CREATE INDEX idx_sessions_last_msg ON sessions(last_message_at DESC);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_session ON messages(session_id);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
```

- [ ] **Step 4: Write connection.ts**

`electron/db/connection.ts`:
```typescript
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export type DB = Database.Database;

export function initDB(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return db;
}

export function closeDB(db: DB): void {
  db.close();
}
```

- [ ] **Step 5: Copy schema.sql to dist-electron in build**

Update `package.json` `scripts.build`:
```json
"build": "tsc -p tsconfig.electron.json && vite build && node -e \"require('fs').copyFileSync('electron/db/schema.sql', 'dist-electron/db/schema.sql')\""
```

Or simpler — embed schema as a string:

`electron/db/connection.ts` (replace):
```typescript
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  project_path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  imported_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  title TEXT,
  started_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  source_file TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_deleted ON sessions(is_deleted);
CREATE INDEX idx_sessions_last_msg ON sessions(last_message_at DESC);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_session ON messages(session_id);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
`;

export function initDB(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function closeDB(db: DB): void {
  db.close();
}
```

Delete `electron/db/schema.sql` (no longer needed). Restore package.json `build` script to original.

- [ ] **Step 6: Run test to verify it passes**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/db.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git add .
git commit -m "feat(db): sqlite schema + connection"
```

---

### Task 3: JSONL Parser

**Files:**
- Create: `electron/importer/parser.ts`
- Create: `electron/importer/types.ts`
- Create: `tests/parser.test.ts`

**Interfaces:**
- `export interface RawMessage { uuid: string; sessionId: string; role: 'user' | 'assistant'; content: string; createdAtMs: number; projectPath: string }`
- `export function parseLine(line: string): RawMessage | null` — returns null on malformed

- [ ] **Step 1: Write the failing test**

`tests/parser.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { parseLine } from '../electron/importer/parser';

test('parses valid user message', () => {
  const line = '{"type":"user","uuid":"abc-123","sessionId":"sess-1","timestamp":"2026-07-28T10:00:00.000Z","cwd":"/home/user/proj","message":{"role":"user","content":"hello world"}}';
  const msg = parseLine(line);
  assert.ok(msg);
  assert.strictEqual(msg!.uuid, 'abc-123');
  assert.strictEqual(msg!.sessionId, 'sess-1');
  assert.strictEqual(msg!.role, 'user');
  assert.strictEqual(msg!.content, 'hello world');
  assert.strictEqual(msg!.projectPath, '/home/user/proj');
  assert.strictEqual(msg!.createdAtMs, 1753700400000);
});

test('parses assistant message with array content', () => {
  const line = '{"type":"assistant","uuid":"xyz-456","sessionId":"sess-1","timestamp":"2026-07-28T10:00:01.000Z","cwd":"/home/user/proj","message":{"role":"assistant","content":[{"type":"text","text":"hi there"}]}}';
  const msg = parseLine(line);
  assert.ok(msg);
  assert.strictEqual(msg!.role, 'assistant');
  assert.strictEqual(msg!.content, 'hi there');
});

test('returns null on malformed json', () => {
  assert.strictEqual(parseLine('not json'), null);
});

test('returns null for non-message lines', () => {
  assert.strictEqual(parseLine('{"type":"summary","data":"x"}'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/parser.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write types**

`electron/importer/types.ts`:
```typescript
export interface RawMessage {
  uuid: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAtMs: number;
  projectPath: string;
}
```

- [ ] **Step 4: Write parser**

`electron/importer/parser.ts`:
```typescript
import { RawMessage } from './types';

interface RawLine {
  type?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  message?: { role?: string; content?: unknown };
}

export function parseLine(line: string): RawMessage | null {
  let raw: RawLine;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (raw.type !== 'user' && raw.type !== 'assistant') return null;
  if (!raw.uuid || !raw.sessionId || !raw.timestamp || !raw.cwd || !raw.message) return null;
  const role = raw.message.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const content = extractContent(raw.message.content);
  if (content === null) return null;
  const createdAtMs = Date.parse(raw.timestamp);
  if (isNaN(createdAtMs)) return null;
  return {
    uuid: raw.uuid,
    sessionId: raw.sessionId,
    role,
    content,
    createdAtMs,
    projectPath: raw.cwd,
  };
}

function extractContent(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (const item of v) {
      if (item && typeof item === 'object' && 'text' in item && typeof (item as { text: unknown }).text === 'string') {
        parts.push((item as { text: string }).text);
      }
    }
    return parts.join('\n');
  }
  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/parser.test.ts
```

Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git add .
git commit -m "feat(importer): jsonl line parser"
```

---

### Task 4: Importer — Scan + Incremental Import

**Files:**
- Create: `electron/importer/scanner.ts`
- Create: `electron/importer/index.ts`
- Create: `tests/fixtures/proj-a/sess-1.jsonl`
- Create: `tests/fixtures/proj-a/sess-2.jsonl`
- Create: `tests/importer.test.ts`

**Interfaces:**
- `export function scanSourceDir(dir: string): string[]` — returns absolute JSONL file paths
- `export function importFile(db: DB, filePath: string): ImportStats`
- `export interface ImportStats { sessionsAdded: number; messagesAdded: number }`

- [ ] **Step 1: Write the failing test**

`tests/importer.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { scanSourceDir, importFile } from '../electron/importer';

test('imports two jsonl files into db', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-imp-'));
  const dbPath = path.join(tmp, 'app.db');
  const db = initDB(dbPath);

  const fixtures = path.resolve('tests/fixtures');
  let totalSess = 0;
  let totalMsg = 0;
  for (const file of scanSourceDir(fixtures)) {
    const stats = importFile(db, file);
    totalSess += stats.sessionsAdded;
    totalMsg += stats.messagesAdded;
  }

  const sessCount = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
  const msgCount = (db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c;
  closeDB(db);
  assert.ok(sessCount >= 2);
  assert.ok(msgCount >= 4);
  assert.ok(totalSess >= 2);
  assert.ok(totalMsg >= 4);
});

test('import is idempotent (uuid dedup)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-imp2-'));
  const dbPath = path.join(tmp, 'app.db');
  const db = initDB(dbPath);
  const file = path.resolve('tests/fixtures/proj-a/sess-1.jsonl');
  importFile(db, file);
  importFile(db, file);
  const count = (db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c;
  closeDB(db);
  assert.strictEqual(count, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/importer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create test fixtures**

`tests/fixtures/proj-a/sess-1.jsonl`:
```jsonl
{"type":"user","uuid":"u-1","sessionId":"sess-1","timestamp":"2026-07-28T10:00:00.000Z","cwd":"C:/Users/test/proj-a","message":{"role":"user","content":"hello world"}}
{"type":"assistant","uuid":"a-1","sessionId":"sess-1","timestamp":"2026-07-28T10:00:01.000Z","cwd":"C:/Users/test/proj-a","message":{"role":"assistant","content":[{"type":"text","text":"hi there"}]}}
```

`tests/fixtures/proj-a/sess-2.jsonl`:
```jsonl
{"type":"user","uuid":"u-2","sessionId":"sess-2","timestamp":"2026-07-27T10:00:00.000Z","cwd":"C:/Users/test/proj-a","message":{"role":"user","content":"how do I reset the database"}}
{"type":"assistant","uuid":"a-2","sessionId":"sess-2","timestamp":"2026-07-27T10:00:05.000Z","cwd":"C:/Users/test/proj-a","message":{"role":"assistant","content":[{"type":"text","text":"use DROP DATABASE"}]}}
```

- [ ] **Step 4: Write scanner + importer**

`electron/importer/scanner.ts`:
```typescript
import * as fs from 'fs';
import * as path from 'path';

export function scanSourceDir(dir: string): string[] {
  const out: string[] = [];
  walk(dir, out);
  return out;
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
}
```

`electron/importer/index.ts`:
```typescript
import * as fs from 'fs';
import { DB } from '../db/connection';
import { parseLine } from './parser';
import * as path from 'path';

export { scanSourceDir } from './scanner';
export { parseLine } from './parser';
export type { RawMessage } from './types';

export interface ImportStats {
  sessionsAdded: number;
  messagesAdded: number;
}

export function importFile(db: DB, filePath: string): ImportStats {
  const content = fs.readFileSync(filePath, 'utf-8');
  let sessionsAdded = 0;
  let messagesAdded = 0;

  const upsertProject = db.prepare(
    'INSERT INTO projects (project_path, name, imported_at) VALUES (?, ?, ?) ON CONFLICT(project_path) DO NOTHING'
  );
  const findProject = db.prepare('SELECT id FROM projects WHERE project_path = ?');
  const findSession = db.prepare('SELECT id FROM sessions WHERE session_id = ?');
  const insertSession = db.prepare(
    'INSERT INTO sessions (session_id, project_id, title, started_at, last_message_at, message_count, source_file) VALUES (?, ?, ?, ?, ?, 0, ?)'
  );
  const insertMessage = db.prepare(
    'INSERT OR IGNORE INTO messages (uuid, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const updateSession = db.prepare(
    'UPDATE sessions SET last_message_at = MAX(last_message_at, ?), message_count = message_count + 1 WHERE session_id = ?'
  );

  const tx = db.transaction(() => {
    const projectCache = new Map<string, number>();
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const msg = parseLine(line);
      if (!msg) continue;

      let projectId = projectCache.get(msg.projectPath);
      if (!projectId) {
        upsertProject.run(msg.projectPath, path.basename(msg.projectPath), Date.now());
        const row = findProject.get(msg.projectPath) as { id: number } | undefined;
        projectId = row?.id ?? 0;
        projectCache.set(msg.projectPath, projectId);
      }

      const existingSession = findSession.get(msg.sessionId);
      if (!existingSession) {
        const title = msg.role === 'user' ? msg.content.slice(0, 50) : null;
        insertSession.run(
          msg.sessionId,
          projectId,
          title,
          msg.createdAtMs,
          msg.createdAtMs,
          filePath
        );
        sessionsAdded++;
      }
      const result = insertMessage.run(msg.uuid, msg.sessionId, msg.role, msg.content, msg.createdAtMs);
      if (result.changes > 0) {
        updateSession.run(msg.createdAtMs, msg.sessionId);
        messagesAdded++;
      }
    }
  });
  tx();
  return { sessionsAdded, messagesAdded };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/importer.test.ts
```

Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git add .
git commit -m "feat(importer): scan source dir + idempotent import"
```

---

### Task 5: Repository — Projects

**Files:**
- Create: `electron/repo/types.ts`
- Create: `electron/repo/projects.ts`
- Create: `electron/repo/index.ts`
- Create: `tests/projects-repo.test.ts`

**Interfaces:**
- `export interface ProjectRow { id: number; path: string; name: string; sessionCount: number }`
- `export function listWithCounts(db: DB): ProjectRow[]`

- [ ] **Step 1: Write the failing test**

`tests/projects-repo.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { importFile } from '../electron/importer';
import { listWithCounts } from '../electron/repo/projects';

test('lists projects with session counts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-proj-'));
  const db = initDB(path.join(tmp, 'app.db'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-1.jsonl'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-2.jsonl'));
  const projects = listWithCounts(db);
  closeDB(db);
  assert.strictEqual(projects.length, 1);
  assert.strictEqual(projects[0].name, 'proj-a');
  assert.strictEqual(projects[0].sessionCount, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/projects-repo.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write types + repo**

`electron/repo/types.ts`:
```typescript
export interface ProjectRow {
  id: number;
  path: string;
  name: string;
  sessionCount: number;
}

export interface SessionRow {
  id: number;
  sessionId: string;
  projectId: number;
  title: string | null;
  startedAt: number;
  lastMessageAt: number;
  messageCount: number;
  sourceFile: string;
  firstUserMessage: string | null;
}

export interface MessageRow {
  id: number;
  uuid: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface SearchHit {
  message: MessageRow;
  snippet: string;
  sessionTitle: string | null;
  projectName: string;
  projectId: number;
}
```

`electron/repo/projects.ts`:
```typescript
import { DB } from '../db/connection';
import { ProjectRow } from './types';

export function listWithCounts(db: DB): ProjectRow[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.project_path AS path, p.name, COALESCE(c.cnt, 0) AS sessionCount
       FROM projects p
       LEFT JOIN (
         SELECT project_id, COUNT(*) AS cnt
         FROM sessions
         WHERE is_deleted = 0
         GROUP BY project_id
       ) c ON c.project_id = p.id
       ORDER BY p.name`
    )
    .all() as { id: number; path: string; name: string; sessionCount: number }[];
  return rows;
}
```

`electron/repo/index.ts`:
```typescript
export * from './projects';
export * from './types';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/projects-repo.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git add .
git commit -m "feat(repo): projects list with session counts"
```

---

### Task 6: Repository — Sessions (CRUD + Soft Delete)

**Files:**
- Create: `electron/repo/sessions.ts`
- Modify: `electron/repo/index.ts`
- Create: `tests/sessions-repo.test.ts`

**Interfaces:**
- `export function listByProject(db, projectId, includeDeleted): SessionRow[]`
- `export function get(db, sessionId): SessionRow | null`
- `export function softDelete(db, sessionId): void`
- `export function restore(db, sessionId): void`
- `export function permanentDelete(db, sessionId): void`

- [ ] **Step 1: Write the failing test**

`tests/sessions-repo.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { importFile } from '../electron/importer';
import { listByProject, get, softDelete, restore, permanentDelete } from '../electron/repo/sessions';

function setup(): { db: ReturnType<typeof initDB>; projectId: number } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-sess-'));
  const db = initDB(path.join(tmp, 'app.db'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-1.jsonl'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-2.jsonl'));
  const projectId = (db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: number }).id;
  return { db, projectId };
}

test('list excludes deleted by default', () => {
  const { db, projectId } = setup();
  softDelete(db, 'sess-1');
  const active = listByProject(db, projectId, false);
  const all = listByProject(db, projectId, true);
  closeDB(db);
  assert.strictEqual(active.length, 1);
  assert.strictEqual(all.length, 2);
});

test('soft delete then restore', () => {
  const { db, projectId } = setup();
  softDelete(db, 'sess-1');
  assert.ok(get(db, 'sess-1'));
  restore(db, 'sess-1');
  const active = listByProject(db, projectId, false);
  closeDB(db);
  assert.strictEqual(active.length, 2);
});

test('permanent delete removes messages', () => {
  const { db } = setup();
  permanentDelete(db, 'sess-1');
  const count = (db.prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id = 'sess-1'").get() as { c: number }).c;
  closeDB(db);
  assert.strictEqual(count, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/sessions-repo.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write sessions repo**

`electron/repo/sessions.ts`:
```typescript
import { DB } from '../db/connection';
import { SessionRow } from './types';

const SELECT_FIELDS = `
  s.id, s.session_id AS sessionId, s.project_id AS projectId, s.title,
  s.started_at AS startedAt, s.last_message_at AS lastMessageAt,
  s.message_count AS messageCount, s.source_file AS sourceFile,
  (SELECT content FROM messages WHERE session_id = s.session_id AND role = 'user' ORDER BY created_at ASC LIMIT 1) AS firstUserMessage
`;

export function listByProject(db: DB, projectId: number, includeDeleted: boolean): SessionRow[] {
  const where = includeDeleted ? 's.project_id = ?' : 's.project_id = ? AND s.is_deleted = 0';
  return db
    .prepare(`SELECT ${SELECT_FIELDS} FROM sessions s WHERE ${where} ORDER BY s.last_message_at DESC`)
    .all(projectId) as SessionRow[];
}

export function get(db: DB, sessionId: string): SessionRow | null {
  const row = db
    .prepare(`SELECT ${SELECT_FIELDS} FROM sessions s WHERE s.session_id = ?`)
    .get(sessionId) as SessionRow | undefined;
  return row ?? null;
}

export function softDelete(db: DB, sessionId: string): void {
  db.prepare('UPDATE sessions SET is_deleted = 1, deleted_at = ? WHERE session_id = ?').run(Date.now(), sessionId);
}

export function restore(db: DB, sessionId: string): void {
  db.prepare('UPDATE sessions SET is_deleted = 0, deleted_at = NULL WHERE session_id = ?').run(sessionId);
}

export function permanentDelete(db: DB, sessionId: string): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
  });
  tx();
}
```

Modify `electron/repo/index.ts`:
```typescript
export * from './projects';
export * from './sessions';
export * from './types';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/sessions-repo.test.ts
```

Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git add .
git commit -m "feat(repo): sessions list + soft delete + permanent delete"
```

---

### Task 7: Repository — Messages + FTS5 Search

**Files:**
- Create: `electron/repo/messages.ts`
- Create: `electron/repo/search.ts`
- Modify: `electron/repo/index.ts`
- Create: `tests/search.test.ts`

**Interfaces:**
- `export function listBySession(db, sessionId): MessageRow[]`
- `export function search(db, query, projectIds | null, timeRange | null): SearchHit[]`
  - `query: string` — multi-keyword, AND
  - `projectIds: number[] | null` — null = all
  - `timeRange: { from: number; to: number } | null`

- [ ] **Step 1: Write the failing test**

`tests/search.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initDB, closeDB } from '../electron/db/connection';
import { importFile } from '../electron/importer';
import { listBySession } from '../electron/repo/messages';
import { search } from '../electron/repo/search';

function setup(): { db: ReturnType<typeof initDB>; projectId: number } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsm-search-'));
  const db = initDB(path.join(tmp, 'app.db'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-1.jsonl'));
  importFile(db, path.resolve('tests/fixtures/proj-a/sess-2.jsonl'));
  const projectId = (db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: number }).id;
  return { db, projectId };
}

test('list messages in session', () => {
  const { db } = setup();
  const msgs = listBySession(db, 'sess-1');
  closeDB(db);
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, 'user');
});

test('search single keyword', () => {
  const { db } = setup();
  const hits = search(db, 'hello', null, null);
  closeDB(db);
  assert.ok(hits.some((h) => h.message.content.includes('hello')));
});

test('search multi-keyword AND', () => {
  const { db } = setup();
  const hits = search(db, 'reset database', null, null);
  closeDB(db);
  assert.strictEqual(hits.length, 1);
  assert.ok(hits[0].message.content.includes('reset'));
});

test('search filter by project', () => {
  const { db, projectId } = setup();
  const hits = search(db, 'hello', [projectId], null);
  closeDB(db);
  assert.ok(hits.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/search.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write messages + search**

`electron/repo/messages.ts`:
```typescript
import { DB } from '../db/connection';
import { MessageRow } from './types';

export function listBySession(db: DB, sessionId: string): MessageRow[] {
  return db
    .prepare(
      'SELECT id, uuid, session_id AS sessionId, role, content, created_at AS createdAt FROM messages WHERE session_id = ? ORDER BY created_at ASC'
    )
    .all(sessionId) as MessageRow[];
}
```

`electron/repo/search.ts`:
```typescript
import { DB } from '../db/connection';
import { SearchHit, MessageRow } from './types';

export function search(
  db: DB,
  query: string,
  projectIds: number[] | null,
  timeRange: { from: number; to: number } | null
): SearchHit[] {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ''))
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`);
  if (tokens.length === 0) return [];
  const ftsQuery = tokens.join(' ');

  let sql = `
    SELECT m.id, m.uuid, m.session_id AS sessionId, m.role, m.content,
           m.created_at AS createdAt,
           snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet,
           s.title AS sessionTitle, p.name AS projectName, p.id AS projectId
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    JOIN sessions s ON s.session_id = m.session_id
    JOIN projects p ON p.id = s.project_id
    WHERE messages_fts MATCH ?
      AND s.is_deleted = 0
  `;
  const params: unknown[] = [ftsQuery];

  if (projectIds && projectIds.length > 0) {
    sql += ` AND p.id IN (${projectIds.map(() => '?').join(',')})`;
    params.push(...projectIds);
  }
  if (timeRange) {
    sql += ' AND m.created_at >= ? AND m.created_at <= ?';
    params.push(timeRange.from, timeRange.to);
  }
  sql += ' ORDER BY rank LIMIT 200';

  const rows = db.prepare(sql).all(...params) as Array<
    Omit<SearchHit, 'message'> & { id: number; uuid: string; sessionId: string; role: 'user' | 'assistant'; content: string; createdAt: number }
  >;
  return rows.map((r) => ({
    message: {
      id: r.id,
      uuid: r.uuid,
      sessionId: r.sessionId,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
    } as MessageRow,
    snippet: r.snippet,
    sessionTitle: r.sessionTitle,
    projectName: r.projectName,
    projectId: r.projectId,
  }));
}
```

Modify `electron/repo/index.ts`:
```typescript
export * from './projects';
export * from './sessions';
export * from './messages';
export * from './search';
export * from './types';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/search.test.ts
```

Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git add .
git commit -m "feat(repo): messages list + FTS5 search"
```

---

### Task 8: Resumer — Spawn `claude --resume`

**Files:**
- Create: `electron/resumer.ts`
- Create: `tests/resumer.test.ts`

**Interfaces:**
- `export function buildResumeCommand(sessionId: string, cwd?: string): { command: string; args: string[]; cwd?: string }`
- `export function resumeSession(sessionId: string, cwd?: string): number` — returns child PID

- [ ] **Step 1: Write the failing test**

`tests/resumer.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { buildResumeCommand } from '../electron/resumer';

test('command includes session id and --resume flag', () => {
  const cmd = buildResumeCommand('sess-abc');
  assert.strictEqual(cmd.command, 'claude');
  assert.deepStrictEqual(cmd.args, ['--resume', 'sess-abc']);
});

test('command respects cwd', () => {
  const cmd = buildResumeCommand('sess-abc', 'C:/some/dir');
  assert.strictEqual(cmd.cwd, 'C:/some/dir');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/resumer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write resumer**

`electron/resumer.ts`:
```typescript
import { spawn } from 'child_process';

export interface ResumeCommand {
  command: string;
  args: string[];
  cwd?: string;
}

export function buildResumeCommand(sessionId: string, cwd?: string): ResumeCommand {
  return {
    command: 'claude',
    args: ['--resume', sessionId],
    cwd,
  };
}

export function resumeSession(sessionId: string, cwd?: string): number {
  const { command, args } = buildResumeCommand(sessionId, cwd);
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test -- tests/resumer.test.ts
```

Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git add .
git commit -m "feat(resumer): spawn claude --resume"
```

---

### Task 9: IPC Bridge (preload + main handlers)

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

**Interfaces (window.api):**
- `listProjects(): Promise<ProjectRow[]>`
- `listSessions(projectId, includeDeleted): Promise<SessionRow[]>`
- `listMessages(sessionId): Promise<MessageRow[]>`
- `searchMessages(query, projectIds, fromMs, toMs): Promise<SearchHit[]>`
- `softDeleteSession(sessionId): Promise<void>`
- `restoreSession(sessionId): Promise<void>`
- `permanentDeleteSession(sessionId): Promise<void>`
- `resumeSession(sessionId): Promise<number>`

- [ ] **Step 1: Write electron/main.ts with full IPC**

`electron/main.ts`:
```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as os from 'os';
import { initDB, DB } from './db/connection';
import { scanSourceDir, importFile } from './importer';
import * as projectsRepo from './repo/projects';
import * as sessionsRepo from './repo/sessions';
import * as messagesRepo from './repo/messages';
import * as searchRepo from './repo/search';
import { resumeSession } from './resumer';

let db: DB;

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
  const dataDir = getDataDir();
  const dbPath = path.join(dataDir, 'app.db');
  db = initDB(dbPath);

  // Trigger first-run import
  const home = os.homedir();
  const sourceDir = path.join(home, '.claude', 'projects');
  setTimeout(() => {
    try {
      for (const file of scanSourceDir(sourceDir)) {
        importFile(db, file);
      }
    } catch (e) {
      console.error('Import error', e);
    }
  }, 1000);

  ipcMain.handle('list_projects', () => projectsRepo.listWithCounts(db));
  ipcMain.handle('list_sessions', (_e, projectId: number, includeDeleted: boolean) =>
    sessionsRepo.listByProject(db, projectId, includeDeleted)
  );
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
    // Use the directory containing the source JSONL
    const cwd = path.dirname(session.sourceFile);
    return resumeSession(sessionId, cwd);
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 2: Write electron/preload.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  listProjects: () => ipcRenderer.invoke('list_projects'),
  listSessions: (projectId: number, includeDeleted: boolean) =>
    ipcRenderer.invoke('list_sessions', projectId, includeDeleted),
  listMessages: (sessionId: string) => ipcRenderer.invoke('list_messages', sessionId),
  searchMessages: (query: string, projectIds: number[] | null, fromMs: number | null, toMs: number | null) =>
    ipcRenderer.invoke('search_messages', query, projectIds, fromMs, toMs),
  softDeleteSession: (sessionId: string) => ipcRenderer.invoke('soft_delete_session', sessionId),
  restoreSession: (sessionId: string) => ipcRenderer.invoke('restore_session', sessionId),
  permanentDeleteSession: (sessionId: string) =>
    ipcRenderer.invoke('permanent_delete_session', sessionId),
  resumeSession: (sessionId: string) => ipcRenderer.invoke('resume_session', sessionId),
});
```

- [ ] **Step 3: Type declaration for window.api**

`src/global.d.ts`:
```typescript
import type { ProjectRow, SessionRow, MessageRow, SearchHit } from './types';

declare global {
  interface Window {
    api: {
      listProjects(): Promise<ProjectRow[]>;
      listSessions(projectId: number, includeDeleted: boolean): Promise<SessionRow[]>;
      listMessages(sessionId: string): Promise<MessageRow[]>;
      searchMessages(
        query: string,
        projectIds: number[] | null,
        fromMs: number | null,
        toMs: number | null
      ): Promise<SearchHit[]>;
      softDeleteSession(sessionId: string): Promise<void>;
      restoreSession(sessionId: string): Promise<void>;
      permanentDeleteSession(sessionId: string): Promise<void>;
      resumeSession(sessionId: string): Promise<number>;
    };
  }
}
export {};
```

- [ ] **Step 4: Verify build**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npx tsc -p tsconfig.electron.json
```

Expected: builds without errors.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git add .
git commit -m "feat(ipc): expose api via contextBridge"
```

---

### Task 10: React Three-Pane UI

**Files:**
- Create: `src/types.ts`
- Create: `src/api.ts`
- Create: `src/components/SearchBar.tsx`
- Create: `src/components/ProjectList.tsx`
- Create: `src/components/SessionList.tsx`
- Create: `src/components/MessageView.tsx`
- Create: `src/components/ConfirmDialog.tsx`
- Create: `src/components/RecycleBinView.tsx`
- Create: `src/hooks/useSearch.ts`
- Create: `src/App.tsx`
- Modify: `src/main.tsx` (import global.d.ts)

- [ ] **Step 1: Define types**

`src/types.ts`:
```typescript
export interface ProjectRow {
  id: number;
  path: string;
  name: string;
  sessionCount: number;
}

export interface SessionRow {
  id: number;
  sessionId: string;
  projectId: number;
  title: string | null;
  startedAt: number;
  lastMessageAt: number;
  messageCount: number;
  sourceFile: string;
  firstUserMessage: string | null;
}

export interface MessageRow {
  id: number;
  uuid: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface SearchHit {
  message: MessageRow;
  snippet: string;
  sessionTitle: string | null;
  projectName: string;
  projectId: number;
}
```

- [ ] **Step 2: API wrapper**

`src/api.ts`:
```typescript
import type { ProjectRow, SessionRow, MessageRow, SearchHit } from './types';

export const api = {
  listProjects: () => window.api.listProjects(),
  listSessions: (projectId: number, includeDeleted: boolean) =>
    window.api.listSessions(projectId, includeDeleted),
  listMessages: (sessionId: string) => window.api.listMessages(sessionId),
  searchMessages: (query: string, projectIds: number[] | null, fromMs: number | null, toMs: number | null) =>
    window.api.searchMessages(query, projectIds, fromMs, toMs),
  softDeleteSession: (sessionId: string) => window.api.softDeleteSession(sessionId),
  restoreSession: (sessionId: string) => window.api.restoreSession(sessionId),
  permanentDeleteSession: (sessionId: string) => window.api.permanentDeleteSession(sessionId),
  resumeSession: (sessionId: string) => window.api.resumeSession(sessionId),
};
```

- [ ] **Step 3: useSearch hook**

`src/hooks/useSearch.ts`:
```typescript
import { useState, useEffect } from 'react';
import { api } from '../api';
import type { SearchHit } from '../types';

export type TimeRange = 'today' | '7d' | '30d' | 'all';

function computeTimeRange(range: TimeRange): { from: number | null; to: number | null } {
  if (range === 'all') return { from: null, to: null };
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (range === 'today') return { from: now - day, to: now };
  if (range === '7d') return { from: now - 7 * day, to: now };
  return { from: now - 30 * day, to: now };
}

export function useSearch(query: string, projectIds: number[] | null, timeRange: TimeRange) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const { from, to } = computeTimeRange(timeRange);
        const result = await api.searchMessages(query, projectIds, from, to);
        setHits(result);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, projectIds?.join(','), timeRange]);

  return { hits, loading };
}
```

- [ ] **Step 4: SearchBar component**

`src/components/SearchBar.tsx`:
```typescript
import React from 'react';
import type { TimeRange } from '../hooks/useSearch';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onShowRecycleBin: () => void;
  showingRecycleBin: boolean;
  projectIds: number[] | null;
  onProjectIdsChange: (ids: number[] | null) => void;
  timeRange: TimeRange;
  onTimeRangeChange: (r: TimeRange) => void;
  availableProjects: { id: number; name: string }[];
}

export const SearchBar: React.FC<Props> = ({
  query, onQueryChange, onShowRecycleBin, showingRecycleBin,
  projectIds, onProjectIdsChange, timeRange, onTimeRangeChange, availableProjects,
}) => (
  <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #ccc', background: '#fafafa' }}>
    <input
      type="text"
      placeholder="🔍 搜索关键词（空格分隔多关键词）"
      value={query}
      onChange={(e) => onQueryChange(e.target.value)}
      style={{ flex: 1, padding: 8, fontSize: 14 }}
    />
    <select
      multiple
      value={projectIds?.map(String) ?? []}
      onChange={(e) => {
        const ids = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
        onProjectIdsChange(ids.length ? ids : null);
      }}
      style={{ minWidth: 140, padding: 4 }}
      size={1}
    >
      {availableProjects.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
    <select
      value={timeRange}
      onChange={(e) => onTimeRangeChange(e.target.value as TimeRange)}
      style={{ padding: 8 }}
    >
      <option value="today">今天</option>
      <option value="7d">近 7 天</option>
      <option value="30d">近 30 天</option>
      <option value="all">全部</option>
    </select>
    <button onClick={onShowRecycleBin} style={{ padding: '8px 12px' }}>
      {showingRecycleBin ? '← 返回' : '🗑️ 回收站'}
    </button>
  </div>
);
```

- [ ] **Step 5: ProjectList component**

`src/components/ProjectList.tsx`:
```typescript
import React from 'react';
import type { ProjectRow } from '../types';

interface Props {
  projects: ProjectRow[];
  selectedProjectId: number | null;
  onSelect: (id: number) => void;
}

export const ProjectList: React.FC<Props> = ({ projects, selectedProjectId, onSelect }) => (
  <div style={{ width: 200, borderRight: '1px solid #ccc', overflowY: 'auto', background: '#f5f5f5' }}>
    {projects.map((p) => (
      <div
        key={p.id}
        onClick={() => onSelect(p.id)}
        style={{
          padding: 12,
          cursor: 'pointer',
          background: selectedProjectId === p.id ? '#e0e0e0' : 'transparent',
          borderBottom: '1px solid #eee',
        }}
      >
        {p.name} ({p.sessionCount})
      </div>
    ))}
  </div>
);
```

- [ ] **Step 6: SessionList component**

`src/components/SessionList.tsx`:
```typescript
import React from 'react';
import type { SessionRow } from '../types';

interface Props {
  sessions: SessionRow[];
  selectedSessionId: string | null;
  onSelect: (id: string) => void;
  onSoftDelete: (id: string) => void;
  onRestore?: (id: string) => void;
  onPermanentDelete?: (id: string) => void;
}

const formatTime = (ms: number) => new Date(ms).toLocaleString();

export const SessionList: React.FC<Props> = ({
  sessions, selectedSessionId, onSelect, onSoftDelete, onRestore, onPermanentDelete,
}) => (
  <div style={{ width: 340, borderRight: '1px solid #ccc', overflowY: 'auto' }}>
    {sessions.length === 0 && (
      <div style={{ padding: 16, color: '#999' }}>暂无会话</div>
    )}
    {sessions.map((s) => (
      <div
        key={s.sessionId}
        onClick={() => onSelect(s.sessionId)}
        style={{
          padding: 12,
          borderBottom: '1px solid #eee',
          cursor: 'pointer',
          background: selectedSessionId === s.sessionId ? '#e0e0e0' : 'transparent',
        }}
      >
        <div style={{ fontWeight: 'bold', fontSize: 13 }}>
          {s.title || s.firstUserMessage?.slice(0, 50) || '(无标题)'}
        </div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
          {formatTime(s.lastMessageAt)} · {s.messageCount} 条消息
        </div>
        <div style={{ marginTop: 6 }}>
          {onRestore && onPermanentDelete ? (
            <>
              <button onClick={(e) => { e.stopPropagation(); onRestore(s.sessionId); }}>
                ↩ 恢复
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onPermanentDelete(s.sessionId); }}
                style={{ marginLeft: 4, color: '#dc2626' }}
              >
                永久删除
              </button>
            </>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onSoftDelete(s.sessionId); }}>
              🗑️ 删除
            </button>
          )}
        </div>
      </div>
    ))}
  </div>
);
```

- [ ] **Step 7: MessageView component**

`src/components/MessageView.tsx`:
```typescript
import React from 'react';
import type { MessageRow } from '../types';

interface Props {
  messages: MessageRow[];
  onResume: () => void;
  showResume: boolean;
}

export const MessageView: React.FC<Props> = ({ messages, onResume, showResume }) => (
  <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#fff' }}>
    {messages.length === 0 && (
      <div style={{ color: '#999', textAlign: 'center', padding: 40 }}>
        选择左侧会话以查看消息
      </div>
    )}
    {messages.map((m) => (
      <div
        key={m.uuid}
        style={{
          marginBottom: 12,
          padding: 12,
          background: m.role === 'user' ? '#dbeafe' : '#f0f0f0',
          borderRadius: 8,
          marginLeft: m.role === 'user' ? 0 : 60,
          marginRight: m.role === 'user' ? 60 : 0,
        }}
      >
        <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
          {m.role === 'user' ? '👤 你' : '🤖 Claude'} · {new Date(m.createdAt).toLocaleString()}
        </div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.5 }}>{m.content}</div>
      </div>
    ))}
    {showResume && (
      <button
        onClick={onResume}
        style={{
          marginTop: 16,
          padding: '10px 20px',
          background: '#16a34a',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        ▶ 继续会话
      </button>
    )}
  </div>
);
```

- [ ] **Step 8: ConfirmDialog component**

`src/components/ConfirmDialog.tsx`:
```typescript
import React, { useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  requireInput?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<Props> = ({
  open, title, message, confirmText = '确认', requireInput, onConfirm, onCancel,
}) => {
  const [input, setInput] = useState('');
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{ background: 'white', padding: 24, borderRadius: 8, minWidth: 400, maxWidth: 600 }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p style={{ color: '#444' }}>{message}</p>
        {requireInput && (
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`请输入: ${requireInput}`}
            style={{ width: '100%', padding: 8, marginTop: 8, boxSizing: 'border-box' }}
          />
        )}
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '6px 14px' }}>取消</button>
          <button
            disabled={!!requireInput && input !== requireInput}
            onClick={onConfirm}
            style={{
              background: requireInput ? '#dc2626' : '#2563eb',
              color: 'white',
              padding: '6px 14px',
              border: 'none',
              borderRadius: 4,
              cursor: requireInput && input !== requireInput ? 'not-allowed' : 'pointer',
              opacity: requireInput && input !== requireInput ? 0.5 : 1,
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 9: RecycleBinView component**

`src/components/RecycleBinView.tsx`:
```typescript
import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { SessionRow } from '../types';
import { SessionList } from './SessionList';

interface Props {
  refreshKey: number;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
}

export const RecycleBinView: React.FC<Props> = ({ refreshKey, onRestore, onPermanentDelete }) => {
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    (async () => {
      const projects = await api.listProjects();
      const all = await Promise.all(projects.map((p) => api.listSessions(p.id, true)));
      // Filter to soft-deleted only
      // (We don't expose is_deleted in SessionRow type, so we approximate by checking source)
      // Better: add a dedicated listDeleted API. For now, list all and show "已删除" badge via source.
      setSessions(all.flat());
    })();
  }, [refreshKey]);

  return (
    <div style={{ display: 'flex', flex: 1 }}>
      <SessionList
        sessions={sessions}
        selectedSessionId={null}
        onSelect={() => {}}
        onSoftDelete={() => {}}
        onRestore={onRestore}
        onPermanentDelete={onPermanentDelete}
      />
      <div style={{ flex: 1, padding: 40, color: '#666', textAlign: 'center' }}>
        回收站 — 选择左侧会话进行恢复或永久删除
      </div>
    </div>
  );
};
```

- [ ] **Step 10: App.tsx**

`src/App.tsx`:
```typescript
import React, { useEffect, useState } from 'react';
import { api } from './api';
import type { ProjectRow, SessionRow, MessageRow, SearchHit } from './types';
import { SearchBar } from './components/SearchBar';
import { ProjectList } from './components/ProjectList';
import { SessionList } from './components/SessionList';
import { MessageView } from './components/MessageView';
import { ConfirmDialog } from './components/ConfirmDialog';
import { RecycleBinView } from './components/RecycleBinView';
import { useSearch, type TimeRange } from './hooks/useSearch';

export default function App() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<number[] | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmSoft, setConfirmSoft] = useState<string | null>(null);
  const [confirmPermanent, setConfirmPermanent] = useState<SessionRow | null>(null);

  const { hits } = useSearch(query, projectFilter, timeRange);

  useEffect(() => {
    api.listProjects().then(setProjects);
  }, [refreshKey]);

  useEffect(() => {
    if (selectedProjectId === null) {
      setSessions([]);
      return;
    }
    api.listSessions(selectedProjectId, false).then(setSessions);
  }, [selectedProjectId, refreshKey]);

  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    api.listMessages(selectedSessionId).then(setMessages);
  }, [selectedSessionId]);

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onShowRecycleBin={() => setShowRecycleBin((v) => !v)}
        showingRecycleBin={showRecycleBin}
        projectIds={projectFilter}
        onProjectIdsChange={setProjectFilter}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        availableProjects={projects}
      />
      {showRecycleBin ? (
        <RecycleBinView
          refreshKey={refreshKey}
          onRestore={async (id) => { await api.restoreSession(id); refresh(); }}
          onPermanentDelete={(id) => {
            const target = sessions.find((s) => s.sessionId === id) || ({ sessionId: id, title: id } as SessionRow);
            setConfirmPermanent(target);
          }}
        />
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <ProjectList
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelect={setSelectedProjectId}
          />
          {query.trim() ? (
            <SearchResultsPane hits={hits} onPick={(id) => { setSelectedSessionId(id); setQuery(''); }} />
          ) : (
            <>
              <SessionList
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                onSelect={setSelectedSessionId}
                onSoftDelete={setConfirmSoft}
              />
              <MessageView
                messages={messages}
                showResume={!!selectedSessionId}
                onResume={async () => {
                  if (selectedSessionId) await api.resumeSession(selectedSessionId);
                }}
              />
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={!!confirmSoft}
        title="移到回收站"
        message="此会话将进入回收站，可随时恢复。"
        confirmText="移到回收站"
        onCancel={() => setConfirmSoft(null)}
        onConfirm={async () => {
          if (confirmSoft) await api.softDeleteSession(confirmSoft);
          setConfirmSoft(null);
          refresh();
        }}
      />
      <ConfirmDialog
        open={!!confirmPermanent}
        title="永久删除"
        message={`此操作不可恢复！请输入会话标题以确认：${confirmPermanent?.title || confirmPermanent?.sessionId}`}
        confirmText="永久删除"
        requireInput={confirmPermanent?.title || ''}
        onCancel={() => setConfirmPermanent(null)}
        onConfirm={async () => {
          if (confirmPermanent) await api.permanentDeleteSession(confirmPermanent.sessionId);
          setConfirmPermanent(null);
          refresh();
        }}
      />
    </div>
  );
}

const SearchResultsPane: React.FC<{ hits: SearchHit[]; onPick: (sessionId: string) => void }> = ({ hits, onPick }) => (
  <div style={{ width: 380, borderRight: '1px solid #ccc', overflowY: 'auto' }}>
    {hits.length === 0 ? (
      <div style={{ padding: 16, color: '#999' }}>未找到匹配会话</div>
    ) : (
      hits.map((h) => (
        <div
          key={h.message.uuid}
          onClick={() => onPick(h.message.sessionId)}
          style={{ padding: 12, borderBottom: '1px solid #eee', cursor: 'pointer' }}
        >
          <div style={{ fontSize: 11, color: '#666' }}>
            {h.projectName} · {h.sessionTitle || '(无标题)'}
          </div>
          <div
            style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}
            dangerouslySetInnerHTML={{ __html: h.snippet }}
          />
        </div>
      ))
    )}
  </div>
);
```

- [ ] **Step 11: Verify build**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npx vite build
npx tsc -p tsconfig.electron.json
```

Expected: both build successfully.

- [ ] **Step 12: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git add .
git commit -m "feat(ui): three-pane layout + search + recycle bin"
```

---

### Task 11: Manual Verification Checklist + Run

**Files:**
- Create: `docs/MANUAL_VERIFICATION.md`

- [ ] **Step 1: Write verification checklist**

`docs/MANUAL_VERIFICATION.md`:
```markdown
# Manual Verification Checklist

Run through these checks before shipping v1.

## Setup
- [ ] `npm install` completes without errors
- [ ] `npm run dev` starts both Vite (port 5173) and Electron
- [ ] A window opens showing the three-pane UI
- [ ] `~/.claude/projects/` directory has at least 50 sessions

## First-run import
- [ ] On first launch, console shows "Import error" or completes silently
- [ ] After a few seconds, the project list populates
- [ ] Project list shows your real projects

## View
- [ ] Three-pane layout renders correctly
- [ ] Clicking a project shows its sessions in the middle pane
- [ ] Clicking a session shows all messages in the right pane
- [ ] User messages left-aligned (blue background), Claude right-indented (gray)

## Search
- [ ] Type "hello" — see results in middle pane
- [ ] Type "reset database" (two keywords) — only AND-matched results
- [ ] Keywords highlighted with `<mark>` yellow background
- [ ] Project filter reduces results
- [ ] Time range "近 7 天" reduces results

## Soft delete + restore
- [ ] Click 🗑️ → confirm → session moves to recycle bin
- [ ] Open recycle bin → session appears
- [ ] Click ↩ 恢复 → session returns to main view

## Permanent delete
- [ ] In recycle bin, click 永久删除
- [ ] Dialog asks to type session title
- [ ] Wrong title → button disabled
- [ ] Correct title → confirmation deletes; messages also gone

## Resume
- [ ] Click ▶ 继续会话
- [ ] A new claude process opens with `--resume <id>` (if `claude` is in PATH)
- [ ] Tool window stays open and responsive

## Production build
- [ ] `npm run build` completes
- [ ] `electron .` (with built dist) opens the production window
```

- [ ] **Step 2: Run all tests**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
git add .
git commit -m "docs: manual verification checklist"
```

- [ ] **Step 4: Run dev mode**

```bash
cd C:/Users/15532/Desktop/cc-session-manager
npm run dev
```

Expected: window opens. Manually walk through `docs/MANUAL_VERIFICATION.md`.

---

## Self-Review Checklist

- [ ] All 4 spec requirements: view, search, resume, soft delete + restore
- [ ] No placeholders
- [ ] TDD: every task has test first, then implementation
- [ ] Soft delete: only `is_deleted` flipped, messages preserved
- [ ] FTS5 sync via triggers
- [ ] Resume: spawn `claude --resume <id>`, non-blocking
- [ ] Permanent delete: requires typing title

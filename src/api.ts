// v4.0 Tauri 2 dispatch — 平移自 v3.1 src/api.ts
//
// Tauri 2 注入 window.__TAURI_INTERNALS__ 用于运行时检测
// 详见 https://v2.tauri.app/reference/architecture/
//
// 浏览器打开 vite 5173 不再有 mock(commit 2 删) → 直接抛错引导用户用 `npm run tauri dev`
import * as tauriApi from './api-tauri';

declare const window: {
  __TAURI_INTERNALS__?: unknown;
};

const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

if (!isTauri) {
  throw new Error(
    'v4.0 已删除 mock 模式 — 请用 `npm run tauri dev` 启动 WebView2 (vite 5173 浏览器开就跑不动)'
  );
}

// 60 个 IPC wrapper 直接 re-export api-tauri.ts
export const api = tauriApi.api;
export type Api = typeof tauriApi.api;
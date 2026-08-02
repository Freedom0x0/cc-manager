// v4.0 Tauri 2 升档后, 旧的 window.api (v3.1 Electron preload inject 模式)
// 不再使用。所有 IPC 调用走 src/api.ts 的 `import { api }`, 走 Tauri 2
// invoke 直接调后端 #[tauri::command] handler。
//
// 本文件留作历史(原 v3.1 commit 1-12 落地), 空 stub 形式保留, 避免
// 老 import 'Api' 类型引用编译失败。debate 后续 commit 全删。
export {};

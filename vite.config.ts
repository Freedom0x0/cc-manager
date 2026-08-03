import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * v4.0 commit 14 动态 prod CSP
 *
 * 策略:
 * - dev (vite dev server, port 5173): 不注入 csp meta,Tauri 端 csp: null,
 *   vite HMR ws:// + http://localhost:5173 任意连, 开发体验流畅
 * - prod (vite build, outDir dist): 注入严格 csp meta 到 index.html,
 *   Tauri 端 csp: null, webview 读 meta csp 生效
 *
 * 为什么 csp 在 vite 不在 tauri.conf.json:
 * - Tauri 2 的 csp 字段是 build-time 嵌入 binary, dev/prod 共用同一 conf
 *   需做 null/strict 二选一,vite HMR ws 会被 strict 拦 → dev 不能 strict
 * - 改 vite transform 注入 meta 天然按 mode 切换: dev 不注, prod 注
 * - webview 优先 meta csp over Tauri 注入的 csp
 */
const cspPlugin = (): Plugin => ({
  name: 'cc-csp-meta',
  transformIndexHtml: {
    order: 'pre',
    handler(html, ctx) {
      if (ctx.server) return html;  // dev: 不注
      // prod: 注入 meta csp(同 tauri 2 default 严格策略)
      const csp = "default-src 'self'; img-src 'self' data: asset: https://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost; font-src 'self' data:";
      return html.replace(
        '<meta name="viewport"',
        `<meta http-equiv="Content-Security-Policy" content="${csp}">\n    <meta name="viewport"`
      );
    },
  },
});

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // v1.2 D34 c5: 多入口 (主窗口 + 宠物窗口), spec §8.3
    // D34 fix (c5 review): pet.html 放项目根 (跟 index.html 平级),
    //   build 输出 dist/pet.html (匹配 WebviewUrl::App("pet.html"))
    //   而非 dist/src/pet.html (会 404)
    rollupOptions: {
      input: {
        main: 'index.html',
        pet: 'pet.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

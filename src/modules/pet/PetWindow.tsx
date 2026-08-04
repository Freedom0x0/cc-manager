// v1.2 D34 (Task 5): PetWindow — 宠物窗口内容
//
// src/pet-main.tsx 独立 React 入口(对应 src/pet.html),挂在 Tauri 启动时
// 建的 "pet" webview(无装饰 / 透明 / always-on-top)。listen 监听 daemon
// 广播的 'agent-state-event'(Rust 侧 daemon.rs handle_event 用
// tauri::Emitter::emit 触发),切换 sprite。
//
// D35: 容器 = sprite 大小 (80×80), 避免透明 webview 吃屏幕点击。
// D38: 拖动用 Tauri 2 原生 startDragging() ——
//   之前的 D36 方案 (mousedown + document mousemove + setPosition) 失败:
//   transparent + always-on-top 窗口 mouse hover 出 webview 后,
//   document mousemove 不再触发 (OS 当无焦点浮窗处理)。
//   startDragging() 是 OS 原生拖动, 不依赖 webview DOM 事件, 跨平台稳。
// D37: 右键 sprite → 关宠物窗口。

import React, { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '../../api-tauri';
import type { AgentStateEvent, PetState } from '../../types';

// 7 state → sprite (asset paths, see §13 待办 1: 像素 GIF 来源待定)
// 暂时用 emoji 占位, v1.2 验证通过后换真 GIF
const SPRITE_MAP: Record<PetState, string> = {
  'idle': '😐',
  'responding': '💬',
  'thinking': '🤔',
  'tool-use': '🔧',
  'ask-user': '❓',
  'completed': '✅',
  'error-interrupted': '❌',
};

const PET_SIZE = 80; // 容器和 sprite 同尺寸 (D35)

export function PetWindow() {
  const [current, setCurrent] = useState<AgentStateEvent | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // Listen to daemon broadcast events
    const unlisten = listen<AgentStateEvent>('agent-state-event', (e) => {
      setCurrent(e.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // D38: Tauri 2 原生拖动 — mousedown 触发 OS 拖动, 不依赖 webview mousemove。
  // startDragging() 内部调用 SetWindowPos (Win) / [WinWindow move] (mac),
  // mouse hover 出 webview 仍继续响应。
  //
  // ⚠️ D38 v2 修复: startDragging() 返回的 Promise 在调用期间不阻塞, 一旦
  // resolve .finally 立刻 setDragging(false) 会抢跑 — cursor 闪 grabbing
  // 又回 grab, 视觉上看不到变化, 拖动期间也没法切 grabbing。 改成 mouseup
  // 显式清: dragging=true 后 document mouseup 触发 setDragging(false)。
  // dragging 也保留作 useEffect 触发 cursor 切到 grabbing 的方式 (CSS).
  useEffect(() => {
    if (!dragging) return;
    const onUp = () => setDragging(false);
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [dragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // 左键才拖, 中键右键留给系统菜单
    if (e.button !== 0) return;
    e.preventDefault();
    setDragging(true);
    getCurrentWindow()
      .startDragging()
      .catch((err) => console.error('[pet] startDragging failed:', err));
  };

  // D37: 右键 sprite → 关闭宠物窗口。
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    api.petWindowClose().catch(() => {});
  };

  const state: PetState = current?.state ?? 'idle';
  const sprite = SPRITE_MAP[state];

  return (
    <div
      style={{
        width: PET_SIZE,
        height: PET_SIZE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        userSelect: 'none',
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        style={{
          fontSize: PET_SIZE,
          lineHeight: 1,
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        {sprite}
      </div>
    </div>
  );
}

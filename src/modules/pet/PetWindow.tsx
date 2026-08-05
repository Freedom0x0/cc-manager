// v1.2 D34 (Task 5): PetWindow — 宠物窗口内容
//
// src/pet-main.tsx 独立 React 入口(对应 src/pet.html),挂在 Tauri 启动时
// 建的 "pet" webview(无装饰 / 透明 / always-on-top)。listen 监听 daemon
// 广播的 'agent-state-event'(Rust 侧 daemon.rs handle_event 用
// tauri::Emitter::emit 触发),切换 sprite。
//
// v1.4: 224×252 紧凑像素状态卡，明确展示状态、Skill 与 MCP 调用。
// D38: 拖动用 Tauri 2 原生 startDragging() ——
//   之前的 D36 方案 (mousedown + document mousemove + setPosition) 失败:
//   transparent + always-on-top 窗口 mouse hover 出 webview 后,
//   document mousemove 不再触发 (OS 当无焦点浮窗处理)。
//   startDragging() 是 OS 原生拖动, 不依赖 webview DOM 事件, 跨平台稳。
// v1.3: 右键打开像素菜单，可关闭、切换悬浮和透明背景。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '../../api-tauri';
import type { AgentStateEvent, PetState } from '../../types';
import './PetWindow.css';

const STATE_META: Record<PetState, { label: string; hint: string; symbol: string }> = {
  idle: { label: '空闲待命', hint: '等待新任务', symbol: 'Z' },
  responding: { label: '正在响应', hint: '已收到你的指令', symbol: '>>' },
  thinking: { label: '深度思考', hint: '正在组织下一步', symbol: '...' },
  'tool-use': { label: '调用工具', hint: '正在执行外部能力', symbol: '<>' },
  'ask-user': { label: '需要确认', hint: '请回到会话处理', symbol: '!' },
  completed: { label: '任务完成', hint: '本轮工作已结束', symbol: 'OK' },
  'error-interrupted': { label: '执行中断', hint: '请检查会话错误', symbol: 'X' },
};

const PINNED_STORAGE_KEY = 'cc-pet:pinned';
const TRANSPARENT_STORAGE_KEY = 'cc-pet:transparent-background';

interface ContextMenuPosition {
  x: number;
  y: number;
}

function mergeEvents(
  current: Record<string, AgentStateEvent>,
  incoming: AgentStateEvent[],
): Record<string, AgentStateEvent> {
  const next = { ...current };
  for (const event of incoming) {
    const previous = next[event.session_id];
    if (!previous || event.timestamp_ms >= previous.timestamp_ms) {
      next[event.session_id] = event;
    }
  }
  return next;
}

function formatAge(timestampMs: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestampMs) / 1000));
  if (seconds < 3) return '刚刚更新';
  if (seconds < 60) return `${seconds} 秒前`;
  return `${Math.floor(seconds / 60)} 分钟前`;
}

export function PetWindow() {
  const [sessions, setSessions] = useState<Record<string, AgentStateEvent>>({});
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  const [pinned, setPinned] = useState(() => localStorage.getItem(PINNED_STORAGE_KEY) !== 'false');
  const [backgroundTransparent, setBackgroundTransparent] = useState(
    () => localStorage.getItem(TRANSPARENT_STORAGE_KEY) === 'true',
  );
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;

    listen<AgentStateEvent>('agent-state-event', (event) => {
      if (!disposed) {
        setSessions((current) => mergeEvents(current, [event.payload]));
      }
    }).then((stop) => {
      if (disposed) stop();
      else stopListening = stop;
    }).catch(() => {});

    // 浮窗可能在调用进行中才打开，先拉 daemon 快照，避免一直显示空闲。
    api.petGetStatus()
      .then((snapshot) => {
        if (!disposed) {
          setSessions((current) => mergeEvents(current, snapshot));
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    // 浏览器预览没有 Tauri window metadata；真实宠物窗口再同步原生悬浮状态。
    if (!('__TAURI_INTERNALS__' in window)) return;
    const petWindow = getCurrentWindow();
    const savedPinned = localStorage.getItem(PINNED_STORAGE_KEY);
    if (savedPinned === null) {
      petWindow.isAlwaysOnTop().then(setPinned).catch(() => {});
    } else {
      petWindow.setAlwaysOnTop(savedPinned === 'true').catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    menuRef.current?.focus();
    const closeMenu = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', closeMenu);
    };
  }, [contextMenu]);

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
    if ((e.target as HTMLElement).closest('.pet-context-menu')) return;
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    e.preventDefault();
    setDragging(true);
    getCurrentWindow()
      .startDragging()
      .catch((err) => console.error('[pet] startDragging failed:', err));
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const menuWidth = 168;
    const menuHeight = 126;
    setContextMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - menuHeight - 8)),
    });
  };

  const togglePinned = async () => {
    const next = !pinned;
    try {
      await getCurrentWindow().setAlwaysOnTop(next);
      setPinned(next);
      localStorage.setItem(PINNED_STORAGE_KEY, String(next));
    } catch (error) {
      console.error('[pet] setAlwaysOnTop failed:', error);
    } finally {
      setContextMenu(null);
    }
  };

  const toggleTransparentBackground = () => {
    const next = !backgroundTransparent;
    setBackgroundTransparent(next);
    localStorage.setItem(TRANSPARENT_STORAGE_KEY, String(next));
    setContextMenu(null);
  };

  const current = useMemo(() => {
    return Object.values(sessions).sort((a, b) => b.timestamp_ms - a.timestamp_ms)[0] ?? null;
  }, [sessions]);
  const state: PetState = current?.state ?? 'idle';
  const meta = STATE_META[state];
  const mcpAction = current?.mcp_server && current.tool_name?.startsWith(`mcp__${current.mcp_server}__`)
    ? current.tool_name.slice(`mcp__${current.mcp_server}__`.length)
    : null;
  const hasCapability = Boolean(current?.skill_name || current?.mcp_server);

  return (
    <div
      className={`pet-card pet-card--${state}${dragging ? ' pet-card--dragging' : ''}${backgroundTransparent ? ' pet-card--transparent' : ''}`}
      data-state={state}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      style={{
        cursor: dragging ? 'grabbing' : 'grab',
      }}
    >
      <header className="pet-status" aria-live="polite">
        <span className="pet-status__dot" />
        <div className="pet-status__copy">
          <strong>{meta.label}</strong>
          <span>{current ? formatAge(current.timestamp_ms, now) : meta.hint}</span>
        </div>
        <span className="pet-status__session">
          {current?.session_id ? current.session_id.slice(0, 6) : 'CC'}
        </span>
      </header>

      <div className="pixel-stage" aria-hidden="true">
        <span className="pet-state-mark">{meta.symbol}</span>
        <span className="pixel-effect pixel-effect--one" />
        <span className="pixel-effect pixel-effect--two" />
        <span className="pixel-effect pixel-effect--three" />
        <div className="pixel-pet-frame">
          <div className="pixel-pet">
            <span className="pixel-ear pixel-ear--left" />
            <span className="pixel-ear pixel-ear--right" />
            <div className="pixel-head">
              <span className="pixel-eye pixel-eye--left" />
              <span className="pixel-eye pixel-eye--right" />
              <span className="pixel-mouth" />
            </div>
            <div className="pixel-body">
              <span className="pixel-core" />
            </div>
            <span className="pixel-leg pixel-leg--left" />
            <span className="pixel-leg pixel-leg--right" />
          </div>
        </div>
        <span className="pixel-shadow" />
      </div>

      <section className="pet-activity">
        {current?.skill_name && (
          <div className="pet-activity__row pet-activity__row--skill">
            <span className="pet-activity__kind">SKILL</span>
            <strong title={current.skill_name}>{current.skill_name}</strong>
          </div>
        )}
        {current?.mcp_server && (
          <div className="pet-activity__row pet-activity__row--mcp">
            <span className="pet-activity__kind">MCP</span>
            <strong title={current.mcp_server}>{current.mcp_server}</strong>
            {mcpAction && <span className="pet-activity__action" title={mcpAction}>/{mcpAction}</span>}
          </div>
        )}
        {!hasCapability && (
          <div className="pet-activity__empty">
            {current?.tool_name ? `工具 · ${current.tool_name}` : meta.hint}
          </div>
        )}
      </section>

      <div className="pet-drag-hint">
        <span>拖动移动</span>
        <span>右键菜单</span>
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="pet-context-menu"
          role="menu"
          aria-label="宠物菜单"
          tabIndex={-1}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="pet-context-menu__title">CC-PET MENU</div>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={pinned}
            onClick={togglePinned}
          >
            <span className={`pet-menu-check${pinned ? ' pet-menu-check--active' : ''}`} />
            固定悬浮
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={backgroundTransparent}
            onClick={toggleTransparentBackground}
          >
            <span className={`pet-menu-check${backgroundTransparent ? ' pet-menu-check--active' : ''}`} />
            背景透明
          </button>
          <div className="pet-context-menu__separator" />
          <button
            type="button"
            role="menuitem"
            className="pet-context-menu__close"
            onClick={() => api.petWindowClose().catch(() => {})}
          >
            <span className="pet-menu-close-mark" />
            关闭宠物
          </button>
        </div>
      )}
    </div>
  );
}

// v1.2 D34 (Task 5): PetWindow — 宠物窗口内容
//
// src/pet-main.tsx 独立 React 入口(对应 src/pet.html),挂在 Tauri 启动时
// 建的 "pet" webview(无装饰 / 透明 / always-on-top)。listen 监听 daemon
// 广播的 'agent-state-event'(Rust 侧 daemon.rs handle_event 用
// tauri::Emitter::emit 触发),切换 sprite + bubble 文案。
//
// sprite 用 7 个 emoji 占位 — 真像素 GIF 待 v4.1 找来源(spec §13 待办 1)。
// bubble 文案优先级: 调用 Skill > 调用 MCP > 调用 tool > 状态标签。

import React, { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
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

const STATE_LABELS: Record<PetState, string> = {
  'idle': '空闲',
  'responding': '正在回复…',
  'thinking': '思考中…',
  'tool-use': '调用工具',
  'ask-user': '需要你介入',
  'completed': '已完成',
  'error-interrupted': '中断',
};

export function PetWindow() {
  const [current, setCurrent] = useState<AgentStateEvent | null>(null);

  useEffect(() => {
    // Listen to daemon broadcast events
    const unlisten = listen<AgentStateEvent>('agent-state-event', (e) => {
      setCurrent(e.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const state: PetState = current?.state ?? 'idle';
  const sprite = SPRITE_MAP[state];
  const label = STATE_LABELS[state];
  const bubble =
    current?.skill_name ? `调用 Skill: ${current.skill_name}` :
    current?.mcp_server ? `调用 MCP: ${current.mcp_server}` :
    current?.tool_name ? `调用 ${current.tool_name}` :
    label;

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        userSelect: 'none',
      }}
    >
      <div style={{
        background: 'rgba(255,255,255,0.92)',
        borderRadius: 12,
        padding: '8px 14px',
        marginBottom: 8,
        fontSize: 13,
        maxWidth: 220,
        textAlign: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        {bubble}
      </div>
      <div style={{ fontSize: 80, lineHeight: 1, cursor: 'grab' }}>
        {sprite}
      </div>
      <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
        {current?.session_id?.slice(0, 8) ?? '—'}
      </div>
    </div>
  );
}
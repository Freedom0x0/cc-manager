import React, { useEffect, useRef } from 'react';
import { Button, Empty } from 'antd';
import {
  PlayCircleOutlined,
  UserOutlined,
  RobotOutlined,
  ToolOutlined,
  FileSearchOutlined,
  BulbOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import type { MessageRow, ContentBlock } from '../types';

interface Props {
  messages: MessageRow[];
  onResume: () => void;
  showResume: boolean;
  highlightedMessageId?: string | null;
}

export const MessageView: React.FC<Props> = ({
  messages,
  onResume,
  showResume,
  highlightedMessageId,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const highlightedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const el = containerRef.current?.querySelector<HTMLDivElement>(
      `[data-uuid="${CSS.escape(highlightedMessageId)}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedMessageId, messages]);

  if (messages.length === 0) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#fff' }}>
        <Empty description="选择左侧会话以查看消息" />
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#fff' }}>
      {messages.map((m) => {
        const isHighlighted = m.uuid === highlightedMessageId;
        return (
          <div
            key={m.uuid}
            data-uuid={m.uuid}
            ref={isHighlighted ? highlightedRef : null}
            style={{
              marginBottom: 12,
              padding: 12,
              background: m.role === 'user' ? '#dbeafe' : '#f3f4f6',
              borderRadius: 8,
              marginLeft: m.role === 'user' ? 0 : 60,
              marginRight: m.role === 'user' ? 60 : 0,
              border: isHighlighted ? '2px solid #f59e0b' : '2px solid transparent',
              transition: 'border-color 0.3s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {m.role === 'user' ? '你' : 'Claude'} · {new Date(m.createdAt).toLocaleString()}
              </span>
            </div>
            {renderMessageBody(m)}
          </div>
        );
      })}
      {showResume && (
        <Button
          type="primary"
          size="large"
          icon={<PlayCircleOutlined />}
          onClick={onResume}
          style={{ marginTop: 16 }}
        >
          继续会话
        </Button>
      )}
    </div>
  );
};

function renderMessageBody(m: MessageRow): React.ReactNode {
  // 没 blocks → 走老路径:直接渲染 content(空 content 渲染占位)
  if (!m.blocks || m.blocks.length === 0) {
    return (
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>
        {m.content || <EmptyContentPlaceholder />}
      </div>
    );
  }
  return (
    <div>
      {m.blocks.map((b, i) => (
        <BlockRenderer key={i} block={b} />
      ))}
    </div>
  );
}

function BlockRenderer({ block }: { block: ContentBlock }): React.ReactNode {
  switch (block.type) {
    case 'text': {
      if (!block.text) return <EmptyContentPlaceholder />;
      return (
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6, marginBottom: 6 }}>
          {block.text}
        </div>
      );
    }
    case 'tool_use':
      return (
        <div
          style={{
            fontSize: 12,
            color: '#6b7280',
            background: '#eef2ff',
            border: '1px solid #c7d2fe',
            borderRadius: 4,
            padding: '4px 8px',
            marginBottom: 6,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <ToolOutlined />
          <span>
            🔧 调用工具:<b>{block.name}</b>
            {summarizeInput(block.input) ? ` (${summarizeInput(block.input)})` : ''}
          </span>
        </div>
      );
    case 'tool_result':
      return (
        <div
          style={{
            fontSize: 12,
            color: block.isError ? '#b91c1c' : '#4b5563',
            background: block.isError ? '#fef2f2' : '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            padding: '4px 8px',
            marginBottom: 6,
            display: 'inline-flex',
            alignItems: 'flex-start',
            gap: 6,
            maxWidth: '100%',
            wordBreak: 'break-all',
          }}
        >
          <FileSearchOutlined />
          <span>
            📋 工具结果:{truncate(stringifyResult(block.content), 200)}
          </span>
        </div>
      );
    case 'thinking':
      return (
        <details
          style={{
            fontSize: 12,
            color: '#6b7280',
            background: '#fafafa',
            border: '1px dashed #d1d5db',
            borderRadius: 4,
            padding: '4px 8px',
            marginBottom: 6,
          }}
        >
          <summary style={{ cursor: 'pointer' }}>
            <BulbOutlined style={{ marginRight: 4 }} />
            💭 思考过程
          </summary>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{block.thinking}</div>
        </details>
      );
    case 'unknown':
    default:
      return (
        <div
          style={{
            fontSize: 12,
            color: '#9ca3af',
            fontStyle: 'italic',
            marginBottom: 6,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <QuestionCircleOutlined />
          (无法解析的内容块)
        </div>
      );
  }
}

function EmptyContentPlaceholder(): React.ReactNode {
  return (
    <span
      style={{
        fontSize: 12,
        color: '#9ca3af',
        fontStyle: 'italic',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <QuestionCircleOutlined />
      (空内容,可能为纯工具调用或思考块)
    </span>
  );
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return '';
  // 取前 2 个字段,值截断 30 字符
  return keys
    .slice(0, 2)
    .map((k) => {
      const v = obj[k];
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}=${truncate(s, 30)}`;
    })
    .join(', ');
}

function stringifyResult(c: unknown): string {
  if (typeof c === 'string') return c;
  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

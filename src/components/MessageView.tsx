import React, { useEffect, useRef } from 'react';
import { Button, Empty, Tag } from 'antd';
import { PlayCircleOutlined, UserOutlined, RobotOutlined } from '@ant-design/icons';
import type { MessageRow } from '../types';

interface Props {
  messages: MessageRow[];
  onResume: () => void;
  showResume: boolean;
  highlightedMessageId?: string | null; // when set, scroll to this message
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
    // Find the message element by data-uuid and scroll into view
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
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>{m.content}</div>
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

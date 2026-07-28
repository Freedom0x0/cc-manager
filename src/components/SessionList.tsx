import React from 'react';
import { List, Card, Button, Tooltip, Empty, Tag } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import type { SessionRow } from '../types';

interface Props {
  sessions: SessionRow[];
  selectedSessionId: string | null;
  onSelect: (id: string) => void;
  onSoftDelete: (id: string) => void;
  onRestore?: (id: string) => void;
  onPermanentDelete?: (id: string) => void;
  breadcrumbFor?: (session: SessionRow) => string | null; // optional top/sub path
}

const formatTime = (ms: number) => new Date(ms).toLocaleString();

export const SessionList: React.FC<Props> = ({
  sessions,
  selectedSessionId,
  onSelect,
  onSoftDelete,
  onRestore,
  onPermanentDelete,
  breadcrumbFor,
}) => {
  if (sessions.length === 0) {
    return (
      <div style={{ width: 360, borderRight: '1px solid #e5e7eb', overflowY: 'auto' }}>
        <div style={{ padding: '12px 16px', fontSize: 12, color: '#6b7280', fontWeight: 600, background: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
          会话
        </div>
        <Empty description="暂无会话" style={{ marginTop: 40 }} />
      </div>
    );
  }

  return (
    <div style={{ width: 360, borderRight: '1px solid #e5e7eb', overflowY: 'auto' }}>
      <div style={{ padding: '12px 16px', fontSize: 12, color: '#6b7280', fontWeight: 600, background: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
        会话 ({sessions.length})
      </div>
      <List
        dataSource={sessions}
        renderItem={(s) => {
          const isSelected = s.sessionId === selectedSessionId;
          return (
            <List.Item
              key={s.sessionId}
              onClick={() => onSelect(s.sessionId)}
              style={{
                cursor: 'pointer',
                padding: '12px 16px',
                background: isSelected ? '#e0e7ff' : 'transparent',
                borderBottom: '1px solid #f3f4f6',
              }}
            >
              <div style={{ width: '100%' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  {s.title || s.firstUserMessage?.slice(0, 50) || '(无标题)'}
                </div>
                {breadcrumbFor && breadcrumbFor(s) && (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>
                    {breadcrumbFor(s)}
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  {formatTime(s.lastMessageAt)} · {s.messageCount} 条消息
                </div>
                <div style={{ marginTop: 6 }}>
                  {onRestore && onPermanentDelete ? (
                    <>
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={(e) => { e.stopPropagation(); onRestore(s.sessionId); }}
                      >
                        恢复
                      </Button>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => { e.stopPropagation(); onPermanentDelete(s.sessionId); }}
                        style={{ marginLeft: 4 }}
                      />
                    </>
                  ) : (
                    <Tooltip title="移到回收站">
                      <Button
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={(e) => { e.stopPropagation(); onSoftDelete(s.sessionId); }}
                      />
                    </Tooltip>
                  )}
                </div>
              </div>
            </List.Item>
          );
        }}
      />
    </div>
  );
};

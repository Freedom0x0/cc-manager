import React, { useEffect, useState } from 'react';
import { Card, Button, Typography, Space, message } from 'antd';
import { CopyOutlined, CheckOutlined, PlayCircleOutlined } from '@ant-design/icons';
import type { ResumeCommand } from '../../types';

interface Props {
  sessionId: string | null;
  /** 父组件传 onResume 触发 fetch 命令(避免子组件重复调 API) */
  resumeCommand: ResumeCommand | null;
  onFetch: (sessionId: string) => void;
}

/**
 * 会话详情页 header 区域固定显示的命令卡片。
 * 复制按钮 → navigator.clipboard → 2s "已复制" 反馈。
 */
export const ResumeCommandCard: React.FC<Props> = ({ sessionId, resumeCommand, onFetch }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (sessionId && !resumeCommand) onFetch(sessionId);
  }, [sessionId, resumeCommand, onFetch]);

  if (!sessionId) return null;

  const display = resumeCommand
    ? resumeCommand.cwd
      ? `${resumeCommand.command}    # cwd: ${resumeCommand.cwd}`
      : resumeCommand.command
    : '(加载中…)';

  const handleCopy = async () => {
    if (!resumeCommand) return;
    const text = display;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback:临时 textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      message.success('已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      message.error('复制失败,请手动选择');
      console.error('clipboard error', e);
    }
  };

  return (
    <Card
      size="small"
      style={{
        margin: '12px 16px 0',
        background: '#f0f9ff',
        border: '1px solid #bae6fd',
      }}
      styles={{ body: { padding: 12 } }}
    >
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space>
          <PlayCircleOutlined style={{ color: '#0284c7' }} />
          <Typography.Text strong style={{ fontSize: 13 }}>
            继续该会话 — 在终端执行:
          </Typography.Text>
        </Space>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            padding: '6px 10px',
          }}
        >
          <Typography.Text
            code
            copyable={false}
            style={{
              flex: 1,
              fontSize: 13,
              fontFamily:
                '"SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace',
              wordBreak: 'break-all',
              color: '#0c4a6e',
            }}
          >
            {display}
          </Typography.Text>
          <Button
            type={copied ? 'default' : 'primary'}
            size="small"
            icon={copied ? <CheckOutlined /> : <CopyOutlined />}
            onClick={handleCopy}
            disabled={!resumeCommand}
          >
            {copied ? '已复制' : '复制'}
          </Button>
        </div>
      </Space>
    </Card>
  );
};

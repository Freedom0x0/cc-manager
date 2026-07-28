import React, { useEffect, useState } from 'react';
import { Badge } from 'antd';
import type { WatcherStatus } from '../types';

type BadgeStatus = 'default' | 'success' | 'processing' | 'warning' | 'error';

const statusToBadge: Record<WatcherStatus['status'], BadgeStatus> = {
  starting: 'processing',
  idle: 'success',
  error: 'error',
};

export const WatcherStatusIndicator: React.FC = () => {
  const [status, setStatus] = useState<WatcherStatus['status']>('starting');
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await window.api.watcherGetStatus();
        if (cancelled) return;
        setStatus(s.status);
        setErrorMsg(s.lastError);
      } catch {
        // IPC handler 尚未在 main.ts 注册(Task 9 范围) — 保持"未启动"
        if (!cancelled) {
          setStatus('starting');
          setErrorMsg(undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const label =
    status === 'starting'
      ? 'watcher: 未启动'
      : status === 'idle'
        ? 'watcher: 运行中'
        : `watcher: 错误${errorMsg ? ` (${errorMsg})` : ''}`;

  return (
    <span aria-label="watcher-status-indicator" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Badge status={statusToBadge[status]} />
      <span style={{ fontSize: 12 }}>{label}</span>
    </span>
  );
};
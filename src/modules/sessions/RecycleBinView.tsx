import React, { useEffect, useState } from 'react';
import { Empty } from 'antd';
import { api } from '../../api';
import type { SessionRow } from '../../types';
import { SessionList } from './SessionList';

interface Props {
  refreshKey: number;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
}

export const RecycleBinView: React.FC<Props> = ({ refreshKey, onRestore, onPermanentDelete }) => {
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    (async () => {
      const deleted = await api.listDeletedSessions();
      setSessions(deleted);
    })();
  }, [refreshKey]);

  if (sessions.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        <Empty description="回收站为空" />
      </div>
    );
  }

  return (
    <SessionList
      sessions={sessions}
      selectedSessionId={null}
      onSelect={() => {}}
      onSoftDelete={() => {}}
      onRestore={onRestore}
      onPermanentDelete={onPermanentDelete}
    />
  );
};

import React, { useEffect, useState } from 'react';
import { ConfigProvider, App as AntApp, Empty, Tag, Card } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { api } from './api';
import type { ProjectTreeNode, SessionRow, MessageRow, SearchHit } from './types';
import { SearchBar } from './components/SearchBar';
import { ProjectTree } from './components/ProjectTree';
import { SessionList } from './components/SessionList';
import { MessageView } from './components/MessageView';
import { ConfirmDialog } from './components/ConfirmDialog';
import { RecycleBinView } from './components/RecycleBinView';
import { useSearch, type TimeRange } from './hooks/useSearch';

export default function AppRoot() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#2563eb' } }}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  );
}

function App() {
  const [tree, setTree] = useState<ProjectTreeNode[]>([]);
  const [flatProjects, setFlatProjects] = useState<{ id: number; name: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<number[] | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmSoft, setConfirmSoft] = useState<string | null>(null);
  const [confirmPermanent, setConfirmPermanent] = useState<SessionRow | null>(null);

  const { hits, searched } = useSearch(query, projectFilter, timeRange);

  useEffect(() => {
    (async () => {
      const t = await api.listProjectTree();
      setTree(t);
      // Flat list — every project is a peer; no children to walk.
      setFlatProjects(t.map((n) => ({ id: n.id, name: n.name })));
    })();
  }, [refreshKey]);

  useEffect(() => {
    if (selectedProjectId === null) {
      setSessions([]);
      return;
    }
    api.listSessions(selectedProjectId, false).then(setSessions);
  }, [selectedProjectId, refreshKey]);

  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    api.listMessages(selectedSessionId).then(setMessages);
  }, [selectedSessionId]);

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onShowRecycleBin={() => setShowRecycleBin((v) => !v)}
        showingRecycleBin={showRecycleBin}
        projectIds={projectFilter}
        onProjectIdsChange={setProjectFilter}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        availableProjects={flatProjects}
      />
      {showRecycleBin ? (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <RecycleBinView
            refreshKey={refreshKey}
            onRestore={async (id) => { await api.restoreSession(id); refresh(); }}
            onPermanentDelete={(id) => {
              const target = sessions.find((s) => s.sessionId === id) || ({ sessionId: id, title: id } as SessionRow);
              setConfirmPermanent(target);
            }}
          />
          <div style={{ flex: 1, padding: 40, color: '#6b7280', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            回收站 — 选择左侧会话进行恢复或永久删除
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <ProjectTree
            projects={tree}
            selectedProjectId={selectedProjectId}
            onSelect={setSelectedProjectId}
          />
          {query.trim() ? (
            <SearchResultsPane
              hits={hits}
              searched={searched}
              onPick={(hit) => {
                setSelectedProjectId(hit.projectId);
                setSelectedSessionId(hit.message.sessionId);
                setHighlightedMessageId(hit.message.uuid);
                setQuery('');
              }}
            />
          ) : (
            <>
              <SessionList
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                onSelect={(id) => { setSelectedSessionId(id); setHighlightedMessageId(null); }}
                onSoftDelete={setConfirmSoft}
              />
              <MessageView
                messages={messages}
                showResume={!!selectedSessionId}
                highlightedMessageId={highlightedMessageId}
                onResume={async () => {
                  if (!selectedSessionId) return;
                  try {
                    await api.resumeSession(selectedSessionId);
                  } catch (e) {
                    console.error('Resume failed', e);
                  }
                }}
              />
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={!!confirmSoft}
        title="移到回收站"
        message="此会话将进入回收站，可随时恢复。"
        confirmText="移到回收站"
        onCancel={() => setConfirmSoft(null)}
        onConfirm={async () => {
          if (confirmSoft) await api.softDeleteSession(confirmSoft);
          setConfirmSoft(null);
          refresh();
        }}
      />
      <ConfirmDialog
        open={!!confirmPermanent}
        title="永久删除"
        message={`此操作不可恢复！请输入会话标题以确认：${
          confirmPermanent?.title || confirmPermanent?.sessionId
        }`}
        confirmText="永久删除"
        requireInput={confirmPermanent?.title || ''}
        onCancel={() => setConfirmPermanent(null)}
        onConfirm={async () => {
          if (confirmPermanent) await api.permanentDeleteSession(confirmPermanent.sessionId);
          setConfirmPermanent(null);
          refresh();
        }}
      />
    </div>
  );
}

const SearchResultsPane: React.FC<{
  hits: SearchHit[];
  searched: boolean;
  onPick: (hit: SearchHit) => void;
}> = ({ hits, searched, onPick }) => {
  if (searched && hits.length === 0) {
    return (
      <div style={{ width: 400, borderRight: '1px solid #e5e7eb', padding: 16, background: '#fff' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div>
              <div style={{ marginBottom: 8 }}>未找到匹配会话</div>
              <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
                建议：<br />
                · 检查关键词拼写<br />
                · 时间范围改成"全部"<br />
                · 回收站里的内容默认不搜
              </div>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ width: 400, borderRight: '1px solid #e5e7eb', overflowY: 'auto' }}>
      <div style={{ padding: '12px 16px', fontSize: 12, color: '#6b7280', fontWeight: 600, background: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
        搜索结果 ({hits.length})
      </div>
      {hits.map((h) => (
        <Card
          key={h.message.uuid}
          size="small"
          hoverable
          onClick={() => onPick(h)}
          style={{ margin: 8, cursor: 'pointer' }}
        >
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
            <Tag color="blue">{h.projectName}</Tag>
            <span style={{ marginLeft: 4 }}>{h.sessionTitle || '(无标题)'}</span>
          </div>
          <div
            style={{ fontSize: 13, lineHeight: 1.6, color: '#1f2937' }}
            dangerouslySetInnerHTML={{ __html: h.snippet }}
          />
        </Card>
      ))}
    </div>
  );
};

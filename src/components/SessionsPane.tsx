import React, { useEffect, useState, useCallback } from 'react';
import { Empty, Tag, Card } from 'antd';
import { api } from '../api';
import type {
  ProjectTreeNode,
  SessionRow,
  MessageRow,
  SearchHit,
  ResumeCommand,
} from '../types';
import { SearchBar } from './SearchBar';
import { ProjectTree } from './ProjectTree';
import { SessionList } from './SessionList';
import { MessageView } from './MessageView';
import { ConfirmDialog } from './ConfirmDialog';
import { RecycleBinView } from './RecycleBinView';
import { ResumeCommandCard } from './ResumeCommandCard';
import { SearchResultsPane } from './SearchResultsPane';
import { useSearch, type TimeRange } from '../hooks/useSearch';

export const SessionsPane: React.FC = () => {
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
  const [resumeCommand, setResumeCommand] = useState<ResumeCommand | null>(null);

  const fetchResumeCommand = useCallback(async (sessionId: string) => {
    setResumeCommand(null);
    try {
      const cmd = await api.resumeSession(sessionId);
      setResumeCommand(cmd);
    } catch (e) {
      console.error('Failed to fetch resume command', e);
      setResumeCommand(null);
    }
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      fetchResumeCommand(selectedSessionId);
    } else {
      setResumeCommand(null);
    }
  }, [selectedSessionId, fetchResumeCommand]);

  const { hits, searched } = useSearch(query, projectFilter, timeRange);

  useEffect(() => {
    (async () => {
      const t = await api.listProjectTree();
      setTree(t);
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <ResumeCommandCard
                  sessionId={selectedSessionId}
                  resumeCommand={resumeCommand}
                  onFetch={fetchResumeCommand}
                />
                <MessageView
                  messages={messages}
                  highlightedMessageId={highlightedMessageId}
                />
              </div>
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
};
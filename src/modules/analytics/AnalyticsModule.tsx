import React, { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Statistic,
  Table,
  Select,
  Space,
  Button,
  Empty,
  Spin,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, BarChartOutlined } from '@ant-design/icons';
import { api } from '../../api';
import type {
  UsageSummary,
  UsageByProjectRow,
  UsageByDayRow,
  UsageByToolRow,
} from '../../types';

const RANGE_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 30 天', value: 30 },
  { label: '最近 90 天', value: 90 },
];

/** 把毫秒格式化为 Xh Ym(用于 duration 显示) */
function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

const projectColumns: ColumnsType<UsageByProjectRow> = [
  { title: '项目', dataIndex: 'projectName', key: 'projectName' },
  {
    title: '会话数',
    dataIndex: 'sessions',
    key: 'sessions',
    align: 'right',
    sorter: (a, b) => a.sessions - b.sessions,
  },
  {
    title: '消息数',
    dataIndex: 'messages',
    key: 'messages',
    align: 'right',
    defaultSortOrder: 'descend',
    sorter: (a, b) => a.messages - b.messages,
  },
  {
    title: 'Token(估算)',
    dataIndex: 'tokens',
    key: 'tokens',
    align: 'right',
    sorter: (a, b) => a.tokens - b.tokens,
    render: (v: number) => v.toLocaleString('zh-CN'),
  },
];

const dayColumns: ColumnsType<UsageByDayRow> = [
  { title: '日期', dataIndex: 'date', key: 'date' },
  {
    title: '消息数',
    dataIndex: 'messages',
    key: 'messages',
    align: 'right',
    defaultSortOrder: 'descend',
    sorter: (a, b) => a.messages - b.messages,
  },
  {
    title: 'Token(估算)',
    dataIndex: 'tokens',
    key: 'tokens',
    align: 'right',
    sorter: (a, b) => a.tokens - b.tokens,
    render: (v: number) => v.toLocaleString('zh-CN'),
  },
];

const toolColumns: ColumnsType<UsageByToolRow> = [
  {
    title: '工具',
    dataIndex: 'tool',
    key: 'tool',
    render: (tool: string) => <Tag color="blue">{tool}</Tag>,
  },
  {
    title: '调用次数',
    dataIndex: 'count',
    key: 'count',
    align: 'right',
    defaultSortOrder: 'descend',
    sorter: (a, b) => a.count - b.count,
  },
];

export const AnalyticsModule: React.FC = () => {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.usageSummary(rangeDays);
      setSummary(data);
    } catch (e) {
      if (e instanceof Error) console.error('usageSummary failed', e);
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  useEffect(() => {
    load();
  }, [load]);

  const isEmpty =
    summary !== null &&
    summary.totalSessions === 0 &&
    summary.totalMessages === 0;

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>
            <BarChartOutlined style={{ marginRight: 8 }} />
            用量分析
          </h2>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            sessions / messages 表只读聚合 · token 数走 JS 端估算(
            length / 4)· 用途是趋势 / 占比,非精确计费
          </div>
        </div>
        <Space>
          <Select
            value={rangeDays}
            onChange={(v) => setRangeDays(v)}
            options={RANGE_OPTIONS}
            style={{ width: 140 }}
          />
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      {isEmpty ? (
        <Empty description="暂无数据,等待 watcher 导入后刷新" />
      ) : (
        <Spin spinning={loading}>
          {/* 顶部 4 个 Statistic 卡 */}
          {summary && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                <Card>
                  <Statistic title="总会话数" value={summary.totalSessions} />
                </Card>
                <Card>
                  <Statistic title="总消息数" value={summary.totalMessages} />
                </Card>
                <Card>
                  <Statistic
                    title="总 Token(估算)"
                    value={summary.totalTokens}
                    valueStyle={{ color: '#2563eb' }}
                  />
                </Card>
                <Card>
                  <Statistic
                    title="总会话时长"
                    value={formatDuration(summary.totalDurationMs)}
                  />
                </Card>
              </div>

              {/* 中间 2 个 Table:byProject + byDay */}
              <Card title="按项目聚合" style={{ marginBottom: 16 }} size="small">
                <Table<UsageByProjectRow>
                  dataSource={summary.byProject}
                  columns={projectColumns}
                  rowKey="projectId"
                  size="small"
                  pagination={false}
                  locale={{ emptyText: '暂无项目数据' }}
                />
              </Card>

              <Card title={`按日聚合(最近 ${rangeDays} 天)`} style={{ marginBottom: 16 }} size="small">
                <Table<UsageByDayRow>
                  dataSource={summary.byDay}
                  columns={dayColumns}
                  rowKey="date"
                  size="small"
                  pagination={false}
                  locale={{ emptyText: `${rangeDays} 天窗口内无活跃日` }}
                />
              </Card>

              {/* 底部 1 个 Table:byTool */}
              <Card title="工具调用频次" size="small">
                <Table<UsageByToolRow>
                  dataSource={summary.byTool}
                  columns={toolColumns}
                  rowKey="tool"
                  size="small"
                  pagination={false}
                  locale={{ emptyText: '暂无 tool_use 数据' }}
                />
              </Card>

              <div
                style={{
                  marginTop: 16,
                  fontSize: 12,
                  color: '#9ca3af',
                  textAlign: 'right',
                }}
              >
                生成于 {new Date(summary.generatedAt).toLocaleString('zh-CN')}
              </div>
            </>
          )}
        </Spin>
      )}
    </div>
  );
};
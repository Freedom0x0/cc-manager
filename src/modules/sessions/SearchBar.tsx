import React from 'react';
import { Input, Select, Button, Space } from 'antd';
import { SearchOutlined, DeleteOutlined } from '@ant-design/icons';
import type { TimeRange } from '../hooks/useSearch';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onShowRecycleBin: () => void;
  showingRecycleBin: boolean;
  projectIds: number[] | null;
  onProjectIdsChange: (ids: number[] | null) => void;
  timeRange: TimeRange;
  onTimeRangeChange: (r: TimeRange) => void;
  availableProjects: { id: number; name: string }[];
}

export const SearchBar: React.FC<Props> = ({
  query,
  onQueryChange,
  onShowRecycleBin,
  showingRecycleBin,
  projectIds,
  onProjectIdsChange,
  timeRange,
  onTimeRangeChange,
  availableProjects,
}) => (
  <div
    style={{
      display: 'flex',
      gap: 8,
      padding: 12,
      borderBottom: '1px solid #e5e7eb',
      background: '#fafafa',
      alignItems: 'center',
    }}
  >
    <Input
      prefix={<SearchOutlined />}
      placeholder="搜索关键词（空格分隔多关键词）"
      value={query}
      onChange={(e) => onQueryChange(e.target.value)}
      style={{ flex: 1 }}
      allowClear
    />
    <Select
      mode="multiple"
      placeholder="项目筛选"
      value={projectIds ?? []}
      onChange={(vals) => onProjectIdsChange(vals.length ? vals : null)}
      style={{ minWidth: 160 }}
      maxTagCount="responsive"
      allowClear
      options={availableProjects.map((p) => ({ value: p.id, label: p.name }))}
    />
    <Select
      value={timeRange}
      onChange={onTimeRangeChange}
      style={{ width: 130 }}
      options={[
        { value: 'today', label: '今天' },
        { value: '7d', label: '近 7 天' },
        { value: '30d', label: '近 30 天' },
        { value: 'all', label: '全部' },
      ]}
    />
    <Button
      icon={<DeleteOutlined />}
      onClick={onShowRecycleBin}
      type={showingRecycleBin ? 'primary' : 'default'}
    >
      {showingRecycleBin ? '返回' : '回收站'}
    </Button>
  </div>
);

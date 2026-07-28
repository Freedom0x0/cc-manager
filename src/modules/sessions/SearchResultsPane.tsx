import React from 'react';
import { Empty, Tag, Card } from 'antd';
import type { SearchHit } from '../types';

export const SearchResultsPane: React.FC<{
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
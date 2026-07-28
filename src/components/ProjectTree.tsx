import React from 'react';
import { List, Empty } from 'antd';
import type { ProjectTreeNode } from '../types';

interface Props {
  projects: ProjectTreeNode[];
  selectedProjectId: number | null;
  onSelect: (id: number) => void;
}

export const ProjectTree: React.FC<Props> = ({ projects, selectedProjectId, onSelect }) => {
  if (projects.length === 0) {
    return (
      <div style={{ width: 220, borderRight: '1px solid #e5e7eb', padding: 16, background: '#fafafa' }}>
        <div style={{ padding: '0 0 8px', fontSize: 12, color: '#6b7280', fontWeight: 600 }}>
          项目
        </div>
        <Empty description="暂无项目" />
      </div>
    );
  }
  return (
    <div style={{ width: 220, borderRight: '1px solid #e5e7eb', background: '#fafafa', overflowY: 'auto' }}>
      <div style={{ padding: '12px 16px 8px', fontSize: 12, color: '#6b7280', fontWeight: 600 }}>
        项目 ({projects.length})
      </div>
      <List
        size="small"
        dataSource={projects}
        renderItem={(p) => {
          const isSelected = p.id === selectedProjectId;
          return (
            <List.Item
              onClick={() => onSelect(p.id)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                background: isSelected ? '#e0e7ff' : 'transparent',
                borderBottom: '1px solid #f3f4f6',
              }}
            >
              <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#1f2937' }}>{p.name}</span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>{p.sessionCount}</span>
              </div>
            </List.Item>
          );
        }}
      />
    </div>
  );
};

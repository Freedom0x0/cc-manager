import React from 'react';
import type { ProjectRow } from '../types';

interface Props {
  projects: ProjectRow[];
  selectedProjectId: number | null;
  onSelect: (id: number) => void;
}

export const ProjectList: React.FC<Props> = ({ projects, selectedProjectId, onSelect }) => (
  <div
    style={{
      width: 200,
      borderRight: '1px solid #ccc',
      overflowY: 'auto',
      background: '#f5f5f5',
    }}
  >
    <div
      style={{
        padding: '12px 12px 8px',
        fontSize: 11,
        color: '#666',
        textTransform: 'uppercase',
        fontWeight: 'bold',
      }}
    >
      项目
    </div>
    {projects.length === 0 && (
      <div style={{ padding: 16, color: '#999', fontSize: 13 }}>暂无项目</div>
    )}
    {projects.map((p) => (
      <div
        key={p.id}
        onClick={() => onSelect(p.id)}
        style={{
          padding: 12,
          cursor: 'pointer',
          background: selectedProjectId === p.id ? '#e0e0e0' : 'transparent',
          borderBottom: '1px solid #eee',
          fontSize: 14,
        }}
      >
        {p.name} <span style={{ color: '#888', fontSize: 12 }}>({p.sessionCount})</span>
      </div>
    ))}
  </div>
);

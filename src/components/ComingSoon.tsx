import React from 'react';
import { Empty } from 'antd';

export const ComingSoon: React.FC<{ label: string; wave: number }> = ({ label, wave }) => (
  <div style={{ padding: 40, height: '100%' }}>
    <Empty description={`${label} — 波 ${wave} 启用`} />
  </div>
);
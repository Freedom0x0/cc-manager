import React from 'react';
import { Input } from 'antd';

export const GlobalSearchBar: React.FC = () => {
  return (
    <Input.Search
      placeholder="全局搜索(波 1+ 启用)"
      disabled
      allowClear={false}
      style={{ width: 280 }}
      aria-label="global-search-bar"
      onSearch={() => {
        // 波 1+ 启用 — Task 4 已加 globalSearch IPC,Task 9 集成到 main.ts
      }}
    />
  );
};
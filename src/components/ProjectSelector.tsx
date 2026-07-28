import React from 'react';
import { Select } from 'antd';

export const ProjectSelector: React.FC = () => {
  return (
    <Select
      placeholder="选择项目(波 1+ 启用)"
      disabled
      style={{ width: 200 }}
      aria-label="project-selector"
      options={[]}
    />
  );
};
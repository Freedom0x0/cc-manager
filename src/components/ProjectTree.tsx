import React, { useMemo } from 'react';
import { Tree, Empty } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { ProjectTreeNode } from '../types';

interface Props {
  tree: ProjectTreeNode[];
  selectedProjectId: number | null;
  onSelect: (id: number) => void;
  // Auto-expand parents of a project id (e.g. when search result is clicked)
  expandProjectId?: number | null;
  defaultExpandedKeys?: React.Key[];
}

function toTreeData(nodes: ProjectTreeNode[]): DataNode[] {
  return nodes.map((n) => ({
    key: n.id,
    title: n.children.length > 0
      ? `${n.name} (${countSessions(n)})`
      : `${n.name}${n.sessionCount > 0 ? ` (${n.sessionCount})` : ''}`,
    children: n.children.length > 0 ? toTreeData(n.children) : undefined,
  }));
}

function countSessions(n: ProjectTreeNode): number {
  if (n.children.length === 0) return n.sessionCount;
  return n.children.reduce((s, c) => s + countSessions(c), 0);
}

function findParentKey(
  nodes: ProjectTreeNode[],
  childId: number,
  parentKey: number | null = null
): number | null {
  for (const n of nodes) {
    if (n.id === childId) return parentKey;
    const found = findParentKey(n.children, childId, n.id);
    if (found !== null) return found;
  }
  return null;
}

export const ProjectTree: React.FC<Props> = ({
  tree,
  selectedProjectId,
  onSelect,
  expandProjectId,
  defaultExpandedKeys = [],
}) => {
  const treeData = useMemo(() => toTreeData(tree), [tree]);

  // When asked to expand a project (e.g. clicked from search), pre-compute the
  // expanded keys to include all ancestors.
  const expandedKeys = useMemo<React.Key[]>(() => {
    if (expandProjectId == null) return defaultExpandedKeys;
    const ancestors: number[] = [];
    let cur: number | null = expandProjectId;
    while (cur != null) {
      const parent = findParentKey(tree, cur);
      if (parent != null) ancestors.push(parent);
      cur = parent;
    }
    return Array.from(new Set([...defaultExpandedKeys, ...ancestors]));
  }, [expandProjectId, tree, defaultExpandedKeys]);

  if (tree.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <Empty description="暂无项目" />
      </div>
    );
  }

  return (
    <div style={{ width: 240, borderRight: '1px solid #e5e7eb', overflowY: 'auto', background: '#fafafa' }}>
      <div style={{ padding: '12px 12px 8px', fontSize: 12, color: '#6b7280', fontWeight: 600 }}>
        项目
      </div>
      <Tree
        treeData={treeData}
        selectedKeys={selectedProjectId != null ? [selectedProjectId] : []}
        expandedKeys={expandedKeys}
        onSelect={(keys) => {
          const k = keys[0];
          if (typeof k === 'number' || typeof k === 'string') onSelect(Number(k));
        }}
        blockNode
        showLine={{ showLeafIcon: false }}
        style={{ background: 'transparent' }}
      />
    </div>
  );
};

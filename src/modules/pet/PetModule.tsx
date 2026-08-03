// v1.2 D34 (Task 5): PetModule — 主窗口的"宠物" Tab
//
// 3 个职责:
// 1. 提供"安装 Agent Status Hook"按钮 → 后端写 ~/.claude/settings.json 的 hooks
//    字段(6 个 HOOK_EVENTS),让 Claude Code 跑起来时自动调 cc-status-emit 上报
// 2. 提供"打开宠物窗口"按钮 → 后端建一个独立 webview(无装饰 / 透明背景 /
//    always-on-top),加载 src/pet.html 渲染 PetWindow
// 3. 展示当前所有活跃会话的状态快照(调 cmd_pet_get_status) + 实时刷新
//
// 状态标签颜色对应 src-tauri/src/pet/state.rs PetState 的 7 个 variant。
// ⚠️ AgentStateEvent 字段名 (session_id/cwd/tool_name) 真机手验后核对 — 见
// src/types.ts 的 D34 注释 + 本文件末尾 commit message 备注。
import React, { useEffect, useState } from 'react';
import { Button, List, Space, Typography, Tag, notification } from 'antd';
import { api } from '../../api-tauri';
import type { AgentStateEvent, InstallResult, PetState } from '../../types';

const { Title, Text } = Typography;

const STATE_COLORS: Record<PetState, string> = {
  'idle': 'default',
  'responding': 'blue',
  'thinking': 'purple',
  'tool-use': 'cyan',
  'ask-user': 'orange',
  'completed': 'green',
  'error-interrupted': 'red',
};

const STATE_LABELS: Record<PetState, string> = {
  'idle': '空闲',
  'responding': '响应中',
  'thinking': '思考中',
  'tool-use': '调用工具',
  'ask-user': '等待介入',
  'completed': '已完成',
  'error-interrupted': '出错中断',
};

export function PetModule() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [events, setEvents] = useState<AgentStateEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.petGetStatus().then(setEvents).catch(() => setEvents([]));
  }, []);

  const handleInstall = async () => {
    setLoading(true);
    try {
      const result: InstallResult = await api.petInstallStatusHook();
      setInstalled(true);
      notification.success({
        message: 'Agent Status Hook 已安装',
        description: `已装 ${result.installed} 条 hook, 跳过 ${result.skipped} 条已存在的`,
      });
    } catch (e) {
      notification.error({ message: '安装失败', description: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenWindow = async () => {
    try {
      await api.petWindowOpen();
    } catch (e) {
      notification.error({ message: '打开宠物窗口失败', description: String(e) });
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>桌面宠物 (cc-pet)</Title>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space>
          <Button type="primary" onClick={handleInstall} loading={loading}>
            {installed === null ? '安装 Agent Status Hook' : installed ? '重新安装 Hook' : '安装 Hook'}
          </Button>
          // D34 fix (c5 review C3): 去掉 disabled gate。
//   之前 installed 初始 null, 只有 handleInstall 成功后才 true; app 重启后
//   按钮永远 disabled, 没法开窗。打开空窗口无害 (显示空闲宠物), reinstall
//   走原 skipped 计数幂等。按钮 label 动态反映 installed 状态。
          <Button onClick={handleOpenWindow}>
            打开宠物窗口
          </Button>
        </Space>
        <Text type="secondary">
          安装 hook 后, Claude Code 运行时会向 cc-manager 上报状态, 宠物窗口会实时显示调用的 skill / mcp, 会话完成时弹通知。
        </Text>

        <Title level={4} style={{ marginTop: 24 }}>活跃会话</Title>
        {events.length === 0 ? (
          <Text type="secondary">暂无活跃会话。安装 hook 后, 跑 Claude Code 触发事件即可看到。</Text>
        ) : (
          <List
            bordered
            dataSource={events}
            renderItem={(item) => (
              <List.Item>
                <Space>
                  <Tag color={STATE_COLORS[item.state]}>{STATE_LABELS[item.state]}</Tag>
                  <Text code>{item.session_id.slice(0, 8)}</Text>
                  {item.tool_name && <Text>tool: {item.tool_name}</Text>}
                  {item.skill_name && <Text type="success">skill: {item.skill_name}</Text>}
                  {item.mcp_server && <Text type="warning">mcp: {item.mcp_server}</Text>}
                  {item.cwd && <Text type="secondary" style={{ fontSize: 12 }}>{item.cwd}</Text>}
                </Space>
              </List.Item>
            )}
          />
        )}
      </Space>
    </div>
  );
}
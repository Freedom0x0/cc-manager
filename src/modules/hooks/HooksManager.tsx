import React, { useEffect, useState } from 'react';
import {
  List,
  Switch,
  Button,
  Modal,
  Form,
  Input,
  Select,
  message,
  Empty,
  Space,
  Tag,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { api } from '../../api';
import type { Hook, HookCreateInput } from '../../types';

/** 表单字段本地形态(event/matcher/command),区别于 HookCreateInput(IPC 入参)。 */
interface HookFormValues {
  event: Hook['event'];
  matcher?: string;
  command: string;
}

export const HooksManager: React.FC = () => {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Hook | null>(null);
  const [creating, setCreating] = useState(false);
  const [editForm] = Form.useForm<HookFormValues>();
  const [createForm] = Form.useForm<HookFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.hookList();
      setHooks(list);
    } catch (e) {
      console.error('hookList failed', e);
      message.error('加载 Hooks 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggle = async (id: string, enabled: boolean) => {
    // 乐观更新 UI,失败再回滚
    setHooks((prev) => prev.map((h) => (h.id === id ? { ...h, enabled } : h)));
    try {
      await api.hookToggleEnabled(id, enabled);
      message.success(enabled ? `已启用 ${id}` : `已停用 ${id}`);
    } catch (e) {
      console.error('hookToggleEnabled failed', e);
      message.error('切换启用状态失败');
      // 回滚
      setHooks((prev) => prev.map((h) => (h.id === id ? { ...h, enabled: !enabled } : h)));
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: `删除 Hook: ${id}?`,
      content: '此操作会从 ~/.claude/settings.json 的 hooks 字段移除该条,不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.hookDelete(id);
          message.success(`已删除 ${id}`);
          load();
        } catch (e) {
          console.error('hookDelete failed', e);
          message.error('删除失败');
        }
      },
    });
  };

  const openEdit = (h: Hook) => {
    setEditing(h);
    editForm.setFieldsValue({
      event: h.event,
      matcher: h.matcher ?? '',
      command: h.command,
    });
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields();
      await api.hookUpdate(editing.id, {
        matcher: values.matcher,
        command: values.command,
      });
      message.success(`已更新 ${editing.id}`);
      setEditing(null);
      load();
    } catch (e) {
      if (e instanceof Error) console.error('hookUpdate failed', e);
      message.error('更新失败');
    }
  };

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const input: HookCreateInput = {
        event: values.event,
        matcher: values.matcher,
        command: values.command,
      };
      await api.hookCreate(input);
      message.success(`已创建 ${values.event} hook`);
      setCreating(false);
      createForm.resetFields();
      load();
    } catch (e) {
      if (e instanceof Error) console.error('hookCreate failed', e);
      message.error('创建失败');
    }
  };

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
          <h2 style={{ margin: 0 }}>Hooks</h2>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            读取 ~/.claude/settings.json 的 hooks 字段 · 启用状态独立存于 mcp_server_state KV 表
          </div>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            新建
          </Button>
        </Space>
      </div>

      {hooks.length === 0 && !loading ? (
        <Empty description="暂无 Hook,点右上角'新建'添加" />
      ) : (
        <List<Hook>
          loading={loading}
          bordered
          dataSource={hooks}
          renderItem={(h) => (
            <List.Item
              key={h.id}
              actions={[
                <Button
                  key="edit"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => openEdit(h)}
                >
                  编辑
                </Button>,
                <Button
                  key="delete"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(h.id)}
                >
                  删除
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span style={{ fontWeight: 600 }}>{h.id}</span>
                    <Tag color={h.enabled ? 'green' : 'default'}>
                      {h.enabled ? '启用' : '停用'}
                    </Tag>
                    <Tag color="blue">{h.event}</Tag>
                    {h.matcher && <Tag color="purple">matcher: {h.matcher}</Tag>}
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    <code>{h.command}</code>
                  </div>
                }
              />
              <Switch
                checked={h.enabled}
                onChange={(v) => handleToggle(h.id, v)}
                aria-label={`toggle-${h.id}`}
              />
            </List.Item>
          )}
        />
      )}

      {/* Edit Dialog — inline,Simplicity First */}
      <Modal
        title={`编辑 Hook: ${editing?.id ?? ''}`}
        open={!!editing}
        onOk={submitEdit}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item label="Event" name="event">
            <Input disabled />
          </Form.Item>
          <Form.Item label="Matcher (工具名匹配)" name="matcher">
            <Input placeholder="例如:Bash,可选" />
          </Form.Item>
          <Form.Item
            label="Command"
            name="command"
            rules={[{ required: true, message: '请输入命令' }]}
          >
            <Input.TextArea rows={4} placeholder="bash 命令" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Dialog — inline */}
      <Modal
        title="新建 Hook"
        open={creating}
        onOk={submitCreate}
        onCancel={() => {
          setCreating(false);
          createForm.resetFields();
        }}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          preserve={false}
          initialValues={{ event: 'PreToolUse' }}
        >
          <Form.Item
            label="Event"
            name="event"
            rules={[{ required: true, message: '请选择 Event' }]}
          >
            <Select
              options={[
                { value: 'PreToolUse', label: 'PreToolUse' },
                { value: 'PostToolUse', label: 'PostToolUse' },
                { value: 'Stop', label: 'Stop' },
                { value: 'SubagentStop', label: 'SubagentStop' },
                { value: 'Notification', label: 'Notification' },
                { value: 'UserPromptSubmit', label: 'UserPromptSubmit' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Matcher (工具名匹配)" name="matcher">
            <Input placeholder="例如:Bash,可空" />
          </Form.Item>
          <Form.Item
            label="Command"
            name="command"
            rules={[{ required: true, message: '请输入命令' }]}
          >
            <Input.TextArea rows={4} placeholder="bash 命令" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

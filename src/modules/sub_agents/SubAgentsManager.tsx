import React, { useEffect, useState } from 'react';
import {
  List,
  Switch,
  Button,
  Modal,
  Form,
  Input,
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
  SearchOutlined,
} from '@ant-design/icons';
import { api } from '../../api';
import type { SubAgent, SubAgentCreateInput } from '../../types';

// 表单字段本地形态(name/description/argumentHint/body)。
// 与 SubAgentCreateInput / SubAgentUpdatePatch 区分(IPC 入参)。
interface SubAgentFormValues {
  name: string;
  description: string;
  argumentHint?: string;
  body?: string;
}

export const SubAgentsManager: React.FC = () => {
  const [agents, setAgents] = useState<SubAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<SubAgent | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [editForm] = Form.useForm<SubAgentFormValues>();
  const [createForm] = Form.useForm<SubAgentFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.subagentList();
      setAgents(list);
    } catch (e) {
      console.error('subagentList failed', e);
      message.error('加载 Sub-Agents 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    // 乐观更新 UI,失败再回滚
    setAgents((prev) => prev.map((a) => (a.name === name ? { ...a, enabled } : a)));
    try {
      await api.subagentToggleEnabled(name, enabled);
      message.success(enabled ? `已启用 ${name}` : `已停用 ${name}`);
    } catch (e) {
      console.error('subagentToggleEnabled failed', e);
      message.error('切换启用状态失败');
      // 回滚
      setAgents((prev) => prev.map((a) => (a.name === name ? { ...a, enabled: !enabled } : a)));
    }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: `删除 Sub-Agent: ${name}?`,
      content: '此操作会从 ~/.claude/agents/ 移除该 .md 文件,不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.subagentDelete(name);
          message.success(`已删除 ${name}`);
          load();
        } catch (e) {
          console.error('subagentDelete failed', e);
          message.error('删除失败');
        }
      },
    });
  };

  const openEdit = (a: SubAgent) => {
    setEditing(a);
    editForm.setFieldsValue({
      name: a.name,
      description: a.description,
      argumentHint: a.argumentHint ?? '',
      body: a.body,
    });
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields();
      await api.subagentUpdate(editing.name, {
        description: values.description,
        argumentHint: values.argumentHint,
        body: values.body,
      });
      message.success(`已更新 ${editing.name}`);
      setEditing(null);
      load();
    } catch (e) {
      if (e instanceof Error) console.error('subagentUpdate failed', e);
      message.error('更新失败');
    }
  };

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const input: SubAgentCreateInput = {
        name: values.name,
        description: values.description,
        body: values.body,
        argumentHint: values.argumentHint,
      };
      await api.subagentCreate(input);
      message.success(`已创建 ${values.name}`);
      setCreating(false);
      createForm.resetFields();
      load();
    } catch (e) {
      if (e instanceof Error) console.error('subagentCreate failed', e);
      message.error('创建失败');
    }
  };

  const enabledCount = agents.filter((a) => a.enabled).length;
  const disabledCount = agents.length - enabledCount;
  const filtered = query
    ? agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
    : agents;

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
          <Space size="middle" align="center">
            <h2 style={{ margin: 0 }}>Sub-Agents</h2>
            <Tag color="blue">
              {enabledCount}/{disabledCount}
            </Tag>
          </Space>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            读取 ~/.claude/agents/*.md · 启用状态独立存于 mcp_server_state KV 表
          </div>
        </div>
        <Space>
          <Input
            allowClear
            placeholder="搜索 name"
            prefix={<SearchOutlined />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 200 }}
          />
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            新建
          </Button>
        </Space>
      </div>

      {agents.length === 0 && !loading ? (
        <Empty description="暂无 Sub-Agent,点右上角'新建'添加" />
      ) : filtered.length === 0 ? (
        <Empty description={`没有匹配 "${query}" 的 Sub-Agent`} />
      ) : (
        <List<SubAgent>
          loading={loading}
          bordered
          dataSource={filtered}
          renderItem={(a) => (
            <List.Item
              key={a.name}
              actions={[
                <Button
                  key="edit"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => openEdit(a)}
                >
                  编辑
                </Button>,
                <Button
                  key="delete"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(a.name)}
                >
                  删除
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span style={{ fontWeight: 600 }}>{a.name}</span>
                    <Tag color={a.enabled ? 'green' : 'default'}>
                      {a.enabled ? '启用' : '停用'}
                    </Tag>
                    {a.argumentHint && (
                      <Tag color="purple">@{a.name} {a.argumentHint}</Tag>
                    )}
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    <div>{a.description || '(无描述)'}</div>
                  </div>
                }
              />
              <Switch
                checked={a.enabled}
                onChange={(v) => handleToggle(a.name, v)}
                aria-label={`toggle-${a.name}`}
              />
            </List.Item>
          )}
        />
      )}

      {/* Edit Dialog — inline,Simplicity First */}
      <Modal
        title={`编辑 Sub-Agent: ${editing?.name ?? ''}`}
        open={!!editing}
        onOk={submitEdit}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item label="名称" name="name">
            <Input disabled />
          </Form.Item>
          <Form.Item
            label="描述"
            name="description"
            rules={[{ required: true, message: '请输入描述' }]}
          >
            <Input.TextArea rows={2} placeholder="例如:深度探索代码库" />
          </Form.Item>
          <Form.Item
            label="argument-hint(参数提示)"
            name="argumentHint"
            tooltip="用户调用 agent 时显示的参数提示,可选"
          >
            <Input placeholder="例如:[path]" />
          </Form.Item>
          <Form.Item label="正文" name="body">
            <Input.TextArea rows={8} placeholder=".md 正文(Markdown)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Dialog — inline */}
      <Modal
        title="新建 Sub-Agent"
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
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item
            label="名称(文件名,去 .md 后缀)"
            name="name"
            rules={[
              { required: true, message: '请输入名称' },
              {
                pattern: /^[a-z0-9_-]+$/,
                message: '仅允许小写字母、数字、-、_',
              },
            ]}
          >
            <Input placeholder="例如:explore" />
          </Form.Item>
          <Form.Item
            label="描述"
            name="description"
            rules={[{ required: true, message: '请输入描述' }]}
          >
            <Input.TextArea rows={2} placeholder="例如:Explore the codebase" />
          </Form.Item>
          <Form.Item
            label="argument-hint(参数提示)"
            name="argumentHint"
            tooltip="可选"
          >
            <Input placeholder="例如:[path]" />
          </Form.Item>
          <Form.Item label="正文" name="body">
            <Input.TextArea rows={8} placeholder=".md 正文(Markdown)" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

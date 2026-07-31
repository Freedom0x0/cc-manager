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
import type { Command, CommandCreateInput } from '../../types';

// 表单字段本地形态(name/description/argumentHint/body)。
// 与 CommandCreateInput / CommandUpdatePatch 区分(CommandCreateInput 是 IPC 入参)。
interface CommandFormValues {
  name: string;
  description: string;
  argumentHint?: string;
  body?: string;
}

export const CommandsManager: React.FC = () => {
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Command | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [editForm] = Form.useForm<CommandFormValues>();
  const [createForm] = Form.useForm<CommandFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.commandList();
      setCommands(list);
    } catch (e) {
      console.error('commandList failed', e);
      message.error('加载 Commands 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    // 乐观更新 UI,失败再回滚
    setCommands((prev) => prev.map((c) => (c.name === name ? { ...c, enabled } : c)));
    try {
      await api.commandToggleEnabled(name, enabled);
      message.success(enabled ? `已启用 ${name}` : `已停用 ${name}`);
    } catch (e) {
      console.error('commandToggleEnabled failed', e);
      message.error('切换启用状态失败');
      // 回滚
      setCommands((prev) => prev.map((c) => (c.name === name ? { ...c, enabled: !enabled } : c)));
    }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: `删除 Command: ${name}?`,
      content: '此操作会从 ~/.claude/commands/ 移除该 .md 文件,不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.commandDelete(name);
          message.success(`已删除 ${name}`);
          load();
        } catch (e) {
          console.error('commandDelete failed', e);
          message.error('删除失败');
        }
      },
    });
  };

  const openEdit = (c: Command) => {
    setEditing(c);
    editForm.setFieldsValue({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint ?? '',
      body: c.body,
    });
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields();
      await api.commandUpdate(editing.name, {
        description: values.description,
        argumentHint: values.argumentHint,
        body: values.body,
      });
      message.success(`已更新 ${editing.name}`);
      setEditing(null);
      load();
    } catch (e) {
      if (e instanceof Error) console.error('commandUpdate failed', e);
      message.error('更新失败');
    }
  };

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const input: CommandCreateInput = {
        name: values.name,
        description: values.description,
        body: values.body,
        argumentHint: values.argumentHint,
      };
      await api.commandCreate(input);
      message.success(`已创建 ${values.name}`);
      setCreating(false);
      createForm.resetFields();
      load();
    } catch (e) {
      if (e instanceof Error) console.error('commandCreate failed', e);
      message.error('创建失败');
    }
  };

  const enabledCount = commands.filter((c) => c.enabled).length;
  const disabledCount = commands.length - enabledCount;
  const filtered = query
    ? commands.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : commands;

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
            <h2 style={{ margin: 0 }}>Commands</h2>
            <Tag color="blue">
              {enabledCount}/{disabledCount}
            </Tag>
          </Space>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            读取 ~/.claude/commands/*.md · 启用状态独立存于 mcp_server_state KV 表
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

      {commands.length === 0 && !loading ? (
        <Empty description="暂无 Command,点右上角'新建'添加" />
      ) : filtered.length === 0 ? (
        <Empty description={`没有匹配 "${query}" 的 Command`} />
      ) : (
        <List<Command>
          loading={loading}
          bordered
          dataSource={filtered}
          renderItem={(c) => (
            <List.Item
              key={c.name}
              actions={[
                <Button
                  key="edit"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => openEdit(c)}
                >
                  编辑
                </Button>,
                <Button
                  key="delete"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(c.name)}
                >
                  删除
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <Tag color={c.enabled ? 'green' : 'default'}>
                      {c.enabled ? '启用' : '停用'}
                    </Tag>
                    {c.argumentHint && (
                      <Tag color="purple">/{c.name} {c.argumentHint}</Tag>
                    )}
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    <div>{c.description || '(无描述)'}</div>
                  </div>
                }
              />
              <Switch
                checked={c.enabled}
                onChange={(v) => handleToggle(c.name, v)}
                aria-label={`toggle-${c.name}`}
              />
            </List.Item>
          )}
        />
      )}

      {/* Edit Dialog — inline,Simplicity First */}
      <Modal
        title={`编辑 Command: ${editing?.name ?? ''}`}
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
            <Input.TextArea rows={2} placeholder="例如:审查当前分支的变更" />
          </Form.Item>
          <Form.Item
            label="argument-hint(参数提示)"
            name="argumentHint"
            tooltip="用户调用命令时显示的参数提示,可选"
          >
            <Input placeholder="例如:[path]" />
          </Form.Item>
          <Form.Item label="正文" name="body">
            <Input.TextArea rows={6} placeholder=".md 正文(Markdown)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Dialog — inline */}
      <Modal
        title="新建 Command"
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
            <Input placeholder="例如:review" />
          </Form.Item>
          <Form.Item
            label="描述"
            name="description"
            rules={[{ required: true, message: '请输入描述' }]}
          >
            <Input.TextArea rows={2} placeholder="例如:Review changed files" />
          </Form.Item>
          <Form.Item
            label="argument-hint(参数提示)"
            name="argumentHint"
            tooltip="可选"
          >
            <Input placeholder="例如:[path]" />
          </Form.Item>
          <Form.Item label="正文" name="body">
            <Input.TextArea rows={6} placeholder=".md 正文(Markdown)" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

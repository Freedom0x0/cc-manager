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
} from '@ant-design/icons';
import { api } from '../../api';
import type { McpServer } from '../../types';

// Form value shape:user 在 <Input> 里输入的是逗号分隔的字符串,
// 提交时再 split 成 McpCreateInput.args: string[]
interface McpFormValues {
  name: string;
  command: string;
  args?: string;
  description?: string;
}

export const McpManager: React.FC = () => {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [creating, setCreating] = useState(false);
  const [editForm] = Form.useForm<McpFormValues>();
  const [createForm] = Form.useForm<McpFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.mcpList();
      setServers(list);
    } catch (e) {
      console.error('mcpList failed', e);
      message.error('加载 MCP 配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    // 乐观更新 UI,失败再回滚
    setServers((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
    try {
      await api.mcpToggleEnabled(name, enabled);
      message.success(enabled ? `已启用 ${name}` : `已停用 ${name}`);
    } catch (e) {
      console.error('mcpToggleEnabled failed', e);
      message.error('切换启用状态失败');
      // 回滚
      setServers((prev) => prev.map((s) => (s.name === name ? { ...s, enabled: !enabled } : s)));
    }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: `删除 MCP server: ${name}?`,
      content: '此操作会从 ~/.claude.json 移除该 server,不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.mcpDelete(name);
          message.success(`已删除 ${name}`);
          load();
        } catch (e) {
          console.error('mcpDelete failed', e);
          message.error('删除失败');
        }
      },
    });
  };

  const openEdit = (s: McpServer) => {
    setEditing(s);
    editForm.setFieldsValue({
      name: s.name,
      command: s.command,
      args: s.args.join(', '),
      description: s.description ?? '',
    });
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields();
      const args = values.args
        ? values.args.split(',').map((a) => a.trim()).filter(Boolean)
        : [];
      await api.mcpUpdate(editing.name, {
        command: values.command,
        args,
        description: values.description || undefined,
      });
      message.success(`已更新 ${editing.name}`);
      setEditing(null);
      load();
    } catch (e) {
      if (e instanceof Error) console.error('mcpUpdate failed', e);
      // antd Form 校验失败会自动显示,这里只兜底 IO 错误
      message.error('更新失败');
    }
  };

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const args = values.args
        ? values.args.split(',').map((a) => a.trim()).filter(Boolean)
        : [];
      await api.mcpCreate({
        name: values.name,
        command: values.command,
        args,
        description: values.description || undefined,
      });
      message.success(`已创建 ${values.name}`);
      setCreating(false);
      createForm.resetFields();
      load();
    } catch (e) {
      if (e instanceof Error) console.error('mcpCreate failed', e);
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
          <h2 style={{ margin: 0 }}>MCP Servers</h2>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            读取 ~/.claude.json · 启用状态独立存于 mcp_server_state KV 表
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

      {servers.length === 0 && !loading ? (
        <Empty description="暂无 MCP server,点右上角'新建'添加" />
      ) : (
        <List<McpServer>
          loading={loading}
          bordered
          dataSource={servers}
          renderItem={(s) => (
            <List.Item
              key={s.name}
              actions={[
                <Button
                  key="edit"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => openEdit(s)}
                >
                  编辑
                </Button>,
                <Button
                  key="delete"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(s.name)}
                >
                  删除
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    <Tag color={s.enabled ? 'green' : 'default'}>
                      {s.enabled ? '启用' : '停用'}
                    </Tag>
                    <Tag color="blue">{s.source}</Tag>
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    <div>
                      <code>
                        {s.command} {s.args.join(' ')}
                      </code>
                    </div>
                    {s.description && <div style={{ marginTop: 4 }}>{s.description}</div>}
                  </div>
                }
              />
              <Switch
                checked={s.enabled}
                onChange={(v) => handleToggle(s.name, v)}
                aria-label={`toggle-${s.name}`}
              />
            </List.Item>
          )}
        />
      )}

      {/* Edit Dialog — inline,Simplicity First(不抽独立组件) */}
      <Modal
        title={`编辑 MCP server: ${editing?.name ?? ''}`}
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
            label="命令"
            name="command"
            rules={[{ required: true, message: '请输入命令' }]}
          >
            <Input placeholder="例如:npx" />
          </Form.Item>
          <Form.Item
            label="参数(逗号分隔)"
            name="args"
            tooltip="多个参数用英文逗号分隔"
          >
            <Input placeholder="例如:-y, @modelcontextprotocol/server-filesystem" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Dialog — inline,Simplicity First */}
      <Modal
        title="新建 MCP server"
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
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如:filesystem" />
          </Form.Item>
          <Form.Item
            label="命令"
            name="command"
            rules={[{ required: true, message: '请输入命令' }]}
          >
            <Input placeholder="例如:npx" />
          </Form.Item>
          <Form.Item
            label="参数(逗号分隔)"
            name="args"
            tooltip="多个参数用英文逗号分隔"
          >
            <Input placeholder="例如:-y, @modelcontextprotocol/server-filesystem" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

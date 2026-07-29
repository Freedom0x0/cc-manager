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
import type { Plugin, PluginCreateInput } from '../../types';

// 表单字段本地形态(name/version/description/author/dependencies/entry)。
// 与 PluginCreateInput / PluginUpdatePatch 区分(IPC 入参)。
// dependencies 用逗号分隔字符串编辑,提交时 split → array(符合任务要求)。
interface PluginFormValues {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: string; // 逗号分隔
  entry?: string;
}

const emptyToUndefined = (v: string | undefined) =>
  v && v.trim().length > 0 ? v : undefined;

export const PluginsManager: React.FC = () => {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Plugin | null>(null);
  const [creating, setCreating] = useState(false);
  const [editForm] = Form.useForm<PluginFormValues>();
  const [createForm] = Form.useForm<PluginFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.pluginList();
      setPlugins(list);
    } catch (e) {
      console.error('pluginList failed', e);
      message.error('加载插件失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    // 乐观更新 UI,失败再回滚
    setPlugins((prev) => prev.map((p) => (p.name === name ? { ...p, enabled } : p)));
    try {
      await api.pluginToggleEnabled(name, enabled);
      message.success(enabled ? `已启用 ${name}` : `已停用 ${name}`);
    } catch (e) {
      console.error('pluginToggleEnabled failed', e);
      message.error('切换启用状态失败');
      // 回滚
      setPlugins((prev) => prev.map((p) => (p.name === name ? { ...p, enabled: !enabled } : p)));
    }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: `删除插件: ${name}?`,
      content:
        '此操作会删除整个 ~/.claude/plugins/<name>/ 子目录(含所有文件),不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.pluginDelete(name);
          message.success(`已删除 ${name}`);
          load();
        } catch (e) {
          console.error('pluginDelete failed', e);
          message.error('删除失败');
        }
      },
    });
  };

  const openEdit = (p: Plugin) => {
    setEditing(p);
    editForm.setFieldsValue({
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author ?? '',
      dependencies: p.dependencies ? p.dependencies.join(', ') : '',
      entry: p.entry ?? '',
    });
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields();
      const deps = values.dependencies
        ? values.dependencies.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      await api.pluginUpdate(editing.name, {
        version: values.version,
        description: values.description,
        author: emptyToUndefined(values.author),
        dependencies: deps && deps.length > 0 ? deps : undefined,
        entry: emptyToUndefined(values.entry),
      });
      message.success(`已更新 ${editing.name}`);
      setEditing(null);
      load();
    } catch (e) {
      if (e instanceof Error) console.error('pluginUpdate failed', e);
      message.error('更新失败');
    }
  };

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const deps = values.dependencies
        ? values.dependencies.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      const input: PluginCreateInput = {
        name: values.name,
        version: values.version,
        description: values.description,
        author: emptyToUndefined(values.author),
        dependencies: deps && deps.length > 0 ? deps : undefined,
        entry: emptyToUndefined(values.entry),
      };
      await api.pluginCreate(input);
      message.success(`已创建 ${values.name}`);
      setCreating(false);
      createForm.resetFields();
      load();
    } catch (e) {
      if (e instanceof Error) console.error('pluginCreate failed', e);
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
          <h2 style={{ margin: 0 }}>插件</h2>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            读取 ~/.claude/plugins/<name>/plugin.json · 严格 schema 校验
            (name/version/description 必填)· 启用状态独立存于 mcp_server_state KV 表
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

      {plugins.length === 0 && !loading ? (
        <Empty description="暂无插件,点右上角'新建'添加" />
      ) : (
        <List<Plugin>
          loading={loading}
          bordered
          dataSource={plugins}
          renderItem={(p) => (
            <List.Item
              key={p.name}
              actions={[
                <Button
                  key="edit"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => openEdit(p)}
                >
                  编辑
                </Button>,
                <Button
                  key="delete"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(p.name)}
                >
                  删除
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    <Tag color="blue">v{p.version}</Tag>
                    <Tag color={p.enabled ? 'green' : 'default'}>
                      {p.enabled ? '启用' : '停用'}
                    </Tag>
                    {p.author && <Tag color="purple">@ {p.author}</Tag>}
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    <div>{p.description}</div>
                    {p.dependencies && p.dependencies.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        deps: {p.dependencies.join(', ')}
                      </div>
                    )}
                    {p.entry && (
                      <div style={{ marginTop: 4 }}>entry: {p.entry}</div>
                    )}
                  </div>
                }
              />
              <Switch
                checked={p.enabled}
                onChange={(v) => handleToggle(p.name, v)}
                aria-label={`toggle-${p.name}`}
              />
            </List.Item>
          )}
        />
      )}

      {/* Edit Dialog — inline,Simplicity First */}
      <Modal
        title={`编辑插件: ${editing?.name ?? ''}`}
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
            label="version"
            name="version"
            rules={[{ required: true, message: '请输入版本号' }]}
          >
            <Input placeholder="例如:1.0.0" />
          </Form.Item>
          <Form.Item
            label="描述"
            name="description"
            rules={[{ required: true, message: '请输入描述' }]}
          >
            <Input.TextArea rows={2} placeholder="插件用途描述" />
          </Form.Item>
          <Form.Item label="author(可选)" name="author">
            <Input placeholder="例如:octocat" />
          </Form.Item>
          <Form.Item
            label="dependencies(逗号分隔,可空)"
            name="dependencies"
            tooltip="依赖列表,逗号分隔,留空表示无依赖"
          >
            <Input placeholder="例如:git, gh" />
          </Form.Item>
          <Form.Item label="entry(可选,主入口文件)" name="entry">
            <Input placeholder="例如:index.js" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Dialog — inline */}
      <Modal
        title="新建插件"
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
            label="名称(子目录名)"
            name="name"
            rules={[
              { required: true, message: '请输入名称' },
              {
                pattern: /^[a-z0-9_-]+$/,
                message: '仅允许小写字母、数字、-、_',
              },
            ]}
          >
            <Input placeholder="例如:git-tools" />
          </Form.Item>
          <Form.Item
            label="version"
            name="version"
            rules={[{ required: true, message: '请输入版本号' }]}
          >
            <Input placeholder="例如:1.0.0" />
          </Form.Item>
          <Form.Item
            label="description"
            name="description"
            rules={[{ required: true, message: '请输入描述' }]}
          >
            <Input.TextArea rows={2} placeholder="插件用途描述" />
          </Form.Item>
          <Form.Item label="author(可选)" name="author">
            <Input placeholder="例如:octocat" />
          </Form.Item>
          <Form.Item
            label="dependencies(逗号分隔,可空)"
            name="dependencies"
            tooltip="依赖列表,逗号分隔,留空表示无依赖"
          >
            <Input placeholder="例如:git, gh" />
          </Form.Item>
          <Form.Item label="entry(可选,主入口文件)" name="entry">
            <Input placeholder="例如:index.js" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

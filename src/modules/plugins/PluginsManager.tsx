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
  SearchOutlined,
} from '@ant-design/icons';
import { api } from '../../api';
import type { Plugin, PluginCreateInput } from '../../types';

/**
 * PluginsManager — v5 wave-2 插件 Tab
 *
 * 2026-07-30 重写:从假设的"`<name>/plugin.json` 目录"改为实际
 * `~/.claude/plugins/installed_plugins.json` 单文件。
 * 字段:fullName(name@marketplace,主键)、name (short)、marketplace、
 * installPath、version、scope、installedAt、lastUpdated、gitCommitSha、enabled。
 *
 * UI 设计:
 * - 每条 plugin 卡片:fullName + version + scope + enabled 状态 + 3 按钮(edit/delete/toggle)
 * - Edit dialog:只允许改 scope + version(其他字段如 installPath/gitCommitSha 是 marketplace 装时固定,不暴露编辑)
 * - Create dialog:用户手动加本地 plugin 到 installed_plugins.json(实际装还是要 marketplace 流程;createPlugin 只动 JSON 条目)
 * - Delete:从 installed_plugins.json 移除条目(**不** rm -rf installPath)
 * - Toggle:只改 KV 表(不污染 installed_plugins.json)— D6 决策
 */

const emptyToUndefined = (v: string | undefined) =>
  v && v.trim().length > 0 ? v : undefined;

const shortIso = (iso: string): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
};

const shortSha = (sha: string): string => {
  if (!sha) return '—';
  return sha.length > 8 ? sha.slice(0, 8) : sha;
};

export const PluginsManager: React.FC = () => {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Plugin | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [editForm] = Form.useForm<{ scope: 'user' | 'project'; version: string }>();
  const [createForm] = Form.useForm<{
    fullName: string;
    installPath: string;
    version: string;
    scope: 'user' | 'project';
  }>();

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

  const handleToggle = async (fullName: string, enabled: boolean) => {
    // 乐观更新 UI,失败再回滚
    setPlugins((prev) => prev.map((p) => (p.fullName === fullName ? { ...p, enabled } : p)));
    try {
      await api.pluginToggleEnabled(fullName, enabled);
      message.success(enabled ? `已启用 ${fullName}` : `已停用 ${fullName}`);
    } catch (e) {
      console.error('pluginToggleEnabled failed', e);
      message.error('切换启用状态失败');
      setPlugins((prev) =>
        prev.map((p) => (p.fullName === fullName ? { ...p, enabled: !enabled } : p))
      );
    }
  };

  const handleDelete = (fullName: string) => {
    const name = fullName.split('@')[0];
    Modal.confirm({
      title: `删除插件: ${fullName}?`,
      content:
        '此操作从 ~/.claude/plugins/installed_plugins.json 移除该条目,但**不**删除 installPath 目录(marketplace 文件保留)。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.pluginDelete(fullName);
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
    editForm.setFieldsValue({ scope: p.scope, version: p.version });
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields();
      await api.pluginUpdate(editing.fullName, {
        scope: values.scope,
        version: emptyToUndefined(values.version),
      });
      message.success(`已更新 ${editing.fullName}`);
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
      const input: PluginCreateInput = {
        fullName: values.fullName,
        installPath: values.installPath,
        version: values.version,
        scope: values.scope,
      };
      await api.pluginCreate(input);
      message.success(`已创建 ${values.fullName}`);
      setCreating(false);
      createForm.resetFields();
      load();
    } catch (e) {
      if (e instanceof Error) console.error('pluginCreate failed', e);
      message.error('创建失败');
    }
  };

  const enabledCount = plugins.filter((p) => p.enabled).length;
  const disabledCount = plugins.length - enabledCount;
  const filtered = query
    ? plugins.filter((p) => p.fullName.toLowerCase().includes(query.toLowerCase()))
    : plugins;

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
            <h2 style={{ margin: 0 }}>插件</h2>
            <Tag color="blue">
              {enabledCount}/{disabledCount}
            </Tag>
          </Space>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            读取 ~/.claude/plugins/installed_plugins.json · 严格 schema 校验 · 启用状态独立存于 mcp_server_state KV 表
          </div>
        </div>
        <Space>
          <Input
            allowClear
            placeholder="搜索 fullName"
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

      {plugins.length === 0 && !loading ? (
        <Empty description="暂未安装插件,可点右上角'新建'手动添加" />
      ) : filtered.length === 0 ? (
        <Empty description={`没有匹配 "${query}" 的插件`} />
      ) : (
        <List<Plugin>
          loading={loading}
          bordered
          dataSource={filtered}
          renderItem={(p) => (
            <List.Item
              key={p.fullName}
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
                  onClick={() => handleDelete(p.fullName)}
                >
                  删除
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <span style={{ fontWeight: 600 }}>{p.fullName}</span>
                    <Tag color="blue">v{p.version}</Tag>
                    <Tag color={p.scope === 'user' ? 'cyan' : 'orange'}>{p.scope}</Tag>
                    <Tag color={p.enabled ? 'green' : 'default'}>
                      {p.enabled ? '启用' : '停用'}
                    </Tag>
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    <div>安装路径: {p.installPath}</div>
                    <div style={{ marginTop: 4 }}>
                      安装: {shortIso(p.installedAt)} · 更新: {shortIso(p.lastUpdated)} · sha:{' '}
                      {shortSha(p.gitCommitSha)}
                    </div>
                  </div>
                }
              />
              <Switch
                checked={p.enabled}
                onChange={(v) => handleToggle(p.fullName, v)}
                aria-label={`toggle-${p.fullName}`}
              />
            </List.Item>
          )}
        />
      )}

      {/* Edit Dialog — 只允许改 scope + version */}
      <Modal
        title={`编辑插件: ${editing?.fullName ?? ''}`}
        open={!!editing}
        onOk={submitEdit}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item label="fullName(主键,不可改)">
            <Input value={editing?.fullName ?? ''} disabled />
          </Form.Item>
          <Form.Item label="installPath(marketplace 装时固定)">
            <Input value={editing?.installPath ?? ''} disabled />
          </Form.Item>
          <Form.Item
            label="scope"
            name="scope"
            rules={[{ required: true, message: '请选择 scope' }]}
          >
            <Select
              options={[
                { value: 'user', label: 'user(全局)' },
                { value: 'project', label: 'project(项目级)' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="version(可选,改后更新 lastUpdated)"
            name="version"
          >
            <Input placeholder="例如:1.0.0" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Dialog */}
      <Modal
        title="新建插件条目"
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
            label="fullName(name@marketplace)"
            name="fullName"
            rules={[
              { required: true, message: '请输入 fullName' },
              {
                pattern: /^[a-z0-9_-]+@[a-z0-9_.-]+$/,
                message: '格式必须为 name@marketplace,如 git@claude-plugins-official',
              },
            ]}
          >
            <Input placeholder="例如:my-plugin@local" />
          </Form.Item>
          <Form.Item
            label="installPath"
            name="installPath"
            rules={[{ required: true, message: '请输入安装路径' }]}
          >
            <Input placeholder="例如:C:/Users/.../plugins/cache/local/my-plugin/1.0.0" />
          </Form.Item>
          <Form.Item
            label="version"
            name="version"
            rules={[{ required: true, message: '请输入版本号' }]}
          >
            <Input placeholder="例如:1.0.0" />
          </Form.Item>
          <Form.Item
            label="scope"
            name="scope"
            rules={[{ required: true, message: '请选择 scope' }]}
            initialValue="user"
          >
            <Select
              options={[
                { value: 'user', label: 'user(全局)' },
                { value: 'project', label: 'project(项目级)' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

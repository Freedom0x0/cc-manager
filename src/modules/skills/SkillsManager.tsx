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
  ImportOutlined,
} from '@ant-design/icons';
import { api } from '../../api';
import type { Skill, SkillCreateInput } from '../../types';

// 表单字段本地形态(name/description/allowedTools/body/version)。
// 与 SkillCreateInput / SkillUpdatePatch 区分(SkillCreateInput 是 IPC 入参)。
interface SkillFormValues {
  name: string;
  description: string;
  allowedTools?: string;
  body?: string;
  version?: string;
}

export const SkillsManager: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);
  const [editForm] = Form.useForm<SkillFormValues>();
  const [createForm] = Form.useForm<SkillFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.skillList();
      setSkills(list);
    } catch (e) {
      console.error('skillList failed', e);
      message.error('加载 Skills 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    // 乐观更新 UI,失败再回滚
    setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
    try {
      await api.skillToggleEnabled(name, enabled);
      message.success(enabled ? `已启用 ${name}` : `已停用 ${name}`);
    } catch (e) {
      console.error('skillToggleEnabled failed', e);
      message.error('切换启用状态失败');
      // 回滚
      setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled: !enabled } : s)));
    }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: `删除 Skill: ${name}?`,
      content: '此操作会从 ~/.claude/skills/ 移除该目录,不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.skillDelete(name);
          message.success(`已删除 ${name}`);
          load();
        } catch (e) {
          console.error('skillDelete failed', e);
          message.error('删除失败');
        }
      },
    });
  };

  const openEdit = (s: Skill) => {
    setEditing(s);
    editForm.setFieldsValue({
      name: s.name,
      description: s.description,
      allowedTools: s.allowedTools ? s.allowedTools.join(', ') : '',
      body: s.body,
      version: s.version ?? '',
    });
  };

  const parseAllowedTools = (raw?: string): string[] | undefined => {
    if (!raw) return undefined;
    const arr = raw.split(',').map((a) => a.trim()).filter(Boolean);
    return arr.length > 0 ? arr : undefined;
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields();
      await api.skillUpdate(editing.name, {
        description: values.description,
        allowedTools: parseAllowedTools(values.allowedTools),
        body: values.body,
        version: values.version || undefined,
      });
      message.success(`已更新 ${editing.name}`);
      setEditing(null);
      load();
    } catch (e) {
      if (e instanceof Error) console.error('skillUpdate failed', e);
      message.error('更新失败');
    }
  };

  const handleImport = async () => {
    try {
      const imported = await api.skillImportFile();
      if (!imported) return; // 用户取消对话框
      createForm.setFieldsValue({
        name: imported.name,
        description: imported.description,
        allowedTools: imported.allowedTools ? imported.allowedTools.join(', ') : '',
        version: imported.version ?? '',
        body: imported.body ?? '',
      });
      message.success(`已从文件导入: ${imported.name}`);
    } catch (e) {
      console.error('skillImportFile failed', e);
      message.error('导入失败');
    }
  };

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const input: SkillCreateInput = {
        name: values.name,
        description: values.description,
        body: values.body,
        allowedTools: parseAllowedTools(values.allowedTools),
        version: values.version || undefined,
      };
      await api.skillCreate(input);
      message.success(`已创建 ${values.name}`);
      setCreating(false);
      createForm.resetFields();
      load();
    } catch (e) {
      if (e instanceof Error) console.error('skillCreate failed', e);
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
          <h2 style={{ margin: 0 }}>Skills</h2>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            读取 ~/.claude/skills/ · 启用状态独立存于 mcp_server_state KV 表
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

      {skills.length === 0 && !loading ? (
        <Empty description="暂无 Skill,点右上角'新建'添加" />
      ) : (
        <List<Skill>
          loading={loading}
          bordered
          dataSource={skills}
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
                    {s.version && <Tag color="blue">v{s.version}</Tag>}
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    <div>{s.description || '(无描述)'}</div>
                    {s.allowedTools && s.allowedTools.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        tools: {s.allowedTools.join(', ')}
                      </div>
                    )}
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

      {/* Edit Dialog — inline,Simplicity First */}
      <Modal
        title={`编辑 Skill: ${editing?.name ?? ''}`}
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
            <Input.TextArea rows={2} placeholder="例如:生成 commit message" />
          </Form.Item>
          <Form.Item
            label="allowed-tools(逗号分隔)"
            name="allowedTools"
            tooltip="允许使用的工具列表,可选"
          >
            <Input placeholder="例如:Read, Grep, Bash" />
          </Form.Item>
          <Form.Item label="version" name="version">
            <Input placeholder="可选,例如:1.0.0" />
          </Form.Item>
          <Form.Item label="正文" name="body">
            <Input.TextArea rows={6} placeholder="SKILL.md 正文(Markdown)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Dialog — inline */}
      <Modal
        title="新建 Skill"
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
          <div style={{ marginBottom: 16, textAlign: 'right' }}>
            <Button icon={<ImportOutlined />} onClick={handleImport} size="small">
              从文件导入
            </Button>
          </div>
          <Form.Item
            label="名称(目录名)"
            name="name"
            rules={[
              { required: true, message: '请输入名称' },
              {
                pattern: /^[a-z0-9_-]+$/,
                message: '仅允许小写字母、数字、-、_',
              },
            ]}
          >
            <Input placeholder="例如:commit-helper" />
          </Form.Item>
          <Form.Item
            label="描述"
            name="description"
            rules={[{ required: true, message: '请输入描述' }]}
          >
            <Input.TextArea rows={2} placeholder="例如:Generate commit message" />
          </Form.Item>
          <Form.Item
            label="allowed-tools(逗号分隔)"
            name="allowedTools"
            tooltip="可选"
          >
            <Input placeholder="例如:Read, Grep, Bash" />
          </Form.Item>
          <Form.Item label="version" name="version">
            <Input placeholder="可选,例如:1.0.0" />
          </Form.Item>
          <Form.Item label="正文" name="body">
            <Input.TextArea rows={6} placeholder="SKILL.md 正文(Markdown)" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

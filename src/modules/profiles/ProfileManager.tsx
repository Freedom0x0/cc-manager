import React, { useEffect, useState } from 'react';
import { List, Button, Modal, Form, Input, message, Empty, Space, Tag } from 'antd';
import {
  ReloadOutlined,
  CheckCircleOutlined,
  CameraOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { api } from '../../api';
import type { Profile, ProfileCreateInput } from '../../types';

// Capture 表单字段(name + description) — profile.config 由 capture 自动从 KV
// 表读 enabled 状态生成,不该用户手编,故无 Edit dialog。
interface ProfileFormValues {
  name: string;
  description: string;
}

const formatTimestamp = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN');
};

export const ProfileManager: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureForm] = Form.useForm<ProfileFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.profileList();
      setProfiles(list);
    } catch (e) {
      console.error('profileList failed', e);
      message.error('加载 Profiles 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // 应用:把该 profile 的 enabled* 列表写回 KV 表(事务化,失败自动回滚)
  const handleApply = (name: string) => {
    Modal.confirm({
      title: `应用 Profile: ${name}?`,
      content:
        '此操作会改变所有 6 类组件(MCP / Skills / Commands / Sub-Agents / Hooks / 插件)的启用状态,事务化执行,失败自动回滚。',
      okText: '应用',
      okButtonProps: { type: 'primary', icon: <CheckCircleOutlined /> },
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await api.profileApply(name);
          message.success(`已应用 ${name}(@ ${formatTimestamp(new Date(result.appliedAt).toISOString())})`);
          load();
        } catch (e) {
          if (e instanceof Error) console.error('profileApply failed', e);
          message.error('应用失败');
        }
      },
    });
  };

  // 捕获:从当前 KV 表 enabled 状态生成新 profile
  const openCapture = () => {
    captureForm.resetFields();
    setCapturing(true);
  };

  const submitCapture = async () => {
    try {
      const values = await captureForm.validateFields();
      const input: ProfileCreateInput = {
        name: values.name,
        description: values.description,
      };
      await api.profileCapture(input.name, input.description);
      message.success(`已捕获 ${values.name}`);
      setCapturing(false);
      captureForm.resetFields();
      load();
    } catch (e) {
      if (e instanceof Error) console.error('profileCapture failed', e);
      message.error('捕获失败');
    }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: `删除 Profile: ${name}?`,
      content: '此操作会从 profiles.json 移除该 profile,不可恢复(不影响当前 KV 表 enabled 状态)。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.profileDelete(name);
          message.success(`已删除 ${name}`);
          load();
        } catch (e) {
          console.error('profileDelete failed', e);
          message.error('删除失败');
        }
      },
    });
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
          <h2 style={{ margin: 0 }}>Profiles</h2>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            快照式启用状态集合 · 6 类组件(MCP / Skills / Commands / Sub-Agents /
            Hooks / 插件)当前启用列表 · apply 事务化写回 KV 表,失败自动回滚
          </div>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<CameraOutlined />} onClick={openCapture}>
            捕获当前状态
          </Button>
        </Space>
      </div>

      {profiles.length === 0 && !loading ? (
        <Empty description="暂无 Profile,点右上角'捕获当前状态'从当前 KV 表快照" />
      ) : (
        <List<Profile>
          loading={loading}
          bordered
          dataSource={profiles}
          renderItem={(p) => {
            const total =
              p.config.enabledServers.length +
              p.config.enabledSkills.length +
              p.config.enabledCommands.length +
              p.config.enabledAgents.length +
              p.config.enabledHooks.length +
              p.config.enabledPlugins.length;
            return (
              <List.Item
                key={p.name}
                actions={[
                  <Button
                    key="apply"
                    type="text"
                    icon={<CheckCircleOutlined />}
                    onClick={() => handleApply(p.name)}
                  >
                    应用
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
                      <Tag color="blue">{total} 项启用</Tag>
                    </Space>
                  }
                  description={
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      <div>{p.description || '(无描述)'}</div>
                      <div style={{ marginTop: 4 }}>
                        更新于 {formatTimestamp(p.updatedAt)}
                      </div>
                      {total === 0 && (
                        <div style={{ marginTop: 4, color: '#dc2626' }}>
                          当前所有类别都未启用任何项
                        </div>
                      )}
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}

      {/* Capture Dialog — 唯一 dialog。profile.config 由 capture 自动从 KV 表
          读 enabled 状态生成,不允许用户手编,故无 Edit/Create 区分。 */}
      <Modal
        title="捕获当前状态为新 Profile"
        open={capturing}
        onOk={submitCapture}
        onCancel={() => {
          setCapturing(false);
          captureForm.resetFields();
        }}
        okText="捕获"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={captureForm} layout="vertical" preserve={false}>
          <Form.Item
            label="名称(唯一标识)"
            name="name"
            rules={[
              { required: true, message: '请输入 Profile 名称' },
              {
                pattern: /^[a-z0-9_-]+$/,
                message: '仅允许小写字母、数字、-、_',
              },
            ]}
          >
            <Input placeholder="例如:dev-default / prod / experiment-1" />
          </Form.Item>
          <Form.Item
            label="描述"
            name="description"
            rules={[{ required: true, message: '请输入描述' }]}
          >
            <Input.TextArea
              rows={3}
              placeholder="说明这个 Profile 的用途(例如:开发环境的默认启用集合)"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
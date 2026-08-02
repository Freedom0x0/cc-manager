import React, { useEffect, useState } from 'react';
import { List, Button, Modal, Form, Input, message, Empty, Space, Tag } from 'antd';
import {
  ReloadOutlined,
  CheckCircleOutlined,
  CameraOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { api } from '../../api';

// v4 后端 commit 11 Profile schema: { id: i64, name, modules: Map<module, Vec<item>>,
// createdAt, updatedAt }。本 commit 18 临时用 unknown[] 兜底,等 commit 18b 重写
// src/types.ts Profile shape + ProfileManager UI 完整对齐。
interface ProfileV4 {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface ProfileFormValues {
  name: string;
}

const formatTimestamp = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN');
};

export const ProfileManager: React.FC = () => {
  const [profiles, setProfiles] = useState<ProfileV4[]>([]);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureForm] = Form.useForm<ProfileFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const list = (await api.profileList()) as unknown as ProfileV4[];
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

  // v4 后端 profileApply 走 id: i64。列表渲染时存 id,apply/delete 都用 id。
  const handleApply = (id: number, name: string) => {
    Modal.confirm({
      title: `应用 Profile: ${name}?`,
      content:
        '此操作会改变所有 6 类组件(MCP / Skills / Commands / Sub-Agents / Hooks / 插件)的启用状态,事务化执行,失败自动回滚。',
      okText: '应用',
      okButtonProps: { type: 'primary', icon: <CheckCircleOutlined /> },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.profileApply(id);
          message.success(`已应用 ${name}`);
          load();
        } catch (e) {
          if (e instanceof Error) console.error('profileApply failed', e);
          message.error('应用失败');
        }
      },
    });
  };

  // v4 后端 profileCreate 单参数 name,description 走 patch 模式不带。
  const openCapture = () => {
    captureForm.resetFields();
    setCapturing(true);
  };

  const submitCapture = async () => {
    try {
      const values = await captureForm.validateFields();
      await api.profileCreate(values.name);
      message.success(`已捕获 ${values.name}`);
      setCapturing(false);
      captureForm.resetFields();
      load();
    } catch (e) {
      if (e instanceof Error) console.error('profileCreate failed', e);
      message.error('捕获失败');
    }
  };

  const handleDelete = (id: number, name: string) => {
    Modal.confirm({
      title: `删除 Profile: ${name}?`,
      content: '此操作从 profile_snapshot 表移除该 row,不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.profileDelete(id);
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
        <Empty description="暂无 Profile,点右上角'捕获当前状态'从 6 scanner 真实 enabled 全集快照" />
      ) : (
        <List<ProfileV4>
          loading={loading}
          bordered
          dataSource={profiles}
          renderItem={(p) => {
            // v4 后端 modules 字段未在 list 视图返 (ProfileSummary 只含 id/name/时戳/itemCount),
            // itemCount 不在 ProfileV4 shape (v3.1 shape) — 暂不显示项数 tag。后续 commit 18b
            // 重写 src/types.ts Profile 完整 shape 后这里再补。
            return (
              <List.Item
                key={p.id}
                actions={[
                  <Button
                    key="apply"
                    type="text"
                    icon={<CheckCircleOutlined />}
                    onClick={() => handleApply(p.id, p.name)}
                  >
                    应用
                  </Button>,
                  <Button
                    key="delete"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDelete(p.id, p.name)}
                  >
                    删除
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space wrap>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <Tag color="blue">id={p.id}</Tag>
                    </Space>
                  }
                  description={
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      <div>更新于 {formatTimestamp(new Date(p.updatedAt).toISOString())}</div>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}

      {/* Capture Dialog — v4 后端 profileCreate 单参数 name (无 description,description 走 patch 模式不带) */}
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
        </Form>
      </Modal>
    </div>
  );
};
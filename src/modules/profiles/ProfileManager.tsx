import React, { useEffect, useState } from 'react';
import { List, Button, Modal, Form, Input, message, Empty, Space, Tag, Descriptions } from 'antd';
import {
  ReloadOutlined,
  CheckCircleOutlined,
  CameraOutlined,
  DeleteOutlined,
  DiffOutlined,
} from '@ant-design/icons';
import { api } from '../../api';
import type { ProfileSummary, ProfileSnapshot, ProfileDiff, ProfileModuleItem } from '../../types';

// v4 后端 commit 11 Profile schema — ProfileSummary (list) / ProfileSnapshot
// (get) / ProfileDiff。ProfileManager 列表显示 ProfileSummary (含 itemCount),
// 详情 Modal 显示 ProfileSnapshot (完整 modules Map)。

interface ProfileFormValues {
  name: string;
}

const PROFILE_MODULE_LABELS: Record<string, string> = {
  mcp: 'MCP',
  skills: 'Skills',
  commands: 'Commands',
  sub_agents: 'Sub-Agents',
  hooks: 'Hooks',
  plugins: '插件',
};

const formatTimestamp = (ms: number) => {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('zh-CN');
};

const summarizeModules = (items: ProfileModuleItem[]): React.ReactNode =>
  items.length === 0 ? (
    <span style={{ color: '#9ca3af' }}>(空)</span>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map((i) => (
        <div key={i.name} style={{ fontSize: 12 }}>
          <span style={{ fontWeight: 500 }}>{i.name}</span>
          {i.description ? (
            <span style={{ color: '#6b7280' }}> — {i.description}</span>
          ) : null}
        </div>
      ))}
    </div>
  );

export const ProfileManager: React.FC = () => {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureForm] = Form.useForm<ProfileFormValues>();
  const [detailSnap, setDetailSnap] = useState<ProfileSnapshot | null>(null);
  const [diffResult, setDiffResult] = useState<ProfileDiff | null>(null);
  const [applyingId, setApplyingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = (await api.profileList()) as unknown as ProfileSummary[];
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

  const showDetail = async (id: number) => {
    try {
      const snap = (await api.profileGet(id)) as unknown as ProfileSnapshot;
      setDetailSnap(snap);
    } catch (e) {
      console.error('profileGet failed', e);
      message.error('读取 Profile 详情失败');
    }
  };

  const showDiff = async (id: number) => {
    try {
      const diff = (await api.profileDiff(id)) as unknown as ProfileDiff;
      setDiffResult(diff);
    } catch (e) {
      console.error('profileDiff failed', e);
      message.error('对比当前状态失败');
    }
  };

  const handleApply = (id: number, name: string) => {
    Modal.confirm({
      title: `应用 Profile: ${name}?`,
      content:
        '此操作会改变所有 6 类组件(MCP / Skills / Commands / Sub-Agents / Hooks / 插件)的启用状态。',
      okText: '应用',
      okButtonProps: { type: 'primary', icon: <CheckCircleOutlined /> },
      cancelText: '取消',
      onOk: async () => {
        setApplyingId(id);
        try {
          await api.profileApply(id);
          message.success(`已应用 ${name}`);
          load();
        } catch (e) {
          if (e instanceof Error) console.error('profileApply failed', e);
          message.error('应用失败');
        } finally {
          setApplyingId(null);
        }
      },
    });
  };

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
      content: '此操作从 profile_snapshot 表移除该 row,不可恢复(不影响当前真实文件 enabled 状态)。',
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
            Hooks / 插件)真实 enabled 全集
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
        <List<ProfileSummary>
          loading={loading}
          bordered
          dataSource={profiles}
          renderItem={(p) => (
            <List.Item
              key={p.id}
              actions={[
                <Button
                  key="detail"
                  type="text"
                  onClick={() => showDetail(p.id)}
                >
                  详情
                </Button>,
                <Button
                  key="diff"
                  type="text"
                  icon={<DiffOutlined />}
                  onClick={() => showDiff(p.id)}
                >
                  对比
                </Button>,
                <Button
                  key="apply"
                  type="text"
                  icon={<CheckCircleOutlined />}
                  loading={applyingId === p.id}
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
                    <Tag color="green">{p.itemCount} 项启用</Tag>
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    <div>创建于 {formatTimestamp(p.createdAt)}</div>
                    <div>更新于 {formatTimestamp(p.updatedAt)}</div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}

      {/* Capture Dialog */}
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
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
            将从 6 scanner (mcp / skills / commands / sub_agents / hooks /
            plugins) 抓取真实 enabled 全集,写入 profile_snapshot 表。
          </div>
        </Form>
      </Modal>

      {/* Detail Modal — 显示完整 modules Map */}
      <Modal
        title={detailSnap ? `Profile 详情: ${detailSnap.name}` : ''}
        open={!!detailSnap}
        onCancel={() => setDetailSnap(null)}
        footer={<Button onClick={() => setDetailSnap(null)}>关闭</Button>}
        width={720}
      >
        {detailSnap && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="ID">{detailSnap.id}</Descriptions.Item>
            <Descriptions.Item label="名称">{detailSnap.name}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatTimestamp(detailSnap.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{formatTimestamp(detailSnap.updatedAt)}</Descriptions.Item>
            {Object.entries(detailSnap.modules).map(([mod, items]) => (
              <Descriptions.Item
                key={mod}
                label={
                  <Space>
                    <Tag color="blue">{PROFILE_MODULE_LABELS[mod] ?? mod}</Tag>
                    <span style={{ color: '#6b7280' }}>{items.length} 项</span>
                  </Space>
                }
              >
                <div style={{ fontSize: 12 }}>{summarizeModules(items)}</div>
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Modal>

      {/* Diff Modal — 显示 vs 当前状态差异 */}
      <Modal
        title={diffResult ? `对比: ${diffResult.name} vs 当前状态` : ''}
        open={!!diffResult}
        onCancel={() => setDiffResult(null)}
        footer={<Button onClick={() => setDiffResult(null)}>关闭</Button>}
        width={720}
      >
        {diffResult && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <Tag color="green">新增 ({diffResult.added.length})</Tag>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                {diffResult.added.length === 0
                  ? '(无)'
                  : diffResult.added.map((i) => (
                      <div key={i.name}>
                        <span style={{ fontWeight: 500 }}>{i.name}</span>
                        {i.description ? <span style={{ color: '#6b7280' }}> — {i.description}</span> : null}
                      </div>
                    ))}
              </div>
            </div>
            <div>
              <Tag color="red">删除 ({diffResult.removed.length})</Tag>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                {diffResult.removed.length === 0
                  ? '(无)'
                  : diffResult.removed.map((i) => (
                      <div key={i.name}>
                        <span style={{ fontWeight: 500 }}>{i.name}</span>
                        {i.description ? <span style={{ color: '#6b7280' }}> — {i.description}</span> : null}
                      </div>
                    ))}
              </div>
            </div>
            <div>
              <Tag color="orange">修改 ({diffResult.modified.length})</Tag>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                {diffResult.modified.length === 0
                  ? '(无)'
                  : diffResult.modified.map((i) => (
                      <div key={i.name}>
                        <span style={{ fontWeight: 500 }}>{i.name}</span>
                        {i.description ? <span style={{ color: '#6b7280' }}> — {i.description}</span> : null}
                      </div>
                    ))}
              </div>
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
};
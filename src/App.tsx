import React, { useState } from 'react';
import { ConfigProvider, App as AntApp, Layout, Tabs } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { GlobalSearchBar } from './components/GlobalSearchBar';
import { ProjectSelector } from './components/ProjectSelector';
import { WatcherStatusIndicator } from './components/WatcherStatusIndicator';
import { ComingSoon } from './components/ComingSoon';
import { SessionsPane } from './modules/sessions/SessionsModule';
import { McpManager } from './modules/mcp/McpManager';
import { SkillsManager } from './modules/skills/SkillsManager';
import { CommandsManager } from './modules/commands/CommandsManager';
import { SubAgentsManager } from './modules/sub_agents/SubAgentsManager';
import { HooksManager } from './modules/hooks/HooksManager';
import { PluginsManager } from './modules/plugins/PluginsManager';
import { ProfileManager } from './modules/profiles/ProfileManager';
import { AnalyticsModule } from './modules/analytics/AnalyticsModule';

const { Header, Sider, Content } = Layout;

const TAB_KEYS = [
  'sessions',
  'mcp',
  'skills',
  'commands',
  'sub-agents',
  'hooks',
  'plugins',
  'profiles',
  'usage',
] as const;

type TabKey = (typeof TAB_KEYS)[number];

const TAB_LABELS: Record<TabKey, string> = {
  sessions: '会话',
  mcp: 'MCP',
  skills: 'Skills',
  commands: 'Commands',
  'sub-agents': 'Sub-Agents',
  hooks: 'Hooks',
  plugins: '插件',
  profiles: 'Profiles',
  usage: '用量分析',
};

export default function AppRoot() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#2563eb' } }}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  );
}

const TAB_WAVES: Record<TabKey, number> = {
  sessions: 0,
  mcp: 1,
  skills: 1,
  commands: 1,
  'sub-agents': 2,
  hooks: 2,
  plugins: 2,
  profiles: 3,
  usage: 3,
};

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('sessions');

  return (
    <Layout style={{ height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <Header
        style={{
          height: 64,
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 24px',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, marginRight: 8 }}>cc-session-manager</div>
        <GlobalSearchBar />
        <ProjectSelector />
        <div style={{ marginLeft: 'auto' }}>
          <WatcherStatusIndicator />
        </div>
      </Header>
      <Layout>
        <Sider width={200} style={{ background: '#fafafa', borderRight: '1px solid #e5e7eb' }}>
          <Tabs
            tabPosition="left"
            activeKey={activeTab}
            onChange={(k) => setActiveTab(k as TabKey)}
            style={{ height: '100%' }}
            tabBarStyle={{ width: '100%' }}
            items={TAB_KEYS.map((k) => ({ key: k, label: TAB_LABELS[k] }))}
          />
        </Sider>
        <Content style={{ background: '#fff', overflow: 'auto' }}>
          {activeTab === 'sessions' ? (
            <SessionsPane />
          ) : activeTab === 'mcp' ? (
            <McpManager />
          ) : activeTab === 'skills' ? (
            <SkillsManager />
          ) : activeTab === 'commands' ? (
            <CommandsManager />
          ) : activeTab === 'sub-agents' ? (
            <SubAgentsManager />
          ) : activeTab === 'hooks' ? (
            <HooksManager />
          ) : activeTab === 'plugins' ? (
            <PluginsManager />
          ) : activeTab === 'profiles' ? (
            <ProfileManager />
          ) : activeTab === 'usage' ? (
            <AnalyticsModule />
          ) : (
            <ComingSoon label={TAB_LABELS[activeTab]} wave={TAB_WAVES[activeTab]} />
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
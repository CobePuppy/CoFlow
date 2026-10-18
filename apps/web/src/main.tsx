import { edition, editionHome } from './edition.js';
import { EditionSwitch } from './components/EditionSwitch.js';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  ConfigProvider,
  Form,
  Input,
  Spin,
  Tabs,
} from 'antd';
import zhCNModule from 'antd/locale/zh_CN.js';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useSearchParams } from 'react-router-dom';
import { ApiError } from './api-response.js';
import { BrandMark } from './components/BrandMark.js';
import { Invitation } from './components/Invitation.js';
import { Registration } from './components/Registration.js';
import { Documents, Management, Portal, Workspace, Settings } from './pages.js';
import { api, client, setCsrf, useData } from './runtime.js';
import './style.css';
document.documentElement.dataset.edition = edition.id;
document.title = `CoFlow 汇流 · ${edition.label}`;
const zhCN = (zhCNModule as any).default || zhCNModule;
function Login({ onLogin }: { onLogin: () => void }) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  return (
    <div className="login">
      <div className="login-story">
        <div className="brand">
          <BrandMark />
        </div>
        <EditionSwitch />
        <h1>
          让每一次协作，
          <br />
          都有清晰的下一步。
        </h1>
        <p>
          {edition.id === 'student'
            ? '围绕需求与项目组织团队，推进竞赛准备、文书撰写和知识沉淀。'
            : '从需求、方案到交付，让产品、研发与测试在同一节奏上前行。'}
        </p>
        <div className="login-flow">
          {edition.id === 'student'
            ? '需求 → 项目 → 竞赛 → 文书 → 知识库'
            : '需求 → 方案 → 双人评估 → 开发 → 测试 → 验收'}
        </div>
      </div>
      <Card className="login-card">
        <h2>
          {authMode === 'login' ? '欢迎回到 汇流' : '加入汇流，开启团队协作'}
        </h2>
        <Tabs
          activeKey={authMode}
          onChange={setAuthMode}
          items={[
            { key: 'login', label: '登录' },
            { key: 'register', label: '注册' },
          ]}
        />
        {authMode === 'register' ? (
          <Registration request={api} onComplete={() => setAuthMode('login')} />
        ) : (
          <>
            <p className="muted">登录你的团队工作空间</p>
            <Form
              layout="vertical"
              onFinish={async (v) => {
                setBusy(true);
                try {
                  const d = await api('/auth/login', 'POST', v);
                  setCsrf(d.csrf);
                  onLogin();
                } catch (e) {
                  message.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Form.Item
                label="邮箱"
                name="email"
                rules={[{ required: true, type: 'email' }]}
              >
                <Input size="large" />
              </Form.Item>
              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true }]}
              >
                <Input.Password size="large" />
              </Form.Item>
              <Button
                block
                size="large"
                type="primary"
                htmlType="submit"
                loading={busy}
              >
                登录工作空间
              </Button>
            </Form>
            <p className="muted small">
              还没有账号？
              <Button type="link" onClick={() => setAuthMode('register')}>
                立即注册
              </Button>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
function Root() {
  const [params] = useSearchParams();
  const me = useData(['me'], '/auth/me');
  if (me.isPending)
    return (
      <div className="loading">
        <Spin />
      </div>
    );
  if (me.data) setCsrf(me.data.csrf);
  const invite =
    params.get('invite') ||
    (me.data ? sessionStorage.getItem('huiliu-invite') : null);
  if (invite)
    return (
      <Invitation
        token={invite}
        user={me.data?.user}
        request={api}
        onLogin={() => client.invalidateQueries({ queryKey: ['me'] })}
      />
    );
  if (me.error && (!(me.error instanceof ApiError) || me.error.status !== 401))
    return (
      <div className="loading">
        <Alert
          type="error"
          message="暂时无法连接汇流服务"
          description={me.error.message}
          action={<Button onClick={() => me.refetch()}>重新连接</Button>}
        />
      </div>
    );
  if (!me.data) return <Login onLogin={() => client.invalidateQueries()} />;
  if (params.get('section') === 'settings') return <Settings />;
  if (params.get('app') === 'work' || params.has('task'))
    return <Workspace user={me.data.user} />;
  return (
    <Portal
      user={me.data.user}
      request={api}
      Documents={Documents}
      Management={Management}
    />
  );
}
createRoot(document.getElementById('root')!).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: edition.primary,
        colorLink: edition.primary,
        colorInfo: edition.primary,
        colorInfoBg: edition.id === 'student' ? '#e1f4ee' : '#eaf3ff',
        colorInfoBgHover: edition.id === 'student' ? '#d2ede4' : '#ddeaff',
        colorInfoBorder: edition.id === 'student' ? '#a6d8cb' : '#b8d2f4',
        colorInfoBorderHover: edition.id === 'student' ? '#7fc1b1' : '#8fb8ec',
        colorInfoText: edition.id === 'student' ? '#245951' : '#244e7c',
        fontSize: 16,
        borderRadius: 8,
        fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif',
        colorBgLayout: edition.id === 'student' ? '#f4f8f8' : '#f3f7fc',
      },
      ...(edition.id === 'student'
        ? {
            components: {
              Button: { primaryShadow: '0 2px 5px rgba(8,127,121,0.16)' },
              Card: { headerBg: '#ffffff' },
              Table: { headerBg: '#f0f7f5', rowHoverBg: '#edf7f3' },
              Tabs: { itemSelectedColor: '#087f79', inkBarColor: '#087f79' },
            },
          }
        : {
            components: {
              Button: { primaryShadow: '0 2px 5px rgba(20,105,216,0.16)' },
              Card: { headerBg: '#ffffff' },
              Table: { headerBg: '#edf4fc', rowHoverBg: '#f0f6ff' },
              Tabs: { itemSelectedColor: '#1469d8', inkBarColor: '#1469d8' },
            },
          }),
    }}
  >
    <AntApp>
      <QueryClientProvider client={client}>
        <BrowserRouter basename={edition.base || undefined}>
          <Root />
        </BrowserRouter>
      </QueryClientProvider>
    </AntApp>
  </ConfigProvider>,
);

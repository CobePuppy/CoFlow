import { NavigationGuard } from '../shared/ui/NavigationGuard.js';
import { editionTheme } from './theme.js';
import { edition, editionHome } from './edition.js';
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
import { useEffect, useState } from 'react';
import { EditionChoice } from './EditionChoice.js';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  RouterProvider,
  useSearchParams,
} from 'react-router-dom';
import { ApiError } from '../shared/api/api-response.js';
import { BrandMark } from '../shared/ui/BrandMark.js';
import { Invitation } from '../features/auth/components/Invitation.js';
import { Registration } from '../features/auth/components/Registration.js';
import { Documents, Management, Portal, Workspace, Settings } from './pages.js';
import { api, client, setCsrf, useData } from '../shared/api/runtime.js';
import '../shared/styles/global.css';
import '../shared/styles/refinement.css';
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
        <h1>
          让每一次协作，
          <br />
          都有清晰的下一步。
        </h1>
        <p>{edition.introduction}</p>
        <div className="login-flow">{edition.flow}</div>
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
  const unified =
    !/^\/(student|enterprise)(?:\/|$)/.test(location.pathname) &&
    !['app', 'task', 'invite', 'section'].some((key) => params.has(key));
  const preference = useData(['settings'], '/settings', unified && !!me.data);
  useEffect(() => {
    if (unified && me.data && preference.data)
      location.replace('/' + preference.data.preferredEdition + '/');
  }, [unified, me.data, preference.data]);
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
  if (unified) {
    if (!me.data) return <EditionChoice />;
    return preference.error ? (
      <Alert
        type="error"
        message={preference.error.message}
        action={
          <Button onClick={() => preference.refetch()}>重新读取偏好</Button>
        }
      />
    ) : (
      <Spin />
    );
  }
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
const router = createBrowserRouter(
  [
    {
      path: '*',
      element: (
        <>
          <NavigationGuard />
          <Root />
        </>
      ),
    },
  ],
  { basename: edition.base || undefined },
);
createRoot(document.getElementById('root')!).render(
  <ConfigProvider locale={zhCN} theme={editionTheme(edition)}>
    <AntApp>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AntApp>
  </ConfigProvider>,
);

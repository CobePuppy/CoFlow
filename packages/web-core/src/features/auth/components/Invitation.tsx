import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Spin, App } from 'antd';
export function Invitation({
  token,
  user,
  request,
  onLogin,
}: {
  token: string;
  user: any;
  request: (path: string, method?: string, body?: any) => Promise<any>;
  onLogin: () => void;
}) {
  const { message } = App.useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [registered, setRegistered] = useState(false);
  const q = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => request(`/invitations/${token}/preview`),
    retry: false,
  });
  const leave = () => {
    sessionStorage.removeItem('huiliu-invite');
    history.replaceState(null, '', '/');
    location.reload();
  };
  return (
    <div className="login">
      <Card className="invite-card">
        <div className="brand">汇流</div>
        <h2>{registered ? '邀请已接受' : '加入团队，一起把想法交付'}</h2>
        {q.isPending ? (
          <Spin />
        ) : q.error ? (
          <Alert type="error" message={q.error.message} />
        ) : registered ? (
          <>
            <Alert
              type="success"
              message="账号已创建并加入团队，请使用受邀邮箱登录"
            />
            <Button type="primary" onClick={leave}>
              前往登录
            </Button>
          </>
        ) : (
          <>
            <p className="muted">你受邀加入「{q.data.workspaceName}」</p>
            <p>受邀邮箱：{q.data.email}</p>
            {error && <Alert type="error" message={error} />}
            {user ? (
              <>
                <p>当前登录：{user.email}</p>
                <Button
                  loading={busy}
                  type="primary"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await request('/invitations/accept', 'POST', { token });
                      message.success('已加入团队');
                      leave();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  接受邀请
                </Button>
              </>
            ) : (
              <Form
                layout="vertical"
                onFinish={async (v) => {
                  setBusy(true);
                  try {
                    await request('/auth/register-invitation', 'POST', {
                      token,
                      ...v,
                    });
                    setRegistered(true);
                    onLogin();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Form.Item
                  name="name"
                  label="姓名"
                  rules={[{ required: true, max: 80 }]}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  name="password"
                  label="设置密码"
                  rules={[{ required: true, min: 8, max: 200 }]}
                >
                  <Input.Password />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={busy}>
                  创建账号并接受邀请
                </Button>
                <Button
                  type="link"
                  onClick={() => {
                    sessionStorage.setItem('huiliu-invite', token);
                    history.replaceState(null, '', '/');
                    location.reload();
                  }}
                >
                  已有账号，先登录
                </Button>
              </Form>
            )}
          </>
        )}
        <p className="muted small">加入团队后，管理员将为你分配项目与角色。</p>
      </Card>
    </div>
  );
}

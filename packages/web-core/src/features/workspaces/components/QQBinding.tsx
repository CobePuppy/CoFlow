import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Space, Typography } from 'antd';

export function QQBinding({
  workspaceId,
  request,
}: {
  workspaceId: string;
  request: any;
}) {
  const { message } = App.useApp();
  const [code, setCode] = useState<{
    code: string;
    expiresAt: string;
    workspaceId: string;
  } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code]);
  const expired = !!code && Date.parse(code.expiresAt) <= now;
  const [busy, setBusy] = useState(false);
  const base = `/workspaces/${workspaceId}/qq-binding`;
  const binding = useQuery<{
    qq: string | null;
    configured?: boolean;
    enabled?: boolean;
  }>({
    queryKey: ['qq-binding', workspaceId],
    queryFn: () => request(base),
    enabled: !!workspaceId,
    retry: false,
    refetchInterval: code && !expired ? 3000 : false,
  });
  async function change(remove = false) {
    setBusy(true);
    try {
      if (remove) {
        await request(base, 'DELETE');
        setCode(null);
      } else
        setCode({
          ...(await request(base + '/code', 'POST', {})),
          workspaceId,
        });
      await binding.refetch();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Alert
      style={{ marginBottom: 20 }}
      type="info"
      showIcon
      message="我的 QQ 工作提醒"
      description={
        <Space direction="vertical">
          {binding.isPending ? (
            '正在获取绑定状态…'
          ) : binding.error ? (
            <span>{binding.error.message}</span>
          ) : (
            <>
              <span>
                {binding.data?.qq
                  ? `已绑定 QQ：${binding.data.qq}。机器人将私信汇总待办。`
                  : '绑定后，私信机器人发送 /工作 查询个人待办，并接收定时提醒。'}
              </span>
              {code?.workspaceId === workspaceId &&
                !binding.data?.qq &&
                !expired && (
                  <>
                    <Typography.Text
                      copyable
                    >{`/工作 绑定 ${code.code}`}</Typography.Text>
                    <span>
                      请将上方指令私信给机器人，有效期至{' '}
                      {new Date(code.expiresAt).toLocaleTimeString('zh-CN')}
                      。绑定码仅供本人使用，重新生成后旧码失效。
                    </span>
                  </>
                )}
              {expired && !binding.data?.qq && (
                <span>绑定码已过期，请重新生成。</span>
              )}
              {binding.data?.enabled === false && (
                <span>团队集成未启用，请联系管理员；已有绑定仍可解除。</span>
              )}
              <Space wrap>
                <Button
                  loading={busy}
                  disabled={
                    !binding.data?.qq && binding.data?.enabled === false
                  }
                  onClick={() => change(!!binding.data?.qq)}
                >
                  {binding.data?.qq ? '解除 QQ 绑定' : '生成绑定码'}
                </Button>
                {!binding.data?.qq && code?.workspaceId === workspaceId && (
                  <Button loading={busy} onClick={() => change(true)}>
                    撤销绑定码
                  </Button>
                )}
              </Space>
            </>
          )}
          <Button onClick={() => binding.refetch()}>刷新绑定状态</Button>
        </Space>
      }
    />
  );
}

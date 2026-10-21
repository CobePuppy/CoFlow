import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Space,
  Typography,
  Collapse,
  Tag,
} from 'antd';
import { api, useData } from '../../../shared/api/runtime.js';
export function GitHubAccountConnection({
  onChange,
}: {
  onChange?: () => void;
}) {
  const account = useData(['githubAccount'], '/github/account');
  const [device, setDevice] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false),
    [checked, setChecked] = useState<{
      login: string;
      checkedAt: string;
      visibleInstallations: number;
    }>();
  useEffect(() => setChecked(undefined), [account.data?.login]);
  const { modal } = App.useApp();
  const generation = useRef(0);
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        if (device.expiresAt <= Date.now()) {
          setDevice(null);
          setError('验证码已过期，请重新登录授权');
          return;
        }
        try {
          const result = await api('/github/device/poll', 'POST', {});
          if (cancelled) return;
          if (result.pending)
            setDevice((d: any) =>
              d ? { ...d, interval: result.interval } : null,
            );
          else {
            setDevice(null);
            await account.refetch();
            changed.current?.();
          }
        } catch (e: any) {
          if (!cancelled) {
            setDevice(null);
            setError(e.message);
          }
        }
      },
      Math.max(5, device.interval) * 1000,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [device]);
  async function login() {
    // Open synchronously so browser popup rules do not block the login tab.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    const attempt = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const d = await api('/github/device', 'POST', {});
      if (attempt !== generation.current) {
        tab?.close();
        return;
      }
      setDevice(d);
      if (tab) tab.location.href = 'https://github.com/login/device';
    } catch (e: any) {
      tab?.close();
      if (attempt === generation.current) setError(e.message);
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }
  return (
    <Card size="small" title="GitHub 账号授权">
      <p>
        ① 登录 GitHub 并输入验证码 → ② 授权应用访问仓库 → ③
        返回此页选择仓库并保存。
      </p>
      <p className="muted">
        公开仓库可直接填写地址。私有仓库需要每位成员连接自己的账号，并授权对应仓库。CoFlow
        仅读取资料。
      </p>
      {account.data?.configuration && (
        <div aria-label="GitHub配置诊断">
          <Space wrap>
            <Tag color={account.data.configured ? 'green' : 'orange'}>
              {account.data.configured ? '服务端参数齐备' : '服务端参数待配置'}
            </Tag>
            <Tag>
              {account.data.login ? '已有个人账号记录' : '尚未连接个人账号'}
            </Tag>
          </Space>
          <ul>
            <li>
              应用客户端标识：
              {account.data.configuration.clientId
                ? '已配置'
                : '缺失，需平台维护者配置'}
            </li>
            <li>
              授权凭据加密：
              {account.data.configuration.encryption
                ? '配置有效'
                : '缺失或格式无效，需平台维护者处理'}
            </li>
            <li>
              仓库安装入口：
              {account.data.configuration.installationLink
                ? '已配置'
                : '未配置，可联系平台维护者补齐'}
            </li>
          </ul>
          <p className="muted">
            参数齐备不代表 GitHub
            端设备流程已启用。设备流程在连接时验证；具体仓库权限在选择和读取仓库时验证。
          </p>
          <Collapse
            size="small"
            items={[
              {
                key: 'setup',
                label: '平台维护者配置说明',
                children: (
                  <>
                    <p>
                      在 GitHub App 设置启用 Device
                      flow，按需授予只读权限并安装到指定仓库；在实际运行的后端配置
                      GITHUB_APP_CLIENT_ID、GITHUB_APP_SLUG 和
                      SETTINGS_ENCRYPTION_KEY 后重启服务。
                    </p>
                    <p>
                      Client ID 与 App ID
                      不同。加密密钥须为64位十六进制字符；已有有效密钥应保留，替换会影响原有加密凭据。此处只显示配置状态，不展示或修改密钥。
                    </p>
                    <a
                      href="https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-device-flow-to-generate-a-user-access-token"
                      target="_blank"
                      rel="noreferrer"
                    >
                      查看 GitHub 官方设备授权说明
                    </a>
                  </>
                ),
              },
            ]}
          />
        </div>
      )}
      {account.isLoading ? (
        <p>正在读取账号状态…</p>
      ) : account.data?.login ? (
        <Space wrap>
          <strong>已连接 @{account.data.login}</strong>
          <Button
            aria-label="验证当前账号授权"
            disabled={busy || !account.data.configured || checking}
            loading={checking}
            onClick={async () => {
              setChecking(true);
              setError('');
              setChecked(undefined);
              try {
                setChecked(await api('/github/account/check', 'POST', {}));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setChecking(false);
              }
            }}
          >
            验证当前账号授权
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              modal.confirm({
                title: '断开当前 GitHub 账号？',
                content:
                  '将删除 CoFlow 保存的授权。完整撤销请前往 GitHub Settings → Applications。',
                onOk: async () => {
                  setBusy(true);
                  try {
                    generation.current++;
                    setDevice(null);
                    await api('/github/account', 'DELETE', {});
                    await account.refetch();
                    changed.current?.();
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                },
              })
            }
          >
            断开账号
          </Button>
        </Space>
      ) : (
        <Button
          type="primary"
          loading={busy}
          disabled={!account.data?.configured || !!device}
          onClick={login}
        >
          登录 GitHub 并连接
        </Button>
      )}
      {account.data && !account.data.configured && (
        <Alert
          type="info"
          showIcon
          message="GitHub 登录尚未启用"
          description="请联系管理员配置 GitHub App 并启用设备授权；公开仓库仍可直接填写地址连接。"
        />
      )}
      {checked && (
        <Alert
          type="success"
          message={'账号授权已验证：@' + checked.login}
          description={
            <>
              <p>
                可见应用安装 {checked.visibleInstallations} 项 ·{' '}
                {new Date(checked.checkedAt).toLocaleString('zh-CN')}
              </p>
              <p>
                {checked.visibleInstallations
                  ? '请选择已授权仓库，具体读取权限仍需逐仓库验证。'
                  : '当前没有可见应用安装，请安装应用或调整仓库授权范围。'}
              </p>
            </>
          }
        />
      )}
      {device && (
        <Alert
          type="info"
          showIcon
          message="等待 GitHub 授权"
          description={
            <>
              <p>
                在新打开的 GitHub 页面登录，然后输入验证码：
                <Typography.Text copyable>{device.code}</Typography.Text>
              </p>
              <Space wrap>
                <a
                  href="https://github.com/login/device"
                  target="_blank"
                  rel="noreferrer"
                >
                  前往 GitHub 输入设备码
                </a>
                <Button size="small" onClick={() => setDevice(null)}>
                  取消等待
                </Button>
              </Space>
              <p>
                若页面未打开，请点击上面的链接。授权完成后本页自动更新，再选择仓库。
              </p>
            </>
          }
        />
      )}
      {account.data?.installationUrl && (
        <p>
          <a
            href={account.data.installationUrl}
            target="_blank"
            rel="noreferrer"
          >
            安装或调整仓库授权
          </a>{' '}
          · 选择允许 CoFlow 读取的个人或组织仓库
        </p>
      )}
      {(error || account.error) && (
        <Alert
          type="error"
          message={error || account.error?.message}
          action={<Button onClick={() => account.refetch()}>刷新账号</Button>}
        />
      )}
    </Card>
  );
}

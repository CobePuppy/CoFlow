import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Switch,
} from 'antd';
import { api, useData, client } from '../../shared/api/runtime.js';
import { QQBinding } from '../workspaces/components/QQBinding.js';
function TeamQQ({ workspaceId }: { workspaceId: string }) {
  const query = useData(
    ['qq-integration', workspaceId],
    `/workspaces/${workspaceId}/qq-integration`,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const data = query.data;
  if (query.error)
    return (
      <Alert
        type="error"
        message={query.error.message}
        action={<Button onClick={() => query.refetch()}>重试</Button>}
      />
    );
  if (!data) return <p>正在读取团队集成状态…</p>;
  return (
    <Card title="团队 QQAgent 集成" style={{ marginTop: 16 }}>
      <Alert
        type={data.enabled && data.configured ? 'success' : 'info'}
        message={
          data.enabled && data.configured
            ? '服务端已启用，需确认机器人插件已连接'
            : '团队集成尚未启用'
        }
        description="此状态表示服务端配置，不代表QQ机器人在线。个人绑定按团队隔离；停用后仍可解除绑定。"
      />
      {!data.canManage ? (
        <p>
          仅团队管理员可修改连接与提醒策略。当前提醒时刻：{data.pushTimes}
          （北京时间）；定时提醒{data.pushEnabled ? '开启' : '关闭'}。
        </p>
      ) : (
        <>
          <p>
            先在QQAgent安装CoFlow插件，将下方团队ID和同一专用令牌填入插件；新版插件开启“从CoFlow同步提醒策略”。
          </p>
          <p>
            团队ID：
            <Input value={workspaceId} readOnly aria-label="QQAgent团队ID" />
          </p>
          <p>
            接口路径：<code>/api/v1/integrations/qq</code>
            （同机可用HTTP，跨机器用HTTPS；使用实际CoFlow API地址）
          </p>
          <p>
            凭据状态：
            {data.configured ? data.tokenHint || '已配置' : '尚未配置'}；来源：
            {data.source === 'DATABASE' ? '团队设置' : '服务端环境变量兼容配置'}
          </p>
          <Form
            key={data.version}
            form={form}
            layout="vertical"
            initialValues={data}
            disabled={busy}
            onFinish={async (values) => {
              setBusy(true);
              setError('');
              try {
                await api(
                  `/workspaces/${workspaceId}/qq-integration`,
                  'PATCH',
                  {
                    enabled: values.enabled,
                    pushEnabled: values.pushEnabled,
                    pushTimes: values.pushTimes,
                    webUrl: values.webUrl,
                    accessToken: values.accessToken?.trim() || undefined,
                    expectedVersion: data.version,
                  },
                );
                form.setFieldValue('accessToken', '');
                await query.refetch();
                await client.invalidateQueries({
                  queryKey: ['qq-binding', workspaceId],
                });
                message.success(
                  '团队集成已保存；替换令牌后请同步更新机器人插件',
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Form.Item
              name="enabled"
              label="启用此团队的QQ集成"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="accessToken"
              label="机器人专用令牌（留空保留原值）"
              rules={[{ min: 32, max: 256 }]}
            >
              <Input.Password aria-label="QQAgent专用令牌" autoComplete="off" />
            </Form.Item>
            <Space wrap style={{ marginBottom: 12 }}>
              <Button
                onClick={() => {
                  const bytes = crypto.getRandomValues(new Uint8Array(32));
                  form.setFieldValue(
                    'accessToken',
                    Array.from(bytes, (b) =>
                      b.toString(16).padStart(2, '0'),
                    ).join(''),
                  );
                  message.success('已生成新令牌，请复制到机器人插件后保存');
                }}
              >
                生成随机专用令牌
              </Button>
              <Button
                onClick={async () => {
                  const token = form.getFieldValue('accessToken');
                  if (!token) {
                    message.info(
                      '请先生成或输入本次令牌；已保存的令牌无法回显',
                    );
                    return;
                  }
                  try {
                    await navigator.clipboard.writeText(token);
                    message.success('已复制，请妥善保存');
                  } catch {
                    message.error('无法复制，请在输入框手动复制');
                  }
                }}
              >
                复制本次令牌
              </Button>
            </Space>
            <p className="muted">
              请输入自己生成的32位以上随机字母数字令牌，并同步到QQAgent插件。服务端仅保存摘要，保存后无法回显；不是DeepSeek
              API Key。
            </p>
            <Form.Item
              name="webUrl"
              label="QQ消息中的CoFlow网站地址"
              rules={[{ required: true, type: 'url' }]}
            >
              <Input placeholder="https://你的域名/student/" />
            </Form.Item>
            <Form.Item
              name="pushEnabled"
              label="允许定时私信提醒"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="pushTimes"
              label="北京时间提醒时刻"
              rules={[
                {
                  required: true,
                  pattern:
                    /^(?:[01]\d|2[0-3]):[0-5]\d(?:,(?:[01]\d|2[0-3]):[0-5]\d){0,5}$/,
                  message: '使用HH:mm，英文逗号分隔，最多6个',
                },
              ]}
            >
              <Input placeholder="09:00,18:00" />
            </Form.Item>
            <p>
              服务端关闭提醒后不再返回定时接收人；手动查询仍可用。提醒时刻同步需要新版插件开启同步选项，旧插件仍使用本地时刻。
            </p>
            {error && <Alert type="error" message={error} />}
            <Space wrap>
              <Button type="primary" htmlType="submit" loading={busy}>
                保存团队QQ配置
              </Button>
              <Button disabled={busy} onClick={() => query.refetch()}>
                刷新团队配置
              </Button>
            </Space>
          </Form>
        </>
      )}
    </Card>
  );
}
export default function QQSettings() {
  const teams = useData(['workspaces'], '/workspaces');
  const [params, setParams] = useSearchParams();
  const selected = params.get('workspace'),
    items = teams.data || [];
  const workspaceId = items.some((t: any) => t.id === selected)
    ? selected
    : items[0]?.id;
  return (
    <section>
      <h2>QQ绑定与团队集成</h2>
      <p>选择团队后绑定个人QQ；团队管理员可配置机器人连接与提醒。</p>
      {teams.error && (
        <Alert
          type="error"
          message={teams.error.message}
          action={<Button onClick={() => teams.refetch()}>重试</Button>}
        />
      )}
      <Select
        aria-label="QQ设置团队"
        style={{ width: '100%', maxWidth: 420, marginBottom: 16 }}
        value={workspaceId}
        loading={teams.isPending}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          next.set('workspace', value);
          next.delete('project');
          setParams(next);
        }}
        options={items.map((t: any) => ({ value: t.id, label: t.name }))}
      />
      {workspaceId ? (
        <>
          <QQBinding
            key={workspaceId}
            workspaceId={workspaceId}
            request={api}
          />
          <TeamQQ key={'team-' + workspaceId} workspaceId={workspaceId} />
        </>
      ) : (
        !teams.isPending && (
          <Alert type="info" message="加入团队后可配置QQ集成" />
        )
      )}
    </section>
  );
}

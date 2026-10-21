import AboutCoFlow from './AboutCoFlow.js';
import { ArrowLeftOutlined } from '@ant-design/icons';
import QQSettings from './QQSettings.js';
import { Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Tabs,
  Popconfirm,
} from 'antd';
import { api, client, useData } from '../../shared/api/runtime.js';
import { editionHome, edition } from '../../app/edition.js';
import { editionDestination } from './edition-navigation.js';
import {
  discardUnsavedChanges,
  useUnsavedChanges,
} from '../../shared/lib/unsaved.js';
export default function Settings() {
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('settingsTab') || '';
  const tab = ['profile', 'ai', 'preferences', 'qq', 'about'].includes(
    requestedTab,
  )
    ? requestedTab
    : 'profile';
  const query = useData(['settings'], '/settings');
  const { message, modal } = App.useApp();
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const selectedEdition = Form.useWatch('preferredEdition', form);
  const data = query.data;
  async function save(removeKey = false) {
    setBusy(true);
    setError('');
    try {
      const values = await form.validateFields();
      const next = await api('/settings', 'PATCH', {
        ...values,
        apiKey: removeKey ? undefined : values.apiKey?.trim() || undefined,
        removeKey,
        expectedVersion: data.version,
      });
      client.setQueryData(['settings'], next);
      setDirty(false);
      form.setFieldValue('apiKey', '');
      await client.invalidateQueries({ queryKey: ['me'] });
      message.success(removeKey ? '已删除保存的Key' : '设置已保存');
    } catch (e) {
      setError((e as Error).message || '请检查表单');
    } finally {
      setBusy(false);
    }
  }
  if (query.isPending) return <Spin />;
  if (!data)
    return (
      <Alert
        type="error"
        message={query.error?.message}
        action={<Button onClick={() => query.refetch()}>重试</Button>}
      />
    );
  return (
    <main style={{ maxWidth: 1040, margin: '32px auto', padding: '0 20px' }}>
      <Space>
        <Link to="/" className="action-link action-link-back">
          <ArrowLeftOutlined aria-hidden />
          返回工作台
        </Link>
        <h1>个人设置</h1>
      </Space>
      <p>配置属于当前账号，在学生版、企业版及所有项目和竞赛中长期复用。</p>
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button
              onClick={async () => {
                const fresh = await query.refetch();
                if (fresh.data) {
                  form.setFieldsValue({ ...fresh.data, apiKey: '' });
                  setError('');
                }
              }}
            >
              刷新设置
            </Button>
          }
        />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={data}
        disabled={busy}
        onValuesChange={() => setDirty(true)}
      >
        <Tabs
          activeKey={tab}
          onChange={(value) => {
            const next = new URLSearchParams(params);
            next.set('settingsTab', value);
            setParams(next);
          }}
          items={[
            { key: 'qq', label: 'QQ与团队集成', children: null },
            {
              key: 'profile',
              label: '个人资料',
              forceRender: true,
              children: (
                <Card title="账号资料">
                  <Form.Item
                    name="name"
                    label="显示名称"
                    rules={[{ required: true, whitespace: true, max: 100 }]}
                  >
                    <Input />
                  </Form.Item>
                  <p>登录邮箱：{data.email}</p>
                  <p className="muted">邮箱用于账号识别，暂不支持自行更换。</p>
                </Card>
              ),
            },
            {
              key: 'ai',
              label: 'AI 服务',
              forceRender: true,
              children: (
                <Card title="DeepSeek · 个人API配置">
                  <Alert
                    type={data.hasKey ? 'success' : 'info'}
                    showIcon
                    message={
                      data.hasKey
                        ? '已保存Key：' + data.keyHint
                        : '尚未配置API Key'
                    }
                    description="一次配置，所有竞赛复用。服务器加密保存，页面不会回显完整Key，不与团队成员共享。"
                  />
                  {!data.encryptionReady && (
                    <Alert
                      type="warning"
                      message="管理员尚未配置加密服务，暂不能保存或调用Key"
                    />
                  )}
                  <p>
                    ①{' '}
                    <a
                      href="https://platform.deepseek.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      前往DeepSeek官方平台创建API Key
                    </a>{' '}
                    → ② 检查API余额 → ③ 保存 → ④
                    验证连接。聊天订阅与API额度分开。
                  </p>
                  <Form.Item
                    name="apiKey"
                    label={
                      data.hasKey
                        ? '替换API Key（留空保留原值）'
                        : 'DeepSeek API Key'
                    }
                  >
                    <Input.Password
                      aria-label="DeepSeek API Key"
                      autoComplete="off"
                      disabled={!data.encryptionReady || busy}
                    />
                  </Form.Item>
                  <Form.Item name="model" label="默认模型">
                    <Select
                      options={[
                        { value: 'deepseek-flash', label: 'DeepSeek Flash' },
                        { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
                      ]}
                    />
                  </Form.Item>
                  <Space wrap>
                    <Button
                      disabled={!data.hasKey || busy}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          await api('/settings/ai/verify', 'POST', {});
                          message.success('已保存的Key与模型可用');
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      验证已保存配置
                    </Button>
                    <Popconfirm
                      title="删除账号保存的API Key？"
                      onConfirm={() => save(true)}
                    >
                      <Button danger disabled={!data.hasKey || busy}>
                        删除API Key
                      </Button>
                    </Popconfirm>
                  </Space>
                  <p className="muted">
                    验证只查询模型列表，不发送赛题。生成前仍会确认资料发送与计费。修改模型后请先保存再验证。
                  </p>
                </Card>
              ),
            },
            {
              key: 'preferences',
              label: '使用偏好',
              forceRender: true,
              children: (
                <Card title="产品版本与使用偏好">
                  <Form.Item
                    name="slides"
                    hidden={!edition.capabilities.competitions}
                    label="默认PPT页数"
                    rules={[{ required: true }]}
                  >
                    <InputNumber min={5} max={30} />
                  </Form.Item>
                  <Form.Item
                    name="minutes"
                    hidden={!edition.capabilities.competitions}
                    label="默认答辩分钟数"
                    rules={[{ required: true }]}
                  >
                    <InputNumber min={3} max={30} />
                  </Form.Item>
                  <p>
                    当前使用：{edition.label}
                    。切换只改变产品界面，不改变团队、项目及权限。
                  </p>
                  <Form.Item name="preferredEdition" label="默认产品版本">
                    <Select
                      options={[
                        { value: 'student', label: '学生版' },
                        { value: 'enterprise', label: '企业版' },
                      ]}
                    />
                  </Form.Item>
                  <Button
                    disabled={
                      busy ||
                      (selectedEdition || data.preferredEdition) === edition.id
                    }
                    onClick={() => {
                      const target =
                        (selectedEdition || data.preferredEdition) === 'student'
                          ? 'student'
                          : 'enterprise';
                      const go = () => {
                        discardUnsavedChanges();
                        setDirty(false);
                        location.assign(
                          editionDestination(target, location.href),
                        );
                      };
                      if (dirty)
                        modal.confirm({
                          title: '有未保存的设置',
                          content:
                            '继续切换将放弃未保存的修改。要设为默认版本，请先保存设置。',
                          okText: '放弃修改并切换',
                          onOk: go,
                        });
                      else go();
                    }}
                  >
                    切换到所选版本
                  </Button>
                  <p>
                    保存设置后，统一入口会采用默认版本；明确的学生版或企业版链接保持原版本。切换不会复制数据或改变项目流程。
                  </p>
                </Card>
              ),
            },
            { key: 'about', label: '关于汇流', children: <AboutCoFlow /> },
          ]}
        />
        <Button
          type="primary"
          loading={busy}
          onClick={() => save()}
          style={{
            margin: '16px 0',
            display: ['qq', 'about'].includes(tab) ? 'none' : undefined,
          }}
        >
          保存设置
        </Button>
      </Form>
      {tab === 'qq' && <QQSettings />}
      <Card
        title="账号安全 · 修改密码"
        style={{ display: ['qq', 'about'].includes(tab) ? 'none' : undefined }}
      >
        <Form
          form={passwordForm}
          onValuesChange={() => setDirty(true)}
          layout="vertical"
          onFinish={async (values) => {
            setBusy(true);
            setError('');
            try {
              await api('/settings/password', 'POST', {
                currentPassword: values.currentPassword,
                newPassword: values.newPassword,
              });
              passwordForm.resetFields();
              message.success('密码已更新，其他设备会话已退出');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item
            name="currentPassword"
            label="当前密码"
            rules={[{ required: true }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[{ required: true, min: 12, max: 200 }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="再次输入新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, v) {
                  return v === getFieldValue('newPassword')
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button htmlType="submit" loading={busy}>
            修改密码并退出其他设备
          </Button>
        </Form>
      </Card>
    </main>
  );
}

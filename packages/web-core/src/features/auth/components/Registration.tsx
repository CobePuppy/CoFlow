import React, { useState } from 'react';
import { Alert, Button, Form, Input, Radio, App, Typography } from 'antd';

export function Registration({
  request,
  onComplete,
}: {
  request: (url: string, method?: string, body?: any) => Promise<any>;
  onComplete: () => void;
}) {
  const [kind, setKind] = useState('creator');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { message } = App.useApp();
  if (result)
    return (
      <div className="registration-result">
        <Alert
          type="success"
          showIcon
          message={
            kind === 'creator' ? '账号与团队已创建' : '注册成功，已加入团队'
          }
          description={result.workspaceName}
        />
        {result.teamCode && (
          <div className="team-code-result">
            <p>将团队码分享给伙伴，注册时即可加入团队</p>
            <Typography.Title level={3} copyable>
              {result.teamCode}
            </Typography.Title>
          </div>
        )}
        <Button type="primary" block size="large" onClick={onComplete}>
          前往登录
        </Button>
      </div>
    );
  return (
    <Form
      layout="vertical"
      onFinish={async (values) => {
        setBusy(true);
        try {
          setResult(
            await request('/auth/register', 'POST', { ...values, kind }),
          );
        } catch (error) {
          message.error((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Radio.Group
        className="registration-kind"
        value={kind}
        onChange={(event) => setKind(event.target.value)}
        optionType="button"
        buttonStyle="solid"
        options={[
          { label: '我是团队创建者', value: 'creator' },
          { label: '我是团队队员', value: 'member' },
        ]}
      />
      <p className="muted">
        {kind === 'creator'
          ? '创建账号与团队，获取专属团队码。'
          : '填写创建者分享的团队码，加入你的团队。'}
      </p>
      <Form.Item
        label="姓名"
        name="name"
        rules={[{ required: true, whitespace: true, max: 80 }]}
      >
        <Input size="large" autoComplete="name" />
      </Form.Item>
      <Form.Item
        label="邮箱"
        name="email"
        rules={[{ required: true, type: 'email' }]}
      >
        <Input size="large" autoComplete="email" />
      </Form.Item>
      <Form.Item
        label="设置密码"
        name="password"
        rules={[
          {
            required: true,
            min: 8,
            max: 200,
            message: '密码至少 8 位，最多 200 位',
          },
        ]}
      >
        <Input.Password
          size="large"
          autoComplete="new-password"
          placeholder="至少 8 位"
        />
      </Form.Item>
      <Form.Item
        label="确认密码"
        name="confirmPassword"
        dependencies={['password']}
        rules={[
          { required: true, message: '请再次输入密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              return value === getFieldValue('password')
                ? Promise.resolve()
                : Promise.reject(new Error('两次密码不一致'));
            },
          }),
        ]}
      >
        <Input.Password size="large" autoComplete="new-password" />
      </Form.Item>
      {kind === 'creator' ? (
        <Form.Item
          key="teamName"
          label="团队名称"
          name="teamName"
          preserve={false}
          rules={[{ required: true, whitespace: true, max: 100 }]}
        >
          <Input size="large" placeholder="为你的团队取个名字" />
        </Form.Item>
      ) : (
        <Form.Item
          key="teamCode"
          label="团队码"
          name="teamCode"
          preserve={false}
          rules={[
            {
              required: true,
              pattern: /^\s*[A-Fa-f0-9]{12}\s*$/,
              message: '请输入 12 位团队码',
            },
          ]}
        >
          <Input size="large" placeholder="向团队创建者获取" />
        </Form.Item>
      )}
      <Button
        type="primary"
        block
        size="large"
        htmlType="submit"
        loading={busy}
      >
        {kind === 'creator' ? '注册并创建团队' : '注册并加入团队'}
      </Button>
    </Form>
  );
}

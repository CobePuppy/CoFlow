import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Dropdown,
  Form,
  Input,
  Modal,
  Space,
  Tabs,
  Tag,
} from 'antd';
import {
  DownOutlined,
  LoginOutlined,
  PlusOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { api, useData } from '../../../shared/api/runtime.js';

export function TeamAccess({ onSelect }: { onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('teams');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const teams = useData(['workspaces'], '/workspaces');
  const qc = useQueryClient();
  async function submit(path: string, values: any) {
    setBusy(true);
    setError('');
    try {
      const team = await api(path, 'POST', values);
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      setOpen(false);
      onSelect(team.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{
          onClick: ({ key }) => {
            setError('');
            setTab(key);
            setOpen(true);
          },
          items: [
            {
              key: 'join',
              icon: <LoginOutlined aria-hidden />,
              label: '加入其他团队',
            },
            {
              key: 'create',
              icon: <PlusOutlined aria-hidden />,
              label: '创建新团队',
            },
            { type: 'divider' },
            {
              key: 'teams',
              icon: <TeamOutlined aria-hidden />,
              label: '我的团队',
            },
          ],
        }}
      >
        <Button>
          团队操作 <DownOutlined aria-hidden />
        </Button>
      </Dropdown>
      <Modal
        open={open}
        title="我的团队"
        footer={null}
        onCancel={() => !busy && setOpen(false)}
        destroyOnHidden
        maskClosable={!busy}
        closable={!busy}
        keyboard={!busy}
      >
        <p className="muted">
          同一账号可加入多个团队，管理员和成员身份在各团队内独立生效。
        </p>
        {error && <Alert type="error" message={error} />}
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'teams',
              label: '已加入团队',
              children: (
                <>
                  {teams.error && (
                    <Alert type="error" message={teams.error.message} />
                  )}
                  {teams.data?.map((team: any) => (
                    <div className="dashboard-row" key={team.id}>
                      <Space wrap>
                        <strong>{team.name}</strong>
                        <Tag>{team.role === 'ADMIN' ? '管理员' : '成员'}</Tag>
                      </Space>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setOpen(false);
                          onSelect(team.id);
                        }}
                      >
                        切换到此团队
                      </Button>
                    </div>
                  ))}
                </>
              ),
            },
            {
              key: 'join',
              label: '加入团队',
              children: (
                <Form
                  layout="vertical"
                  disabled={busy}
                  onFinish={(v) => submit('/workspaces/join', v)}
                >
                  <Form.Item
                    name="teamCode"
                    label="团队码"
                    rules={[
                      { required: true, message: '请填写团队码' },
                      {
                        pattern: /^[A-Fa-f0-9]{12}$/,
                        message: '请填写12位团队码',
                      },
                    ]}
                    normalize={(v: string) => v.trim().toUpperCase()}
                  >
                    <Input
                      placeholder="向目标团队管理员获取团队码"
                      maxLength={12}
                      autoComplete="off"
                    />
                  </Form.Item>
                  <p className="muted">
                    以成员身份加入新团队，原有团队及身份保持不变。再次输入已加入团队的团队码会切换到该团队。
                  </p>
                  <Button type="primary" htmlType="submit" loading={busy}>
                    加入团队
                  </Button>
                </Form>
              ),
            },
            {
              key: 'create',
              label: '创建团队',
              children: (
                <Form
                  layout="vertical"
                  disabled={busy}
                  onFinish={(v) => submit('/workspaces', v)}
                >
                  <Form.Item
                    name="name"
                    label="团队名称"
                    rules={[
                      {
                        required: true,
                        whitespace: true,
                        message: '请填写团队名称',
                      },
                      { max: 100 },
                    ]}
                  >
                    <Input maxLength={100} />
                  </Form.Item>
                  <p className="muted">
                    创建后成为新团队的管理员，不影响已有团队身份。
                  </p>
                  <Button type="primary" htmlType="submit" loading={busy}>
                    创建团队
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      </Modal>
    </>
  );
}

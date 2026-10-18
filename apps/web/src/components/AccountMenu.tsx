import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { App, Avatar, Dropdown } from 'antd';
import {
  EllipsisOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { editionHome } from '../edition.js';
import { api } from '../runtime.js';

export function AccountMenu({
  user,
}: {
  user: { name: string; email: string };
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const link = (tab: string, text: string) => (
    <a href={`${editionHome}?section=settings&settingsTab=${tab}`}>{text}</a>
  );
  return (
    <div className="account-menu-root">
      <Dropdown
        trigger={['click']}
        placement="topLeft"
        open={open}
        onOpenChange={setOpen}
        overlayClassName="account-popup"
        menu={{
          onClick: () => setOpen(false),
          items: [
            {
              key: 'identity',
              disabled: true,
              label: (
                <div className="account-identity">
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </div>
              ),
            },
            { type: 'divider' },
            {
              key: 'profile',
              icon: <UserOutlined aria-hidden />,
              label: link('profile', '个人资料'),
            },
            {
              key: 'ai',
              icon: <ExperimentOutlined aria-hidden />,
              label: link('ai', '个人AI设置'),
            },
            {
              key: 'preferences',
              icon: <SettingOutlined aria-hidden />,
              label: link('preferences', '偏好设置'),
            },
            { type: 'divider' },
            {
              key: 'logout',
              icon: <LogoutOutlined aria-hidden />,
              label: busy ? '正在退出…' : '退出登录',
              disabled: busy,
              onClick: async () => {
                setBusy(true);
                try {
                  await api('/auth/logout', 'POST', {});
                  qc.clear();
                  location.assign(editionHome);
                } catch (e) {
                  message.error((e as Error).message);
                  setBusy(false);
                }
              },
            },
          ],
        }}
      >
        <button
          type="button"
          className="account-trigger"
          aria-label="个人菜单"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Avatar className="account-avatar">{user.name[0]}</Avatar>
          <span>
            <strong>{user.name}</strong>
            <small>个人账户</small>
          </span>
          <EllipsisOutlined aria-hidden />
        </button>
      </Dropdown>
    </div>
  );
}

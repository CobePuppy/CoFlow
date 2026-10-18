import { useState } from 'react';
import {
  Alert,
  App,
  Avatar,
  Button,
  Form,
  Input,
  Modal,
  Popover,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { api, useData } from '../runtime.js';
import { editionHome } from '../edition.js';

type Person = {
  id: string;
  name: string;
  email: string;
  accountName: string;
  displayName?: string;
  role: string;
};
export function TeamMembers({
  wid,
  search = '',
  toolbar = true,
}: {
  wid: string;
  search?: string;
  toolbar?: boolean;
}) {
  const people = useData(
    ['workspaceMembers', wid],
    `/workspaces/${wid}/members`,
    !!wid,
  );
  const me = useData(['me'], '/auth/me');
  const teams = useData(['workspaces'], '/workspaces');
  const admin = people.data?.some(
    (p: Person) => p.id === me.data?.user?.id && p.role === 'ADMIN',
  );
  const [action, setAction] = useState('');
  const [person, setPerson] = useState<Person>();
  const [memberCard, setMemberCard] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const projects = useData(
    ['memberProjects', wid, person?.id],
    `/workspaces/${wid}/members/${person?.id}/projects`,
    !!admin && action === 'project',
  );
  const targets = useData(
    ['memberTransferTargets', wid],
    `/workspaces/${wid}/member-transfer-targets`,
    !!admin && action === 'team',
  );
  const code = useData(
    ['teamCode', wid],
    `/workspaces/${wid}/team-code`,
    !!admin && ['invite', 'settings'].includes(action),
  );
  function open(next: string, member?: Person) {
    setMemberCard('');
    setPerson(member);
    setAction(next);
    setError('');
    setLink('');
    form.resetFields();
    form.setFieldsValue(
      next === 'edit'
        ? { displayName: member?.displayName || '', role: member?.role }
        : next === 'settings'
          ? { name: teams.data?.find((t: any) => t.id === wid)?.name || '' }
          : {},
    );
  }
  async function save(values: any) {
    setBusy(true);
    setError('');
    try {
      const base = `/workspaces/${wid}/members/${person?.id}`;
      if (action === 'invite') {
        const result = await api(
          `/workspaces/${wid}/invitations`,
          'POST',
          values,
        );
        const url = new URL(result.url);
        url.pathname = editionHome;
        setLink(url.href);
        message.success('邀请链接已生成');
      } else {
        if (action === 'edit') await api(base, 'PATCH', values);
        if (action === 'remove') await api(base, 'DELETE', {});
        if (action === 'project') await api(`${base}/move`, 'POST', values);
        if (action === 'team') await api(`${base}/transfer`, 'POST', values);
        if (action === 'settings')
          await api(`/workspaces/${wid}`, 'PATCH', values);
        setAction('');
        message.success('操作已保存');
      }
      await qc.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const titles: Record<string, string> = {
    invite: '邀请成员',
    edit: '修改成员资料',
    remove: '移出团队',
    project: '移动 / 分配项目',
    team: '转移到其他团队',
    settings: '团队设置',
  };
  return (
    <>
      {toolbar && (
        <div className="team-member-toolbar">
          <span className="muted">
            {people.data?.length || 0} 位成员{!admin && ' · 仅管理员可管理'}
          </span>
          <Space wrap>
            <Button disabled={!admin} onClick={() => open('settings')}>
              团队设置
            </Button>
            <Button
              type="primary"
              disabled={!admin}
              onClick={() => open('invite')}
            >
              邀请成员
            </Button>
          </Space>
        </div>
      )}
      {people.error && <Alert type="error" message={people.error.message} />}
      <Table
        rowKey="id"
        loading={people.isPending}
        dataSource={people.data?.filter((p: Person) =>
          `${p.name}${p.email}`.toLowerCase().includes(search.toLowerCase()),
        )}
        scroll={{ x: 520 }}
        columns={[
          {
            title: '成员',
            dataIndex: 'name',
            render: (name: string, member: Person) => (
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={memberCard === member.id}
                onOpenChange={(visible) =>
                  setMemberCard(visible ? member.id : '')
                }
                content={
                  <section
                    className="team-member-card"
                    aria-label="成员资料"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setMemberCard('');
                    }}
                  >
                    <div className="team-member-card-heading">
                      <Avatar size={40}>{name[0]}</Avatar>
                      <div>
                        <strong>{name}</strong>
                        <p>{member.email}</p>
                      </div>
                    </div>
                    <Tag color={member.role === 'ADMIN' ? 'blue' : 'default'}>
                      {member.role === 'ADMIN' ? '管理员' : '成员'}
                    </Tag>
                    {admin && (
                      <div className="team-member-card-actions">
                        {[
                          { key: 'edit', label: '修改资料' },
                          { key: 'project', label: '移动项目' },
                          { key: 'team', label: '转移团队' },
                          { key: 'remove', label: '移出团队' },
                        ].map((item) => (
                          <Button
                            key={item.key}
                            type="text"
                            danger={item.key === 'remove'}
                            onClick={() => open(item.key, member)}
                          >
                            {item.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </section>
                }
              >
                <button
                  type="button"
                  className="team-member-trigger"
                  aria-label={`查看成员 ${name}`}
                  aria-expanded={memberCard === member.id}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setMemberCard('');
                  }}
                >
                  <Avatar size="small">{name[0]}</Avatar>
                  <span>{name}</span>
                </button>
              </Popover>
            ),
          },
          { title: '邮箱', dataIndex: 'email' },
          {
            title: '团队身份',
            dataIndex: 'role',
            render: (role: string) => (
              <Tag color={role === 'ADMIN' ? 'blue' : 'default'}>
                {role === 'ADMIN' ? '管理员' : '成员'}
              </Tag>
            ),
          },
        ]}
      />
      <Modal
        open={!!action}
        title={titles[action]}
        footer={null}
        onCancel={() => !busy && setAction('')}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        destroyOnHidden
      >
        {error && <Alert type="error" showIcon message={error} />}
        {person && (
          <p>
            <strong>{person.name}</strong> · {person.email}
          </p>
        )}
        <Form form={form} layout="vertical" onFinish={save} disabled={busy}>
          {action === 'invite' && (
            <>
              <p>
                按邮箱生成7天有效的邀请链接，由你复制分享；系统不会自动发送邮件。
              </p>
              <Form.Item
                name="email"
                label="受邀邮箱"
                rules={[{ required: true, type: 'email' }]}
              >
                <Input type="email" />
              </Form.Item>
              {link && (
                <Alert
                  type="success"
                  message="邀请链接"
                  description={
                    <>
                      <Input.TextArea
                        aria-label="邀请链接"
                        value={link}
                        readOnly
                        autoSize
                      />
                      <Typography.Text copyable={{ text: link }}>
                        复制邀请链接
                      </Typography.Text>
                    </>
                  }
                />
              )}
            </>
          )}
          {action === 'edit' && (
            <>
              <Alert
                type="info"
                message="仅修改本团队资料。登录邮箱和个人账号资料由本人管理；显示名留空恢复账号姓名。"
              />
              <Form.Item
                name="displayName"
                label="团队内显示名"
                rules={[{ max: 80 }]}
              >
                <Input placeholder={person?.accountName} maxLength={80} />
              </Form.Item>
              <Form.Item
                name="role"
                label="团队身份"
                rules={[{ required: true }]}
              >
                <Select
                  options={[
                    { value: 'ADMIN', label: '管理员' },
                    { value: 'MEMBER', label: '成员' },
                  ]}
                />
              </Form.Item>
            </>
          )}
          {action === 'project' && (
            <>
              <Alert
                type="info"
                message="不选择来源项目即为新增分配；选择来源后会移除该项目成员身份。需求和历史不会移动，有未结束责任时需先转交。"
              />
              {projects.error && (
                <Alert type="error" message={projects.error.message} />
              )}
              <Form.Item name="sourceId" label="来源项目（可选）">
                <Select
                  allowClear
                  loading={projects.isPending}
                  options={projects.data
                    ?.filter((p: any) => p.roles.length && !p.archivedAt)
                    .map((p: any) => ({ value: p.id, label: p.name }))}
                />
              </Form.Item>
              <Form.Item
                name="targetId"
                label="目标项目"
                rules={[{ required: true }]}
              >
                <Select
                  loading={projects.isPending}
                  options={projects.data
                    ?.filter((p: any) => !p.archivedAt)
                    .map((p: any) => ({ value: p.id, label: p.name }))}
                />
              </Form.Item>
              <Form.Item
                name="roles"
                label="目标项目角色"
                rules={[{ required: true }]}
              >
                <Select
                  mode="multiple"
                  options={['PRODUCT', 'ENGINEER', 'QA', 'OPS'].map(
                    (value, i) => ({
                      value,
                      label: ['产品', '研发', '测试', '运维'][i],
                    }),
                  )}
                />
              </Form.Item>
            </>
          )}
          {action === 'team' && (
            <>
              <Alert
                type="warning"
                message="转移后退出当前团队及其项目，清除当前团队QQ绑定，历史记录保留在原团队。目标团队新成员为普通成员，已有身份保留；项目需要重新分配。操作者须同时是两个团队的管理员。"
              />
              {targets.error && (
                <Alert type="error" message={targets.error.message} />
              )}
              {!targets.isPending &&
                !targets.error &&
                !targets.data?.length && (
                  <p>
                    暂无你管理的其他团队，可先通过“团队操作”创建团队或取得目标团队管理员身份。
                  </p>
                )}
              <Form.Item
                name="targetWorkspaceId"
                label="目标团队"
                rules={[{ required: true }]}
              >
                <Select
                  loading={targets.isPending}
                  options={targets.data?.map((t: any) => ({
                    value: t.id,
                    label: t.name,
                  }))}
                />
              </Form.Item>
            </>
          )}
          {action === 'remove' && (
            <Alert
              type="warning"
              message="确定移出此成员？"
              description="将移除其在本团队及所有项目的访问权限，清除本团队QQ绑定并撤销未接受的邮箱邀请。账号、其他团队及历史资料保留。有未结束需求责任时必须先转交；最后一位管理员不可移出。"
            />
          )}
          {action === 'settings' && (
            <Form.Item
              name="name"
              label="团队名称"
              rules={[{ required: true, whitespace: true, max: 80 }]}
            >
              <Input maxLength={80} />
            </Form.Item>
          )}
          {['settings', 'invite'].includes(action) && (
            <div style={{ margin: '16px 0' }}>
              {code.error ? (
                <Alert type="error" message={code.error.message} />
              ) : (
                <>
                  <span>团队码：</span>
                  <Typography.Text copyable>
                    {code.data?.teamCode || '加载中…'}
                  </Typography.Text>
                  <p className="muted">
                    已有账号可在“团队操作 →
                    加入其他团队”中使用；新用户可在注册时使用。仅分享给需要加入的人。
                  </p>
                </>
              )}
            </div>
          )}
          <Button
            type="primary"
            danger={['remove', 'team'].includes(action)}
            htmlType="submit"
            loading={busy}
            disabled={
              (action === 'project' &&
                (!!projects.error || projects.isPending)) ||
              (action === 'team' &&
                (!!targets.error || targets.isPending || !targets.data?.length))
            }
          >
            {action === 'invite'
              ? '生成邀请链接'
              : action === 'remove'
                ? '确认移出'
                : action === 'team'
                  ? '确认转移'
                  : '保存'}
          </Button>
        </Form>
      </Modal>
    </>
  );
}

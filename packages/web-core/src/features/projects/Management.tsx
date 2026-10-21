import { TeamMembers } from '../workspaces/components/TeamMembers.js';
import { FileImport } from '../../app/pages.js';
import { edition, editionHome } from '../../app/edition.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Table,
} from 'antd';
import { useState } from 'react';
import { type Member } from '@coflow/contracts/index.js';
import { api, useData } from '../../shared/api/runtime.js';
export default function Management({ kind, wid, pid, project, onClose }: any) {
  const [projectForm] = Form.useForm();
  const qc = useQueryClient(),
    { message } = AntApp.useApp();
  const me = useData(['me'], '/auth/me');
  const wm = useData(
    ['workspaceMembers', wid],
    `/workspaces/${wid}/members`,
    !!wid,
  );
  const pm = useData(
    ['members', pid],
    `/projects/${pid}/members`,
    !!pid && kind === 'project-members',
  );
  const canManage = wm.data?.some(
    (member: any) => member.id === me.data?.user?.id && member.role === 'ADMIN',
  );
  const [busy, setBusy] = useState(false),
    [link, setLink] = useState(''),
    [error, setError] = useState('');
  async function submit(url: string, body: any, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      const d = await api(url, method, body);
      qc.invalidateQueries();
      message.success('操作已保存');
      if (d?.url) {
        const url = new URL(d.url);
        url.pathname = editionHome;
        d.url = url.href;
      }
      return d;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      width={750}
      title={
        kind === 'project'
          ? '创建项目'
          : kind === 'project-members'
            ? `项目成员 · ${project?.name || ''}`
            : '团队成员管理'
      }
      onCancel={onClose}
      footer={null}
    >
      {error && <Alert type="error" message={error} />}
      {wm.error && <Alert type="error" message={wm.error.message} />}
      {kind === 'project' ? (
        <Form
          form={projectForm}
          layout="vertical"
          initialValues={{
            workflow: edition.defaultWorkflow,
          }}
          onFinish={async (v) => {
            if (await submit(`/workspaces/${wid}/projects`, v)) onClose();
          }}
        >
          <FileImport
            kind="project"
            onApply={(fields: any) =>
              projectForm.setFieldsValue({
                name: fields.name,
                description: fields.description,
              })
            }
          />
          <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="项目介绍">
            <Input.TextArea />
          </Form.Item>
          <Form.Item
            name="workflow"
            label="协作流程"
            extra="简易流程允许一人兼任，适合课程和小团队；标准流程包含方案、独立评估与测试。创建后保留所选流程。"
          >
            <Select
              options={[
                {
                  value: 'SIMPLE',
                  label: '简易：待办 → 进行中 → 待验收 → 完成',
                },
                {
                  value: 'STANDARD',
                  label: '标准：需求 → 方案 → 评估 → 开发 → 测试 → 验收',
                },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            创建项目
          </Button>
        </Form>
      ) : (
        <>
          {kind !== 'project-members' && <TeamMembers key={wid} wid={wid} />}
          {kind === 'project-members' && pid && (
            <>
              <h3>项目角色 · {project?.name}</h3>
              <Form
                layout="vertical"
                disabled={busy || !canManage}
                onFinish={(v) => submit(`/projects/${pid}/members`, v)}
              >
                <Form.Item
                  name="userId"
                  label="选择团队成员"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={wm.data?.map((m: any) => ({
                      value: m.id,
                      label: m.name,
                    }))}
                  />
                </Form.Item>
                <Form.Item
                  name="roles"
                  label="项目角色"
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
                <Button htmlType="submit" loading={busy}>
                  保存成员角色
                </Button>
              </Form>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={pm.data}
                columns={[
                  { title: '成员', dataIndex: 'name' },
                  {
                    title: '角色',
                    render: (_, m: Member) =>
                      m.roles
                        .map(
                          (r) =>
                            ({
                              PRODUCT: '产品',
                              ENGINEER: '研发',
                              QA: '测试',
                              OPS: '运维',
                            })[r],
                        )
                        .join(' / '),
                  },
                  {
                    title: '管理',
                    render: (_, m: Member) => (
                      <Button
                        danger
                        disabled={busy || !canManage}
                        className="action-button"
                        size="small"
                        onClick={() =>
                          submit(
                            `/projects/${pid}/members/${m.id}`,
                            {},
                            'DELETE',
                          )
                        }
                      >
                        移除
                      </Button>
                    ),
                  },
                ]}
              />
              <Button
                danger
                disabled={busy || !canManage}
                onClick={() =>
                  submit(
                    `/projects/${pid}`,
                    { archived: !project?.archivedAt },
                    'PATCH',
                  )
                }
              >
                {project?.archivedAt ? '恢复项目' : '归档项目'}
              </Button>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

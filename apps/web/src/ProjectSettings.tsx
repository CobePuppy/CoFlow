import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Space, App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { api, useData } from './runtime.js';
import { Management, FileImport } from './pages.js';

export default function ProjectSettings({
  project,
  workspaceId,
  onClose,
}: any) {
  const [form] = Form.useForm();
  const me = useData(['me'], '/auth/me');
  const team = useData(
    ['workspaceMembers', workspaceId],
    '/workspaces/' + workspaceId + '/members',
    !!workspaceId,
  );
  const canManage = team.data?.some(
    (m: any) => m.id === me.data?.user?.id && m.role === 'ADMIN',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const { message } = App.useApp();
  async function save(method: string, body: any) {
    setBusy(true);
    setError('');
    try {
      await api('/projects/' + project.id, method, body);
      await qc.invalidateQueries();
      message.success('项目设置已更新');
      onClose(method === 'DELETE');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Modal
        open
        title="项目设置"
        footer={null}
        onCancel={() => !busy && onClose()}
        destroyOnHidden
      >
        {!canManage && (
          <Alert type="info" message="仅团队管理员可修改项目设置" />
        )}
        {error && <Alert type="error" message={error} />}
        <p>
          协作流程：
          {project.workflow === 'SIMPLE'
            ? '简易流程 · 允许一人兼任'
            : '标准流程 · 包含独立评估和测试'}
          。现有需求沿用创建时的流程。
        </p>
        <Form
          form={form}
          layout="vertical"
          initialValues={project}
          onFinish={(v) => save('PATCH', v)}
          disabled={busy || !canManage}
        >
          {canManage && (
            <FileImport
              kind="project"
              onApply={(fields: any) =>
                form.setFieldsValue({
                  name: fields.name,
                  description: fields.description,
                })
              }
            />
          )}
          <Form.Item
            name="name"
            label="项目名称"
            rules={[{ required: true, whitespace: true }, { max: 200 }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="description" label="项目介绍">
            <Input.TextArea rows={3} maxLength={10000} />
          </Form.Item>
          <Space wrap>
            <Button type="primary" htmlType="submit" loading={busy}>
              保存项目信息
            </Button>
            <Button onClick={() => setMembers(true)}>管理项目成员</Button>
            <Button
              onClick={() => save('PATCH', { archived: !project.archivedAt })}
            >
              {project.archivedAt ? '恢复项目' : '归档项目'}
            </Button>
          </Space>
        </Form>
        <hr />
        <p>
          永久删除仅适用于空项目。已有需求、文档、附件、竞赛、模板或分身时请归档，保留协作记录。
        </p>
        <Button
          danger
          disabled={busy || !canManage}
          onClick={() => setDeleting(true)}
        >
          删除项目
        </Button>
        {deleting && (
          <div style={{ marginTop: 16 }}>
            <p>请输入项目名称「{project.name}」确认永久删除。</p>
            <Input
              aria-label="确认删除的项目名称"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
            <Button
              danger
              style={{ marginTop: 12 }}
              disabled={busy || !canManage || confirmation !== project.name}
              onClick={() => save('DELETE', { confirmName: confirmation })}
            >
              确认永久删除
            </Button>
          </div>
        )}
      </Modal>
      {members && (
        <Management
          kind="project-members"
          wid={workspaceId}
          pid={project.id}
          project={project}
          onClose={() => setMembers(false)}
        />
      )}
    </>
  );
}

import { withEditionPath } from './edition.js';
import { PlusOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
} from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LinkedTasks, documentUrl } from './components/DocumentLinks.js';
import { Markdown } from './components/Markdown.js';
import { api, useData } from './runtime.js';
import { loadTaskOptions } from './task-options.js';
export default function Documents({ projectId, readOnly, search = '' }: any) {
  const [params, setParams] = useSearchParams();
  const documentId = params.get('document');
  const direct = useQuery({
    queryKey: ['document', documentId, projectId],
    queryFn: async () => {
      const document = await api(`/documents/${documentId}`);
      if (document.projectId !== projectId)
        throw new Error('文档不属于当前项目，请检查链接');
      return document;
    },
    enabled: !!documentId && !!projectId,
  });
  const qc = useQueryClient(),
    { message } = AntApp.useApp();
  const docs = useData(
    ['documents', projectId],
    `/projects/${projectId}/documents`,
    !!projectId,
  );
  const [edit, setEdit] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (direct.data && documentId) {
      setEdit((current: any) =>
        current?.id === documentId ? current : direct.data,
      );
      setError('');
    } else if (documentId) {
      setEdit((current: any) =>
        current?.id === documentId ? current : undefined,
      );
    } else if (!documentId) {
      setEdit((current: any) => (current?.id ? undefined : current));
    }
  }, [direct.data, documentId]);
  const close = () => {
    setEdit(undefined);
    const next = new URLSearchParams(params);
    next.delete('document');
    setParams(next, { replace: true });
  };
  const options = useQuery({
    queryKey: ['taskOptions', projectId],
    queryFn: () => loadTaskOptions(api, projectId),
    enabled: !!projectId && !!edit,
  });
  return (
    <>
      <Button
        icon={<PlusOutlined />}
        disabled={readOnly}
        onClick={() => {
          setError('');
          setEdit({ title: '', content: '', taskIds: [] });
        }}
      >
        新建项目文档
      </Button>
      {direct.isFetching && <p role="status">正在打开文档…</p>}
      {direct.error && (
        <Alert
          type="error"
          message={direct.error.message}
          action={
            <Button onClick={() => direct.refetch()}>重试打开文档</Button>
          }
        />
      )}
      <div className="document-grid">
        {docs.data
          ?.filter((d: any) => `${d.title}${d.content}`.includes(search))
          .map((d: any) => (
            <Card
              key={d.id}
              title={d.title}
              extra={
                <Button
                  className="action-button"
                  size="small"
                  icon={
                    readOnly ? (
                      <EyeOutlined aria-hidden />
                    ) : (
                      <EditOutlined aria-hidden />
                    )
                  }
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set('document', d.id);
                    next.set('project', projectId);
                    setParams(next);
                  }}
                >
                  查看 / 编辑
                </Button>
              }
            >
              <Markdown>{d.content.slice(0, 220)}</Markdown>
              <p className="muted">
                版本 {d.version} ·{' '}
                {new Date(d.updatedAt).toLocaleString('zh-CN')}
              </p>
            </Card>
          ))}
      </div>
      {docs.error && <Alert type="error" message={docs.error.message} />}
      {docs.data?.length === 0 && (
        <Empty description="沉淀团队知识，创建第一份项目文档" />
      )}
      {edit && (
        <Modal
          open
          width={900}
          title="项目文档"
          onCancel={close}
          footer={null}
          destroyOnHidden
        >
          <Form
            key={edit.id || 'new'}
            layout="vertical"
            initialValues={edit}
            onValuesChange={(v) => setEdit({ ...edit, ...v })}
            onFinish={async (v) => {
              setBusy(true);
              try {
                await api(
                  edit.id
                    ? `/documents/${edit.id}`
                    : `/projects/${projectId}/documents`,
                  edit.id ? 'PATCH' : 'POST',
                  { ...v, expectedVersion: edit.version },
                );
                close();
                qc.invalidateQueries();
              } catch (e) {
                setError((e as Error).message);
                message.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && (
              <>
                <Alert type="error" message={error} />
                <Space className="conflict-controls">
                  <Button
                    onClick={() =>
                      navigator.clipboard
                        .writeText(edit.content)
                        .then(() => message.success('文档内容已复制'))
                        .catch(() => message.error('请手动复制文档内容'))
                    }
                  >
                    复制当前内容
                  </Button>
                  {edit.id && (
                    <Button
                      onClick={async () => {
                        try {
                          const fresh = await api(`/documents/${edit.id}`);
                          setEdit({
                            ...edit,
                            version: fresh.version,
                            revisions: fresh.revisions,
                          });
                          setError(
                            '已加载最新版本信息；当前输入仍保留，确认内容后可再次提交。',
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      加载最新版本信息
                    </Button>
                  )}
                </Space>
              </>
            )}
            <Form.Item
              name="title"
              label="文档标题"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <div className="form-grid">
              <Form.Item
                name="content"
                label="Markdown 内容"
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={15} />
              </Form.Item>
              <div className="markdown-preview">
                <Markdown>{edit.content}</Markdown>
              </div>
            </div>
            {options.error && (
              <Alert
                type="error"
                message={options.error.message}
                action={
                  <Button onClick={() => options.refetch()}>
                    重试加载关联任务
                  </Button>
                }
              />
            )}
            <Form.Item name="taskIds" label="关联任务">
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                loading={options.isFetching}
                options={(options.data || []).map((t) => ({
                  value: t.id,
                  label: t.title,
                }))}
              />
            </Form.Item>
            <Button
              disabled={readOnly}
              type="primary"
              htmlType="submit"
              loading={busy}
            >
              提交新版本
            </Button>
            {edit.id && (
              <>
                <LinkedTasks documentId={edit.id} />
                <Button
                  onClick={() =>
                    navigator.clipboard
                      .writeText(
                        new URL(
                          withEditionPath(documentUrl(edit)),
                          window.location.origin,
                        ).href,
                      )
                      .then(() => message.success('文档链接已复制'))
                      .catch(() =>
                        message.error('复制失败，请从地址栏复制链接'),
                      )
                  }
                >
                  复制文档链接
                </Button>
              </>
            )}
            <h3>历史版本</h3>
            {edit.revisions?.map((v: any) => (
              <details key={v.version}>
                <summary>
                  版本 {v.version} · {new Date(v.at).toLocaleString('zh-CN')}
                </summary>
                <Markdown>{v.content}</Markdown>
              </details>
            ))}
          </Form>
        </Modal>
      )}
    </>
  );
}

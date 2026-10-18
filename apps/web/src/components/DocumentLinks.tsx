import { Alert, Button, Empty, Space, Spin, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../runtime.js';
import { labels, type Status } from '../../../../packages/contracts/index.js';

type DocumentSummary = {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
  projectId: string;
  workspaceId: string;
};
type LinkedTask = {
  deletedAt?: string | null;
  id: string;
  title: string;
  number: number;
  status: Status;
};
export function documentUrl(
  document: Pick<DocumentSummary, 'id' | 'workspaceId' | 'projectId'>,
) {
  return (
    '/?' +
    new URLSearchParams({
      section: 'library',
      workspace: document.workspaceId,
      project: document.projectId,
      document: document.id,
    })
  );
}
export function RelatedDocuments({ taskId }: { taskId: string }) {
  const query = useQuery<DocumentSummary[]>({
    queryKey: ['relatedDocuments', taskId],
    queryFn: () => api(`/tasks/${taskId}/documents`),
  });
  if (query.isPending) return <Spin aria-label="正在加载关联文档" />;
  if (query.error)
    return (
      <Alert
        type="error"
        message={query.error.message}
        action={<Button onClick={() => query.refetch()}>重试</Button>}
      />
    );
  if (!query.data?.length)
    return <Empty description="暂无关联文档，可在知识库编辑文档时关联此需求" />;
  return (
    <div className="document-grid">
      {query.data.map((document) => (
        <article key={document.id}>
          <h3>
            <Link to={documentUrl(document)}>{document.title}</Link>
          </h3>
          <p>
            版本 {document.version} ·{' '}
            {new Date(document.updatedAt).toLocaleString('zh-CN')}
          </p>
        </article>
      ))}
    </div>
  );
}
export function LinkedTasks({ documentId }: { documentId: string }) {
  const query = useQuery<LinkedTask[]>({
    queryKey: ['documentTasks', documentId],
    queryFn: () => api(`/documents/${documentId}/tasks`),
  });
  if (query.isPending)
    return <Spin size="small" aria-label="正在加载关联需求" />;
  if (query.error)
    return (
      <Alert
        type="error"
        message={query.error.message}
        action={<Button onClick={() => query.refetch()}>重试</Button>}
      />
    );
  return (
    <section aria-label="文档关联需求">
      <h3>关联需求</h3>
      {query.data?.length ? (
        <Space direction="vertical">
          {query.data.map((task) => (
            <span key={task.id}>
              <Link to={'/?task=' + encodeURIComponent(task.id)}>
                CF-{String(task.number).padStart(3, '0')} · {task.title}
              </Link>{' '}
              <Tag>{task.deletedAt ? '需求已删除' : labels[task.status]}</Tag>
            </span>
          ))}
        </Space>
      ) : (
        <p className="muted">尚未关联需求</p>
      )}
    </section>
  );
}

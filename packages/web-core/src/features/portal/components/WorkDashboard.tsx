import { edition } from '../../../app/edition.js';
import { WorkOverview } from './WorkOverview.js';
import { Alert, Button, Card, Empty, Skeleton, Space, Tag } from 'antd';
import { useData } from '../../../shared/api/runtime.js';

export function WorkDashboard({
  workspaceId,
  onNavigate,
  onSettings,
  onPortal,
}: any) {
  const query = useData(
    ['overview', workspaceId],
    '/workspaces/' + workspaceId + '/overview-summary',
    !!workspaceId,
    15000,
  );
  if (query.isPending) return <Skeleton active />;
  if (query.error)
    return (
      <Alert
        type="error"
        message={query.error.message}
        action={<Button onClick={() => query.refetch()}>重试加载工作台</Button>}
      />
    );
  const data = query.data;
  if (!data) return <Empty description="选择团队后查看工作台" />;
  const name = (id: string) =>
    data.projects.find((p: any) => p.id === id)?.name || '团队项目';
  const todos = [...data.todos].sort((a: any, b: any) =>
    (a.data.dueAt || '9999').localeCompare(b.data.dueAt || '9999'),
  );
  const deadlines = [...data.competitions]
    .filter((c: any) => c.deadline)
    .sort((a: any, b: any) => a.deadline.localeCompare(b.deadline))
    .slice(0, 6);
  return (
    <>
      <WorkOverview data={data} onNavigate={onNavigate} />
      <Button
        style={{ marginBottom: 16 }}
        onClick={() =>
          onNavigate(
            {
              view: 'discussions',
              task: null,
              discussionScope: 'mine',
              discussionState: 'OPEN',
            },
            true,
          )
        }
      >
        待我澄清
      </Button>
      <div className="work-dashboard">
        <Card title="我的项目" extra={<Tag>{data.projects.length} 个项目</Tag>}>
          {data.projects.length ? (
            [...data.projects]
              .sort(
                (a: any, b: any) =>
                  Number(!!a.archivedAt) - Number(!!b.archivedAt),
              )
              .slice(0, 6)
              .map((p: any) => (
                <div className="dashboard-row" key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.archivedAt ? '已归档' : `${p.openTasks} 项进行中需求`}
                    </small>
                  </div>
                  <Space>
                    <Button
                      onClick={() =>
                        onNavigate(
                          { project: p.id, view: 'tasks', task: null },
                          true,
                        )
                      }
                    >
                      进入项目
                    </Button>
                    <Button onClick={() => onSettings(p)}>项目设置</Button>
                  </Space>
                </div>
              ))
          ) : (
            <Empty description="尚未加入项目" />
          )}
          {data.projects.length > 6 && (
            <p className="muted">
              还有 {data.projects.length - 6} 个项目。
              <Button type="link" onClick={() => onPortal('projects')}>
                查看全部项目
              </Button>
            </p>
          )}
        </Card>
        <Card
          title={
            edition.capabilities.competitions ? '竞赛与截止提醒' : '截止提醒'
          }
          extra={
            edition.capabilities.competitions ? (
              <Button onClick={() => onPortal('competitions')}>竞赛管理</Button>
            ) : null
          }
        >
          <p className="muted">
            计划日期按北京时间展示，请及时更新已结束的记录。
          </p>
          {todos
            .filter((t: any) => t.data.dueAt)
            .slice(0, 4)
            .map((t: any) => (
              <button
                key={t.id}
                className="dashboard-row dashboard-task"
                onClick={() =>
                  onNavigate(
                    { project: t.projectId, task: t.id, view: 'todos' },
                    true,
                  )
                }
              >
                <strong>{t.data.title}</strong>
                <Tag>{t.data.dueAt.slice(0, 10)}</Tag>
              </button>
            ))}
          {deadlines.length && edition.capabilities.competitions ? (
            deadlines.map((c: any) => (
              <div className="dashboard-row" key={c.id}>
                <strong>{c.name}</strong>
                <Tag>{c.deadline}</Tag>
              </div>
            ))
          ) : todos.some((t: any) => t.data.dueAt) ? null : (
            <Empty description="暂无截止安排" />
          )}
        </Card>
        <Card
          title="最近成果"
          extra={<Button onClick={() => onPortal('library')}>知识库</Button>}
        >
          {data.documents.length ? (
            data.documents.map((d: any) => (
              <div className="dashboard-row" key={d.id}>
                <div>
                  <strong>{d.title}</strong>
                  <small>
                    {name(d.projectId)} ·{' '}
                    {new Date(d.updatedAt).toLocaleDateString('zh-CN')}
                  </small>
                </div>
                <Button
                  onClick={() =>
                    onNavigate(
                      { project: d.projectId, view: 'documents', task: null },
                      true,
                    )
                  }
                >
                  查看文档
                </Button>
              </div>
            ))
          ) : (
            <Empty description="项目文档将汇集在这里" />
          )}
        </Card>
      </div>
    </>
  );
}

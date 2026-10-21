import { Alert, Button, Empty, List, Progress, Skeleton, Tag } from 'antd';
import { terminal } from '@coflow/contracts/index.js';
import { workflowLabel } from '@coflow/contracts/workflow.js';
export function ProjectMetrics({ query, todos, projectId, onScope }: any) {
  const rows = query.data;
  const values = [
    [
      'active',
      '进行中的需求',
      rows?.filter((x: any) => !terminal(x.status)).length,
    ],
    [
      'handling',
      '等待我的处理',
      todos.data?.filter((x: any) => x.projectId === projectId).length,
    ],
    [
      'ended',
      '已完成交付',
      rows?.filter((x: any) => x.status === 'CLOSED').length,
    ],
    ['overdue', '需要关注', rows?.filter((x: any) => x.overdue).length],
  ];
  return (
    <>
      <div className="project-metrics" aria-label="项目交付指标">
        {values.map(([scope, label, count]) => (
          <button key={scope} onClick={() => onScope(scope)}>
            <span>{label}</span>
            <strong>{count ?? '—'}</strong>
          </button>
        ))}
        <span className="project-metrics-note">当前项目</span>
      </div>
      {(query.error || todos.error) && (
        <Alert
          type="warning"
          message="部分项目指标读取失败"
          action={
            <Button
              onClick={() => {
                query.refetch();
                todos.refetch();
              }}
            >
              重试
            </Button>
          }
        />
      )}
    </>
  );
}
export function ProjectOverview({ project, query, onTasks, onDocuments }: any) {
  if (query.isPending) return <Skeleton active />;
  if (query.error)
    return (
      <Alert
        type="error"
        message="项目概览读取失败"
        action={<Button onClick={() => query.refetch()}>重试</Button>}
      />
    );
  const rows = query.data || [];
  const delivered = rows.filter((x: any) => x.status === 'CLOSED');
  const overdue = rows.filter((x: any) => x.overdue);
  const returned = rows.filter(
    (x: any) => x.solutionReturns + x.testReturns > 0,
  );
  const durations = delivered.filter((x: any) => x.deliveryHours != null);
  const average = durations.length
    ? (
        durations.reduce((n: number, x: any) => n + x.deliveryHours, 0) /
        durations.length
      ).toFixed(1)
    : null;
  const stages = [...new Set(rows.map((x: any) => x.status))] as string[];
  const label = (status: any) =>
    workflowLabel({ status, data: { workflow: project?.workflow } as any });
  return (
    <section className="project-overview">
      <h2>项目交付总览</h2>
      <p className="muted">先了解交付进展与风险，再进入需求处理具体工作。</p>
      <div className="project-overview-grid">
        <article className="overview-block">
          <h3>交付完成率</h3>
          <Progress
            percent={
              rows.length
                ? Math.round((delivered.length / rows.length) * 100)
                : 0
            }
            strokeColor="#387a52"
          />
          <p>
            已交付 {delivered.length} / 全部 {rows.length} 项需求
          </p>
          <p className="muted">
            按已完成验收的需求数量计算，非工时进度；终止需求计入总数。
          </p>
          <strong>
            {average === null
              ? '暂无已交付周期数据'
              : '平均交付周期 ' + average + ' 小时'}
          </strong>
          <p className="muted">仅统计有提交与验收记录的已交付需求。</p>
        </article>
        <article className="overview-block">
          <h3>需求阶段分布</h3>
          {rows.length ? (
            stages.map((status) => (
              <div className="overview-stage" key={status}>
                <span>{label(status)}</span>
                <Progress
                  percent={Math.round(
                    (rows.filter((x: any) => x.status === status).length /
                      rows.length) *
                      100,
                  )}
                  showInfo={false}
                  strokeColor="#7fa780"
                />
                <strong>
                  {rows.filter((x: any) => x.status === status).length}
                </strong>
              </div>
            ))
          ) : (
            <Empty description="创建需求后展示阶段分布" />
          )}
        </article>
        <article className="overview-block">
          <h3>
            需要关注{' '}
            <Tag color={overdue.length ? 'orange' : 'green'}>
              {overdue.length} 项逾期
            </Tag>
          </h3>
          <List
            dataSource={overdue.slice(0, 5)}
            locale={{ emptyText: <Empty description="当前没有逾期需求" /> }}
            renderItem={(x: any) => (
              <List.Item>
                <span>{x.title}</span>
                <Tag>{label(x.status)}</Tag>
              </List.Item>
            )}
          />
          {!!overdue.length && (
            <Button onClick={() => onTasks('overdue')}>处理逾期需求</Button>
          )}
        </article>
        <article className="overview-block">
          <h3>返工与质量</h3>
          <div className="overview-quality">
            <span>
              方案退回{' '}
              <strong>
                {rows.reduce((n: number, x: any) => n + x.solutionReturns, 0)}
              </strong>{' '}
              次
            </span>
            <span>
              测试退回{' '}
              <strong>
                {rows.reduce((n: number, x: any) => n + x.testReturns, 0)}
              </strong>{' '}
              次
            </span>
          </div>
          <p className="muted">累计历史退回次数，不代表当前仍有问题。</p>
          <List
            dataSource={returned.slice(0, 5)}
            locale={{ emptyText: '暂无退回记录' }}
            renderItem={(x: any) => (
              <List.Item>
                <span>{x.title}</span>
                <span>{x.solutionReturns + x.testReturns} 次</span>
              </List.Item>
            )}
          />
        </article>
      </div>
      <div className="project-overview-actions">
        <Button type="primary" onClick={() => onTasks('all')}>
          进入需求与交付
        </Button>
        <Button onClick={onDocuments}>查看项目文档</Button>
      </div>
    </section>
  );
}

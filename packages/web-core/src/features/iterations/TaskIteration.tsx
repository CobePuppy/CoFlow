import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/runtime.js';
export function TaskIteration({ task }: { task: any }) {
  const query = useQuery<any>({
    queryKey: ['taskIteration', task.id],
    queryFn: () => api('/tasks/' + task.id + '/iteration'),
  });
  if (query.isPending) return null;
  if (query.error)
    return (
      <Alert
        type="error"
        message="迭代安排加载失败"
        action={<Button onClick={() => query.refetch()}>重试迭代安排</Button>}
      />
    );
  if (!query.data) return null;
  const plan = query.data;
  return (
    <Card title="迭代安排" size="small">
      <Link
        to={
          '/?' +
          new URLSearchParams({
            app: 'work',
            view: 'iterations',
            project: task.projectId,
            workspace: task.workspaceId,
            iteration: plan.iterationId,
          })
        }
      >
        {plan.name}
      </Link>
      <p>
        {plan.startDate} 至 {plan.endDate}
      </p>
      {plan.milestone && (
        <p>
          里程碑：{plan.milestone.name} · {plan.milestone.dueDate}
        </p>
      )}
      {plan.delayNote && <p>延期说明：{plan.delayNote}</p>}
    </Card>
  );
}

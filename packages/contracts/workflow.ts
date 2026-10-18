import { labels, type Status, type Task } from './index.js';

export function workflowLabel(task: Pick<Task, 'data' | 'status'>) {
  if (task.data.workflow !== 'SIMPLE') return labels[task.status];
  return (
    (
      {
        DRAFT: '草稿',
        READY_FOR_DEV: '待办',
        DEVELOPING: '进行中',
        ACCEPTANCE_PENDING: '待验收',
        CLOSED: '已完成',
      } as Partial<Record<Status, string>>
    )[task.status] || labels[task.status]
  );
}

export function workflowStatuses(simple: boolean): Status[] {
  return simple
    ? [
        'DRAFT',
        'READY_FOR_DEV',
        'DEVELOPING',
        'ACCEPTANCE_PENDING',
        'CLOSED',
        'CANCELLED',
      ]
    : (Object.keys(labels) as Status[]);
}

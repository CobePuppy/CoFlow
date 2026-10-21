import { Tag } from 'antd';
import { isOverdue } from '@coflow/contracts/deadline.js';
import { terminal, type Task } from '@coflow/contracts/index.js';

export function RequirementSignal({ task }: { task: Task }) {
  if (task.deletedAt || terminal(task.status)) return null;
  return (
    <>
      {task.data.blocks.some((b) => !b.end) && <Tag color="orange">阻塞中</Tag>}
      {isOverdue(task.data.dueAt) && <Tag color="red">已逾期</Tag>}
    </>
  );
}

export function nextWork(task: Task) {
  if (task.deletedAt) return '已移入回收站';
  if (terminal(task.status))
    return task.status === 'CLOSED' ? '已完成验收' : '已取消';
  if (task.data.blocks.some((b) => !b.end)) return '先处理阻塞';
  const simple = task.data.workflow === 'SIMPLE';
  return (
    (
      {
        DRAFT: '补齐并提交需求',
        SOLUTION_PENDING: '编写研发方案',
        SOLUTION_REVIEW: '完成方案评估',
        READY_FOR_DEV: simple ? '确认并开始处理' : '确认并开始开发',
        DEVELOPING: simple ? '整理交付并提交验收' : '整理交付并提测',
        READY_FOR_TEST: '确认环境并开始测试',
        TESTING: '记录测试结果',
        ACCEPTANCE_PENDING: '逐项核对验收标准',
      } as Record<string, string>
    )[task.status] || ''
  );
}

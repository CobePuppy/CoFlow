import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  goalTaskIds,
  goalProgress,
  commandQueues,
  goalFields,
} from '@coflow/contracts/project-goals.js';
test('目标统计对直接及迭代关联去重，取消与回收站单列，不以空集合宣称完成', () => {
  const context: any = {
    goalTasks: [
      { goalId: 'g', taskId: 'a' },
      { goalId: 'g', taskId: 'b' },
    ],
    goalIterations: [{ goalId: 'g', iterationId: 'i' }],
    iterationTasks: [
      { iterationId: 'i', taskId: 'a' },
      { iterationId: 'other', taskId: 'x' },
    ],
  };
  assert.deepEqual(goalTaskIds(context, 'g'), ['a', 'b']);
  const rows: any = [
    { id: 'a', status: 'CLOSED' },
    { id: 'b', status: 'CANCELLED' },
    { id: 'c', status: 'CLOSED', deletedAt: 'today' },
  ];
  assert.deepEqual(goalProgress(rows, ['a', 'a', 'b', 'c']), {
    planned: 1,
    accepted: 1,
    cancelled: 1,
    deleted: 1,
    percent: 100,
  });
  assert.equal(goalProgress(rows, []).percent, 0);
  assert(
    !goalFields.safeParse({
      title: 'x',
      description: '',
      criteria: [],
      ownerId: 'u',
      dueDate: null,
    }).success,
  );
});
test('目标工作队列排除回收站与本人提交，行动逾期使用独立日期', () => {
  const tasks: any = [
    { id: 'a', status: 'CLOSED', data: { productId: 'p', blocks: [] } },
    { id: 'b', status: 'CLOSED', deletedAt: 'today', data: { blocks: [] } },
  ];
  const base: any = {
    taskId: 'a',
    dueDate: '2000-01-01',
    status: 'SUBMITTED',
    ownerId: 'u',
  };
  const actions: any = [
    { ...base, id: 'self' },
    { ...base, id: 'review', ownerId: 'other' },
    { ...base, id: 'trash', taskId: 'b' },
  ];
  const q = commandQueues(tasks, actions, 'u', true);
  assert.deepEqual(q.reviews, ['review']);
  assert.deepEqual(q.overdueActions, ['self', 'review']);
  assert.deepEqual(q.myTasks, []);
});

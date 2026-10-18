import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectQQTasks } from '../apps/api/src/qq.js';
import type { Task } from '../packages/contracts/index.js';

test('QQ 待办沿用当前阶段处理人，过滤终态、已评估用户并优先逾期', () => {
  const task = (id: string, status: Task['status'], extra = {}): Task =>
    ({
      id,
      status,
      data: {
        productId: 'p',
        engineerId: 'e',
        testerId: 'q',
        productReviewerId: 'p',
        qaReviewerId: 'q',
        priority: 'P1',
        solutions: [{}],
        reviews: [],
        ...extra,
      },
    }) as unknown as Task;
  const rows = [
    task('dev', 'DEVELOPING'),
    task('review', 'SOLUTION_REVIEW', { reviews: [{ round: 1, userId: 'p' }] }),
    task('test', 'TESTING', { dueAt: '2020-01-01T00:00:00Z' }),
    task('end', 'CLOSED'),
    task('cancel', 'CANCELLED'),
  ];
  assert.deepEqual(
    selectQQTasks(rows, 'p', 'current').map((t) => t.id),
    [],
  );
  assert.deepEqual(
    selectQQTasks(rows, 'q', 'current').map((t) => t.id),
    ['test', 'review'],
  );
  assert.deepEqual(
    selectQQTasks(rows, 'q', 'overdue').map((t) => t.id),
    ['test'],
  );
  assert.equal(selectQQTasks(rows, 'e', 'all').length, 3);
  assert.equal(selectQQTasks(rows, 'outsider', 'all').length, 0);
});

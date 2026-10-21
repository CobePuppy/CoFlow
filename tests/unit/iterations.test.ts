import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  iterationInput,
  milestoneInput,
  iterationProgress,
} from '@coflow/contracts/iterations.js';
import { readWorkspaceState } from '../../packages/web-core/src/features/requirements/model/workspace-state.js';
import { editionDestination } from '../../packages/web-core/src/features/settings/edition-navigation.js';
const valid = {
  name: '验收迭代',
  goal: '完成真实验收',
  ownerId: '10000000-0000-4000-8000-000000000001',
  startDate: '2026-10-01',
  endDate: '2026-10-21',
};
test('迭代日期、负责人和目标校验，拒绝非法日期、倒置范围及额外字段', () => {
  assert(iterationInput.safeParse(valid).success);
  for (const patch of [
    { startDate: '2026-02-30' },
    { endDate: '2026-09-30' },
    { ownerId: 'x' },
    { goal: '  ' },
    { taskIds: ['x'] },
  ])
    assert(!iterationInput.safeParse({ ...valid, ...patch }).success);
  assert(
    milestoneInput.safeParse({ name: '检查点', dueDate: '2026-10-21' }).success,
  );
  assert(
    !milestoneInput.safeParse({ name: '检查点', dueDate: '2026-13-01' })
      .success,
  );
});
test('验收进度不将取消、回收站或空迭代算作完成', () => {
  const p = iterationProgress({
    planned: 3,
    accepted: 1,
    cancelled: 2,
    deleted: 1,
    overdue: 1,
    blocked: 1,
  });
  assert.equal(p.percent, 33);
  assert.equal(p.unfinished, 2);
  assert.equal(p.cancelled, 2);
  assert.equal(
    iterationProgress({
      planned: 0,
      accepted: 0,
      cancelled: 3,
      deleted: 1,
      overdue: 0,
      blocked: 0,
    }).percent,
    0,
  );
});
test('迭代视图与版本切换保留计划上下文', () => {
  assert.equal(
    readWorkspaceState(new URLSearchParams('view=iterations')).view,
    'iterations',
  );
  const url = new URL(
    editionDestination(
      'student',
      'https://coflow.test/enterprise/?app=work&view=iterations&project=p&iteration=i&iterationPage=2&iterationTasksPage=3&iterationFilter=overdue',
    ),
    'https://coflow.test',
  );
  assert.equal(url.pathname, '/student/');
  for (const [key, value] of [
    ['iteration', 'i'],
    ['iterationPage', '2'],
    ['iterationTasksPage', '3'],
    ['iterationFilter', 'overdue'],
  ])
    assert.equal(url.searchParams.get(key), value);
});

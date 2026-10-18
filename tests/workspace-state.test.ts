import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readWorkspaceState,
  matchesTaskFilters,
} from '../apps/web/src/workspace-state.js';
import type { Task } from '../packages/contracts/index.js';
test('页面状态只接受已知视图、筛选和有效页码', () => {
  const state = readWorkspaceState(
    new URLSearchParams(
      'view=bad&mode=bad&page=NaN&status=bad&priority=P9&blocked=bad',
    ),
  );
  assert.deepEqual(state, {
    view: 'dashboard',
    mode: 'list',
    page: 1,
    filters: {},
  });
  for (const value of ['0', '-2', '1.5', '1000001', 'Infinity'])
    assert.equal(
      readWorkspaceState(new URLSearchParams('page=' + value)).page,
      1,
    );
  assert.deepEqual(
    readWorkspaceState(
      new URLSearchParams(
        'view=tasks&mode=board&page=2&status=TESTING&priority=P1&q=%20hello%20&blocked=false',
      ),
    ),
    {
      view: 'tasks',
      mode: 'board',
      page: 2,
      filters: {
        q: 'hello',
        status: 'TESTING',
        priority: 'P1',
        blocked: 'false',
      },
    },
  );
});
test('待办筛选区分未阻塞和阻塞，并按标题内容忽略大小写搜索', () => {
  const task = {
    status: 'DRAFT',
    data: {
      title: 'Hello',
      description: 'World',
      priority: 'P1',
      productId: 'u',
      engineerId: 'e',
      testerId: 'q',
      productReviewerId: 'u',
      qaReviewerId: 'q',
      blocks: [],
    },
  } as unknown as Task;
  assert(
    matchesTaskFilters(task, {
      q: 'WORLD',
      owner: 'u',
      priority: 'P1',
      blocked: 'false',
    }),
  );
  assert(!matchesTaskFilters(task, { blocked: 'true' }));
  assert(!matchesTaskFilters(task, { status: 'TESTING' }));
  task.data.blocks = [{ start: '2026-01-01', reason: 'waiting' }];
  assert(matchesTaskFilters(task, { blocked: 'true' }));
  assert(!matchesTaskFilters(task, { blocked: 'false' }));
});

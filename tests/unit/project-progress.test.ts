import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionChange,
  deliveryChecks,
  compareCheckpoints,
  checkpointFollowUps,
  actionFilters,
  matchesAction,
  progressBrief,
  type ProgressSnapshot,
} from '@coflow/contracts/project-progress.js';

const task: any = {
  data: {
    workflow: 'STANDARD',
    criteria: ['能够复核'],
    blocks: [],
    comments: [],
    development: [{ summary: '完成交接', selfTest: '自测记录', round: 1 }],
    tests: [{ round: 2, submission: 1, status: 'PASSED', record: '实际结果' }],
  },
};
test('交付检查按交接submission匹配最新测试，重测通过不与交接数组长度混淆', () => {
  const checks = deliveryChecks(task);
  assert(checks.find((c) => c.key === 'test')?.ok);
  assert(
    !deliveryChecks({
      ...task,
      data: { ...task.data, tests: [{ ...task.data.tests[0], submission: 0 }] },
    }).find((c) => c.key === 'test')?.ok,
  );
  assert(
    !deliveryChecks({
      ...task,
      data: {
        ...task.data,
        tests: [{ ...task.data.tests[0], status: 'VOID' }],
      },
    }).find((c) => c.key === 'test')?.ok,
  );
  assert.equal(
    deliveryChecks({ ...task, data: { ...task.data, workflow: 'SIMPLE' } })
      .length,
    3,
  );
});
test('交付缺口归并问题解决事件，未解决问题和阻塞不会因有测试记录而忽略', () => {
  const t = {
    ...task,
    data: {
      ...task.data,
      criteria: [],
      blocks: [{ reason: '等待环境' }],
      comments: [{ id: 'q', body: '问题', kind: 'QUESTION' }],
    },
  };
  assert(
    deliveryChecks(t)
      .filter((c) => ['criteria', 'blocks', 'questions'].includes(c.key))
      .every((c) => !c.ok),
  );
  t.data.comments.push({
    id: 's',
    replyTo: 'q',
    kind: 'QUESTION_STATE',
    resolved: true,
  } as any);
  assert(deliveryChecks(t).find((c) => c.key === 'questions')?.ok);
});
test('检查点真实对比资料修改、阶段变化、回收站与新增，不推断完成', () => {
  const before: ProgressSnapshot = {
    tasks: [
      {
        id: 'a',
        number: 1,
        title: '任务',
        status: 'DEVELOPING',
        version: 1,
        deleted: false,
      },
    ],
    actions: [{ id: 'x', title: '行动', status: 'DOING', version: 1 }],
  };
  assert.equal(compareCheckpoints(null, before).baseline, false);
  assert.deepEqual(compareCheckpoints(before, before).changes, []);
  const after = structuredClone(before);
  after.tasks[0].version++;
  assert.equal(
    compareCheckpoints(before, after).changes[0].change,
    '资料更新，阶段未变化',
  );
  after.tasks[0].deleted = true;
  after.actions[0].status = 'SUBMITTED';
  assert.deepEqual(
    compareCheckpoints(before, after).changes.map((c) => c.change),
    ['移入回收站', 'DOING → SUBMITTED'],
  );
});
test('行动输入要求真实日期和并发版本，拒绝未知状态字段', () => {
  const input = {
    expectedVersion: 1,
    expectedTaskVersion: 2,
    operation: 'CLAIM',
    note: '我负责处理',
    dueDate: '2026-02-30',
  };
  assert(!actionChange.safeParse(input).success);
  assert(actionChange.safeParse({ ...input, dueDate: '2026-10-22' }).success);
  assert(
    !actionChange.safeParse({ ...input, dueDate: null, status: 'DONE' })
      .success,
  );
});
test('检查点跟进建议来自真实行动状态，不把行动完成等同需求验收', () => {
  const current: ProgressSnapshot = {
    tasks: [],
    actions: [{ id: 'a', title: '成果', status: 'SUBMITTED', version: 1 }],
  };
  assert(checkpointFollowUps(null, current)[0].includes('1 项成果待确认'));
  assert(
    checkpointFollowUps(current, current).some((t) => t.includes('暂无变化')),
  );
  current.actions[0].status = 'DONE';
  assert(checkpointFollowUps(null, current)[0].includes('需求的正式验收'));
});
test('行动筛选组合范围与状态，按北京时间逾期，搜索百分号为普通文字', () => {
  const a = {
    title: '完成100%交付',
    acceptance: '有结果',
    ownerId: 'member',
    dueDate: '2026-10-21',
    status: 'SUBMITTED',
    canReview: true,
    taskNumber: 8,
    taskTitle: '原需求',
  };
  const filters = (value: any) => actionFilters.parse(value);
  assert(matchesAction(a, filters({ scope: 'REVIEW' }), 'reviewer'));
  assert(!matchesAction(a, filters({ scope: 'REVIEW' }), 'member'));
  assert(
    !matchesAction(
      { ...a, unavailable: true },
      filters({ scope: 'REVIEW' }),
      'reviewer',
    ),
  );
  assert(matchesAction(a, filters({ scope: 'MINE', q: '%' }), 'member'));
  assert(!matchesAction(a, filters({ status: 'DONE' }), 'member'));
  assert(matchesAction(a, filters({ q: 'CF-8' }), 'member'));
  assert(matchesAction(a, filters({ q: 'CF-008' }), 'member'));
  assert(matchesAction(a, filters({ q: '负责人' }), 'member', '测试负责人'));
  assert(!matchesAction(a, filters({ q: '.*' }), 'member'));
  assert(
    !matchesAction(
      a,
      filters({ scope: 'OVERDUE' }),
      'member',
      '',
      Date.parse('2026-10-21T23:59:59+08:00'),
    ),
  );
  assert(
    matchesAction(
      a,
      filters({ scope: 'OVERDUE' }),
      'member',
      '',
      Date.parse('2026-10-22T00:00:00+08:00'),
    ),
  );
  assert(
    !matchesAction(
      { ...a, status: 'DONE' },
      filters({ scope: 'OVERDUE' }),
      'member',
    ),
  );
  assert(!actionFilters.safeParse({ scope: 'OTHER_USERS' }).success);
});
test('推进简报标明所选基线和完整行动数，转义标题，不把行动完成视为需求验收', () => {
  const current: ProgressSnapshot = {
    tasks: [],
    actions: [{ id: 'a', title: '行动', status: 'DONE', version: 2 }],
  };
  const text = progressBrief({
    projectName: '# 项目\n注入标题',
    asOf: '2026-10-22T00:00:00Z',
    baseline: {
      id: 'base',
      note: '最初基线',
      createdAt: '2026-10-21T00:00:00Z',
      snapshot: { tasks: [], actions: [] },
    },
    current,
    actions: [
      {
        title: '行动',
        status: 'DONE',
        ownerName: '执行人',
        dueDate: null,
        taskNumber: 8,
        outcome: '已提交',
      },
    ],
  });
  assert(text.includes('最初基线'));
  assert(text.includes('ID base'));
  assert(text.includes('全项目行动（1项，独立于页面筛选）'));
  assert(text.includes('需求的正式验收'));
  assert(!text.includes('\n注入标题'));
  assert(text.includes('\\# 项目'));
});

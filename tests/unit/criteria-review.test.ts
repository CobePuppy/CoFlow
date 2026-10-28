import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewCriteria } from '../../packages/contracts/src/criteria-review.js';
import { execute } from '../../apps/api/src/modules/requirements/domain.js';
import type { Task, Member } from '@coflow/contracts/index.js';

const members: Member[] = [
  { id: 'p', name: '产品', email: 'p@test.local', roles: ['PRODUCT'] },
  { id: 'e', name: '研发', email: 'e@test.local', roles: ['ENGINEER'] },
  { id: 'q', name: '测试', email: 'q@test.local', roles: ['QA'] },
  { id: 'r', name: '测试评估', email: 'r@test.local', roles: ['QA'] },
];
function draft(criteria: string[], extra: any = {}): Task {
  return {
    id: 't',
    workspaceId: 'w',
    projectId: 'x',
    number: 1,
    status: 'DRAFT',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: {
      title: '需求',
      background: '背景',
      goal: '目标',
      description: '说明',
      criteria,
      priority: 'P1',
      productId: 'p',
      engineerId: 'e',
      productReviewerId: 'p',
      qaReviewerId: 'r',
      testerId: 'q',
      requirementVersion: 0,
      requirements: [],
      solutions: [],
      reviews: [],
      development: [],
      tests: [],
      acceptances: [],
      changes: [],
      blocks: [],
      comments: [],
      history: [],
      ...extra,
    },
  };
}
const IGNORED = (t: Task) =>
  t.data.history.filter((h) => h.action === 'CRITERIA_WARNINGS_IGNORED');

test('质量检查：模糊词提醒', () => {
  const w = reviewCriteria(['性能尽量再优化一些']);
  assert.ok(w.some((x) => x.category === 'vague' && x.index === 1));
  assert.ok(w.every((x) => x.message.includes('模糊词')));
});

test('质量检查：一条多结果提醒', () => {
  const w = reviewCriteria(['列表能显示十条记录；导出支持CSV']);
  assert.ok(w.some((x) => x.category === 'multi'));
});

test('质量检查：无可观察结果提醒', () => {
  const w = reviewCriteria(['整体体验良好']);
  assert.ok(w.some((x) => x.category === 'unobservable'));
});

test('质量检查：实现细节提醒', () => {
  const w = reviewCriteria(['保存时写入数据库字段']);
  assert.ok(w.some((x) => x.category === 'detail'));
});

test('质量检查：规范标准不触发任何提醒', () => {
  assert.deepEqual(
    reviewCriteria(['页面能在3秒内显示统计结果']),
    [],
  );
});

test('质量检查：BUG 类型缺失复现步骤/实际结果/期望结果提醒', () => {
  const w = reviewCriteria(['缺陷修复后能正常显示'], {
    type: 'BUG',
    description: '缺少小节',
  });
  const bug = w.filter((x) => x.category === 'bug');
  assert.equal(bug.length, 3);
  assert.ok(bug.every((x) => x.index === 0));
  const complete = reviewCriteria(['复现后能正常显示'], {
    type: 'BUG',
    description: '复现步骤：…\n实际结果：…\n期望结果：…',
  });
  assert.ok(!complete.some((x) => x.category === 'bug'));
});

test('提醒模式：带提醒提交不阻断并留痕时间线', () => {
  const t = execute(
    draft(['性能尽量再优化一些']),
    'SUBMIT_REQUIREMENT',
    {},
    members[0],
    members,
  );
  assert.equal(t.status, 'SOLUTION_PENDING');
  const events = IGNORED(t);
  assert.equal(events.length, 1);
  assert.equal(events[0].from, 'DRAFT');
  assert.equal(events[0].to, 'DRAFT');
  assert.ok(events[0].payload.warnings.length >= 1);
  assert.equal(events[0].payload.overrideReason, '');
  assert.equal(events[0].payload.strict, false);
});

test('提醒模式：无提醒提交不留痕', () => {
  const t = execute(
    draft(['页面能在3秒内显示统计结果']),
    'SUBMIT_REQUIREMENT',
    {},
    members[0],
    members,
  );
  assert.equal(IGNORED(t).length, 0);
});

test('严格模式：有提醒时拒绝提交', () => {
  assert.throws(
    () =>
      execute(
        draft(['性能尽量再优化一些']),
        'SUBMIT_REQUIREMENT',
        {},
        members[0],
        members,
        undefined,
        true,
        true,
      ),
    /验收标准未通过严格检查/,
  );
});

test('严格模式：管理员无理由或不足10字仍拒绝', () => {
  for (const criteriaOverrideReason of ['', '太短了']) {
    assert.throws(
      () =>
        execute(
          draft(['性能尽量再优化一些']),
          'SUBMIT_REQUIREMENT',
          { criteriaOverrideReason },
          members[0],
          members,
          undefined,
          true,
          true,
        ),
      /验收标准未通过严格检查/,
    );
  }
});

test('严格模式：管理员不少于10字理由放行并留痕', () => {
  const t = execute(
    draft(['性能尽量再优化一些']),
    'SUBMIT_REQUIREMENT',
    { criteriaOverrideReason: '该性能项仅供演示环境验证，不影响主线交付。' },
    members[0],
    members,
    undefined,
    true,
    true,
  );
  assert.equal(t.status, 'SOLUTION_PENDING');
  const events = IGNORED(t);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.strict, true);
  assert.equal(
    events[0].payload.overrideReason,
    '该性能项仅供演示环境验证，不影响主线交付。',
  );
});

test('严格模式：标准无提醒时无需理由直接通过', () => {
  const t = execute(
    draft(['页面能在3秒内显示统计结果']),
    'SUBMIT_REQUIREMENT',
    {},
    members[0],
    members,
    undefined,
    false,
    true,
  );
  assert.equal(t.status, 'SOLUTION_PENDING');
  assert.equal(IGNORED(t).length, 0);
});

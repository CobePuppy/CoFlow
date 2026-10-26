import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requirementReadiness } from '../../packages/web-core/src/features/requirements/model/transition-readiness.js';
test('提交准备明确区分正文、成员独立性与阻塞，不替代服务端流转', () => {
  const task: any = {
    data: {
      title: '需求',
      background: '背景',
      goal: '目标',
      description: '说明',
      criteria: ['可验证标准'],
      productId: 'p',
      engineerId: 'e',
      testerId: 't',
      productReviewerId: 'p',
      qaReviewerId: 'q',
      blocks: [],
    },
  };
  assert.equal(requirementReadiness(task, ['p', 'e', 'q', 't']).ready, true);
  task.data.goal = '';
  task.data.qaReviewerId = 'p';
  let report = requirementReadiness(task, ['p', 'e', 'q', 't']);
  assert(report.content.includes('目标'));
  assert(report.assignment.some((x) => x.includes('不同成员')));
  assert.equal(report.ready, false);
  task.data.blocks.push({ reason: '等待外部接口' });
  assert.equal(requirementReadiness(task).blocked, true);
});

test('缺项定位包含正文、成员和独立性字段，简易流程省略标准流程字段', () => {
  const data: any = {
    title: '需求',
    description: '',
    criteria: [],
    productId: 'p',
    engineerId: 'e',
    productReviewerId: 'p',
    qaReviewerId: 'p',
    testerId: 'q',
    blocks: [],
  };
  const report = requirementReadiness({ data } as any, ['p', 'q']);
  assert(report.issues.some((i) => i.field === 'description'));
  assert(report.issues.some((i) => i.field === 'criteria'));
  assert(report.issues.some((i) => i.field === 'engineerId'));
  assert(report.issues.some((i) => i.field === 'qaReviewerId'));
  const simple = requirementReadiness(
    { data: { ...data, workflow: 'SIMPLE' } } as any,
    ['p', 'e'],
  );
  assert(
    !simple.issues.some((i) =>
      ['background', 'goal', 'qaReviewerId', 'testerId'].includes(i.field),
    ),
  );
});

test('紧凑模式仅需三角色，兼任评估不算缺项', () => {
  const task: any = {
    data: {
      title: '需求',
      background: '背景',
      goal: '目标',
      description: '说明',
      criteria: ['可验证标准'],
      workflow: 'STANDARD',
      roleMode: 'COMPACT',
      productId: 'p',
      engineerId: 'e',
      testerId: 't',
      productReviewerId: '',
      qaReviewerId: '',
      blocks: [],
    },
  };
  assert.equal(requirementReadiness(task, ['p', 'e', 't']).ready, true);
  task.data.testerId = 'p';
  const report = requirementReadiness(task, ['p', 'e', 't']);
  assert(
    report.assignment.some((x) => x.includes('测试负责人不能评估自己的测试结果')),
  );
  assert.equal(report.ready, false);
});

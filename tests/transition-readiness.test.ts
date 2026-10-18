import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requirementReadiness } from '../apps/web/src/transition-readiness.js';
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
      testerId: 'q',
      productReviewerId: 'p',
      qaReviewerId: 'q',
      blocks: [],
    },
  };
  assert.equal(requirementReadiness(task, ['p', 'e', 'q']).ready, true);
  task.data.goal = '';
  task.data.qaReviewerId = 'p';
  let report = requirementReadiness(task, ['p', 'e', 'q']);
  assert(report.content.includes('目标'));
  assert(report.assignment.some((x) => x.includes('不同成员')));
  assert.equal(report.ready, false);
  task.data.blocks.push({ reason: '等待外部接口' });
  assert.equal(requirementReadiness(task).blocked, true);
});

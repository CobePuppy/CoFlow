import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requirementDiff } from '../../packages/web-core/src/features/requirements/model/requirement-diff.js';
test('首次提交及缺失历史字段不伪造旧值，验收项正确显示新增移除和顺序变化', () => {
  assert.equal(
    requirementDiff(null, { title: '首次', criteria: ['A'] }).length,
    2,
  );
  const changes = requirementDiff(
    { description: '旧', criteria: ['A', 'B'] },
    { description: '新', criteria: ['B', 'C'] },
  );
  assert.deepEqual(
    changes.map((c) => c.field),
    ['description', 'criteria'],
  );
  assert.deepEqual(changes[1].added, ['C']);
  assert.deepEqual(changes[1].removed, ['A']);
  assert.equal(
    requirementDiff({}, { title: '历史未记录' })[0].unknownBefore,
    true,
  );
  const reorder = requirementDiff(
    { criteria: ['A', 'B'] },
    { criteria: ['B', 'A'] },
  )[0];
  assert.deepEqual(reorder.added, []);
  assert.deepEqual(reorder.removed, []);
  assert.deepEqual(requirementDiff({ title: 'a' }, { title: 'a' }), []);
});
test('对比忽略权限、负责人和流程字段，大段正文按完整字段对比', () => {
  const body = '很长的正文'.repeat(20000);
  const changes = requirementDiff(
    { description: body, status: 'DRAFT' },
    { description: body + '改', status: 'CLOSED', password: '秘密' },
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].after, body + '改');
});

test('重复验收项按实际次数计数，不误判为仅顺序调整', () => {
  const c = requirementDiff({ criteria: ['A', 'A'] }, { criteria: ['A'] })[0];
  assert.deepEqual(c.removed, ['A']);
  assert.deepEqual(c.added, []);
});

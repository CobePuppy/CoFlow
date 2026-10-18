import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute, metrics, allowedActions } from '../apps/api/src/domain.js';
import type { Task, Member } from '../packages/contracts/index.js';
const members: Member[] = [
  { id: 'p', name: '产品', email: 'p@test.local', roles: ['PRODUCT'] },
  { id: 'e', name: '研发', email: 'e@test.local', roles: ['ENGINEER'] },
  { id: 'q', name: '测试', email: 'q@test.local', roles: ['QA'] },
];
export function fixture(): Task {
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
      criteria: ['标准'],
      priority: 'P1',
      productId: 'p',
      engineerId: 'e',
      productReviewerId: 'p',
      qaReviewerId: 'q',
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
    },
  };
}
const solution = {
    body: '方案',
    scope: 'API',
    effort: 2,
    risk: '无',
    start: '2026-01-01',
    end: '2026-01-02',
  },
  dev = {
    summary: '实现',
    selfTest: '通过',
    releaseVersion: '1',
    environment: '本地',
    knownIssues: '无',
  };
function flow() {
  let t = fixture();
  return {
    get task() {
      return t;
    },
    act(a: string, p: any = {}, who = 0, at?: string) {
      t = execute(t, a, p, members[who], members, at);
      return t;
    },
  };
}
test('按需求分工授权：成员可兼任产品研发测试，不受预设身份限制', () => {
  let t = fixture();
  t.data.engineerId = 'p';
  t.data.testerId = 'p';
  t.data.productReviewerId = 'e';
  t.data.qaReviewerId = 'q';
  const act = (action: string, payload: any = {}, who = 0) => {
    assert(allowedActions(t, members[who]).includes(action));
    t = execute(t, action, payload, members[who], members);
  };
  act('SUBMIT_REQUIREMENT');
  act('SUBMIT_SOLUTION', solution);
  act('APPROVE_SOLUTION', {}, 1);
  act('APPROVE_SOLUTION', {}, 2);
  act('START_DEVELOPMENT');
  act('COMPLETE_DEVELOPMENT', dev);
  act('START_TEST', { environment: 'local' });
  act('PASS_TEST', { record: '通过', deployment: '验证通过' });
  act('ACCEPT', { checks: [true] });
  assert.equal(t.status, 'CLOSED');
  const reassigned = execute(
    fixture(),
    'TRANSFER',
    { testerId: 'e' },
    members[0],
    members,
  );
  assert.equal(reassigned.data.testerId, 'e');
  assert.equal(
    reassigned.data.history.at(-1)?.payload.reason,
    '调整需求责任分工',
  );
});
test('完整闭环、两个评估槽位与不可变原始值', () => {
  const f = flow();
  const original = f.task;
  f.act('SUBMIT_REQUIREMENT');
  assert.equal(original.status, 'DRAFT');
  f.act('SUBMIT_SOLUTION', solution, 1);
  f.act('APPROVE_SOLUTION');
  assert.equal(f.task.status, 'SOLUTION_REVIEW');
  assert.throws(() => f.act('START_DEVELOPMENT', {}, 1));
  f.act('APPROVE_SOLUTION', {}, 2);
  assert.equal(f.task.status, 'READY_FOR_DEV');
  f.act('START_DEVELOPMENT', {}, 1);
  f.act('COMPLETE_DEVELOPMENT', dev, 1);
  f.act('START_TEST', { environment: 'local' }, 2);
  f.act('PASS_TEST', { record: '通过', deployment: '检查通过' }, 2);
  assert.throws(() => f.act('ACCEPT', { checks: [false] }));
  f.act('ACCEPT', { checks: [true] });
  assert.equal(f.task.status, 'CLOSED');
  assert.throws(() => f.act('CANCEL', { reason: '重开' }));
});
test('职责分离与非指定审批拒绝', () => {
  const f = flow();
  f.task.data.qaReviewerId = 'p';
  assert.throws(() => f.act('SUBMIT_REQUIREMENT'));
  f.task.data.qaReviewerId = 'q';
  f.act('SUBMIT_REQUIREMENT');
  f.act('SUBMIT_SOLUTION', solution, 1);
  assert.throws(() => f.act('APPROVE_SOLUTION', {}, 1));
});
test('方案退回后两个槽位重新审批', () => {
  const f = flow();
  f.act('SUBMIT_REQUIREMENT');
  f.act('SUBMIT_SOLUTION', solution, 1);
  f.act('APPROVE_SOLUTION');
  assert.throws(() => f.act('REJECT_SOLUTION', {}, 2));
  f.act('REJECT_SOLUTION', { reason: '补充风险' }, 2);
  f.act('SUBMIT_SOLUTION', solution, 1);
  f.act('APPROVE_SOLUTION', {}, 2);
  assert.equal(f.task.status, 'SOLUTION_REVIEW');
  f.act('APPROVE_SOLUTION');
  assert.equal(f.task.data.reviewSnapshot.solutionVersion, 2);
});
test('测试退回保留结论并生成新轮次；变更废止旧评估', () => {
  const f = flow();
  f.act('SUBMIT_REQUIREMENT');
  f.act('SUBMIT_SOLUTION', solution, 1);
  f.act('APPROVE_SOLUTION');
  f.act('APPROVE_SOLUTION', {}, 2);
  f.act('START_DEVELOPMENT', {}, 1);
  f.act('COMPLETE_DEVELOPMENT', dev, 1);
  f.act('START_TEST', { environment: 'local' }, 2);
  assert.throws(() =>
    f.act(
      'FAIL_TEST',
      { reason: '失败', record: '失败', deployment: 'local' },
      2,
    ),
  );
  f.act(
    'FAIL_TEST',
    { reason: '失败', record: '失败', deployment: 'local', defectIds: ['bug'] },
    2,
  );
  f.act('COMPLETE_DEVELOPMENT', dev, 1);
  assert.equal(f.task.data.tests.length, 2);
  assert.equal(f.task.data.tests[0].status, 'FAILED');
  f.act('APPLY_REQUIREMENT_CHANGE', {
    reason: '调整',
    impact: '接口',
    description: '新需求',
    criteria: ['新标准'],
  });
  assert.equal(f.task.status, 'SOLUTION_PENDING');
  assert.equal(f.task.data.reviewSnapshot, undefined);
  assert.equal(f.task.data.tests[1].status, 'VOID');
  assert.equal(f.task.data.requirements.length, 2);
});
test('阻塞阶段不变且耗时正确扣除', () => {
  const f = flow();
  f.act('BLOCK', { reason: '等待' }, 0, '2026-01-01T01:00:00Z');
  assert.equal(f.task.status, 'DRAFT');
  assert.throws(() => f.act('SUBMIT_REQUIREMENT'));
  f.act('UNBLOCK', { reason: '已就绪' }, 0, '2026-01-01T03:00:00Z');
  f.act('SUBMIT_REQUIREMENT', {}, 0, '2026-01-01T04:00:00Z');
  const m = metrics([f.task], Date.parse('2026-01-01T05:00:00Z'))[0];
  assert.equal(m.stages.DRAFT.totalHours, 4);
  assert.equal(m.stages.DRAFT.netHours, 2);
});
test('验收退回待测试必须新轮次', () => {
  const f = flow();
  f.act('SUBMIT_REQUIREMENT');
  f.act('SUBMIT_SOLUTION', solution, 1);
  f.act('APPROVE_SOLUTION');
  f.act('APPROVE_SOLUTION', {}, 2);
  f.act('START_DEVELOPMENT', {}, 1);
  f.act('COMPLETE_DEVELOPMENT', dev, 1);
  f.act('START_TEST', { environment: 'local' }, 2);
  f.act('PASS_TEST', { record: '通过', deployment: '通过' }, 2);
  f.act('REJECT_ACCEPTANCE', { reason: '补充检查', target: 'READY_FOR_TEST' });
  assert.equal(f.task.data.tests.length, 2);
  assert.throws(() => f.act('ACCEPT', { checks: [true] }));
});

test('草稿可逐项调整未完成的角色分工，提交仍检查评估独立性', () => {
  let task = fixture();
  task.data.engineerId = 'p';
  task.data.qaReviewerId = 'p';
  task = execute(task, 'TRANSFER', { testerId: 'e' }, members[0], members);
  assert.equal(task.data.testerId, 'e');
  assert.equal(task.status, 'DRAFT');
  assert.throws(
    () => execute(task, 'SUBMIT_REQUIREMENT', {}, members[0], members),
    /不同账号/,
  );
  assert.throws(
    () =>
      execute(task, 'TRANSFER', { testerId: 'outside' }, members[0], members),
    /当前项目/,
  );
  task = execute(task, 'TRANSFER', { engineerId: 'e' }, members[0], members);
  task = execute(task, 'TRANSFER', { qaReviewerId: 'q' }, members[0], members);
  assert.equal(
    execute(task, 'SUBMIT_REQUIREMENT', {}, members[0], members).status,
    'SOLUTION_PENDING',
  );
});

test('单人简易流程允许兼任，支持退回、重新交付和逐项验收', () => {
  const solo = members[0];
  let t = fixture();
  t.data.workflow = 'SIMPLE';
  t.data.engineerId = solo.id;
  t.data.background = '';
  t.data.goal = '';
  t.data.productReviewerId = '';
  t.data.qaReviewerId = '';
  t.data.testerId = '';
  t = execute(t, 'SUBMIT_REQUIREMENT', {}, solo, [solo]);
  assert.equal(t.status, 'READY_FOR_DEV');
  assert.deepEqual(
    allowedActions(t, solo).filter((a) => a.startsWith('START')),
    ['START_WORK'],
  );
  assert.throws(() => execute(t, 'START_DEVELOPMENT', {}, solo, [solo]));
  t = execute(t, 'START_WORK', {}, solo, [solo]);
  t = execute(t, 'SUBMIT_ACCEPTANCE', { summary: '已完成' }, solo, [solo]);
  assert.throws(() => execute(t, 'ACCEPT', { checks: [false] }, solo, [solo]));
  t = execute(
    t,
    'REJECT_ACCEPTANCE',
    { reason: '补充结果', target: 'DEVELOPING' },
    solo,
    [solo],
  );
  assert.equal(t.status, 'DEVELOPING');
  t = execute(t, 'SUBMIT_ACCEPTANCE', { summary: '补充完成' }, solo, [solo]);
  t = execute(t, 'ACCEPT', { checks: [true] }, solo, [solo]);
  assert.equal(t.status, 'CLOSED');
  assert.equal(t.data.development.length, 2);
  assert.equal(t.data.requirements.length, 1);
});

test('标准流程不能绕过评估，管理员只获得转交能力，回收站禁止流转', () => {
  const t = fixture();
  assert.throws(() => execute(t, 'START_WORK', {}, members[0], members));
  assert.throws(() =>
    execute(t, 'TRANSFER', { productId: 'e' }, members[1], members),
  );
  const next = execute(
    t,
    'TRANSFER',
    { productId: 'e' },
    members[1],
    members,
    undefined,
    true,
  );
  assert.equal(next.data.productId, 'e');
  assert.equal(next.data.history.at(-1)?.actor, 'e');
  assert.equal(t.data.productId, 'p');
  const trash = { ...t, deletedAt: new Date().toISOString() };
  assert.deepEqual(allowedActions(trash, members[0], true), []);
  assert.throws(() =>
    execute(trash, 'SUBMIT_REQUIREMENT', {}, members[0], members),
  );
});

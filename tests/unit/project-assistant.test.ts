import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installProjectAssistantRoutes } from '../../apps/api/src/modules/ai/project-assistant-routes.js';
import {
  assistantSources,
  assistantFingerprint,
  validateProjectPlan,
} from '../../apps/api/src/modules/ai/project-assistant.js';

const task: any = {
  id: 'a',
  number: 1,
  version: 3,
  status: 'SOLUTION_REVIEW',
  data: {
    title: '支付回归',
    goal: '完成支付回归',
    criteria: [],
    dueAt: '2026-10-19',
    priority: 'HIGH',
    productId: 'product',
    engineerId: 'engineer',
    productReviewerId: 'product',
    qaReviewerId: 'qa',
    testerId: 'qa',
    reviews: [{ round: 1, userId: 'product' }],
    solutions: [{}],
    blocks: [{ reason: '等待测试环境' }],
    development: [],
    tests: [],
    description: '不应发送无关正文',
    comments: ['不应发送评论'],
    history: ['不应发送历史'],
  },
};
test('推进依据排除终止和删除需求，使用上海日期并保留真实待评估处理人', () => {
  const sources = assistantSources(
    [
      task,
      { ...task, id: 'b', status: 'CLOSED' },
      { ...task, id: 'c', deletedAt: '2026-10-20' },
    ],
    Date.parse('2026-10-20T00:00:00+08:00'),
  );
  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0].handlerIds, ['qa']);
  assert.deepEqual(sources[0].signals, [
    '存在未解除阻塞',
    '已逾期',
    '缺少验收标准',
  ]);
  assert(!sources[0].text.includes('不应发送'));
  assert.equal(
    assistantSources(
      [{ ...task, data: { ...task.data, dueAt: '2026-10-20' } }],
      Date.parse('2026-10-20T12:00:00+08:00'),
    )[0].signals.includes('已逾期'),
    false,
  );
});
test('行动引用必须属于真实需求且逐字包含依据，拒绝跨需求、编造和重复', () => {
  const sources = assistantSources([task]);
  const action = {
    taskId: 'a',
    priority: 'HIGH',
    action: '确认测试环境',
    acceptance: '明确环境可用时间',
    evidence: '等待测试环境',
  };
  const report = { summary: '先解除阻塞', actions: [action], questions: [] };
  assert.equal(validateProjectPlan(report, sources).actions.length, 1);
  for (const actions of [
    [{ ...action, taskId: 'other-project' }],
    [{ ...action, evidence: '测试已经通过' }],
    [action, action],
  ]) {
    assert.throws(() => validateProjectPlan({ ...report, actions }, sources));
  }
  assert.throws(() => validateProjectPlan({ ...report, actions: [] }, sources));
  assert.throws(() =>
    validateProjectPlan({ ...report, executed: true }, sources),
  );
});
test('任务版本、负责人、截止和阻塞变化都会改变依据指纹', () => {
  const before = assistantFingerprint(assistantSources([task]));
  for (const changed of [
    { ...task, version: 4 },
    { ...task, data: { ...task.data, qaReviewerId: 'new-qa' } },
    { ...task, data: { ...task.data, dueAt: '2026-11-01' } },
    { ...task, data: { ...task.data, blocks: [] } },
  ])
    assert.notEqual(assistantFingerprint(assistantSources([changed])), before);
});

test('生成路由复用个人模型配置，生成中版本变化拒绝返回，超限不调用模型', async (t) => {
  const current = structuredClone(task);
  const routes = new Map<string, any>();
  let rows = [current],
    audits = 0,
    locks = 0,
    captured: any;
  const project = {
    id: 'p',
    workspaceId: 'w',
    name: '项目',
    description: '',
    archivedAt: null,
    workflow: 'STANDARD',
  };
  const db: any = {
    project: { findUniqueOrThrow: async () => project },
    task: { findMany: async () => structuredClone(rows) },
    projectMember: { findMany: async () => [{ userId: 'qa', roles: ['QA'] }] },
    user: { findMany: async () => [{ id: 'qa', name: '测试' }] },
    projectGoal: { findMany: async () => [] },
    iteration: { findMany: async () => [] },
    projectAction: { findMany: async () => [] },
    projectGoalTask: { findMany: async () => [] },
    projectGoalIteration: { findMany: async () => [] },
    iterationMilestone: { findMany: async () => [] },
    iterationTask: { findMany: async () => [] },
  };
  db.$transaction = async (fn: any) => fn(db);
  installProjectAssistantRoutes(
    {
      get: (path: string, fn: any) => routes.set('GET ' + path, fn),
      post: (path: string, fn: any) => routes.set('POST ' + path, fn),
    } as any,
    {
      db,
      wrap: (fn: any) => fn,
      hash: assistantFingerprint,
      project: async () => project,
      projectWrite: async () => {
        locks++;
        return project;
      },
      record: async () => {
        audits++;
      },
      savedCredentials: async (id: string) => {
        assert.equal(id, 'assistant-user');
        return { apiKey: 'mock-assistant-key', model: 'deepseek-flash' };
      },
    } as any,
  );
  const req: any = { params: { id: 'p' }, user: { id: 'assistant-user' } };
  const res = {
    setHeader: () => {},
    json: (value: any) => {
      captured = value;
    },
  };
  await routes.get('GET /projects/:id/assistant')(req, res);
  const fingerprint = captured.fingerprint;
  req.body = { goal: '推进项目', fingerprint };
  let changeDuringGeneration = false;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'deepseek-flash');
    assert(!options.body.includes('mock-assistant-key'));
    assert(!options.body.includes('不应发送'));
    if (changeDuringGeneration) current.version++;
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              summary: '优先解除阻塞',
              actions: [
                {
                  taskId: 'a',
                  priority: 'HIGH',
                  action: '确认环境',
                  acceptance: '环境可以复核',
                  evidence: '等待测试环境',
                },
              ],
              questions: [],
            }),
          },
        },
      ],
    });
  });
  await routes.get('POST /projects/:id/assistant/run')(req, res);
  assert.equal(captured.result.actions[0].taskId, 'a');
  assert.equal(captured.model, 'deepseek-flash');
  assert.equal(audits, 1);
  assert.equal(locks, 1);
  changeDuringGeneration = true;
  await assert.rejects(
    routes.get('POST /projects/:id/assistant/run')(req, res),
    /生成期间项目已变化/,
  );
  assert.equal(audits, 1);
  assert.equal(calls, 2);
  await assert.rejects(
    routes.get('POST /projects/:id/assistant/run')(req, res),
    /项目已变化/,
  );
  assert.equal(calls, 2);
  rows = Array.from({ length: 201 }, (_, i) => ({ ...current, id: String(i) }));
  await assert.rejects(
    routes.get('GET /projects/:id/assistant')(req, res),
    /最多200项/,
  );
});

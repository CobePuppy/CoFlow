import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateQualityReview,
  installQualityRoutes,
  reviewSources,
  reviewFingerprint,
  qualityJson,
} from '../apps/api/src/ai-quality.js';
const credentials = { apiKey: 'sk-quality-mock-only', model: 'deepseek-flash' };
const task = {
  data: {
    title: '需求标题',
    goal: '支持导出报告',
    description: '用户可导出PDF文件',
    background: '人工整理效率低',
    criteria: ['生成可打开的PDF'],
    solutions: [],
    development: [],
    tests: [],
    comments: [{ body: '私密评论' }],
    productId: 'private-user-id',
  },
};
const sources = reviewSources(task, []);
const result = () => ({
  outcome: 'NEEDS_CHANGES',
  summary: '现有资料缺少可复现测试步骤，需补充后进行人工确认。',
  checks: [
    {
      criterion: '需求目标',
      status: 'PASS',
      explanation: '需求明确支持导出报告',
      suggestion: '',
      evidence: [{ sourceId: 'requirement', quote: '支持导出报告' }],
    },
    {
      criterion: '边界条件',
      status: 'MISSING',
      explanation: '没有明确文件大小和权限限制',
      suggestion: '补充边界条件',
      evidence: [],
    },
    {
      criterion: '测试覆盖',
      status: 'MISSING',
      explanation: '没有提供真实测试执行记录',
      suggestion: '补充预期与实际结果',
      evidence: [],
    },
  ],
});
const mock = (value: any, reason = 'stop') =>
  (async () =>
    Response.json({
      choices: [
        { finish_reason: reason, message: { content: JSON.stringify(value) } },
      ],
    })) as typeof fetch;
test('AI质量评审只发送白名单材料，引用严格匹配并复用配置模型', async () => {
  assert(!JSON.stringify(sources).includes('私密评论'));
  assert(!JSON.stringify(sources).includes('private-user-id'));
  let request: any;
  const fetcher = (async (url: any, options: any) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    request = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer ' + credentials.apiKey);
    return mock(result())(url, options);
  }) as typeof fetch;
  const reviewed = await generateQualityReview(
    'REQUIREMENT',
    sources,
    credentials,
    fetcher,
  );
  assert.equal(request.model, credentials.model);
  assert(!JSON.stringify(request).includes(credentials.apiKey));
  assert.equal(reviewed.outcome, 'NEEDS_CHANGES');
});
test('AI评审拒绝虚构引用、无证据通过、矛盾结论和截断输出', async () => {
  const fabricated = result();
  fabricated.checks[0].evidence[0].quote = '原文不存在的事实';
  await assert.rejects(
    generateQualityReview(
      'REQUIREMENT',
      sources,
      credentials,
      mock(fabricated),
    ),
    /引用与原文不符/,
  );
  const noEvidence = result();
  noEvidence.checks[0].evidence = [];
  await assert.rejects(
    generateQualityReview(
      'REQUIREMENT',
      sources,
      credentials,
      mock(noEvidence),
    ),
    /缺少依据/,
  );
  const conflict = result();
  conflict.outcome = 'PASSED';
  await assert.rejects(
    generateQualityReview('REQUIREMENT', sources, credentials, mock(conflict)),
    /结论与检查项冲突/,
  );
  await assert.rejects(
    generateQualityReview(
      'TEST',
      sources,
      credentials,
      mock(result(), 'length'),
    ),
    /输出不完整/,
  );
});
test('材料缺失强制不足、评审标记随材料变化而过期，历史评论不影响材料摘要', async () => {
  assert.equal(
    (
      await generateQualityReview(
        'SOLUTION',
        sources,
        credentials,
        mock(result()),
      )
    ).outcome,
    'INSUFFICIENT',
  );
  const before = reviewFingerprint('REQUIREMENT', sources);
  const comments = structuredClone(task);
  comments.data.comments.push({ body: '新评论' });
  assert.equal(
    before,
    reviewFingerprint('REQUIREMENT', reviewSources(comments, [])),
  );
  comments.data.goal = '修改后的目标';
  assert.notEqual(
    before,
    reviewFingerprint('REQUIREMENT', reviewSources(comments, [])),
  );
  await assert.rejects(
    qualityJson('json', { text: 'x'.repeat(100001) }, credentials, mock({})),
    /10万字符/,
  );
});

test('评审使用个人配置、保存报告及审计且不改变审批状态，版本冲突拒绝写入', async (t) => {
  const current: any = {
    id: 'quality-task',
    workspaceId: 'quality-team',
    projectId: 'quality-project',
    version: 1,
    status: 'DRAFT',
    data: structuredClone(task.data),
  };
  const routes = new Map<string, any>();
  let savedCredentialFor = '',
    locks = 0,
    audits = 0;
  const db: any = {
    document: { findMany: async () => [] },
    task: {
      findUnique: async () => structuredClone(current),
      updateMany: async ({ where, data }: any) => {
        if (where.version !== current.version) return { count: 0 };
        current.data = data.data;
        current.version += 1;
        return { count: 1 };
      },
    },
  };
  db.$transaction = async (fn: any) => fn(db);
  installQualityRoutes(
    {
      get: (path: string, fn: any) => routes.set('GET ' + path, fn),
      post: (path: string, fn: any) => routes.set('POST ' + path, fn),
    },
    {
      db,
      wrap: (fn: any) => fn,
      task: async () => structuredClone(current),
      project: async () => ({}),
      projectWrite: async () => {
        locks++;
      },
      record: async () => {
        audits++;
      },
      savedCredentials: async (id: string) => {
        savedCredentialFor = id;
        return credentials;
      },
    },
  );
  t.mock.method(globalThis, 'fetch', mock(result()));
  const request = {
    params: { id: current.id },
    user: { id: 'quality-route-user' },
    body: {
      kind: 'REQUIREMENT',
      documentIds: [],
      expectedVersion: 1,
      consent: true,
    },
  };
  let response: any;
  await routes.get('POST /tasks/:id/ai-reviews')(request, {
    json: (v: any) => {
      response = v;
    },
  });
  assert.equal(savedCredentialFor, request.user.id);
  assert.equal(locks, 1);
  assert.equal(audits, 1);
  assert.equal(current.status, 'DRAFT');
  assert.equal(current.version, 2);
  assert.equal(current.data.aiReviews[0].id, response.id);
  assert(!JSON.stringify(current.data.aiReviews).includes(credentials.apiKey));
  await routes.get('GET /tasks/:id/ai-reviews')(request, {
    json: (v: any) => {
      response = v;
    },
  });
  assert.equal(response.items[0].stale, false);
  await assert.rejects(
    routes.get('POST /tasks/:id/ai-reviews')(request, { json: () => {} }),
    /需求已更新/,
  );
});

test('阶段文件AI导入复用个人配置、校验同意及字段白名单，不保存业务数据', async (t) => {
  const routes = new Map<string, any>();
  let credentialReads = 0;
  installQualityRoutes(
    { get: () => {}, post: (path: string, fn: any) => routes.set(path, fn) },
    {
      wrap: (fn: any) => fn,
      savedCredentials: async (id: string) => {
        assert.equal(id, 'material-import-user');
        credentialReads++;
        return credentials;
      },
    },
  );
  const handler = routes.get('/ai/import');
  const request = {
    user: { id: 'material-import-user' },
    body: {
      kind: 'solution',
      text: '技术方案：实现导出。影响范围：Web。',
      consent: true,
    },
  };
  t.mock.method(
    globalThis,
    'fetch',
    mock({ body: '实现导出', scope: 'Web', effort: '' }),
  );
  let response: any;
  await handler(request, {
    json: (value: any) => {
      response = value;
    },
  });
  assert.equal(response.fields.body, '实现导出');
  assert.equal(response.model, credentials.model);
  assert.equal(credentialReads, 1);
  assert(!JSON.stringify(response).includes(credentials.apiKey));
  await assert.rejects(
    handler(
      { ...request, body: { ...request.body, consent: false } },
      { json: () => {} },
    ),
  );
  assert.equal(credentialReads, 1);
  t.mock.method(
    globalThis,
    'fetch',
    mock({ record: '测试记录', status: 'PASSED' }),
  );
  await assert.rejects(
    handler(
      { ...request, body: { ...request.body, kind: 'testing' } },
      { json: () => {} },
    ),
    /AI提取格式不正确/,
  );
});

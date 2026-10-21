import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  firstStepSections,
  firstStepMessages,
  type FirstStepBundle,
} from '@coflow/contracts/firststep.js';
import {
  firstStepRunSchema,
  generateFirstStep,
  verifyFirstStepKey,
  withFirstStepLimit,
} from '../../apps/api/src/modules/ai/firststep.js';
import { BusinessError } from '../../apps/api/src/modules/requirements/domain.js';
const key = 'sk-test-firststep-only-key';
const competition = {
  name: '校园项目赛',
  organizer: '学校',
  deadline: '2026-12-01',
  url: 'https://example.com/notice',
  notes: '赛题要求',
};
const brief = {
  problem:
    '为校园项目设计可验证的方案，提供需求分析、成果说明和答辩材料。需要明确实现范围、评分依据和验收标准。',
  team: '3人，前端和数据分析',
  constraints: '两周，预算有限',
  slides: 12,
  minutes: 8,
};
const bundle = {
  ...Object.fromEntries(
    Object.keys(firstStepSections).map((k) => [
      k,
      '## ' +
        k +
        '\n' +
        '这是待核对的竞赛规划，包含依据、任务和验证步骤。'.repeat(4),
    ]),
  ),
  questions: ['需确认官方评分要求'],
} as unknown as FirstStepBundle;
const response = (value: unknown) =>
  Response.json({
    choices: [
      { finish_reason: 'stop', message: { content: JSON.stringify(value) } },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 800 },
  });

test('FirstStep提示词明确资料边界、PPT要求和6类成果，登记信息使用白名单', () => {
  const messages = firstStepMessages(
    {
      ...competition,
      ...{ id: 'private-id', outcome: 'private-outcome' },
    } as typeof competition,
    brief,
  );
  assert.match(messages[0].content, /严格 JSON/);
  assert.match(messages[0].content, /不访问链接/);
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.用户提供资料.slides, 12);
  assert.equal(
    firstStepRunSchema.safeParse({
      apiKey: key,
      model: 'deepseek-flash',
      brief,
      expectedVersion: 1,
      consent: true,
    }).success,
    false,
  );
  assert.equal(payload.竞赛登记信息.id, undefined);
  assert.equal(payload.竞赛登记信息.outcome, undefined);
  assert.equal(
    firstStepRunSchema.safeParse({
      model: 'deepseek-flash',
      brief,
      expectedVersion: 1,
      consent: false,
    }).success,
    false,
  );
  assert.equal(
    firstStepRunSchema.safeParse({
      model: 'deepseek-flash',
      brief,
      expectedVersion: 1,
      consent: true,
    }).success,
    true,
  );
});
test('DeepSeek固定地址及认证，密钥不进入提示词，输出按结构校验', async () => {
  const fake: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal((init?.headers as any).Authorization, 'Bearer ' + key);
    assert.equal(init?.redirect, 'error');
    assert(!String(init?.body).includes(key));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.type, 'json_object');
    return response(bundle);
  };
  const result = await generateFirstStep(
    competition,
    { ...brief, problem: brief.problem + key },
    key,
    'deepseek-flash',
    fake,
  );
  assert.deepEqual(result.bundle, bundle);
  assert.equal(result.usage.completionTokens, 800);
  const encoded = JSON.stringify({
    ...bundle,
    analysis: bundle.analysis + key,
  }).replaceAll(
    key,
    Array.from(key)
      .map((char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
      .join(''),
  );
  const redacted = await generateFirstStep(
    competition,
    brief,
    key,
    'deepseek-flash',
    async () =>
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: encoded } }],
      }),
  );
  assert(!redacted.bundle.analysis.includes(key));
});
test('上游Key、余额、限流与网络异常有可读提示，不暴露原文或影响登录状态', async () => {
  for (const status of [401, 403, 402, 429, 500]) {
    await assert.rejects(
      generateFirstStep(
        competition,
        brief,
        key,
        'deepseek-flash',
        async () => new Response('echo ' + key, { status }),
      ),
      (error: unknown) => {
        assert(error instanceof BusinessError);
        assert.notEqual(error.status, 401);
        assert(!error.message.includes(key));
        assert(!error.message.includes('echo'));
        return true;
      },
    );
  }
  await assert.rejects(
    generateFirstStep(competition, brief, key, 'deepseek-flash', async () => {
      throw new Error('network ' + key);
    }),
    /连接失败或超时/,
  );
});
test('拒绝空、截断、非JSON和缺章成果，保留安全错误', async () => {
  const invalid = [
    Response.json(null),
    Response.json({
      choices: [{ finish_reason: 'length', message: { content: '{}' } }],
    }),
    Response.json({
      choices: [{ finish_reason: 'stop', message: { content: '' } }],
    }),
    response({ analysis: '缺失' }),
    new Response('not-json'),
  ];
  for (const item of invalid)
    await assert.rejects(
      generateFirstStep(
        competition,
        brief,
        key,
        'deepseek-flash',
        async () => item,
      ),
      BusinessError,
    );
});
test('Key验证仅查询模型，单用户并发调用被拦截且异常后释放', async () => {
  const result = await verifyFirstStepKey(
    key,
    'deepseek-flash',
    async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/models');
      assert.equal(init?.method, 'GET');
      assert.equal(init?.body, undefined);
      return Response.json({ data: [{ id: 'deepseek-flash' }] });
    },
  );
  assert.equal(result.ok, true);
  await assert.rejects(
    verifyFirstStepKey(key, 'deepseek-v4-pro', async () =>
      Response.json({ data: [] }),
    ),
    /模型不可用/,
  );
  let release!: () => void;
  const pending = withFirstStepLimit(
    'unit-firststep',
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    withFirstStepLimit('unit-firststep', async () => {}),
    /当前已有AI请求/,
  );
  release();
  await pending;
  await assert.rejects(
    withFirstStepLimit('unit-firststep', async () => {
      throw new Error('failure');
    }),
    /failure/,
  );
  assert.equal(
    await withFirstStepLimit('unit-firststep', async () => true),
    true,
  );
});

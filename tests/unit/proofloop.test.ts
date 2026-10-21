import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimSchema,
  claimEvidenceDigest,
  claimsDigest,
  evidenceState,
  checkContradictions,
} from '../../apps/api/src/modules/proofloop/routes.js';
const a = '10000000-0000-4000-8000-000000000011',
  b = '10000000-0000-4000-8000-000000000012';
const docs = [
  {
    id: a,
    title: '论文',
    content: '同一测试集上的准确率为95%，以完整实验记录为准。',
    version: 1,
  },
  {
    id: b,
    title: '实验记录',
    content: '同一测试集上的准确率为89%，此次为正式验收结果。',
    version: 2,
  },
];
const claim = {
  id: a,
  ...claimSchema.parse({
    statement: '同一测试集上准确率达到95%',
    evidence: [{ documentId: a, version: 1, quote: '准确率为95%' }],
  }),
};
test('ProofLoop证据状态区分缺失、已关联与源文书过期；任务链接不使检查过期', () => {
  assert.equal(evidenceState({ ...claim, evidence: [] }, docs), 'MISSING');
  assert.equal(evidenceState(claim, docs), 'RECORDED');
  assert.equal(evidenceState(claim, [{ ...docs[0], version: 2 }]), 'OUTDATED');
  assert.equal(
    evidenceState(claim, [{ ...docs[0], content: '已删除原文' }]),
    'OUTDATED',
  );
  assert.equal(claimsDigest([claim]), claimsDigest([{ ...claim, taskId: b }]));
  assert.notEqual(
    claimsDigest([claim]),
    claimsDigest([{ ...claim, statement: '新的主张内容' }]),
  );
});
test('ProofLoop检查要求来自不同文书的逐字依据，拒绝杜撰和不完整响应', async () => {
  const finding = {
    reason: '两份文书对于同一测试集上的准确率表述不一致，需要核对版本。',
    suggestion: '核对测试集哈希和实验版本，并重新运行相同条件下的评估。',
    sources: [
      { documentId: a, quote: '准确率为95%' },
      { documentId: b, quote: '准确率为89%' },
    ],
  };
  const fake =
    (value: unknown, finish = 'stop'): typeof fetch =>
    async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert(!String(init?.body).includes('sk-unit-test-key'));
      return Response.json({
        choices: [
          {
            finish_reason: finish,
            message: { content: JSON.stringify(value) },
          },
        ],
      });
    };
  const result = await checkContradictions(
    docs,
    [claim],
    'sk-unit-test-key',
    'deepseek-flash',
    fake({ findings: [finding] }),
  );
  assert.equal(result.length, 1);
  assert(result[0].id);
  await assert.rejects(
    () =>
      checkContradictions(
        docs,
        [],
        'sk-unit-test-key',
        'deepseek-flash',
        fake({
          findings: [
            { ...finding, sources: [finding.sources[0], finding.sources[0]] },
          ],
        }),
      ),
    /不同文书/,
  );
  await assert.rejects(
    () =>
      checkContradictions(
        docs,
        [],
        'sk-unit-test-key',
        'deepseek-flash',
        fake({
          findings: [
            {
              ...finding,
              sources: [
                finding.sources[0],
                { documentId: b, quote: '不存在的实验结果' },
              ],
            },
          ],
        }),
      ),
    /原文不符/,
  );
  await assert.rejects(
    () =>
      checkContradictions(
        docs,
        [],
        'sk-unit-test-key',
        'deepseek-flash',
        fake({ findings: [] }, 'length'),
      ),
    /未完成/,
  );
  assert.deepEqual(
    await checkContradictions(
      docs,
      [],
      'sk-unit-test-key',
      'deepseek-flash',
      fake({ findings: [] }),
    ),
    [],
  );
});

test('第一轮：补证建议遵守预算及三项上限，排序公开且排除已核对支持的主张', async () => {
  const { planProofWork } = await import('@coflow/contracts/proofloop.js');
  const claims = [
    { id: 'a', statement: '高重要度缺失', importance: 5, effortHours: 2 },
    { id: 'b', statement: '低重要度缺失', importance: 1, effortHours: 2 },
    { id: 'c', statement: '已核对', importance: 5, effortHours: 1 },
    { id: 'd', statement: '耗时超过预算', importance: 5, effortHours: 20 },
  ];
  const plan = planProofWork(
    claims,
    { a: 'MISSING', b: 'OUTDATED', c: 'VERIFIED', d: 'MISSING' },
    4,
  );
  assert.deepEqual(
    plan.selected.map((c) => c.id),
    ['a', 'b'],
  );
  assert.equal(plan.plannedHours, 4);
  assert.equal(plan.selected[0].priority, 7.5);
  assert.deepEqual(planProofWork(claims, {}, 0).selected, []);
  assert.equal(
    planProofWork(
      Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        statement: '主张',
      })),
      {},
      80,
    ).selected.length,
    3,
  );
});

test('第二轮：人工核对绑定证据内容，主张变化或文书换版后失效，工时变化不影响证据判断', () => {
  const review = {
    by: 'reviewer',
    at: new Date().toISOString(),
    outcome: 'SUPPORTED' as const,
    note: '已核对原始实验和数据口径，仅在该测试集及版本内成立。',
    fingerprint: claimEvidenceDigest(claim),
  };
  const reviewed = { ...claim, reviews: [review] };
  assert.equal(evidenceState(reviewed, docs), 'VERIFIED');
  assert.equal(
    evidenceState({ ...reviewed, statement: '变更了结论内容' }, docs),
    'RECORDED',
  );
  assert.equal(
    evidenceState({ ...reviewed, effortHours: 4 }, docs),
    'VERIFIED',
  );
  assert.equal(
    evidenceState(reviewed, [{ ...docs[0], version: 2 }]),
    'OUTDATED',
  );
  assert.equal(
    evidenceState(
      { ...claim, reviews: [{ ...review, outcome: 'REFUTED' }] },
      docs,
    ),
    'REFUTED',
  );
});

test('第三轮：证据包固定快照摘要、原文哈希和未解决清单，不包含未关联文书', async () => {
  const { canonicalJson, createProofExport } = await import(
    '../../apps/api/src/modules/proofloop/export.js'
  );
  const { createHash } = await import('node:crypto');
  assert.equal(
    canonicalJson({ z: 1, a: { d: 2, c: 3 } }),
    canonicalJson({ a: { c: 3, d: 2 }, z: 1 }),
  );
  const view = {
    version: 3,
    data: { claims: [claim], findings: [] },
    states: { [a]: 'OUTDATED' },
    tasks: {},
    documents: docs,
    checkOutdated: true,
  };
  const pack = createProofExport(
    { id: a, name: '竞赛', version: 1 },
    { id: b, name: '项目' },
    view,
    '2026-10-17T00:00:00Z',
  );
  assert.equal(pack.payload.documents.length, 1);
  assert.equal(pack.payload.documents[0].id, a);
  assert.equal(pack.payload.unresolved.length, 1);
  assert.match(pack.markdown, /证据已过期/);
  assert.match(pack.markdown, /检查已过期/);
  assert.equal(
    pack.digest,
    createHash('sha256').update(canonicalJson(pack.payload)).digest('hex'),
  );
  assert.equal(
    pack.payload.documents[0].contentSha256,
    createHash('sha256').update(docs[0].content).digest('hex'),
  );
  const changed = { ...pack.payload, boardVersion: 4 };
  assert.notEqual(
    pack.digest,
    createHash('sha256').update(canonicalJson(changed)).digest('hex'),
  );
  const verified = createProofExport(
    { id: a, name: '竞赛', version: 1 },
    { id: b, name: '项目' },
    { ...view, states: { [a]: 'VERIFIED' } },
    '2026-10-17T00:00:00Z',
  );
  assert.equal(verified.payload.unresolved.length, 0);
  assert.match(verified.markdown, /仍需自行检查/);
});

test('第三轮完整性工具识别文件被改动，不把摘要一致当作真实性认证', async () => {
  const { verifyProofFile } = await import(
    '../../scripts/maintenance/verify-proof.js'
  );
  const { createProofExport } = await import(
    '../../apps/api/src/modules/proofloop/export.js'
  );
  const pack = createProofExport(
    { id: a, name: '竞赛', version: 1 },
    { id: b, name: '项目' },
    {
      version: 1,
      data: { claims: [claim], findings: [] },
      states: { [a]: 'RECORDED' },
      tasks: {},
      documents: docs,
      checkOutdated: false,
    },
  );
  assert.equal(verifyProofFile(pack), true);
  const changed = JSON.parse(JSON.stringify(pack));
  changed.payload.documents[0].content += '修改';
  assert.equal(verifyProofFile(changed), false);
  assert.equal(verifyProofFile({}), false);
  assert.equal(verifyProofFile(null), false);
});

test('最终复查：模型输入使用白名单，不发送核对历史、任务链接及多余元数据', async () => {
  const input = {
    ...claim,
    taskId: 'private-task-id',
    reviews: [
      {
        by: 'private-reviewer',
        at: '2026',
        outcome: 'SUPPORTED' as const,
        note: 'private-review-note',
        fingerprint: 'private-hash',
      },
    ],
  };
  const fetcher: typeof fetch = async (_url, init) => {
    const prompt = JSON.parse(String(init?.body)).messages[1].content;
    assert(!prompt.includes('private-task-id'));
    assert(!prompt.includes('private-reviewer'));
    assert(!prompt.includes('private-review-note'));
    const material = JSON.parse(prompt);
    assert.deepEqual(Object.keys(material.claims[0]).sort(), [
      'criterion',
      'statement',
    ]);
    return Response.json({
      choices: [
        { finish_reason: 'stop', message: { content: '{"findings":[]}' } },
      ],
    });
  };
  await checkContradictions(
    docs,
    [input],
    'sk-unit-test-key',
    'deepseek-flash',
    fetcher,
  );
});

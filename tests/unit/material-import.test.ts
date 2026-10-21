import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  materialFieldsFromText,
  materialKindForAction,
} from '@coflow/contracts/material-import.js';
import { materialImportFields } from '../../apps/api/src/modules/ai/quality.js';

test('方案提取显式工作量、日期和风险，代码块内的标题不作为字段', () => {
  const fields = materialFieldsFromText(
    'solution',
    '# 技术方案\n实现导出功能。\n```md\n## 风险说明\n示例内容\n```\n## 影响范围\nWeb/API\n## 工作量\n2.5 人日\n## 风险说明\n兼容性验证\n## 开始日期\n2026/10/18\n## 结束日期\n2026年10月20日',
  );
  assert.equal(fields.effort, 2.5);
  assert.equal(fields.start, '2026-10-18');
  assert.equal(fields.end, '2026-10-20');
  assert.equal(fields.scope, 'Web/API');
  assert.equal(fields.risk, '兼容性验证');
  assert.match(String(fields.body), /## 风险说明\n示例内容/);
});

test('缺失工作量、相对日期和无效日期不猜测或填入', () => {
  const fields = materialFieldsFromText(
    'solution',
    '实现说明\n## 工作量\n待评估\n## 开始日期\n下周一\n## 结束日期\n2026-02-30',
  );
  assert.equal(fields.effort, undefined);
  assert.equal(fields.start, undefined);
  assert.equal(fields.end, undefined);
  assert.match(String(fields.body), /实现说明/);
});

test('开发和测试资料分别映射字段，不生成测试结论或缺陷关联', () => {
  const dev = materialFieldsFromText(
    'development',
    '## 开发说明\n完成接口\n## 自测结果\n用例可复现\n## 发布版本\nv3\n## 环境\nhttps://example.test\n## 已知问题\n无',
  );
  assert.deepEqual(dev, {
    summary: '完成接口',
    selfTest: '用例可复现',
    releaseVersion: 'v3',
    environment: 'https://example.test',
    knownIssues: '无',
  });
  const result = materialFieldsFromText(
    'testing',
    '## 测试执行记录\n用户导出文件可打开\n## 部署验证\n验证服务正常\n## 失败原因\n按钮错位',
  );
  assert.deepEqual(result, {
    record: '用户导出文件可打开',
    deployment: '验证服务正常',
    reason: '按钮错位',
  });
  assert.equal('status' in result, false);
  assert.equal('defectIds' in result, false);
});

test('无结构原文保留，阶段动作与导入种类对应', () => {
  assert.deepEqual(materialFieldsFromText('testing', '测试原始记录'), {
    record: '测试原始记录',
  });
  assert.equal(materialKindForAction('PASS_TEST'), 'testing');
  assert.equal(materialKindForAction('FAIL_TEST'), 'testing');
  assert.equal(materialKindForAction('START_TEST'), 'testEnvironment');
  assert.equal(materialKindForAction('SUBMIT_ACCEPTANCE'), 'simpleDelivery');
  assert.equal(materialKindForAction('CANCEL'), undefined);
});

test('AI导入白名单拒绝状态、负责人、缺陷ID和超限字段', () => {
  assert.equal(
    materialImportFields('solution').safeParse({
      body: '方案',
      effort: 2,
      start: '2026-10-18',
    }).success,
    true,
  );
  assert.equal(
    materialImportFields('solution').safeParse({ body: '方案', effort: -1 })
      .success,
    false,
  );
  assert.equal(
    materialImportFields('solution').safeParse({
      body: '方案',
      start: '下周一',
    }).success,
    false,
  );
  for (const key of ['status', 'productId', 'defectIds', 'expectedVersion']) {
    assert.equal(
      materialImportFields('testing').safeParse({
        record: '测试记录',
        [key]: 'unexpected',
      }).success,
      false,
    );
  }
  assert.equal(
    materialImportFields('development').safeParse({
      summary: 'x'.repeat(10001),
    }).success,
    false,
  );
  assert.equal(
    materialImportFields('development').safeParse({
      summary: '交付说明',
      releaseVersion: 'v'.repeat(201),
    }).success,
    false,
  );
});

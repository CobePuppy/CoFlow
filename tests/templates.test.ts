import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  templateContent,
  templateFormValues,
} from '../apps/web/src/template-content.js';
import { templateInputSchema } from '../apps/api/src/templates.js';

test('需求模板仅复制内容字段，隔离责任人、流程状态和历史', () => {
  const result = templateContent({
    title: '接口',
    description: '协议',
    criteria: ' 响应成功 \n\n 错误可解释 ',
    priority: 'P1',
    productId: 'old',
    engineerId: 'old',
    status: 'CLOSED',
    dueAt: '2020-01-01',
    history: [{}],
    reviews: [{}],
  });
  assert.deepEqual(result, {
    title: '接口',
    background: '',
    goal: '',
    description: '协议',
    criteria: ['响应成功', '错误可解释'],
    priority: 'P1',
  });
  const form = templateFormValues(result);
  assert.equal(form.criteria, '响应成功\n错误可解释');
  assert.equal(result.criteria.length, 2);
});
test('模板输入校验名称、内容边界和禁用字段', () => {
  const parsed = templateInputSchema.parse({
    name: ' 接口模板 ',
    content: { criteria: [' 通过 '] },
  });
  assert.equal(parsed.name, '接口模板');
  assert.deepEqual(parsed.content.criteria, ['通过']);
  for (const input of [
    { name: ' ', content: {} },
    { name: 'x', content: { productId: 'old' } },
    { name: 'x', content: { priority: 'P9' } },
    { name: 'x', content: { title: 'x'.repeat(201) } },
    { name: 'x', content: { criteria: Array(101).fill('ok') } },
  ])
    assert.equal(templateInputSchema.safeParse(input).success, false);
});

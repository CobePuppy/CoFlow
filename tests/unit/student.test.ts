import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editionFromPath } from '../../packages/web-core/src/app/edition.js';
import {
  studentDraft,
  studentDraftKinds,
} from '../../apps/student-web/src/features/student-drafts.js';
import { competitionInput } from '../../apps/api/src/modules/competitions/schema.js';
test('版本按路径完整前缀区分，并保留旧网址企业版兼容', () => {
  assert.equal(editionFromPath('/student/').id, 'student');
  assert.equal(editionFromPath('/student').base, '/student');
  assert.equal(editionFromPath('/enterprise/').base, '/enterprise');
  assert.equal(editionFromPath('/').base, '');
  assert.equal(editionFromPath('/student-other/').id, 'enterprise');
});
test('学生文书生成可编辑结构，明确标注待填写，不生成结果或文献', () => {
  for (const kind of Object.keys(
    studentDraftKinds,
  ) as (keyof typeof studentDraftKinds)[]) {
    const text = studentDraft(kind, '校园项目');
    assert.match(text, /校园项目/);
    assert.match(text, /结构草稿/);
    assert.match(text, /待填写真实内容及证据/);
  }
});
test('竞赛输入限制网址协议、日期和阶段', () => {
  assert.equal(
    competitionInput.parse({
      name: ' 校园创新赛 ',
      deadline: '2026-12-01',
      url: 'https://example.com',
    }).name,
    '校园创新赛',
  );
  for (const input of [
    { name: '' },
    { name: 'x', url: 'javascript:alert(1)' },
    { name: 'x', url: 'file:///tmp/a' },
    { name: 'x', deadline: '2026-02-30' },
    { name: 'x', stage: 'UNKNOWN' },
  ])
    assert.equal(competitionInput.safeParse(input).success, false);
});

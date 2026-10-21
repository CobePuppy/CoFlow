import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftKey,
  draftValues,
  readDraft,
  writeDraft,
} from '../../packages/web-core/src/shared/lib/browser-draft.js';
function storage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}
const record = (token: string) => ({
  token,
  at: Date.now(),
  base: 3,
  values: { title: '未完成输入' },
});
test('工作副本按账号、空间、项目和编辑入口隔离且只保存白名单字段', () => {
  assert.notEqual(draftKey(['a', 'b,c']), draftKey(['a,b', 'c']));
  for (let i = 0; i < 5; i++) {
    const a = ['u', 'w', 'p', 'body', 'id'],
      b = [...a];
    b[i] += '2';
    assert.notEqual(draftKey(a), draftKey(b));
  }
  assert.deepEqual(
    draftValues(
      {
        title: 't',
        password: 'secret',
        status: 'CLOSED',
        criteria: ['a'],
        effort: 2,
      },
      ['title', 'criteria', 'effort'],
    ),
    { title: 't', effort: 2 },
  );
});
test('工作副本拒绝损坏、过期、嵌套和过大数据', () => {
  const s = storage();
  for (const raw of [
    '{',
    JSON.stringify({ ...record('a'), at: 0 }),
    JSON.stringify({ ...record('a'), values: { title: { bad: 1 } } }),
    'x'.repeat(1000001),
  ]) {
    s.setItem('k', raw);
    assert.equal(readDraft(s, 'k'), null);
  }
});
test('另一页面保存后不能覆盖或误删其工作副本', () => {
  const s = storage();
  assert.equal(writeDraft(s, 'k', null, record('a')), true);
  assert.equal(writeDraft(s, 'k', null, record('b')), false);
  assert.equal(writeDraft(s, 'k', 'a', record('b')), true);
  assert.equal(writeDraft(s, 'k', 'a', null), false);
  assert.equal(readDraft(s, 'k')?.token, 'b');
  assert.equal(writeDraft(s, 'k', 'b', null), true);
});
test('浏览器存储失败必须报告失败', () => {
  assert.throws(
    () =>
      writeDraft(
        {
          ...storage(),
          setItem() {
            throw Error('quota');
          },
        },
        'k',
        null,
        record('a'),
      ),
    /quota/,
  );
});

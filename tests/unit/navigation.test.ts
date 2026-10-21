import test from 'node:test';
import assert from 'node:assert/strict';
import {
  patchSearchParams,
  taskIdFromParams,
} from '../../packages/web-core/src/shared/lib/navigation.js';
import { editionDestination } from '../../packages/web-core/src/features/settings/edition-navigation.js';
test('空参数删除而非序列化，已有空任务深链接与版本切换兼容', () => {
  const base = new URLSearchParams('project=p&task=t&page=2');
  const next = patchSearchParams(base, {
    task: null,
    page: undefined,
    view: 'tasks',
  });
  assert.equal(next.toString(), 'project=p&view=tasks');
  assert.equal(base.get('task'), 't');
  for (const value of ['null', 'undefined', '']) {
    const params = new URLSearchParams({ task: value, project: 'p' });
    assert.equal(taskIdFromParams(params), null);
    assert.equal(patchSearchParams(params, {}).has('task'), false);
    assert.equal(
      new URL(
        editionDestination(
          'student',
          'https://test.invalid/?app=work&view=tasks&task=' + value,
        ),
        'https://test.invalid',
      ).searchParams.has('task'),
      false,
    );
  }
  assert.equal(
    taskIdFromParams(new URLSearchParams('task=real-id')),
    'real-id',
  );
});

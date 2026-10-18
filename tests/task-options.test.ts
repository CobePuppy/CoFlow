import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTaskOptions } from '../apps/web/src/task-options.js';
test('关联任务读取所有分页，不截断第101条', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({
    id: String(i),
    title: `任务${i}`,
  }));
  const calls: number[] = [];
  const actual = await loadTaskOptions(async (path) => {
    const page = Number(new URL(path, 'http://local').searchParams.get('page'));
    calls.push(page);
    return {
      total: rows.length,
      items: rows.slice((page - 1) * 100, page * 100),
    };
  }, 'project');
  assert.deepEqual(actual, rows);
  assert.deepEqual(calls, [1, 2, 3]);
});
test('关联任务中途空页明确报错，避免静默展示不完整列表', async () => {
  await assert.rejects(
    loadTaskOptions(async () => ({ total: 101, items: [] }), 'project'),
    /加载不完整/,
  );
});

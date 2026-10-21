import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareRequirements,
  matchesRequirementSearch,
  requirementNumber,
} from '@coflow/contracts/requirement-list.js';
import { savedViewSchema } from '@coflow/contracts/collaboration.js';
import { readWorkspaceState } from '../../packages/web-core/src/features/requirements/model/workspace-state.js';

test('编号精确匹配且不被正文中的相同编号误命中，普通搜索忽略大小写', () => {
  const task = {
    number: 12,
    data: { title: 'Hello', description: '引用 CF-001' },
  };
  assert(matchesRequirementSearch(task, ' cf-00012 '));
  assert(!matchesRequirementSearch(task, 'CF-001'));
  assert(matchesRequirementSearch(task, 'HELLO'));
  assert.equal(requirementNumber('CF-9007199254740993'), null);
  assert.equal(requirementNumber('CF-0'), null);
});
test('排序稳定、无截止日期置后，相同优先级按更新时间和编号稳定翻页', () => {
  const rows = [
    {
      id: 'b',
      updatedAt: '2026-10-20T00:00:00.000Z',
      data: { priority: 'P1' },
    },
    {
      id: 'a',
      updatedAt: '2026-10-20T00:00:00.000Z',
      data: { priority: 'P1', dueAt: '2026-10-23T00:00:00.000Z' },
    },
    {
      id: 'c',
      updatedAt: '2026-10-19T00:00:00.000Z',
      data: { priority: 'P0', dueAt: '2026-10-21T00:00:00.000Z' },
    },
  ];
  assert.deepEqual(
    [...rows]
      .sort((a, b) => compareRequirements('updated', a, b))
      .map((t) => t.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    [...rows].sort((a, b) => compareRequirements('due', a, b)).map((t) => t.id),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    [...rows]
      .sort((a, b) => compareRequirements('priority', a, b))
      .map((t) => t.id),
    ['c', 'a', 'b'],
  );
});
test('网址和常用视图保存排序，旧视图兼容且拒绝任意排序表达式', () => {
  assert.equal(
    readWorkspaceState(new URLSearchParams('sort=due')).filters.sort,
    'due',
  );
  assert.equal(
    readWorkspaceState(new URLSearchParams('sort=bad')).filters.sort,
    undefined,
  );
  const view = {
    name: '待办',
    view: 'todos',
    mode: 'list',
    projectId: null,
    filters: { sort: 'priority' },
  };
  assert.equal(savedViewSchema.parse(view).filters.sort, 'priority');
  assert(savedViewSchema.safeParse({ ...view, filters: {} }).success);
  assert(
    !savedViewSchema.safeParse({ ...view, filters: { sort: 'data ASC' } })
      .success,
  );
});

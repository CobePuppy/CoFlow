import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  savedViewSchema,
  notificationReadSchema,
} from '@coflow/contracts/collaboration.js';
import { randomUUID } from 'node:crypto';

test('常用视图只接受筛选与显示方式，拒绝流程字段和错误项目范围', () => {
  const content = {
    name: '  我的待办  ',
    view: 'todos',
    mode: 'board',
    projectId: null,
    filters: { priority: 'P1', blocked: 'true' },
  };
  assert.equal(savedViewSchema.parse(content).name, '我的待办');
  for (const invalid of [
    { ...content, projectId: randomUUID() },
    { ...content, view: 'tasks' },
    { ...content, name: ' ' },
    { ...content, name: 'a'.repeat(61) },
    { ...content, filters: { role: 'ADMIN' } },
    { ...content, filters: { status: 'INVENTED' } },
    { ...content, filters: { priority: 'P9' } },
    { ...content, userId: randomUUID() },
    { ...content, filters: { q: 'a'.repeat(201) } },
  ])
    assert.equal(savedViewSchema.safeParse(invalid).success, false);
  assert(
    savedViewSchema.safeParse({
      ...content,
      view: 'tasks',
      projectId: randomUUID(),
    }).success,
  );
});

test('通知批量已读须明确团队与选择范围，拒绝混合及空选择', () => {
  const workspaceId = randomUUID();
  assert(notificationReadSchema.safeParse({ workspaceId, all: true }).success);
  assert(
    notificationReadSchema.safeParse({ workspaceId, ids: [randomUUID()] })
      .success,
  );
  for (const invalid of [
    { all: true },
    { workspaceId },
    { workspaceId, ids: [] },
    { workspaceId, ids: [randomUUID()], all: true },
    { workspaceId, ids: Array.from({ length: 101 }, () => randomUUID()) },
    { workspaceId, all: true, recipientId: randomUUID() },
  ])
    assert.equal(notificationReadSchema.safeParse(invalid).success, false);
});

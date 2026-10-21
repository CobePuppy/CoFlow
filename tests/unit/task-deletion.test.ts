import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteRequirement } from '@coflow/contracts/task-deletion.js';

test('回收站权限：创建人、负责人和管理员；归档及重复删除被禁止', () => {
  const task = {
    deletedAt: null as string | null,
    data: { productId: 'owner', createdBy: 'creator' },
  };
  assert.equal(canDeleteRequirement(task, 'owner'), true);
  assert.equal(canDeleteRequirement(task, 'creator'), true);
  assert.equal(canDeleteRequirement(task, 'peer'), false);
  assert.equal(canDeleteRequirement(task, 'admin', false, true), true);
  assert.equal(canDeleteRequirement(task, 'admin', true, true), false);
  task.deletedAt = new Date().toISOString();
  assert.equal(canDeleteRequirement(task, 'owner'), false);
});

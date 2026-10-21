import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOverdue } from '@coflow/contracts/deadline.js';

test('截止日当天不算逾期，按北京时间跨日而不是运行主机时区', () => {
  assert.equal(
    isOverdue('2026-10-18T00:00:00Z', Date.parse('2026-10-18T15:59:59Z')),
    false,
  );
  assert.equal(
    isOverdue('2026-10-18T00:00:00Z', Date.parse('2026-10-18T16:00:00Z')),
    true,
  );
  assert.equal(isOverdue(undefined), false);
  assert.equal(isOverdue('invalid'), false);
});

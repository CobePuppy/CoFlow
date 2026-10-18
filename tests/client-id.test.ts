import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createClientId } from '../apps/web/src/client-id.js';
test('HTTP缺少randomUUID时仍生成独立有效的UUID请求编号', () => {
  const source = {
    getRandomValues: webcrypto.getRandomValues.bind(
      webcrypto,
    ) as unknown as Crypto['getRandomValues'],
  };
  const ids = Array.from({ length: 100 }, () => createClientId(source));
  assert.equal(new Set(ids).size, 100);
  for (const id of ids)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  assert.match(createClientId(), /^[0-9a-f-]{36}$/);
});

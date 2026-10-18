import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptKey,
  decryptKey,
  encryptionReady,
} from '../apps/api/src/settings.js';
test('个人密钥随机加密、账号绑定、篡改拒绝与缺失配置保护', () => {
  const previous = process.env.SETTINGS_ENCRYPTION_KEY;
  try {
    process.env.SETTINGS_ENCRYPTION_KEY = 'a'.repeat(64);
    const key = 'sk-private-test-only',
      a = encryptKey(key, 'user-a'),
      b = encryptKey(key, 'user-a');
    assert.notEqual(a, b);
    assert(!a.includes(key));
    assert.equal(decryptKey(a, 'user-a'), key);
    assert.throws(() => decryptKey(a, 'user-b'));
    assert.throws(() => decryptKey(a.slice(0, -3) + 'abc', 'user-a'));
    process.env.SETTINGS_ENCRYPTION_KEY = 'b'.repeat(64);
    assert.throws(() => decryptKey(a, 'user-a'));
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    assert.equal(encryptionReady(), false);
    assert.throws(() => encryptKey(key, 'user-a'));
  } finally {
    if (previous === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = previous;
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFile } from '../../apps/api/src/infrastructure/storage/validation.js';
const file = (name: string, mime: string, data: Buffer | string) => ({
  originalname: name,
  mimetype: mime,
  buffer: Buffer.from(data),
  size: Buffer.byteLength(data),
});
test('TXT和Markdown兼容浏览器MIME差异，仍校验文本内容', () => {
  for (const mime of [
    'text/markdown',
    'text/x-markdown',
    'text/plain',
    'application/octet-stream',
    'text/markdown; charset=utf-8',
  ])
    assert.equal(
      validateFile(file('需求.MD', mime, '# 目标\n中文 **说明**')).mime,
      'text/markdown',
    );
  assert.equal(
    validateFile(file('说明.txt', 'application/octet-stream', '中文文本')).mime,
    'text/plain',
  );
  assert.throws(() =>
    validateFile(
      file('伪装.md', 'application/octet-stream', Buffer.from([0, 1, 2])),
    ),
  );
  assert.throws(() =>
    validateFile(file('损坏.md', 'text/markdown', Buffer.from([0xff, 0xfe]))),
  );
  assert.throws(() =>
    validateFile(file('页面.md', 'text/html', '# 不匹配的类型')),
  );
});
test('附件白名单、MIME、签名、编码和大小校验', () => {
  assert.equal(
    validateFile(
      file(Buffer.from('资料.txt').toString('latin1'), 'text/plain', '内容'),
    ).name,
    '资料.txt',
  );
  assert.equal(
    validateFile(file('café.txt', 'text/plain', 'content')).name,
    'café.txt',
  );
  assert.equal(
    validateFile(file('../测试.txt', 'text/plain', '你好 CoFlow')).name,
    '测试.txt',
  );
  assert.throws(() =>
    validateFile(file('x.exe', 'application/octet-stream', 'MZ')),
  );
  assert.throws(() => validateFile(file('x.png', 'image/png', 'fake')));
  assert.throws(() =>
    validateFile(
      file(
        'x.png',
        'text/plain',
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      ),
    ),
  );
  assert.throws(() =>
    validateFile(file('x.txt', 'text/plain', Buffer.from([0xff, 0xfe]))),
  );
  assert.throws(() => validateFile(file('x.txt', 'text/plain', '')));
  assert.throws(() =>
    validateFile({
      ...file('x.txt', 'text/plain', 'abc'),
      size: 21 * 1024 * 1024,
    }),
  );
  assert.throws(() =>
    validateFile(
      file(
        'x.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        Buffer.from([80, 75, 3, 4]),
      ),
    ),
  );
});

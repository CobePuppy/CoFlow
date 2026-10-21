import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fileSpaceState,
  fileTypes,
} from '../../packages/contracts/src/file-space.js';
import { editionDestination } from '../../packages/web-core/src/features/settings/edition-navigation.js';
test('文件筛选仅接受已知参数，不将未知值发送给接口', () => {
  assert.deepEqual(
    fileSpaceState(
      new URLSearchParams('fileType=KEY&fileSort=DROP&fileUploader=someone'),
    ),
    { type: 'ALL', sort: 'newest', uploader: 'ALL' },
  );
  assert.deepEqual(
    fileSpaceState(
      new URLSearchParams('fileType=PDF&fileSort=size&fileUploader=MINE'),
    ),
    { type: 'PDF', sort: 'size', uploader: 'MINE' },
  );
  const mimes = fileTypes.flatMap((t) => t.mimes);
  assert.equal(new Set(mimes).size, mimes.length);
});
test('文件空间版本切换保留查找条件且不转发额外敏感参数', () => {
  const destination = editionDestination(
    'student',
    '/enterprise/?section=library&workspace=w&fileSpace=team&fileQ=规范&fileType=TEXT&fileUploader=MINE&fileSort=size&filePage=2&secret=x',
  );
  const params = new URL(destination, 'https://coflow.invalid').searchParams;
  assert.equal(params.get('section'), 'library');
  assert.equal(params.get('fileQ'), '规范');
  assert.equal(params.get('filePage'), '2');
  assert.equal(params.get('fileSort'), 'size');
  assert(!params.has('secret'));
});

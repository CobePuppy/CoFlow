import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  githubReferenceInput,
  pullNumber,
  referenceLineCount,
} from '@coflow/contracts/github.js';
import { installGitHubRoutes } from '../../apps/api/src/modules/github/routes.js';
import { GitHubClient } from '../../apps/api/src/infrastructure/github/client.js';

test('代码引用行范围与 PR 地址限制，空文件及末尾换行计数', () => {
  const base = { version: 1, path: 'src/main.ts' };
  assert(
    githubReferenceInput.safeParse({ ...base, startLine: 1, endLine: 4 })
      .success,
  );
  for (const range of [
    { startLine: 2 },
    { startLine: 0, endLine: 2 },
    { startLine: 4, endLine: 2 },
  ])
    assert(!githubReferenceInput.safeParse({ ...base, ...range }).success);
  assert.equal(referenceLineCount(''), 0);
  assert.equal(referenceLineCount('one\n'), 1);
  assert.equal(referenceLineCount('one\ntwo'), 2);
  assert.equal(pullNumber('#12', 'demo/public'), 12);
  assert.equal(
    pullNumber('https://github.com/demo/public/pull/12', 'demo/public'),
    12,
  );
  for (const value of [
    'https://evil.test/demo/public/pull/12',
    'https://github.com/other/private/pull/12',
    '#0',
    '12?x=secret',
  ])
    assert.throws(() => pullNumber(value, 'demo/public'));
});

test('关联读取权限与响应使用同一仓库版本，不能先校验新仓库再泄露旧引用', async () => {
  const routes = new Map<string, any>();
  let reads = 0;
  const old = {
    taskId: 't',
    version: 1,
    data: {
      name: 'demo/private',
      repoId: 2,
      references: [{ path: 'private-secret.ts' }],
    },
  };
  const newer = {
    taskId: 't',
    version: 2,
    data: { name: 'demo/public', repoId: 1, references: [] },
  };
  const db: any = {
    taskGitHub: { findUnique: async () => (++reads === 1 ? old : newer) },
    $transaction: async (fn: any) =>
      fn({
        $queryRaw: async () => [],
        gitHubAccount: { upsert: async () => ({ credentials: null }) },
      }),
  };
  const router = Object.fromEntries(
    ['get', 'post', 'put', 'delete'].map((method) => [
      method,
      (path: string, handler: any) => routes.set(`${method} ${path}`, handler),
    ]),
  );
  installGitHubRoutes(router, {
    db,
    wrap: (fn: any) => fn,
    task: async () => ({ id: 't' }),
  });
  const original = GitHubClient.prototype.repository;
  const checked: string[] = [];
  GitHubClient.prototype.repository = async function (name) {
    checked.push(name);
    if (name.includes('private')) {
      const { BusinessError } = await import(
        '../../apps/api/src/modules/requirements/domain.js'
      );
      throw new BusinessError(404, '无权读取');
    }
    return {
      id: 1,
      name,
      description: '',
      private: false,
      defaultBranch: 'main',
    };
  };
  let response: any;
  try {
    await routes.get('get /tasks/:id/github')(
      { user: { id: 'reader' }, params: { id: 't' } },
      { json: (value: any) => (response = value) },
    );
  } finally {
    GitHubClient.prototype.repository = original;
  }
  assert.deepEqual(checked, ['demo/private']);
  assert.equal(reads, 1);
  assert.deepEqual(response.data.references, []);
  assert.equal(response.accessError, '无权读取');
});

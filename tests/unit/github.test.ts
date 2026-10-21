import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHubClient,
  parseRepository,
  safePath,
} from '../../apps/api/src/infrastructure/github/client.js';

test('GitHub 仓库与路径验证阻断外部主机和目录穿越', () => {
  assert.equal(
    parseRepository('https://github.com/octocat/Hello-World.git'),
    'octocat/Hello-World',
  );
  for (const value of [
    'https://evil.test/a/b',
    'http://github.com/a/b',
    'a/b?token=x',
    'a/..',
    'a/b/c',
    'a/b#x',
  ])
    assert.throws(() => parseRepository(value));
  for (const value of ['../secret', '/root', 'a//b', 'a/./b', 'a\\b', 'a\0b'])
    assert.throws(() => safePath(value));
  assert.equal(safePath('src/你好.ts'), 'src/你好.ts');
});
test('GitHub 文本读取仅使用固定 API、提交树与普通 UTF8 文件', async () => {
  const sha = 'a'.repeat(40);
  const calls: string[] = [];
  const mock: typeof fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.redirect, 'error');
    assert.equal((options?.headers as any).Authorization, 'Bearer ghu_test');
    return Response.json(
      String(url).includes('/trees/')
        ? {
            tree: [
              { path: 'README.md', sha, mode: '100644', type: 'blob', size: 5 },
            ],
          }
        : {
            encoding: 'base64',
            size: 5,
            content: Buffer.from('hello').toString('base64'),
          },
    );
  };
  const result = await new GitHubClient('ghu_test', mock).file(
    'a/b',
    sha,
    'README.md',
  );
  assert.equal(result.text, 'hello');
  assert.equal(calls.length, 2);
  assert(
    calls.every((x) => x.startsWith('https://api.github.com/repos/a/b/git/')),
  );
});
test('GitHub 拒绝不完整目录、符号链接、二进制及超限响应', async () => {
  const sha = 'a'.repeat(40);
  const truncated = new GitHubClient(undefined, async () =>
    Response.json({ truncated: true, tree: [] }),
  );
  await assert.rejects(truncated.entries('a/b', sha), /完整目录/);
  const symlink = new GitHubClient(undefined, async () =>
    Response.json({ tree: [{ path: 'link', sha, mode: '120000' }] }),
  );
  await assert.rejects(symlink.file('a/b', sha, 'link'), /符号链接/);
  for (const bytes of [Buffer.from([0, 1]), Buffer.from([0xff])]) {
    const binary = new GitHubClient(undefined, async (url) =>
      Response.json(
        String(url).includes('/trees/')
          ? { tree: [{ path: 'f', sha, mode: '100644', size: 2 }] }
          : { encoding: 'base64', size: 2, content: bytes.toString('base64') },
      ),
    );
    await assert.rejects(binary.file('a/b', sha, 'f'), /二进制|UTF-8/);
  }
  const huge = new GitHubClient(
    undefined,
    async () => new Response('x'.repeat(8 * 1024 * 1024 + 1)),
  );
  await assert.rejects(huge.json('/repos/a/b'), /响应过大/);
});
test('GitHub 空仓库、失效授权及总读取时限提供安全错误', async () => {
  const empty = new GitHubClient(
    undefined,
    async () => new Response('{"token":"secret"}', { status: 409 }),
  );
  await assert.rejects(empty.json('/repos/a/b/commits/main'), /仓库为空/);
  const invalid = new GitHubClient(
    'ghu_secret',
    async () => new Response('{"token":"secret"}', { status: 401 }),
  );
  await assert.rejects(
    invalid.json('/user'),
    (e: any) =>
      e.status === 403 &&
      e.message.includes('授权已失效') &&
      !e.message.includes('secret'),
  );
  const timed = new GitHubClient(undefined, async () => {
    throw new Error('不应请求');
  });
  (timed as any).deadline = Date.now() - 1;
  await assert.rejects(timed.json('/repos/a/b'), /耗时过长/);
});

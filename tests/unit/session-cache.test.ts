import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  client,
  expireSession,
  setCsrf,
} from '../../packages/web-core/src/shared/api/runtime.js';
import { invalidateTaskQueries } from '../../packages/web-core/src/shared/api/query-invalidation.js';

test('登录过期清理业务缓存和 CSRF，取消旧请求并拒绝迟到响应', async () => {
  const originalFetch = globalThis.fetch;
  let finish!: (response: Response) => void;
  let oldSignal: AbortSignal | null | undefined;
  try {
    client.setQueryData(['me'], { user: { id: 'old' } });
    client.setQueryData(['tasks', 'old-project'], ['private']);
    client.setQueryData(['settings'], { private: true });
    setCsrf('old-token');
    globalThis.fetch = async (_url, options) => {
      oldSignal = options?.signal;
      // Simulate a transport that completes even after cancellation.
      return new Promise<Response>((resolve) => (finish = resolve));
    };
    const pending = api('/tasks/old');
    globalThis.fetch = async () =>
      new Response('{"message":"请重新登录"}', { status: 401 });
    await assert.rejects(api('/me/todos'), (e: any) => e.status === 401);
    assert.equal(oldSignal?.aborted, true);
    assert.equal(client.getQueryData(['me']), null);
    assert.equal(client.getQueryData(['tasks', 'old-project']), undefined);
    assert.equal(client.getQueryData(['settings']), undefined);
    client.setQueryData(['me'], { user: { id: 'new' } });
    finish(new Response('{"private":"old"}'));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(client.getQueryData(['me']), { user: { id: 'new' } });
    globalThis.fetch = async (_url, options) => {
      assert.equal((options?.headers as any)['X-CSRF-Token'], '');
      assert.equal(options?.signal?.aborted, false);
      return new Response('{"ok":true}');
    };
    assert.deepEqual(await api('/projects'), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
    expireSession();
    client.clear();
  }
});

test('需求刷新同步列表、统计、引用与待办，保留账号和成员缓存', async () => {
  const affected = [
    ['task', 't'],
    ['taskDiscussions', 't'],
    ['tasks', 'p', 'page=2'],
    ['todos'],
    ['metrics', 'p'],
    ['overview', 'w'],
    ['notifications', 'w'],
    ['taskOptions', 'p'],
    ['documentTasks', 'd'],
    ['fork-tasks', 'p'],
    ['proof', 'c'],
    ['attachments', 't'],
    ['libraryFiles', 'p'],
  ];
  const retained = [['me'], ['settings'], ['members', 'p'], ['projects', 'w']];
  try {
    for (const key of [...affected, ...retained]) client.setQueryData(key, {});
    await invalidateTaskQueries(client);
    for (const key of affected)
      assert.equal(client.getQueryState(key)?.isInvalidated, true, String(key));
    for (const key of retained)
      assert.equal(
        client.getQueryState(key)?.isInvalidated,
        false,
        String(key),
      );
  } finally {
    client.clear();
  }
});

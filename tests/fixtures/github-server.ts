// Only this test entry point installs a mock transport. Production has no mock setting.
import { GitHubClient } from '../../apps/api/src/infrastructure/github/client.js';
const original = GitHubClient.prototype.json;
let polls = 0;
const sha = 'a'.repeat(40),
  blob = 'b'.repeat(40),
  next = 'c'.repeat(40);
GitHubClient.prototype.json = async function (path, body, oauth) {
  if (oauth) {
    if (path === 'device/code')
      return {
        device_code: 'test-device-secret',
        user_code: 'TEST-CODE',
        expires_in: 900,
        interval: 5,
      };
    if (body?.grant_type !== 'refresh_token') {
      polls++;
      if (polls === 1) return { error: 'authorization_pending' };
      if (polls === 2) return { error: 'slow_down' };
    }
    if (body?.refresh_token === 'ghr_expired')
      return { error: 'invalid_grant' };
    return {
      access_token:
        body?.grant_type === 'refresh_token'
          ? 'ghu_test_refreshed'
          : 'ghu_test_private',
      refresh_token: 'ghr_test_private',
      expires_in: 28800,
      refresh_token_expires_in: 15552000,
    };
  }
  if (path === '/user') return { login: 'github-test' };
  if (path.startsWith('/user/installations?'))
    return {
      total_count: 1,
      installations: [{ id: 42, account: { login: 'demo' } }],
    };
  if (path.startsWith('/user/installations/42/repositories?'))
    return {
      total_count: 2,
      repositories: [
        { full_name: 'demo/public', private: false },
        { full_name: 'demo/private', private: true },
      ],
    };
  if (!path.startsWith('/repos/demo/'))
    return original.call(this, path, body, oauth);
  const privateRepo = path.startsWith('/repos/demo/private');
  if (privateRepo && !(this as any).token)
    throw Object.assign(new Error('仓库不存在或当前 GitHub 账号无权读取'), {
      status: 404,
    });
  if (/^\/repos\/demo\/[^/]+$/.test(path))
    return {
      id: privateRepo ? 2 : 1,
      full_name: privateRepo ? 'demo/private' : 'demo/public',
      default_branch: 'main',
      private: privateRepo,
      description: 'GitHub 集成测试仓库',
    };
  if (path.includes('/pulls/')) {
    const number = Number(path.split('/').at(-1));
    return {
      number,
      title: '实现需求与验收关联',
      merged: number === 1,
      state: number === 1 || number === 4 ? 'closed' : 'open',
      draft: number === 4,
      base: { ref: 'main', repo: { id: privateRepo ? 2 : 1 } },
      head: {
        ref: 'feature/requirement',
        sha: number === 2 ? next : number === 3 ? 'e'.repeat(40) : sha,
      },
    };
  }
  if (path.includes('/check-runs')) {
    if (path.includes('e'.repeat(40)))
      return {
        total_count: 101,
        check_runs: Array.from({ length: 100 }, (_, i) => ({
          name: `check-${i}`,
          status: 'completed',
          conclusion: 'success',
        })),
      };
    if (path.includes(next))
      throw Object.assign(new Error('Checks permission denied'), {
        status: 403,
      });
    return {
      total_count: 1,
      check_runs: [
        { name: 'build', status: 'completed', conclusion: 'success' },
      ],
    };
  }
  if (path.includes('/status?'))
    return {
      state: 'success',
      total_count: 1,
      statuses: [{ context: 'test', state: 'success' }],
    };
  if (path.includes('/commits/'))
    return {
      sha: path.endsWith('next') ? next : sha,
      commit: { tree: { sha: path.endsWith('next') ? next : sha } },
    };
  if (path.includes('/branches?')) return [{ name: 'main' }, { name: 'next' }];
  if (path.includes('/git/trees/'))
    return {
      tree: [
        {
          path: 'README.md',
          sha: path.endsWith(next) ? 'd'.repeat(40) : blob,
          mode: '100644',
          type: 'blob',
          size: 27,
        },
        { path: 'submodule', sha, mode: '160000', type: 'commit' },
      ],
    };
  if (path.includes('/git/blobs/'))
    return {
      encoding: 'base64',
      size: 27,
      content: Buffer.from('# CoFlow repository context\n').toString('base64'),
    };
  throw new Error('Unmocked test GitHub endpoint');
};
// Match production error type, without allowing production to opt into this transport.
const { BusinessError } = await import(
  '../../apps/api/src/modules/requirements/domain.js'
);
const mocked = GitHubClient.prototype.json;
GitHubClient.prototype.json = async function (...args) {
  try {
    return await mocked.apply(this, args);
  } catch (e: any) {
    if (e.status) throw new BusinessError(e.status, e.message);
    throw e;
  }
};
process.env.COFLOW_IMPORT_ONLY = '1';
const { start } = await import('../../apps/api/src/main.js');
await start();

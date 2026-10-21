import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leavesEditingContext } from '../../packages/web-core/src/shared/lib/navigation-guard.js';
import { githubConfiguration } from '../../apps/api/src/modules/github/configuration.js';
test('离开保护覆盖页面、项目、团队、文件空间与需求切换，保留详情页签和筛选操作', () => {
  const a = {
    pathname: '/student/',
    search: '?app=work&project=p&workspace=w&task=t&taskTab=activity',
  };
  assert(
    !leavesEditingContext(a, {
      ...a,
      search: a.search.replace('activity', 'requirement'),
    }),
  );
  assert(
    !leavesEditingContext(a, { ...a, search: a.search + '&q=测试&page=2' }),
  );
  for (const search of [
    '?section=settings',
    '?app=work&project=q&workspace=w&task=t',
    '?app=work&project=p&workspace=x&task=t',
    '?app=work&project=p&workspace=w&task=other',
    '?app=work&project=p&workspace=w',
  ])
    assert(leavesEditingContext(a, { ...a, search }));
  assert(leavesEditingContext(a, { ...a, pathname: '/enterprise/' }));
  assert(
    leavesEditingContext(
      { pathname: '/student/', search: '?section=library&fileSpace=personal' },
      { pathname: '/student/', search: '?section=library&fileSpace=team' },
    ),
  );
});
test('GitHub配置诊断仅返回布尔状态，缺失和无效配置不能通过', () => {
  assert.deepEqual(githubConfiguration({}), {
    clientId: false,
    encryption: false,
    installationLink: false,
  });
  assert.deepEqual(
    githubConfiguration({
      GITHUB_APP_CLIENT_ID: ' ',
      GITHUB_APP_SLUG: 'https://evil.example',
      SETTINGS_ENCRYPTION_KEY: 'invalid',
    }),
    { clientId: false, encryption: false, installationLink: false },
  );
  const secret = 'a'.repeat(64),
    id = 'non-public-test-id';
  const value = githubConfiguration({
    GITHUB_APP_CLIENT_ID: id,
    GITHUB_APP_SLUG: 'coflow-test',
    SETTINGS_ENCRYPTION_KEY: secret,
  });
  assert(Object.values(value).every((v) => v === true));
  assert(!JSON.stringify(value).includes(secret));
  assert(!JSON.stringify(value).includes(id));
});

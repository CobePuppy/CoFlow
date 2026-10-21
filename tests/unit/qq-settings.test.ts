import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  qqSettingsSchema,
  pushTimesSchema,
  qqTaskUrl,
} from '../../apps/api/src/modules/qq/settings.js';
test('QQ提醒时间去重排序，拒绝无效时间和含凭据或非首页的网址', () => {
  assert.equal(pushTimesSchema.parse('18:00,09:00,09:00'), '09:00,18:00');
  assert.equal(pushTimesSchema.safeParse('25:00').success, false);
  const value = {
    expectedVersion: 0,
    enabled: true,
    pushEnabled: true,
    pushTimes: '09:00',
    webUrl: 'https://example.com/student/',
  };
  assert(qqSettingsSchema.safeParse(value).success);
  for (const webUrl of [
    'javascript:alert(1)',
    'https://user:pass@example.com',
    'https://example.com/?token=x',
    'https://example.com/broken',
  ])
    assert(!qqSettingsSchema.safeParse({ ...value, webUrl }).success);
});
test('QQ任务链接包含团队项目与个人版本，清理旧查询和锚点', () => {
  const url = new URL(
    qqTaskUrl(
      'https://example.com/?old=1#old',
      'task',
      'team',
      'project',
      'student',
    ),
  );
  assert.equal(url.pathname, '/student/');
  assert.equal(url.searchParams.get('project'), 'project');
  assert.equal(url.searchParams.get('workspace'), 'team');
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.has('old'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editionDestination } from '../../packages/web-core/src/features/settings/edition-navigation.js';
test('版本切换保留共享业务上下文，丢弃专属页面和非白名单参数', () => {
  const url = editionDestination(
    'student',
    'https://coflow.example/enterprise/?section=settings&app=work&workspace=w&project=p&view=tasks&task=t&token=secret',
  );
  assert.equal(
    url,
    '/student/?workspace=w&project=p&app=work&view=tasks&task=t',
  );
  assert.equal(
    editionDestination(
      'enterprise',
      '/student/?app=competitions&workspace=w&project=p&task=t',
    ),
    '/enterprise/?workspace=w&project=p',
  );
  assert.equal(
    editionDestination(
      'enterprise',
      '/student/?app=work&view=unknown&workspace=w',
    ),
    '/enterprise/?workspace=w',
  );
});

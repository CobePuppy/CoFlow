import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const origin = 'http://localhost:5174';
for (const edition of ['enterprise', 'student'])
  test(
    edition + '需求变更对比与资料引用、更新确认及个人授权撤销',
    async ({ page }) => {
      const email =
          'resource-ui-' + edition + '-' + Date.now() + '@example.com',
        password = 'Resource-ui-2026!';
      const reg = await page.request.post('/api/v1/auth/register', {
        headers: { Origin: origin },
        data: {
          kind: 'creator',
          email,
          password,
          name: '资料负责人',
          teamName: '资料引用团队',
        },
      });
      expect(reg.status(), await reg.text()).toBe(201);
      const team = await reg.json();
      const login = await page.request.post('/api/v1/auth/login', {
        headers: { Origin: origin },
        data: { email, password },
      });
      const session = await login.json();
      const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
      async function post(path: string, data: any) {
        const r = await page.request.post('/api/v1' + path, { headers, data });
        expect(r.ok(), await r.text()).toBeTruthy();
        return r.json();
      }
      const project = await post(
        '/workspaces/' + team.workspaceId + '/projects',
        { name: '资料引用项目', workflow: 'SIMPLE' },
      );
      await post('/projects/' + project.id + '/members', {
        userId: session.user.id,
        roles: ['PRODUCT', 'ENGINEER', 'QA'],
      });
      const task = await post('/projects/' + project.id + '/tasks', {
        title: '开发规范接入',
        description: '旧需求说明',
        criteria: ['旧验收标准'],
        productId: session.user.id,
        engineerId: session.user.id,
        submit: true,
      });
      const changed = await page.request.post(
        '/api/v1/tasks/' + task.id + '/actions',
        {
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          data: {
            action: 'APPLY_REQUIREMENT_CHANGE',
            expectedVersion: task.version,
            payload: {
              description: '新版需求说明',
              criteria: ['新版验收标准'],
              reason: '统一开发规范',
              impact: '执行人重新确认',
            },
          },
        },
      );
      expect(changed.ok(), await changed.text()).toBeTruthy();
      expect((await changed.json()).status).toBe('READY_FOR_DEV');
      async function upload(route: string, name: string) {
        const r = await page.request.post('/api/v1' + route, {
          headers,
          multipart: {
            file: {
              name,
              mimeType: 'text/markdown',
              buffer: Buffer.from('# 开发规范\n先验证再交付'),
            },
          },
        });
        expect(r.ok(), await r.text()).toBeTruthy();
        return r.json();
      }
      const file = await upload(
        '/workspaces/' + team.workspaceId + '/files',
        '团队开发规范.md',
      );
      await upload('/me/files', '个人常用资料.md');
      await post('/projects/' + project.id + '/documents', {
        title: '项目接口说明',
        content: '接口内容',
        taskIds: [],
      });
      const base = '/' + edition + '/?app=work&task=' + task.id;
      await page.goto(base);
      const versions = page
        .locator('.ant-card')
        .filter({ has: page.getByText('需求版本对比', { exact: true }) });
      await expect(versions).toContainText('旧需求说明');
      await expect(versions).toContainText('新版需求说明');
      await expect(versions).toContainText('统一开发规范');
      await expect(versions).toContainText('新增 1 项 · 移除 1 项');
      await versions.scrollIntoViewIfNeeded();
      await versions.screenshot({
        path: 'artifacts/v3.7.0-' + edition + '-diff.png',
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await versions.scrollIntoViewIfNeeded();
      await versions.screenshot({
        path: 'artifacts/v3.7.0-' + edition + '-diff-mobile.png',
        animations: 'disabled',
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.setViewportSize({ width: 1440, height: 980 });
      await page.getByRole('tab', { name: '关联资料', exact: true }).click();
      await page
        .getByRole('button', { name: '引用已有资料', exact: true })
        .click();
      const modal = page.getByRole('dialog', {
        name: '引用已有资料',
        exact: true,
      });
      await modal
        .getByRole('button', { name: '团队开发规范.md · v1', exact: true })
        .click();
      await modal
        .getByRole('button', { name: '确认引用', exact: true })
        .click();
      await expect(modal).toHaveCount(0);
      const refcard = page
        .locator('article')
        .filter({ has: page.getByText('团队开发规范.md', { exact: true }) });
      await expect(refcard).toContainText('版本一致');
      const renamed = await page.request.patch(
        '/api/v1/space-files/' + file.id,
        { headers, data: { expectedVersion: 1, name: '团队开发规范新版.md' } },
      );
      expect(renamed.ok(), await renamed.text()).toBeTruthy();
      await page.reload();
      await page.getByRole('tab', { name: '关联资料', exact: true }).click();
      await expect(refcard).toContainText('资料有更新');
      await refcard
        .getByRole('button', { name: '确认使用当前版本', exact: true })
        .click();
      await page
        .getByRole('button', { name: '确认更新引用', exact: true })
        .click();
      await expect(
        page.locator('article').filter({
          has: page.getByText('团队开发规范新版.md', { exact: true }),
        }),
      ).toContainText('引用版本 v2');
      await page
        .getByRole('button', { name: '引用已有资料', exact: true })
        .click();
      await modal.locator('.ant-select[aria-label="引用资料来源"]').click();
      await page.getByTitle('我的个人文件', { exact: true }).click();
      await modal
        .getByRole('button', { name: '个人常用资料.md · v1', exact: true })
        .click();
      await expect(
        modal.getByRole('button', { name: '确认引用', exact: true }),
      ).toBeDisabled();
      await modal
        .getByRole('checkbox', {
          name: '我同意向本需求所在项目成员共享所选个人文件',
          exact: true,
        })
        .check();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: 'artifacts/v3.7.0-' + edition + '-reference-mobile.png',
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await modal
        .getByRole('button', { name: '确认引用', exact: true })
        .click();
      await expect(modal).toHaveCount(0);
      await page.setViewportSize({ width: 1440, height: 980 });
      await page
        .getByRole('button', { name: '引用已有资料', exact: true })
        .click();
      await modal.locator('.ant-select[aria-label="引用资料来源"]').click();
      await page.getByTitle('本项目文档', { exact: true }).click();
      await modal
        .getByRole('button', { name: '项目接口说明 · v1', exact: true })
        .click();
      await modal
        .getByRole('button', { name: '确认引用', exact: true })
        .click();
      await expect(modal).toHaveCount(0);
      await expect(
        page
          .getByRole('tabpanel', { name: '关联资料', exact: true })
          .getByRole('link', { name: '查看文档', exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('tabpanel', { name: '关联资料', exact: true })
          .getByRole('link', { name: '查看文档', exact: true }),
      ).toHaveAttribute('href', new RegExp('^/' + edition + '/'));
      await page.goto('/' + edition + '/?section=library&fileSpace=personal');
      await page.getByRole('button', { name: '引用授权', exact: true }).click();
      const grants = page.getByRole('dialog', {
        name: '个人文件引用授权 · 个人常用资料.md',
        exact: true,
      });
      await expect(grants).toContainText('开发规范接入');
      await grants
        .getByRole('button', { name: '撤销授权', exact: true })
        .click();
      await page
        .getByRole('button', { name: '确认撤销授权', exact: true })
        .click();
      await expect(grants).toContainText('当前没有引用授权');
      await page.goto(base);
      await page.getByRole('tab', { name: '关联资料', exact: true }).click();
      await expect(
        page
          .locator('article')
          .filter({ has: page.getByText('个人常用资料.md', { exact: true }) }),
      ).toHaveCount(0);
    },
  );

test('标准需求变更后旧评估显示过期，提议尚未生效且可选择历史版本', async ({
  page,
}) => {
  const pid = '10000000-0000-4000-8000-000000000001',
    password = process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!';
  async function login(email: string) {
    const r = await page.request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { email, password },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  }
  let user = await login('product@coflow.local');
  const product = user;
  const people = await (
    await page.request.get('/api/v1/projects/' + pid + '/members')
  ).json();
  const engineer = people.find((m: any) => m.email === 'engineer@coflow.local'),
    qa = people.find((m: any) => m.email === 'qa@coflow.local');
  const created = await page.request.post(
    '/api/v1/projects/' + pid + '/tasks',
    {
      headers: { Origin: origin, 'X-CSRF-Token': user.csrf },
      data: {
        title: '标准版本对比-' + Date.now(),
        background: '背景',
        goal: '目标',
        description: '第一版内容',
        criteria: ['原验收'],
        productId: user.user.id,
        engineerId: engineer.id,
        productReviewerId: user.user.id,
        qaReviewerId: qa.id,
        testerId: qa.id,
        submit: true,
      },
    },
  );
  expect(created.ok(), await created.text()).toBeTruthy();
  let task = await created.json();
  async function act(action: string, payload: any) {
    const r = await page.request.post('/api/v1/tasks/' + task.id + '/actions', {
      headers: {
        Origin: origin,
        'X-CSRF-Token': user.csrf,
        'Idempotency-Key': randomUUID(),
      },
      data: { action, expectedVersion: task.version, payload },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    task = await r.json();
  }
  user = await login('engineer@coflow.local');
  await act('SUBMIT_SOLUTION', {
    body: '方案',
    scope: '需求模块',
    effort: 1,
    risk: '低',
    start: '2026-10-21',
    end: '2026-10-22',
  });
  user = await login('product@coflow.local');
  await act('APPROVE_SOLUTION', {});
  await act('APPLY_REQUIREMENT_CHANGE', {
    description: '第二版内容',
    criteria: ['新验收'],
    reason: '范围更新',
    impact: '重新评估',
  });
  expect(task.status).toBe('SOLUTION_PENDING');
  const proposal = await page.request.post(
    '/api/v1/tasks/' + task.id + '/requirement-changes',
    {
      headers: { Origin: origin, 'X-CSRF-Token': user.csrf },
      data: {
        expectedVersion: task.version,
        description: '尚未确认的提议',
        criteria: ['建议验收'],
        reason: '建议',
        impact: '待确认',
      },
    },
  );
  expect(proposal.ok(), await proposal.text()).toBeTruthy();
  await page.goto('/enterprise/?app=work&task=' + task.id);
  await expect(
    page.locator('.review-summary').getByText('已过期', { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByText('提议尚未生效，以下对比当前正式版本', { exact: true }),
  ).toBeVisible();
  const versions = page
    .locator('.ant-card')
    .filter({ has: page.getByText('需求版本对比', { exact: true }) });
  await expect(versions).toContainText('第一版内容');
  await expect(versions).toContainText('第二版内容');
  await versions.locator('.ant-select[aria-label="查看需求版本"]').click();
  await page
    .locator(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="需求 v1"]',
    )
    .click();
  await expect(versions).toContainText('首次提交，无上一版');
  expect(task.data.requirements).toHaveLength(2);
  expect(product.user.id).not.toBe(engineer.id);
});

import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

test.use({ actionTimeout: 10000 });
const origin = 'http://localhost:5174';
async function register(request: any, tag: string) {
  const email = `collaboration-${randomUUID()}@example.com`,
    password = 'Collaboration-test-2026!';
  const registered = await request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      email,
      password,
      name: tag,
      teamName: tag + '-团队',
    },
  });
  expect(registered.status()).toBe(201);
  const team = await registered.json();
  const login = await request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email, password },
  });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
  const created = await request.post(
    `/api/v1/workspaces/${team.workspaceId}/projects`,
    { headers, data: { name: tag + '-项目', workflow: 'SIMPLE' } },
  );
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  return {
    ...team,
    ...session,
    email,
    password,
    headers,
    projectId: project.id,
  };
}

test('个人常用视图跨会话恢复、管理与团队隔离，适配手机', async ({
  page,
  browser,
}) => {
  const auth = await register(page.request, '常用视图');
  const root = `/student/?app=work&view=tasks&workspace=${auth.workspaceId}&project=${auth.projectId}`;
  for (const priority of ['P1', 'P2']) {
    const created = await page.request.post(
      `/api/v1/projects/${auth.projectId}/tasks`,
      {
        headers: auth.headers,
        data: {
          title: '视图需求-' + priority,
          productId: auth.user.id,
          priority,
        },
      },
    );
    expect(created.ok()).toBeTruthy();
  }
  await page.goto(root + '&priority=P1&mode=board&page=3');
  await page.getByRole('button', { name: '保存当前视图', exact: true }).click();
  await page.getByLabel('视图名称', { exact: true }).fill('我的高优先级');
  await page.getByRole('button', { name: '保存视图', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '保存当前视图' }),
  ).not.toBeVisible();
  // A second browser session reads the server-backed preference.
  const second = await browser.newContext({ baseURL: origin });
  try {
    await second.request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { email: auth.email, password: auth.password },
    });
    const otherPage = await second.newPage();
    await otherPage.goto(root);
    await otherPage
      .getByRole('combobox', { name: '使用常用视图', exact: true })
      .click();
    await otherPage
      .locator('.ant-select-dropdown:visible')
      .getByTitle('我的高优先级', { exact: true })
      .click();
    await expect(otherPage).toHaveURL(/priority=P1/);
    await expect(otherPage).toHaveURL(/mode=board/);
    expect(new URL(otherPage.url()).searchParams.has('page')).toBe(false);
    await expect(
      otherPage.getByText('视图需求-P1', { exact: true }),
    ).toBeVisible();
    await expect(
      otherPage.getByText('视图需求-P2', { exact: true }),
    ).toHaveCount(0);
    await otherPage
      .getByRole('button', { name: '管理视图', exact: true })
      .click();
    const manage = otherPage.getByRole('dialog', {
      name: '管理常用视图',
      exact: true,
    });
    await manage.getByRole('button', { name: '重命名', exact: true }).click();
    await otherPage.getByLabel('视图名称', { exact: true }).fill('研发关注');
    const viewPath = `/api/v1/workspaces/${auth.workspaceId}/views`;
    const existing = (await (await page.request.get(viewPath)).json()).items[0];
    const concurrent = await page.request.patch(viewPath + '/' + existing.id, {
      headers: auth.headers,
      data: {
        name: existing.name,
        view: existing.view,
        mode: existing.mode,
        projectId: existing.projectId,
        filters: { priority: 'P2' },
        expectedVersion: existing.version,
      },
    });
    expect(concurrent.ok()).toBeTruthy();
    await otherPage
      .getByRole('button', { name: '保存视图', exact: true })
      .click();
    await expect(
      otherPage.getByRole('dialog', { name: '重命名视图' }),
    ).toContainText('名称输入已保留');
    await expect(otherPage.getByLabel('视图名称', { exact: true })).toHaveValue(
      '研发关注',
    );
    await otherPage
      .getByRole('button', { name: '保存视图', exact: true })
      .click();
    await expect(manage).toContainText('研发关注');
    expect(
      (await (await page.request.get(viewPath)).json()).items[0].filters
        .priority,
    ).toBe('P2');
    await manage.getByRole('button', { name: '更新条件', exact: true }).click();
    await otherPage
      .getByRole('dialog')
      .filter({ hasText: '使用当前页面的项目' })
      .getByRole('button', { name: /确定|确 定/ })
      .click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(viewPath)).json()).items[0].filters
            .priority,
      )
      .toBe('P1');
    await manage
      .getByRole('button', { name: '删除视图：研发关注', exact: true })
      .click();
    await otherPage
      .getByRole('dialog')
      .filter({ hasText: '只删除个人视图' })
      .getByRole('button', { name: /确定|确 定/ })
      .click();
    await expect(manage).toContainText('尚未保存常用视图');
    await manage.getByRole('button', { name: 'Close', exact: true }).click();
  } finally {
    await second.close();
  }
  await page.goto(root + '&priority=P2');
  await page.getByRole('button', { name: '保存当前视图', exact: true }).click();
  await page.getByLabel('视图名称', { exact: true }).fill('手机视图');
  await page.getByRole('button', { name: '保存视图', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '保存当前视图' }),
  ).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.shell > aside')).not.toBeInViewport();
  await expect(
    page.getByRole('button', { name: '保存当前视图', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'artifacts/browser/saved-views-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  // Same account, second team: personal preferences must not cross teams.
  const url = process.env.TEST_DATABASE_URL;
  expect(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  ).toBeTruthy();
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const teamId = randomUUID();
    await db.workspace.create({ data: { id: teamId, name: '另一个视图团队' } });
    await db.workspaceMember.create({
      data: { workspaceId: teamId, userId: auth.user.id, role: 'ADMIN' },
    });
    await page.goto(`/student/?app=work&view=todos&workspace=${teamId}`);
    await page.getByRole('button', { name: '管理视图', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: '管理常用视图' }),
    ).toContainText('尚未保存常用视图');
  } finally {
    await db.$disconnect();
  }
});

test('通知翻页、刷新恢复、选中与全量已读，未读末页回退和手机布局', async ({
  page,
}) => {
  const auth = await register(page.request, '通知中心');
  const created = await page.request.post(
    `/api/v1/projects/${auth.projectId}/tasks`,
    {
      headers: auth.headers,
      data: { title: '通知关联需求', productId: auth.user.id },
    },
  );
  expect(created.ok()).toBeTruthy();
  const task = await created.json();
  const url = process.env.TEST_DATABASE_URL;
  expect(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  ).toBeTruthy();
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    await db.notification.createMany({
      data: Array.from({ length: 25 }, (_, index) => {
        const id = randomUUID();
        return {
          id,
          recipientId: auth.user.id,
          workspaceId: auth.workspaceId,
          projectId: auth.projectId,
          taskId: task.id,
          message: `通知中心消息-${index}`,
          dedupe: id,
        };
      }),
    });
    await page.goto(
      `/student/?app=work&view=notifications&workspace=${auth.workspaceId}`,
    );
    const center = page.locator('.notification-center');
    await expect(center).toContainText('当前团队未读 25 条');
    await expect(center.locator('.notice-row')).toHaveCount(20);
    await center.locator('.ant-pagination-next').click();
    await expect(center.locator('.notice-row')).toHaveCount(5);
    await expect(page).toHaveURL(/notificationPage=2/);
    await page.reload();
    await expect(center.locator('.notice-row')).toHaveCount(5);
    await page.locator('.notification-toolbar .ant-select-selector').click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByTitle('仅看未读', { exact: true })
      .click();
    await center.locator('.ant-pagination-next').click();
    await expect(center.locator('.notice-row')).toHaveCount(5);
    await page.getByLabel('选择本页未读通知', { exact: true }).check();
    await page
      .getByRole('button', { name: '选中已读（5）', exact: true })
      .click();
    await expect(center).toContainText('当前团队未读 20 条');
    await expect(page).toHaveURL(/notificationPage=1/);
    await expect(center.locator('.notice-row')).toHaveCount(20);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.shell > aside')).not.toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: 'artifacts/browser/notifications-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page
      .getByRole('button', { name: '当前团队全部已读', exact: true })
      .click();
    await page
      .getByRole('button', { name: '全部标为已读', exact: true })
      .click();
    await expect(center).toContainText('当前团队暂无未读通知');
    await expect(center).toContainText('当前团队未读 0 条');
    expect(
      await db.notification.count({
        where: {
          recipientId: auth.user.id,
          workspaceId: auth.workspaceId,
          readAt: null,
        },
      }),
    ).toBe(0);
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.locator('.notification-toolbar .ant-select-selector').click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByTitle('全部通知', { exact: true })
      .click();
    await expect(center.locator('.notice-row')).toHaveCount(20);
    await center.locator('.notice-open').first().click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
  } finally {
    await db.$disconnect();
  }
});

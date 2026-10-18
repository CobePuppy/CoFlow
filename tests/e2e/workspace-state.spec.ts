import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5174';
test('页面状态恢复、看板完整翻页、筛选清空与团队项目切换', async ({ page }) => {
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    new URL(url).pathname !== '/coflow_test' ||
    url === process.env.DATABASE_URL
  )
    throw new Error('仅允许隔离测试库');
  const suffix = Date.now();
  const email = `front-state-${suffix}@coflow.local`,
    password = 'Front-state-test-2026!';
  const registration = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      email,
      password,
      name: '前端回归',
      teamName: `状态团队A-${suffix}`,
    },
  });
  expect(registration.ok(), await registration.text()).toBeTruthy();
  const workspaceA = (await registration.json()).workspaceId;
  await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email, password },
  });
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const db = new PrismaClient({ datasources: { db: { url } } });
  const workspaceB = randomUUID(),
    projectA = randomUUID(),
    projectB = randomUUID(),
    projectC = randomUUID();
  try {
    await db.$transaction(async (tx) => {
      const source = await tx.task.findFirstOrThrow({
        where: { status: 'DRAFT' },
      });
      await tx.workspace.create({
        data: { id: workspaceB, name: `状态团队B-${suffix}` },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspaceB, userId: me.user.id, role: 'ADMIN' },
      });
      await tx.project.createMany({
        data: [
          {
            id: projectA,
            workspaceId: workspaceA,
            name: '状态项目A',
            sequence: 105,
          },
          { id: projectB, workspaceId: workspaceA, name: '状态项目B' },
          { id: projectC, workspaceId: workspaceB, name: '状态项目C' },
        ],
      });
      await tx.projectMember.createMany({
        data: [projectA, projectB, projectC].map((projectId) => ({
          projectId,
          userId: me.user.id,
          roles: ['PRODUCT', 'ENGINEER', 'QA'],
        })),
      });
      await tx.task.createMany({
        data: Array.from({ length: 105 }, (_, i) => ({
          id: randomUUID(),
          workspaceId: workspaceA,
          projectId: projectA,
          number: i + 1,
          status: 'DRAFT',
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
          data: {
            ...(source.data as object),
            title: `状态需求-${i}`,
            priority: 'P1',
            productId: me.user.id,
            engineerId: me.user.id,
            testerId: me.user.id,
            productReviewerId: me.user.id,
            qaReviewerId: me.user.id,
            history: [],
            blocks: [],
          },
        })),
      });
    });
  } finally {
    await db.$disconnect();
  }
  const route = `/?app=work&workspace=${workspaceA}&project=${projectA}&view=tasks&mode=board&page=2&priority=P1`;
  await page.goto(route);
  await expect(page.locator('.board .ant-card')).toHaveCount(5);
  await expect(page.getByText('共 105 条需求，每页最多 100 条')).toBeVisible();
  await expect(
    page.locator('.ant-select[aria-label="筛选优先级"]'),
  ).toContainText('P1');
  await page.reload();
  await expect(page.locator('.board .ant-card')).toHaveCount(5);
  await page.locator('.board .ant-card h4').first().click();
  await expect(page.locator('.task-detail-drawer')).toBeVisible();
  await page.getByRole('button', { name: '返回需求列表', exact: true }).click();
  await expect(page.locator('.board .ant-card')).toHaveCount(5);
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  await page.goBack();
  await expect(page.locator('.task-detail-drawer')).toBeVisible();
  await page.goForward();
  await expect(page.locator('.task-detail-drawer')).toHaveCount(0);
  await page.locator('.ant-select[aria-label="筛选全部状态"]').click();
  await page.getByTitle('待测试', { exact: true }).click();
  await expect(page.getByText('没有符合筛选条件的需求')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('page')).toBeNull();
  await page.getByRole('button', { name: '清空筛选', exact: true }).click();
  await expect(page.locator('.board .ant-card')).toHaveCount(100);
  await expect(
    page.locator('.ant-select[aria-label="筛选全部状态"]'),
  ).toContainText('全部状态');
  await expect(
    page.locator('.ant-select[aria-label="筛选优先级"]'),
  ).toContainText('优先级');
  await page.getByLabel('搜索需求', { exact: true }).fill('查不到的需求');
  await page.getByLabel('搜索需求', { exact: true }).press('Enter');
  await expect(page.getByText('没有符合筛选条件的需求')).toBeVisible();
  await page.getByRole('button', { name: '清空筛选', exact: true }).click();
  await expect(page.getByLabel('搜索需求', { exact: true })).toHaveValue('');
  await expect(page.locator('.board .ant-card')).toHaveCount(100);
  await page.getByRole('button', { name: '状态项目B', exact: false }).click();
  expect(new URL(page.url()).searchParams.get('project')).toBe(projectB);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '状态项目B', exact: true }),
  ).toBeVisible();
  await page.locator('.ant-select[aria-label="切换团队"]').click();
  await page
    .getByTitle(`状态团队B-${suffix} · 管理员`, { exact: true })
    .click();
  expect(new URL(page.url()).searchParams.get('workspace')).toBe(workspaceB);
  expect(new URL(page.url()).searchParams.get('project')).toBeNull();
  await expect(page.locator('.shell > main > header')).toContainText(
    '待我处理 · 当前团队全部项目',
  );
  await expect(
    page.getByRole('button', { name: '状态项目A', exact: false }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell')).not.toHaveClass(/nav-open/);
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});

import { test, expect } from '@playwright/test';
test.use({ actionTimeout: 15000 });
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const pid = '10000000-0000-4000-8000-000000000001';
test('超过100条任务：历史附件、完整关联选项与跨团队隔离', async ({
  page,
  browser,
}) => {
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    new URL(url).pathname !== '/coflow_test' ||
    url === process.env.DATABASE_URL
  )
    throw new Error('仅允许隔离测试库');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const title = `分页末尾任务-${Date.now()}`;
  let taskId = '';
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${pid} FOR UPDATE`;
      const source = await tx.task.findFirstOrThrow({
        where: { projectId: pid, status: 'DRAFT' },
      });
      const project = await tx.project.update({
        where: { id: pid },
        data: { sequence: { increment: 101 } },
      });
      const rows = Array.from({ length: 101 }, (_, i) => ({
        id: randomUUID(),
        workspaceId: source.workspaceId,
        projectId: pid,
        number: project.sequence - 100 + i,
        status: 'DRAFT',
        data: {
          ...(source.data as object),
          title: i === 100 ? title : `分页填充-${Date.now()}-${i}`,
          history: [],
        },
        updatedAt: new Date('2020-01-01T00:00:00Z'),
      }));
      taskId = rows[100].id;
      await tx.task.createMany({ data: rows });
    });
  } finally {
    await db.$disconnect();
  }
  await page.goto('/enterprise/');
  await page.getByLabel('邮箱', { exact: true }).fill('product@coflow.local');
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(
    page.getByRole('heading', { name: '工作台', exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const filename = `${title}.txt`;
  const upload = await page.request.post(
    `/api/v1/tasks/${taskId}/attachments`,
    {
      headers: { Origin: 'http://localhost:5174', 'X-CSRF-Token': me.csrf },
      multipart: {
        file: {
          name: filename,
          mimeType: 'text/plain',
          buffer: Buffer.from('分页历史附件内容'),
        },
      },
    },
  );
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const attachment = await upload.json();
  const firstPage = await (
    await page.request.get(`/api/v1/projects/${pid}/tasks?pageSize=100`)
  ).json();
  expect(firstPage.items.some((t: any) => t.id === taskId)).toBeFalsy();
  await page.goto(
    `/?section=library&project=${pid}&workspace=${me.user.workspaceId || '00000000-0000-4000-8000-000000000001'}`,
  );
  await page.getByRole('tab', { name: /文件库/ }).click();
  await page.getByLabel('搜索当前页面').fill(filename);
  const row = page.getByRole('row').filter({ hasText: filename });
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: '关联需求' })).toBeVisible();
  const content = await page.request.get(
    `/api/v1/attachments/${attachment.id}/download`,
  );
  expect(await content.text()).toBe('分页历史附件内容');
  await page.locator('.ant-select[aria-label="文件来源"]').click();
  await page.getByTitle('独立文件', { exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.locator('.ant-select[aria-label="文件来源"]').click();
  await page.getByTitle('需求附件', { exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByLabel('搜索当前页面').clear();
  await page.getByRole('tab', { name: '项目文档' }).click();
  await page.getByRole('button', { name: '新建项目文档' }).click();
  await page.getByLabel('关联任务').click();
  await page.getByLabel('关联任务').fill(title);
  await page.getByTitle(title, { exact: true }).click();
  await page.getByLabel('文档标题').fill(title);
  await page.getByLabel('Markdown 内容').fill('分页关联验证');
  await page.getByRole('button', { name: '提交新版本' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const documents = await (
    await page.request.get(`/api/v1/projects/${pid}/documents`)
  ).json();
  expect(documents.find((d: any) => d.title === title).taskIds).toEqual([
    taskId,
  ]);
  const document = documents.find((d: any) => d.title === title);
  await page.goto('/?task=' + taskId);
  await page.getByRole('tab', { name: '关联资料', exact: true }).click();
  await page.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByRole('dialog', { name: '项目文档' })).toBeVisible();
  await expect(page.getByLabel('文档标题')).toHaveValue(title);
  await expect(page).toHaveURL(new RegExp('document=' + document.id));
  await page.reload();
  await expect(page.getByLabel('文档标题')).toHaveValue(title);
  await page
    .getByRole('region', { name: '文档关联需求' })
    .getByRole('link')
    .click();
  await expect(page).toHaveURL(new RegExp('task=' + taskId));
  await page.getByRole('tab', { name: '关联资料', exact: true }).click();
  await expect(
    page.getByRole('link', { name: title, exact: true }),
  ).toBeVisible();
  const related = await (
    await page.request.get('/api/v1/tasks/' + taskId + '/documents')
  ).json();
  expect(related.some((d: any) => d.id === document.id)).toBeTruthy();
  expect(related[0]).not.toHaveProperty('content');
  const other = await browser.newContext({ baseURL: 'http://localhost:5174' });
  try {
    await other.request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://localhost:5174' },
      data: {
        email: 'other@coflow.local',
        password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
      },
    });
    for (const path of [
      `/tasks/${taskId}/documents`,
      `/documents/${document.id}/tasks`,
      `/documents/${document.id}`,
      `/projects/${pid}/attachments`,
      `/projects/${pid}/task-options`,
      `/attachments/${attachment.id}/download`,
    ])
      expect((await other.request.get('/api/v1' + path)).status()).toBe(404);
  } finally {
    await other.close();
  }
  const unlink = await page.request.patch('/api/v1/documents/' + document.id, {
    headers: { Origin: 'http://localhost:5174', 'X-CSRF-Token': me.csrf },
    data: {
      title,
      content: '分页关联验证',
      taskIds: [],
      expectedVersion: document.version,
    },
  });
  expect(unlink.ok(), await unlink.text()).toBeTruthy();
  await page.reload();
  await page.getByRole('tab', { name: '关联资料', exact: true }).click();
  await expect(page.getByText('尚未引用资料')).toBeVisible();
});

import { test, expect } from '@playwright/test';
test.use({ actionTimeout: 15000 });
const pid = '10000000-0000-4000-8000-000000000001';
const origin = 'http://localhost:5174';
test('项目模板创建、套用确认、草稿保存模板与停用', async ({ page }) => {
  const suffix = Date.now(),
    name = `接口模板-${suffix}`,
    title = `模板需求-${suffix}`;
  await page.goto('/enterprise/');
  await page.getByLabel('邮箱', { exact: true }).fill('product@coflow.local');
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '工作台', exact: true }),
  ).toBeVisible();
  await page.goto(`/?app=work&project=${pid}&view=templates`);
  await page.getByRole('button', { name: '新建需求模板', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '需求模板', exact: true });
  await editor.getByLabel('模板名称', { exact: true }).fill(name);
  await editor.getByLabel('预填需求标题', { exact: true }).fill(title);
  await editor.getByLabel('模板目标', { exact: true }).fill('接口统一接入');
  await editor
    .getByLabel('模板需求描述', { exact: true })
    .fill('定义字段、权限与异常响应');
  await editor
    .getByLabel('模板验收标准（每行一项）', { exact: true })
    .fill('正常请求成功\n异常请求明确返回');
  await editor
    .getByRole('button', { name: '保存需求模板', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const task = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: '创建需求', exact: true }),
  });
  await task.getByLabel('需求标题', { exact: true }).fill('保留当前输入');
  await task.getByLabel('计划截止', { exact: true }).fill('2026-12-01');
  await task.locator('.ant-select[aria-label="选择需求模板"]').click();
  await page.getByTitle(name, { exact: true }).click();
  await task.getByRole('button', { name: '应用需求模板', exact: true }).click();
  await page
    .getByRole('dialog', { name: '应用需求模板', exact: true })
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await expect(task.getByLabel('需求标题', { exact: true })).toHaveValue(
    '保留当前输入',
  );
  await task.getByRole('button', { name: '应用需求模板', exact: true }).click();
  await page
    .getByRole('dialog', { name: '应用需求模板', exact: true })
    .getByRole('button', { name: '填入所选字段', exact: true })
    .click();
  await expect(task.getByLabel('需求标题', { exact: true })).toHaveValue(title);
  await expect(task.getByLabel('目标', { exact: true })).toHaveValue(
    '接口统一接入',
  );
  await expect(task.getByLabel('计划截止', { exact: true })).toHaveValue(
    '2026-12-01',
  );
  await expect(
    task.getByLabel('验收标准（每行一项）', { exact: true }),
  ).toHaveValue('正常请求成功\n异常请求明确返回');
  await task
    .getByRole('button', { name: '将当前内容保存为模板', exact: true })
    .click();
  const save = page.getByRole('dialog', {
    name: '保存为需求模板',
    exact: true,
  });
  await save.getByLabel('保存模板名称', { exact: true }).fill(name + '复用');
  await save.getByRole('button', { name: '确认保存模板', exact: true }).click();
  await expect(save).toHaveCount(0);
  await task.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(task).toHaveCount(0);
  const tasks = await (
    await page.request.get(
      `/api/v1/projects/${pid}/tasks?q=${encodeURIComponent(title)}`,
    )
  ).json();
  const created = tasks.items.find((x: any) => x.data.title === title);
  expect(created.status).toBe('DRAFT');
  expect(created.data.history).toEqual([]);
  expect(created.data.criteria).toEqual(['正常请求成功', '异常请求明确返回']);
  expect(created.data.engineerId).toBeTruthy();
  expect(created.data.dueAt).toMatch(/^2026-12-01/);
  const templates = await (
    await page.request.get(`/api/v1/projects/${pid}/templates`)
  ).json();
  const copy = templates.items.find((x: any) => x.name === name + '复用');
  expect(copy.content).not.toHaveProperty('productId');
  expect(copy.content).not.toHaveProperty('dueAt');
  await page.goto(`/?app=work&project=${pid}&view=templates`);
  const card = page
    .locator('.ant-card')
    .filter({ has: page.getByText(name, { exact: true }) });
  await card
    .getByRole('button', { name: '查看 / 编辑模板', exact: true })
    .click();
  await editor.getByRole('switch', { name: '启用模板', exact: true }).click();
  await editor
    .getByRole('button', { name: '保存需求模板', exact: true })
    .click();
  await expect(card.getByText('已停用', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  await task.locator('.ant-select[aria-label="选择需求模板"]').click();
  await expect(page.getByTitle(name, { exact: true })).toHaveCount(0);
  await expect(page.getByTitle(name + '复用', { exact: true })).toBeVisible();
});

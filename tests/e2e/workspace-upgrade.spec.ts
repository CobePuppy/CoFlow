import { test, expect } from '@playwright/test';

test('工作概览、项目设置删除与需求所属选择', async ({ page }) => {
  const suffix = Date.now(),
    origin = 'http://localhost:5174';
  const email = `dashboard-${suffix}@example.com`,
    password = 'Dashboard-test-2026!';
  const registered = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      name: '工作台负责人',
      email,
      password,
      teamName: '工作台测试' + suffix,
    },
  });
  expect(registered.status()).toBe(201);
  const team = await registered.json();
  const logged = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email, password },
  });
  const session = await logged.json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
  async function post(path: string, data: any) {
    const response = await page.request.post('/api/v1' + path, {
      headers,
      data,
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  const source = await post('/workspaces/' + team.workspaceId + '/projects', {
    name: '工作台项目A',
  });
  const target = await post('/workspaces/' + team.workspaceId + '/projects', {
    name: '工作台项目B',
  });
  await post('/projects/' + target.id + '/members', {
    userId: session.user.id,
    roles: ['PRODUCT', 'ENGINEER', 'QA', 'OPS'],
  });
  const empty = await post('/workspaces/' + team.workspaceId + '/projects', {
    name: '待删除项目',
  });
  await page.goto(
    '/student/?app=work&workspace=' +
      team.workspaceId +
      '&project=' +
      source.id,
  );
  await expect(page.locator('.work-stat-grid')).toBeVisible();
  for (const name of ['我的项目', '竞赛与截止提醒', '最近成果'])
    await expect(
      page
        .locator('.work-dashboard .ant-card-head-title')
        .filter({ hasText: name }),
    ).toBeVisible();
  const emptyRow = page
    .locator('.dashboard-row')
    .filter({ has: page.getByText('待删除项目', { exact: true }) });
  await emptyRow.getByRole('button', { name: '项目设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '项目设置', exact: true });
  await settings
    .getByLabel('项目名称', { exact: true })
    .fill('待删除项目已更新');
  await settings
    .getByLabel('项目介绍', { exact: true })
    .fill('从项目设置修改介绍');
  await settings
    .getByRole('button', { name: '保存项目信息', exact: true })
    .click();
  await expect(settings).not.toBeVisible();
  const updatedRow = page
    .locator('.dashboard-row')
    .filter({ has: page.getByText('待删除项目已更新', { exact: true }) });
  await updatedRow
    .getByRole('button', { name: '项目设置', exact: true })
    .click();
  await settings.getByRole('button', { name: '删除项目', exact: true }).click();
  await settings.getByLabel('确认删除的项目名称').fill('待删除项目已更新');
  await settings
    .getByRole('button', { name: '确认永久删除', exact: true })
    .click();
  await expect(settings).not.toBeVisible();
  await expect(page.getByText('待删除项目已更新', { exact: true })).toHaveCount(
    0,
  );
  expect(
    (await page.request.get('/api/v1/projects/' + empty.id)).status(),
  ).toBe(404);
  await page
    .getByRole('button', { name: 'folder 工作台项目A', exact: true })
    .click();
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const editor = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: '创建需求', exact: true }),
  });
  await editor.getByLabel('需求标题', { exact: true }).fill('可选择归属的需求');
  await editor
    .locator('.ant-form-item')
    .filter({ has: page.getByText('所属项目', { exact: true }) })
    .locator('.ant-select-selector')
    .click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByTitle('工作台项目B', { exact: true })
    .click();
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(editor).not.toBeVisible();
  const tasks = await (
    await page.request.get('/api/v1/projects/' + target.id + '/tasks')
  ).json();
  expect(
    tasks.items.some((t: any) => t.data.title === '可选择归属的需求'),
  ).toBeTruthy();
  const createdTask = tasks.items.find(
    (t: any) => t.data.title === '可选择归属的需求',
  );
  await page.goto(
    '/student/?app=work&workspace=' +
      team.workspaceId +
      '&task=' +
      createdTask.id,
  );
  await page.getByRole('button', { name: '编辑草稿', exact: true }).click();
  const draftEditor = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: '编辑需求草稿', exact: true }),
  });
  await draftEditor
    .locator('.ant-form-item')
    .filter({ has: page.getByText('所属项目', { exact: true }) })
    .locator('.ant-select-selector')
    .click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByTitle('工作台项目A', { exact: true })
    .click();
  await draftEditor.getByRole('button', { name: /完善更多信息/ }).click();
  for (const label of [
    '产品负责人',
    '研发负责人',
    '测试负责人',
    '产品评估人',
    '测试评估人',
  ]) {
    await draftEditor.getByLabel(label, { exact: true }).click();
    await draftEditor.getByLabel(label, { exact: true }).fill('工作台负责人');
    await draftEditor.getByLabel(label, { exact: true }).press('Enter');
  }
  await draftEditor
    .getByRole('button', { name: '保存修改', exact: true })
    .click();
  await expect(draftEditor).not.toBeVisible();
  expect(
    (await (await page.request.get('/api/v1/tasks/' + createdTask.id)).json())
      .projectId,
  ).toBe(source.id);
  await page.goto('/student/?app=work&workspace=' + team.workspaceId);
  await expect(page.locator('.work-dashboard')).toBeVisible();
  await page.screenshot({
    path: 'artifacts/browser/work-dashboard.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.shell > aside')).not.toBeInViewport();
  await expect(page.locator('.work-dashboard')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: 'artifacts/browser/work-dashboard-mobile.png',
    fullPage: true,
  });
});

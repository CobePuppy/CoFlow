import { test, expect } from '@playwright/test';
test.use({ actionTimeout: 15000 });
test('项目空间：独立导航、真实速览、项目隔离、两版入口与手机卡片', async ({
  page,
}) => {
  const origin = 'http://localhost:5174';
  const password = 'Project-space-test-2026!';
  const email = 'project-space-' + Date.now() + '@example.com';
  const registered = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      name: '项目空间负责人',
      email,
      password,
      teamName: '项目空间测试',
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
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const source = await post('/workspaces/' + team.workspaceId + '/projects', {
    name: '智学引擎 · 项目空间',
    description: '项目专属空间，保留所有交付资料与业务权限。',
    workflow: 'STANDARD',
  });
  const target = await post('/workspaces/' + team.workspaceId + '/projects', {
    name: '简易协作项目',
    workflow: 'SIMPLE',
  });
  for (const project of [source, target])
    await post('/projects/' + project.id + '/members', {
      userId: session.user.id,
      roles: ['PRODUCT', 'ENGINEER', 'QA', 'OPS'],
    });
  const task = await post('/projects/' + source.id + '/tasks', {
    title: '智学引擎项目空间验证',
    description: '这是当前项目需求的真实正文。',
    criteria: ['验收结果可复核'],
    productId: session.user.id,
    engineerId: session.user.id,
    testerId: session.user.id,
    productReviewerId: session.user.id,
    qaReviewerId: session.user.id,
  });
  const invalidTaskRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/v1\/tasks\/(null|undefined)([/?]|$)/.test(request.url()))
      invalidTaskRequests.push(request.url());
  });
  for (const edition of ['enterprise', 'student']) {
    await page.goto('/' + edition + '/?workspace=' + team.workspaceId);
    await page
      .locator('.dashboard-row')
      .filter({ hasText: source.name })
      .getByRole('button', { name: '进入项目', exact: true })
      .click();
    await expect(page.locator('.shell.project-space')).toBeVisible();
    expect(new URL(page.url()).searchParams.has('task')).toBe(false);
    await expect(page.locator('.task-detail-drawer')).toHaveCount(0);
    for (const name of ['待我处理', '站内通知']) {
      await page
        .locator('aside')
        .getByRole('button', { name, exact: true })
        .click();
      await expect(page.locator('.shell.project-space')).toBeVisible();
      await expect(
        page.locator('aside').getByRole('button', { name, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      expect(new URL(page.url()).searchParams.get('project')).toBe(source.id);
      await expect(page.locator('.workspace-project-list')).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name, exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.locator('aside').getByRole('button', { name, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    }
    await page
      .getByRole('navigation', { name: '项目导航' })
      .getByRole('button', { name: '需求与交付', exact: true })
      .click();
    for (const invalid of ['null', 'undefined']) {
      await page.goto(
        '/' +
          edition +
          '/?app=work&project=' +
          source.id +
          '&view=tasks&task=' +
          invalid,
      );
      await expect(page.locator('.project-desktop-table')).toContainText(
        task.data.title,
      );
      expect(new URL(page.url()).searchParams.has('task')).toBe(false);
      await expect(page.locator('.task-detail-drawer')).toHaveCount(0);
    }
    expect(invalidTaskRequests).toEqual([]);
    await page.goto(
      '/' + edition + '/?app=work&project=' + source.id + '&view=tasks',
    );
    await expect(page.locator('.shell.project-space')).toBeVisible();
    await expect(
      page
        .locator('.shell>aside')
        .getByRole('button', { name: '创建项目', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('navigation', { name: '项目导航' })
      .getByRole('button', { name: '项目概览', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: '项目交付总览', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '需求阶段分布', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.project-overview')).toContainText(
      '已交付 0 / 全部 1 项需求',
    );
    if (edition === 'student')
      await page.screenshot({
        path: 'artifacts/v3.2.0-overview-desktop.png',
        animations: 'disabled',
      });
    await page
      .getByRole('button', { name: '进入需求与交付', exact: true })
      .click();
    await expect(page.locator('.project-metrics')).toContainText(
      '进行中的需求',
    );
    expect(
      await page
        .locator('.shell>aside')
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe('rgb(251, 252, 253)');
    const row = page.locator('tbody tr').filter({ hasText: task.data.title });
    if (edition === 'student') {
      await row.focus();
      await row.press('Enter');
    } else await row.locator('td').nth(1).click();
    await expect(
      page.getByRole('complementary', { name: '需求速览' }),
    ).toContainText('真实正文');
    expect(new URL(page.url()).searchParams.has('task')).toBe(false);
    await page
      .getByRole('button', { name: '打开完整需求详情', exact: true })
      .click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
    await expect(
      page.locator('.requirement-detail-sections').getByRole('tab'),
    ).toHaveCount(8);
    await page
      .getByRole('button', { name: '返回需求列表', exact: true })
      .click();
    const nav = page.getByRole('navigation', { name: '项目导航' });
    await expect(
      nav.locator('details').filter({ hasText: '项目资源' }),
    ).not.toHaveAttribute('open');
    await expect(
      nav.getByRole('button', { name: 'GitHub 仓库', exact: true }),
    ).not.toBeVisible();
    await nav.getByRole('button', { name: '项目概览', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '项目交付总览', exact: true }),
    ).toBeVisible();
    await nav.locator('summary').filter({ hasText: '项目资源' }).click();
    await nav.getByRole('button', { name: 'GitHub 仓库', exact: true }).click();
    await expect(
      page.getByText('为本项目设置默认仓库，需求可采用默认值并保存独立快照。'),
    ).toBeVisible();
    await page.reload();
    await expect(
      nav.getByRole('button', { name: 'GitHub 仓库', exact: true }),
    ).toBeVisible();
    await nav.getByRole('button', { name: '需求与交付', exact: true }).click();
    await page
      .locator('tbody tr')
      .filter({ hasText: task.data.title })
      .locator('td')
      .nth(1)
      .click();
    await page.locator('.project-selector .ant-select-selector').click();
    await page.getByTitle(target.name, { exact: true }).click();
    await expect(page.locator('.requirement-preview')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: target.name, exact: true }),
    ).toBeVisible();
    await expect(page.locator('.project-desktop-table')).not.toContainText(
      task.data.title,
    );
  }
  await page.goto('/student/?app=work&project=' + source.id + '&view=tasks');
  await expect(page.locator('.project-desktop-table')).toContainText(
    task.data.title,
  );
  await page
    .locator('tbody tr')
    .filter({ hasText: task.data.title })
    .locator('td')
    .nth(1)
    .click();
  await expect(
    page.getByRole('complementary', { name: '需求速览' }),
  ).toContainText('真实正文');
  await page.screenshot({
    path: 'artifacts/v3.2.0-project-desktop.png',
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '关闭需求速览', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.project-mobile-cards')).toBeVisible();
  await expect(page.locator('.project-desktop-table')).toHaveCount(0);
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page
    .getByRole('navigation', { name: '项目导航' })
    .getByRole('button', { name: '项目概览', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '项目交付总览', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'artifacts/v3.2.0-overview-mobile.png',
    animations: 'disabled',
  });
  await page
    .getByRole('button', { name: '进入需求与交付', exact: true })
    .click();
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: '项目导航' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭导航', exact: true }).click();
  await page.getByRole('button', { name: '需求速览', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '需求速览', exact: true }),
  ).toContainText('真实正文');
  await page
    .getByRole('button', { name: '打开完整需求详情', exact: true })
    .click();
  await expect(page.locator('.task-detail-drawer')).toBeVisible();
  await page.getByRole('button', { name: '返回需求列表', exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const tab of await page
    .locator('.task-scope-tabs')
    .getByRole('tab')
    .all())
    await expect(tab).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'artifacts/v3.2.0-project-mobile.png',
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await expect(page.locator('.shell.project-space')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '工作台', exact: true }),
  ).toBeVisible();
  const archive = await page.request.patch('/api/v1/projects/' + source.id, {
    headers,
    data: { archived: true },
  });
  expect(archive.ok()).toBeTruthy();
  await page.goto('/student/?app=work&project=' + source.id + '&view=tasks');
  await expect(
    page.getByRole('button', { name: '新建需求', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText('项目已归档，业务数据只读', { exact: true }),
  ).toBeVisible();
});

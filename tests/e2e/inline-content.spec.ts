import { test, expect } from '@playwright/test';
test('需求正文点击编辑、取消、详情文件导入及只读权限', async ({
  page,
  browser,
}) => {
  const origin = 'http://localhost:5174',
    suffix = Date.now(),
    email = `inline-${suffix}@example.com`,
    password = 'Inline-test-2026!';
  const registered = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      name: '正文负责人',
      email,
      password,
      teamName: '正文编辑',
    },
  });
  const team = await registered.json();
  expect(registered.ok()).toBeTruthy();
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email, password },
  });
  const session = await login.json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
  const response = await page.request.post(
    '/api/v1/workspaces/' + team.workspaceId + '/projects',
    { headers, data: { name: '正文项目' } },
  );
  const project = await response.json();
  const created = await page.request.post(
    '/api/v1/projects/' + project.id + '/tasks',
    {
      headers,
      data: {
        title: '正文编辑需求',
        productId: session.user.id,
        engineerId: session.user.id,
        testerId: session.user.id,
        productReviewerId: session.user.id,
        qaReviewerId: session.user.id,
      },
    },
  );
  const task = await created.json();
  await page.goto('/student/?app=work&task=' + task.id);
  const article = page.locator('.requirement-article');
  await expect(
    article.getByRole('button', { name: '从文件导入信息', exact: true }),
  ).toBeVisible();
  for (const [label, text] of [
    ['目标', '可以导出完整报告'],
    ['背景', '人工整理耗时较长'],
    ['范围与需求说明', '用户点击导出后得到PDF文件'],
    ['验收标准', 'PDF可以打开\n文件包含全部章节'],
  ]) {
    await article
      .getByRole('button', { name: '编辑' + label, exact: true })
      .click();
    await article
      .getByRole('textbox', { name: '编辑' + label, exact: true })
      .fill(text);
    await article
      .getByRole('button', { name: '保存正文修改', exact: true })
      .click();
    await expect(
      article.getByRole('textbox', { name: '编辑' + label, exact: true }),
    ).not.toBeVisible();
    await expect(article).toContainText(text.split('\n')[0]);
  }
  await article.getByRole('button', { name: '编辑目标', exact: true }).click();
  await article
    .getByRole('textbox', { name: '编辑目标', exact: true })
    .fill('不应该保存的内容');
  await article
    .getByRole('button', { name: '取消正文修改', exact: true })
    .click();
  expect(
    (await (await page.request.get('/api/v1/tasks/' + task.id)).json()).data
      .goal,
  ).toBe('可以导出完整报告');
  await article
    .getByRole('button', { name: '从文件导入信息', exact: true })
    .click();
  const importer = page.getByRole('dialog', {
    name: '文件解析与填入',
    exact: true,
  });
  await importer.getByLabel('选择信息文件').setInputFiles({
    name: '需求导入.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('文件导入后的需求说明，包含报告下载功能。'),
  });
  await importer
    .getByRole('button', { name: '按正文填入说明', exact: true })
    .click();
  await importer
    .getByRole('button', { name: '确认填入表单', exact: true })
    .click();
  await expect(
    article.getByRole('textbox', { name: '编辑范围与需求说明', exact: true }),
  ).toHaveValue('文件导入后的需求说明，包含报告下载功能。');
  await article
    .getByRole('button', { name: '保存正文修改', exact: true })
    .click();
  await expect(
    article.getByRole('textbox', { name: '编辑范围与需求说明', exact: true }),
  ).not.toBeVisible();
  const saved = await (
    await page.request.get('/api/v1/tasks/' + task.id)
  ).json();
  expect(saved.data.title).toBe('需求导入');
  expect(saved.data.criteria).toHaveLength(2);
  expect(saved.data.background).toBe('人工整理耗时较长');
  await page.setViewportSize({ width: 390, height: 844 });
  await article.getByRole('button', { name: '编辑目标', exact: true }).click();
  await expect(
    article.getByRole('textbox', { name: '编辑目标', exact: true }),
  ).toBeVisible();
  await article
    .getByRole('button', { name: '取消正文修改', exact: true })
    .click();
  const peerContext = await browser.newContext({ baseURL: origin });
  try {
    const peerEmail = `inline-peer-${suffix}@example.com`;
    await peerContext.request.post('/api/v1/auth/register', {
      headers: { Origin: origin },
      data: {
        kind: 'member',
        name: '正文队友',
        email: peerEmail,
        password,
        teamCode: team.teamCode,
      },
    });
    const logged = await peerContext.request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { email: peerEmail, password },
    });
    const peer = await logged.json();
    await page.request.post('/api/v1/projects/' + project.id + '/members', {
      headers,
      data: { userId: peer.user.id, roles: ['ENGINEER'] },
    });
    const peerPage = await peerContext.newPage();
    await peerPage.goto('/student/?app=work&task=' + task.id);
    await expect(peerPage.locator('.requirement-article')).toContainText(
      '仅产品负责人可以编辑当前草稿',
    );
    await expect(
      peerPage
        .locator('.requirement-article')
        .getByRole('button', { name: '编辑目标', exact: true }),
    ).toHaveCount(0);
  } finally {
    await peerContext.close();
  }
  await page.route('**/api/v1/tasks/' + task.id, async (route) => {
    if (route.request().method() === 'GET')
      await route.fulfill({
        json: { ...saved, status: 'SOLUTION_PENDING', allowedActions: [] },
      });
    else await route.continue();
  });
  await page.reload();
  await expect(article).toContainText('需求已提交');
  await expect(
    article.getByRole('button', { name: '编辑目标', exact: true }),
  ).toHaveCount(0);
  await article
    .getByRole('button', { name: '发起内容变更', exact: true })
    .click();
  await expect(page.locator('.ant-modal-content')).toBeVisible();
});

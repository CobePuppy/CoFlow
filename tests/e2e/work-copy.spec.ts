import { test, expect } from '@playwright/test';
test.use({ actionTimeout: 15000 });
const origin = 'http://localhost:5174';
for (const edition of ['enterprise', 'student'])
  test(edition + '工作副本恢复、缺项定位和模板按字段填入', async ({ page }) => {
    const email = 'copy-' + edition + '-' + Date.now() + '@example.com',
      password = 'Copy-test-2026!';
    const reg = await page.request.post('/api/v1/auth/register', {
      headers: { Origin: origin },
      data: {
        kind: 'creator',
        name: '草稿处理人',
        email,
        password,
        teamName: '草稿团队',
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
      { name: '草稿项目', workflow: 'SIMPLE' },
    );
    await post('/projects/' + project.id + '/members', {
      userId: session.user.id,
      roles: ['PRODUCT', 'ENGINEER', 'QA'],
    });
    await post('/projects/' + project.id + '/templates', {
      name: '字段模板',
      active: true,
      content: {
        title: '模板标题',
        description: '模板描述',
        background: '模板背景',
        goal: '模板目标',
        criteria: ['模板验收'],
        priority: 'P1',
      },
    });
    const base = '/' + edition + '/?app=work&view=tasks&project=' + project.id;
    await page.goto(base);
    await page.getByRole('button', { name: '新建需求', exact: true }).click();
    const editor = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: '创建需求', exact: true }),
    });
    await editor
      .getByLabel('需求标题', { exact: true })
      .fill('刷新后恢复的标题');
    await expect(
      editor.getByText('工作副本已保存在当前浏览器', { exact: true }),
    ).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.reload();
    await page.getByRole('button', { name: '新建需求', exact: true }).click();
    await expect(
      editor.getByText('发现未完成的工作副本', { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: 'artifacts/v3.6.0-' + edition + '-recovery-mobile.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 980 });
    await editor
      .getByRole('button', { name: '恢复工作副本', exact: true })
      .click();
    await expect(editor.getByLabel('需求标题', { exact: true })).toHaveValue(
      '刷新后恢复的标题',
    );
    await editor.getByLabel('计划截止', { exact: true }).fill('2026-12-05');
    await editor.locator('.ant-select[aria-label="选择需求模板"]').click();
    await page.getByTitle('字段模板', { exact: true }).click();
    await editor
      .getByRole('button', { name: '应用需求模板', exact: true })
      .click();
    const preview = page.getByRole('dialog', {
      name: '应用需求模板',
      exact: true,
    });
    for (const name of ['标题', '背景', '目标', '验收标准', '优先级'])
      await preview.getByRole('checkbox', { name, exact: true }).uncheck();
    await preview
      .getByRole('button', { name: '填入所选字段', exact: true })
      .click();
    await expect(editor.getByLabel('需求标题', { exact: true })).toHaveValue(
      '刷新后恢复的标题',
    );
    await expect(
      editor.getByLabel('需求描述（Markdown）', { exact: true }),
    ).toHaveValue('模板描述');
    await expect(editor.getByLabel('计划截止', { exact: true })).toHaveValue(
      '2026-12-05',
    );
    await editor
      .getByRole('button', { name: '创建并提交', exact: true })
      .click();
    await editor
      .getByRole('button', { name: '至少一项可验证的验收标准', exact: true })
      .click();
    await expect(
      editor.getByLabel('验收标准（每行一项）', { exact: true }),
    ).toBeFocused();
    await editor
      .getByLabel('验收标准（每行一项）', { exact: true })
      .fill('可验证');
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          Object.keys(localStorage).filter((k) =>
            k.startsWith('coflow:work-copy:v1:'),
          ).length,
      ),
    ).toBe(0);
    await page.getByRole('button', { name: '编辑内容', exact: true }).click();
    await page
      .getByRole('textbox', { name: '编辑范围与需求说明', exact: true })
      .fill('正文工作副本');
    page.once('dialog', (d) => d.accept());
    await page.reload();
    await page
      .getByRole('button', { name: '恢复工作副本', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: '编辑范围与需求说明', exact: true }),
    ).toHaveValue('正文工作副本');
    await page
      .getByRole('button', { name: '保存正文修改', exact: true })
      .click();
    await expect(
      page.getByText('需求内容已保存', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          Object.keys(localStorage).filter((k) =>
            k.startsWith('coflow:work-copy:v1:'),
          ).length,
      ),
    ).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: 'artifacts/v3.6.0-' + edition + '-work-copy.png',
      fullPage: true,
    });
  });

test('方案工作副本显式恢复并保存到服务端，账号隔离', async ({ page }) => {
  const password = process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    pid = '10000000-0000-4000-8000-000000000001';
  async function login(email: string) {
    const r = await page.request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { email, password },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  }
  const product = await login('product@coflow.local');
  const people = await (
    await page.request.get('/api/v1/projects/' + pid + '/members')
  ).json();
  const engineer = people.find((m: any) => m.email === 'engineer@coflow.local'),
    qa = people.find((m: any) => m.email === 'qa@coflow.local');
  const r = await page.request.post('/api/v1/projects/' + pid + '/tasks', {
    headers: { Origin: origin, 'X-CSRF-Token': product.csrf },
    data: {
      title: '方案恢复-' + Date.now(),
      background: '背景',
      goal: '目标',
      description: '描述',
      criteria: ['可验收'],
      productId: product.user.id,
      engineerId: engineer.id,
      productReviewerId: product.user.id,
      qaReviewerId: qa.id,
      testerId: qa.id,
      submit: true,
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const task = await r.json();
  await login('engineer@coflow.local');
  await page.goto('/enterprise/?app=work&task=' + task.id);
  await page
    .getByRole('button', { name: '提交方案', exact: true })
    .first()
    .click();
  const modal = page.getByRole('dialog', { name: '提交方案', exact: true });
  await modal
    .getByLabel('方案正文', { exact: true })
    .fill('浏览器保留的方案正文');
  await modal.getByLabel('影响范围', { exact: true }).fill('需求模块');
  await expect(
    modal.getByText('工作副本已保存在当前浏览器', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await login('product@coflow.local');
  await page.goto('/enterprise/?app=work&task=' + task.id);
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith('coflow:work-copy:v1:'),
        ).length,
    ),
  ).toBe(1);
  await expect(
    page.getByText('发现未完成的工作副本', { exact: true }),
  ).toHaveCount(0);
  await login('engineer@coflow.local');
  await page.goto('/enterprise/?app=work&task=' + task.id);
  await page
    .getByRole('button', { name: '提交方案', exact: true })
    .first()
    .click();
  await modal
    .getByRole('button', { name: '恢复工作副本', exact: true })
    .click();
  await expect(modal.getByLabel('方案正文', { exact: true })).toHaveValue(
    '浏览器保留的方案正文',
  );
  await modal
    .getByRole('button', { name: '保存方案草稿', exact: true })
    .click();
  await expect(page.getByText('方案草稿已保存', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith('coflow:work-copy:v1:'),
        ).length,
    ),
  ).toBe(0);
});
test('正文旧版本仅供核对，浏览器存储失败不丢当前输入', async ({ page }) => {
  const pid = '10000000-0000-4000-8000-000000000001';
  const r = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: {
      email: 'product@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  const session = await r.json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
  const created = await page.request.post(
    '/api/v1/projects/' + pid + '/tasks',
    {
      headers,
      data: { title: '冲突正文-' + Date.now(), productId: session.user.id },
    },
  );
  expect(created.ok(), await created.text()).toBeTruthy();
  const task = await created.json();
  await page.goto('/enterprise/?app=work&task=' + task.id);
  await page.getByRole('button', { name: '编辑内容', exact: true }).click();
  await page
    .getByRole('textbox', { name: '编辑范围与需求说明', exact: true })
    .fill('必须保留的旧版本正文');
  const update = await page.request.patch('/api/v1/tasks/' + task.id, {
    headers,
    data: { expectedVersion: task.version, description: '其他页面已经保存' },
  });
  expect(update.ok(), await update.text()).toBeTruthy();
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await expect(
    page.getByRole('button', { name: '恢复工作副本', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '查看工作副本', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: '工作副本（仅供核对）' })
      .getByRole('textbox', { name: '副本需求描述', exact: true }),
  ).toHaveValue('必须保留的旧版本正文');
  await page
    .getByRole('dialog', { name: '工作副本（仅供核对）' })
    .getByRole('button', { name: 'Close' })
    .click();
  await page
    .getByRole('button', { name: '舍弃旧工作副本', exact: true })
    .click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.startsWith('coflow:work-copy:'))
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      original.call(this, k, v);
    };
  });
  await page.getByRole('button', { name: '编辑内容', exact: true }).click();
  await page
    .getByRole('textbox', { name: '编辑范围与需求说明', exact: true })
    .fill('保存失败仍保留的输入');
  await expect(
    page.getByText('工作副本保存失败，请复制保留输入后再离开', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: '编辑范围与需求说明', exact: true }),
  ).toHaveValue('保存失败仍保留的输入');
});

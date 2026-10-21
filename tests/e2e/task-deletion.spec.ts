import { test, expect } from '@playwright/test';

const origin = 'http://localhost:5174';
const pid = '10000000-0000-4000-8000-000000000001';
async function login(request: any, name = 'product') {
  const r = await request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: {
      email: name + '@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}
const headersFor = (auth: any) => ({
  Origin: origin,
  'X-CSRF-Token': auth.csrf,
});

test('回收站：关联保留、越权与并发拦截、详情恢复和永久删除保护', async ({
  page,
  browser,
}) => {
  const auth = await login(page.request);
  const headers = headersFor(auth);
  const response = await page.request.post(
    '/api/v1/projects/' + pid + '/tasks',
    { headers, data: { title: '回收站验证-' + Date.now() } },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  const task = await response.json();
  const path = '/api/v1/tasks/' + task.id;
  const doc = await page.request.post(
    '/api/v1/projects/' + pid + '/documents',
    {
      headers,
      data: { title: '引用保留', content: '关联需求', taskIds: [task.id] },
    },
  );
  expect(doc.ok()).toBeTruthy();
  const document = await doc.json();
  const peer = await browser.newContext({ baseURL: origin });
  try {
    const other = await login(peer.request, 'engineer');
    expect(
      (
        await peer.request.delete(path, {
          headers: headersFor(other),
          data: { expectedVersion: task.version },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.delete(path, {
          headers,
          data: { expectedVersion: task.version + 1 },
        })
      ).status(),
    ).toBe(409);
    await page.goto(
      '/student/?app=work&project=' + pid + '&view=tasks&task=' + task.id,
    );
    await page
      .locator('.task-detail-drawer')
      .getByRole('button', { name: '删除需求', exact: true })
      .click();
    await page.getByRole('button', { name: '保留需求', exact: true }).click();
    expect((await (await page.request.get(path)).json()).deletedAt).toBeNull();
    await page
      .locator('.task-detail-drawer')
      .getByRole('button', { name: '删除需求', exact: true })
      .click();
    await page.getByRole('button', { name: '移入回收站', exact: true }).click();
    await expect(
      page.getByText('需求已移入回收站', { exact: true }),
    ).toBeVisible();
    const removed = await (await page.request.get(path)).json();
    expect(removed.deletedAt).toBeTruthy();
    expect(removed.readOnly).toBe(true);
    const list = await (
      await page.request.get('/api/v1/projects/' + pid + '/tasks?scope=all')
    ).json();
    expect(list.items.some((t: any) => t.id === task.id)).toBe(false);
    const refs = await (
      await page.request.get('/api/v1/documents/' + document.id + '/tasks')
    ).json();
    expect(refs.find((t: any) => t.id === task.id).deletedAt).toBeTruthy();
    expect(
      (
        await page.request.patch(path, {
          headers,
          data: { ...task.data, expectedVersion: removed.version },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await page.request.delete(path + '/permanent', {
          headers,
          data: {
            expectedVersion: removed.version,
            confirmTitle: task.data.title,
          },
        })
      ).status(),
    ).toBe(409);
    await page.goto(
      '/enterprise/?app=work&project=' + pid + '&view=tasks&scope=trash',
    );
    const row = page.getByRole('row').filter({ hasText: task.data.title });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '恢复需求', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '恢复需求', exact: true })
      .click();
    await expect(row).toHaveCount(0);
    const restored = await (await page.request.get(path)).json();
    expect(restored.deletedAt).toBeNull();
    expect(restored.status).toBe('DRAFT');
    expect(restored.data.history.map((x: any) => x.action)).toEqual([
      'TASK_TRASH',
      'TASK_RESTORE',
    ]);
    const own = await peer.request.post('/api/v1/projects/' + pid + '/tasks', {
      headers: headersFor(other),
      data: { title: '永久清理权限-' + Date.now() },
    });
    expect(own.ok()).toBeTruthy();
    const empty = await own.json();
    const purgePath = '/api/v1/tasks/' + empty.id;
    expect(
      (
        await peer.request.delete(purgePath, {
          headers: headersFor(other),
          data: { expectedVersion: empty.version },
        })
      ).ok(),
    ).toBeTruthy();
    const trashed = await (await page.request.get(purgePath)).json();
    const purgeBody = {
      expectedVersion: trashed.version,
      confirmTitle: empty.data.title,
    };
    expect(
      (
        await peer.request.delete(purgePath + '/permanent', {
          headers: headersFor(other),
          data: purgeBody,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.delete(purgePath + '/permanent', {
          headers,
          data: purgeBody,
        })
      ).ok(),
    ).toBeTruthy();
    expect((await page.request.get(purgePath)).status()).toBe(404);
  } finally {
    await peer.close();
  }
});

test('学生单人简易流程：默认选择、直接提交、处理验收及页面范围', async ({
  page,
}) => {
  const auth = await login(page.request);
  const headers = headersFor(auth);
  const teams = await (await page.request.get('/api/v1/workspaces')).json();
  const wid = teams[0].id;
  await page.goto('/student/?section=projects&workspace=' + wid);
  await page
    .getByRole('button', { name: '创建项目', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: '创建项目' });
  await expect(
    dialog.getByText('简易：待办 → 进行中 → 待验收 → 完成', { exact: true }),
  ).toBeVisible();
  const name = '单人简易-' + Date.now();
  await dialog.getByLabel('项目名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const projects = await (
    await page.request.get('/api/v1/workspaces/' + wid + '/projects')
  ).json();
  const project = projects.find((p: any) => p.name === name);
  expect(project.workflow).toBe('SIMPLE');
  await page.goto(
    '/student/?app=work&workspace=' +
      wid +
      '&project=' +
      project.id +
      '&view=tasks',
  );
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const editor = page.getByRole('dialog');
  const title = '单人需求-' + Date.now();
  await editor.getByLabel('需求标题', { exact: true }).fill(title);
  await editor.getByRole('button', { name: '创建并提交', exact: true }).click();
  await expect(editor.getByText(/提交前请补齐/)).toBeVisible();
  await editor
    .getByLabel('需求描述（Markdown）', { exact: true })
    .fill('完成课程实验');
  await editor
    .getByLabel('验收标准（每行一项）', { exact: true })
    .fill('实验结果可复现');
  await editor.getByRole('button', { name: '创建并提交', exact: true }).click();
  const detail = page.locator('.task-detail-drawer');
  await expect(detail.getByRole('heading', { name: title })).toBeVisible();
  await expect(detail.locator('.flow-strip')).toContainText('待办');
  await expect(detail.locator('.flow-strip')).not.toContainText('方案评估');
  await detail
    .locator('.next-step-card')
    .getByRole('button', { name: '开始处理', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .filter({ hasText: '交接预览' })
    .getByRole('button', { name: /确认/ })
    .click();
  await expect(detail.locator('.next-step-card')).toContainText('进行中');
  await detail
    .locator('.next-step-card')
    .getByRole('button', { name: '提交验收', exact: true })
    .click();
  const transition = page.locator('.requirement-transition');
  await transition.getByLabel('完成说明', { exact: true }).fill('实验已完成');
  await transition.getByRole('button', { name: /确认/ }).click();
  await expect(detail.locator('.next-step-card')).toContainText('待验收');
  const tasks = await (
    await page.request.get(
      '/api/v1/projects/' + project.id + '/tasks?scope=all',
    )
  ).json();
  const task = tasks.items[0];
  const result = await page.request.post(
    '/api/v1/tasks/' + task.id + '/actions',
    {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        action: 'ACCEPT',
        expectedVersion: task.version,
        payload: { checks: [true] },
      },
    },
  );
  expect(result.ok(), await result.text()).toBeTruthy();
  await page.goto(
    '/student/?app=work&workspace=' +
      wid +
      '&project=' +
      project.id +
      '&view=tasks',
  );
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
  await page.getByRole('tab', { name: '已结束', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: title })).toBeVisible();
  await page
    .getByRole('button', { name: '待我处理', exact: false })
    .first()
    .click();
  await expect(page.locator('header').first()).toContainText(
    '当前团队全部项目',
  );
  await expect(
    page
      .locator('.page-heading')
      .getByRole('button', { name: '项目设置', exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.patch('/api/v1/projects/' + project.id, {
        headers,
        data: { archived: true },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.delete('/api/v1/tasks/' + task.id, {
        headers,
        data: { expectedVersion: task.version + 1 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await (await page.request.get('/api/v1/me/todos')).json()).some(
      (t: any) => t.projectId === project.id,
    ),
  ).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('.shell > aside')
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await expect(
    page
      .locator('.page-heading')
      .getByRole('button', { name: '新建需求', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: 'artifacts/browser/usability-simple-mobile.png',
    fullPage: true,
  });
});

test('列表快捷编辑与管理员转交：保存生效、无意外打开详情', async ({ page }) => {
  const auth = await login(page.request);
  const headers = headersFor(auth);
  const people = await (
    await page.request.get('/api/v1/projects/' + pid + '/members')
  ).json();
  const engineer = people.find((p: any) => p.email === 'engineer@coflow.local');
  const r = await page.request.post('/api/v1/projects/' + pid + '/tasks', {
    headers,
    data: { title: '快捷编辑-' + Date.now(), productId: engineer.id },
  });
  const task = await r.json();
  expect(r.ok()).toBeTruthy();
  await page.goto(
    '/enterprise/?app=work&project=' +
      pid +
      '&view=tasks&q=' +
      encodeURIComponent(task.data.title),
  );
  const row = page.getByRole('row').filter({ hasText: task.data.title });
  await row.getByRole('button', { name: '更多操作', exact: true }).click();
  await page
    .getByRole('menuitem', { name: '修改截止日期', exact: true })
    .click();
  await page.getByLabel('计划截止（留空清除）').fill('2026-12-31');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await expect(row).toContainText('2026-12-31');
  await expect(page.locator('.task-detail-drawer')).toHaveCount(0);
  await row.getByRole('button', { name: '更多操作', exact: true }).click();
  await page
    .getByRole('menuitem', { name: '转交 / 管理员接管', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('需求负责人', { exact: true })
    .click();
  const currentMember = people.find((p: any) => p.id === auth.user.id);
  await page
    .getByRole('dialog')
    .getByLabel('需求负责人', { exact: true })
    .fill(currentMember.name);
  await page
    .locator('.ant-select-dropdown:visible')
    .getByTitle(currentMember.name, { exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const updated = await (
    await page.request.get('/api/v1/tasks/' + task.id)
  ).json();
  expect(updated.data.productId).toBe(auth.user.id);
  expect(
    updated.data.history.some(
      (x: any) => x.action === 'TRANSFER' && x.actor === auth.user.id,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'artifacts/browser/usability-enterprise-list.png',
    fullPage: true,
  });
});

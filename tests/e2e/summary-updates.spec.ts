import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
async function setup(page: Page, edition: string) {
  const origin = 'http://localhost:5174',
    email = 'summary-updates-' + edition + '-' + randomUUID() + '@example.com',
    password = 'Discussion-draft-2026!';
  const reg = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      email,
      password,
      name: '讨论作者',
      teamName: '讨论团队',
    },
  });
  expect(reg.status()).toBe(201);
  const team = await reg.json();
  const session = await (
    await page.request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { email, password },
    })
  ).json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
  const p = await (
    await page.request.post(`/api/v1/workspaces/${team.workspaceId}/projects`, {
      headers,
      data: { name: '工作副本项目', workflow: 'SIMPLE' },
    })
  ).json();
  const task = await (
    await page.request.post(`/api/v1/projects/${p.id}/tasks`, {
      headers,
      data: {
        title: '讨论恢复需求',
        description: '初始说明',
        criteria: ['可验收'],
        productId: session.user.id,
        engineerId: session.user.id,
        submit: true,
      },
    })
  ).json();
  const url = '/' + edition + '/?app=work&task=' + task.id;
  const open = async () => {
    await page.goto(url);
    await page.getByRole('tab', { name: '动态记录', exact: true }).click();
  };
  const reload = async () => {
    page.once('dialog', (d) => d.accept());
    await page.reload();
    await page.getByRole('tab', { name: '动态记录', exact: true }).click();
  };
  const panel = page.getByRole('region', { name: '讨论与决策', exact: true });
  return { headers, task, url, open, reload, panel };
}

for (const edition of ['enterprise', 'student'])
  test(edition + '轻量首页、旧讨论定位与增量刷新保留输入', async ({ page }) => {
    const { headers, task } = await setup(page, edition);
    let version = task.version,
      firstId = '';
    for (const text of ['较早的澄清问题', '另一条讨论']) {
      const r = await page.request.post(
        '/api/v1/tasks/' + task.id + '/comments',
        {
          headers,
          data: { body: text, kind: 'QUESTION', expectedVersion: version },
        },
      );
      expect(r.ok()).toBeTruthy();
      const comment = await r.json();
      if (!firstId) firstId = comment.id;
      version++;
    }
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    const home = page.waitForResponse(
      (r) => r.url().includes('/overview-summary') && r.ok(),
    );
    await page.goto('/' + edition + '/?app=work&view=dashboard');
    const summary = await (await home).json();
    expect(summary.todos.map((t: any) => t.id)).toContain(task.id);
    expect(summary.todos[0].data.comments).toBeUndefined();
    await expect(page.locator('.work-stat-grid')).toBeVisible();
    expect(requests.some((url) => url.includes('/me/todos'))).toBe(false);
    expect(requests.some((url) => url.includes('/metrics'))).toBe(false);
    await page
      .locator('.work-task-card')
      .filter({ hasText: task.data.title })
      .click();
    await page.getByRole('tab', { name: '动态记录', exact: true }).click();
    const panel = page.getByRole('region', { name: '讨论与决策', exact: true });
    await expect(panel).toContainText('较早的澄清问题');
    await page.goto(
      '/' +
        edition +
        '/?app=work&task=' +
        task.id +
        '&taskTab=activity&discussion=' +
        firstId,
    );
    const root = page.locator('#discussion-' + firstId);
    await expect(root).toBeFocused();
    await root.getByRole('button', { name: '回复此讨论', exact: true }).click();
    await panel
      .getByLabel('讨论内容', { exact: true })
      .fill('通过增量保存的回复');
    const deltaPromise = page.waitForResponse(
      async (r) =>
        r.url().includes('/discussion-updates?after=2') &&
        r.ok() &&
        (await r.json()).comments.some(
          (c: any) => c.body === '通过增量保存的回复',
        ),
    );
    await panel.getByRole('button', { name: '保存回复', exact: true }).click();
    const delta = await (await deltaPromise).json();
    expect(delta.comments).toHaveLength(1);
    expect(delta.reset).toBe(false);
    await expect(root).toContainText('通过增量保存的回复');
    await panel
      .getByLabel('讨论内容', { exact: true })
      .fill('刷新时仍在编辑的内容');
    const current = await (
      await page.request.get('/api/v1/tasks/' + task.id)
    ).json();
    const external = await page.request.post(
      '/api/v1/tasks/' + task.id + '/comments',
      {
        headers,
        data: { body: '另一窗口追加的讨论', expectedVersion: current.version },
      },
    );
    expect(external.ok()).toBeTruthy();
    await expect(panel).toContainText('另一窗口追加的讨论', { timeout: 25000 });
    await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
      '刷新时仍在编辑的内容',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'artifacts/summary-updates-' + edition + '.png',
    });
  });

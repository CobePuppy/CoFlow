import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
async function setup(page: Page, edition: string) {
  const origin = 'http://localhost:5174',
    email = 'discussion-draft-' + edition + '-' + randomUUID() + '@example.com',
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
  test(
    edition + '回复工作副本、关闭保护、失败保留与成功清除',
    async ({ page }) => {
      const { headers, task, open, reload, panel } = await setup(page, edition);
      const response = await page.request.post(
        `/api/v1/tasks/${task.id}/comments`,
        {
          headers,
          data: {
            body: '需要澄清的原问题',
            kind: 'QUESTION',
            expectedVersion: task.version,
          },
        },
      );
      expect(response.ok()).toBeTruthy();
      await open();
      await panel
        .getByRole('button', { name: '回复此讨论', exact: true })
        .click();
      await panel
        .getByLabel('讨论内容', { exact: true })
        .fill('尚未提交的回复正文');
      await expect(panel).toContainText('工作副本已保存在当前浏览器');
      await reload();
      await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
        '',
      );
      await panel
        .getByRole('button', { name: '恢复工作副本', exact: true })
        .click();
      await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
        '尚未提交的回复正文',
      );
      await expect(panel).toContainText('正在回复：需要澄清的原问题');
      await page
        .getByRole('button', { name: '返回需求列表', exact: true })
        .click();
      const dialog = page.getByRole('dialog', {
        name: '离开未完成的编辑？',
        exact: true,
      });
      await dialog
        .getByRole('button', { name: '继续编辑', exact: true })
        .click();
      await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
        '尚未提交的回复正文',
      );
      await page
        .getByRole('button', { name: '返回需求列表', exact: true })
        .click();
      await dialog
        .getByRole('button', { name: '离开详情', exact: true })
        .click();
      await expect(panel).toHaveCount(0);
      await open();
      await panel
        .getByRole('button', { name: '恢复工作副本', exact: true })
        .click();
      await page.route(
        `**/api/v1/tasks/${task.id}/comments`,
        async (route) =>
          route.request().method() === 'POST'
            ? route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify({
                  code: 'CONFLICT',
                  message: '版本冲突，请保留输入并刷新',
                }),
              })
            : route.continue(),
        { times: 1 },
      );
      await panel
        .getByRole('button', { name: '保存回复', exact: true })
        .click();
      await expect(panel).toContainText('版本冲突');
      await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
        '尚未提交的回复正文',
      );
      await panel
        .getByRole('button', { name: '保存回复', exact: true })
        .click();
      await expect(panel.locator('blockquote')).toContainText(
        '尚未提交的回复正文',
      );
      await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
        '',
      );
      expect(
        await page.evaluate(
          () =>
            Object.keys(localStorage).filter((k) =>
              k.startsWith('coflow:work-copy:v1:'),
            ).length,
        ),
      ).toBe(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await panel
        .getByLabel('讨论内容', { exact: true })
        .fill('取消回复前的临时文字');
      await panel
        .getByRole('button', { name: '回复此讨论', exact: true })
        .click();
      await panel
        .getByRole('button', { name: '取消回复', exact: true })
        .click();
      await reload();
      await panel
        .getByRole('button', { name: '恢复工作副本', exact: true })
        .click();
      await expect(
        panel.getByRole('button', { name: '保存回复', exact: true }),
      ).toHaveCount(0);
      await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
        '取消回复前的临时文字',
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBeTruthy();
      await page.screenshot({
        path: 'artifacts/discussion-draft-' + edition + '-mobile.png',
      });
    },
  );
test('讨论旧需求版本阻止直接发表或恢复，存储失败仍保留当前输入', async ({
  page,
}) => {
  const { headers, task, open, reload, panel } = await setup(
    page,
    'enterprise',
  );
  await open();
  await panel.getByLabel('讨论内容', { exact: true }).fill('基于旧版的决策');
  async function change(description: string) {
    const current = await (
      await page.request.get(`/api/v1/tasks/${task.id}`)
    ).json();
    const r = await page.request.post(`/api/v1/tasks/${task.id}/actions`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        action: 'APPLY_REQUIREMENT_CHANGE',
        expectedVersion: current.version,
        payload: {
          description,
          criteria: ['新版验收'],
          reason: '范围更新',
          impact: '重新核对',
        },
      },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  await change('第二版说明');
  await page.getByRole('button', { name: /^刷\s*新$/, exact: true }).click();
  await expect(panel).toContainText('正式需求版本已变化');
  await expect(
    panel.getByRole('button', { name: '发表评论', exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole('button', { name: '已核对新版需求', exact: true })
    .click();
  await expect(
    panel.getByRole('button', { name: '发表评论', exact: true }),
  ).toBeEnabled();
  await reload();
  await panel
    .getByRole('button', { name: '恢复工作副本', exact: true })
    .click();
  await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
    '基于旧版的决策',
  );
  await change('第三版说明');
  await reload();
  await expect(
    panel.getByRole('button', { name: '恢复工作副本', exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole('button', { name: '查看工作副本', exact: true })
    .click();
  await expect(page.getByLabel('副本讨论正文', { exact: true })).toHaveValue(
    '基于旧版的决策',
  );
  await page
    .getByRole('dialog', { name: '工作副本（仅供核对）', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await panel
    .getByRole('button', { name: '舍弃旧工作副本', exact: true })
    .click();
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('Quota', 'QuotaExceededError');
    };
  });
  await panel
    .getByLabel('讨论内容', { exact: true })
    .fill('存储失败也不能丢失');
  await expect(panel).toContainText('工作副本保存失败');
  await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
    '存储失败也不能丢失',
  );
});

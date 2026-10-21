import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
async function setup(page: Page) {
  const origin = 'http://localhost:5174',
    email = 'navigation-' + randomUUID() + '@example.com',
    password = 'Navigation-2026!';
  const reg = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      email,
      password,
      name: '导航验证',
      teamName: '导航团队',
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
      data: { name: '导航项目', workflow: 'SIMPLE' },
    })
  ).json();
  const task = await (
    await page.request.post(`/api/v1/projects/${p.id}/tasks`, {
      headers,
      data: {
        title: '导航保护需求',
        productId: session.user.id,
        engineerId: session.user.id,
      },
    })
  ).json();
  return { p, task, team };
}
for (const edition of ['enterprise', 'student'])
  test(
    edition + '前进后退保护、详情页签保留输入及设置离开保护',
    async ({ page }) => {
      const { p, task } = await setup(page);
      await page.goto('/' + edition + '/?app=work&view=tasks&project=' + p.id);
      await expect(
        page.getByRole('button', { name: '导航保护需求', exact: true }),
      ).toBeVisible();
      const baseIndex = await page.evaluate(() => history.state.idx as number);
      await page
        .getByRole('button', { name: '导航保护需求', exact: true })
        .click();
      await page.getByRole('tab', { name: '动态记录', exact: true }).click();
      const panel = page.getByRole('region', {
        name: '讨论与决策',
        exact: true,
      });
      await panel
        .getByLabel('讨论内容', { exact: true })
        .fill('浏览器后退也需要保留');
      await page.getByRole('tab', { name: '需求说明', exact: true }).click();
      await expect(page).toHaveURL(/taskTab=requirement/);
      await expect(
        page.getByRole('dialog', { name: '离开未完成的编辑？', exact: true }),
      ).toHaveCount(0);
      await page.getByRole('tab', { name: '动态记录', exact: true }).click();
      await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
        '浏览器后退也需要保留',
      );
      // Return to the actual list entry, irrespective of tab history timing.
      await expect(page).toHaveURL(/taskTab=activity/);
      const steps =
        baseIndex - (await page.evaluate(() => history.state.idx as number));
      expect(steps).toBeLessThan(0);
      await page.evaluate((delta) => history.go(delta), steps);
      const confirm = page.getByRole('dialog', {
        name: '离开未完成的编辑？',
        exact: true,
      });
      await expect(confirm).toBeVisible();
      await confirm
        .getByRole('button', { name: '继续编辑', exact: true })
        .click();
      await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
        '浏览器后退也需要保留',
      );
      await page
        .getByRole('button', { name: '返回需求列表', exact: true })
        .click();
      await confirm
        .getByRole('button', { name: '离开详情', exact: true })
        .click();
      await expect(page).not.toHaveURL(/task=/);
      await page
        .getByRole('button', { name: '导航保护需求', exact: true })
        .click();
      await page.getByRole('tab', { name: '动态记录', exact: true }).click();
      await panel
        .getByRole('button', { name: '恢复工作副本', exact: true })
        .click();
      await expect(panel.getByLabel('讨论内容', { exact: true })).toHaveValue(
        '浏览器后退也需要保留',
      );
      await panel.getByLabel('讨论内容', { exact: true }).fill('');
      await page.goto('/' + edition + '/?section=settings');
      await page.getByLabel('显示名称', { exact: true }).fill('尚未保存的名称');
      await page.getByRole('link', { name: '返回工作台', exact: true }).click();
      await expect(confirm).toBeVisible();
      await confirm
        .getByRole('button', { name: '继续编辑', exact: true })
        .click();
      await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(
        '尚未保存的名称',
      );
      await page.getByRole('link', { name: '返回工作台', exact: true }).click();
      await confirm
        .getByRole('button', { name: '离开当前页面', exact: true })
        .click();
      await expect(page).not.toHaveURL(/section=settings/);
    },
  );
test('GitHub诊断区分缺失参数与个人授权，不把参数齐备当作仓库读取通过', async ({
  page,
}) => {
  const { p } = await setup(page);
  await page.route('**/api/v1/github/account', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: false,
        login: null,
        installationUrl: null,
        configuration: {
          clientId: false,
          encryption: true,
          installationLink: false,
        },
      }),
    }),
  );
  await page.goto('/enterprise/?app=work&view=github&project=' + p.id);
  const diag = page.getByLabel('GitHub配置诊断', { exact: true });
  await expect(diag).toContainText('应用客户端标识：缺失');
  await expect(diag).toContainText('授权凭据加密：配置有效');
  await expect(
    page.getByRole('button', { name: '登录 GitHub 并连接', exact: true }),
  ).toBeDisabled();
  await expect(diag).toContainText('具体仓库权限在选择和读取仓库时验证');
  await page.getByText('平台维护者配置说明', { exact: true }).click();
  await expect(diag).toContainText('不展示或修改密钥');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.screenshot({ path: 'artifacts/github-diagnostics-mobile.png' });
});

import { test, expect } from '@playwright/test';
test('QQ设置集成、机器人兑换、停用解绑与操作按钮桌面和窄屏外观', async ({
  page,
}) => {
  await page.request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://localhost:5174' },
    data: {
      email: 'product@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const created = await page.request.post('/api/v1/workspaces', {
    headers: { Origin: 'http://localhost:5174', 'X-CSRF-Token': me.csrf },
    data: { name: 'QQ设置浏览器-' + Date.now() },
  });
  expect(created.ok()).toBeTruthy();
  const team = await created.json();
  const token = 'browser-qq-only-' + Date.now() + '-random-test-token';
  await page.goto(
    '/student/?section=settings&settingsTab=qq&workspace=' + team.id,
  );
  const card = page
    .locator('.ant-card')
    .filter({ has: page.getByText('团队 QQAgent 集成', { exact: true }) });
  await card
    .getByRole('switch', { name: '启用此团队的QQ集成', exact: true })
    .check();
  await card.locator('input[aria-label="QQAgent专用令牌"]').fill(token);
  await card
    .getByLabel('QQ消息中的CoFlow网站地址', { exact: true })
    .fill('https://coflow.example/student/');
  await card
    .getByLabel('北京时间提醒时刻', { exact: true })
    .fill('18:00,09:00,09:00');
  await card
    .getByRole('button', { name: '保存团队QQ配置', exact: true })
    .click();
  await expect(card.getByText(/凭据状态：••••/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('tab', { name: 'QQ与团队集成', selected: true }),
  ).toBeVisible();
  await expect(card.locator('input[aria-label="QQAgent专用令牌"]')).toHaveValue(
    '',
  );
  await expect(
    card.getByLabel('北京时间提醒时刻', { exact: true }),
  ).toHaveValue('09:00,18:00');
  await page.getByRole('button', { name: '生成绑定码', exact: true }).click();
  const command = page.getByText(/^\/工作 绑定 [a-f0-9]{32}$/);
  await expect(command).toBeVisible();
  const code = (await command.innerText()).split(' ').at(-1);
  const bind = await page.request.post(
    'http://127.0.0.1:3102/api/v1/integrations/qq/bind',
    {
      headers: {
        Authorization: 'Bearer ' + token,
        'X-CoFlow-Workspace': team.id,
      },
      data: { qq: '123456789', code },
    },
  );
  expect(bind.ok()).toBeTruthy();
  await expect(page.getByText(/已绑定 QQ：123456789/)).toBeVisible({
    timeout: 10000,
  });
  await card
    .getByRole('switch', { name: '启用此团队的QQ集成', exact: true })
    .uncheck();
  await card
    .getByRole('button', { name: '保存团队QQ配置', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '解除 QQ 绑定', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '解除 QQ 绑定', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '生成绑定码', exact: true }),
  ).toBeDisabled();
  const back = page.getByRole('link', { name: '返回工作台', exact: true });
  await expect(back).toHaveClass(/action-link-back/);
  await expect(page.locator('.ant-message-notice')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await back.screenshot({ path: 'artifacts/browser/back-action.png' });
  await page.screenshot({
    path: 'artifacts/browser/settings-qq-desktop.png',
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'artifacts/browser/settings-qq-mobile.png',
    animations: 'disabled',
  });
  await back.click();
  await expect(
    page.getByRole('navigation', { name: '首页导航' }),
  ).toBeAttached();
  const pid = '10000000-0000-4000-8000-000000000001',
    wid = '00000000-0000-4000-8000-000000000001';
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(`/student/?section=library&workspace=${wid}&project=${pid}`);
  const action = page
    .getByRole('button', { name: '查看 / 编辑', exact: true })
    .first();
  await expect(action).toHaveClass(/action-button/);
  await expect(page.locator('.document-grid .ant-spin')).toHaveCount(0);
  await action.screenshot({ path: 'artifacts/browser/view-edit-action.png' });
  await page.screenshot({
    path: 'artifacts/browser/library-actions.png',
    animations: 'disabled',
  });
  await action.click();
  await expect(
    page.getByRole('dialog', { name: '项目文档', exact: true }),
  ).toBeVisible();
});

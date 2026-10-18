import { test, expect } from '@playwright/test';

test('成员管理中生成、使用和解除 QQ 绑定，并适配窄屏', async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.QQ_BOT_TOKEN || !process.env.QQ_BOT_WORKSPACE_ID,
    '需要显式启用隔离测试 QQ 集成',
  );
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('engineer@coflow.local');
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await page
    .getByRole('navigation', { name: '首页导航' })
    .getByRole('button', { name: '团队', exact: true })
    .click();
  await page.getByRole('button', { name: '生成绑定码', exact: true }).click();
  const command = page.getByText(/^\/工作 绑定 [a-f0-9]{32}$/);
  await expect(command).toBeVisible();
  const code = (await command.innerText()).trim().split(' ').at(-1);
  await page.screenshot({
    path: 'artifacts/browser/qq-binding-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(command).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: 'artifacts/browser/qq-binding-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  const qq = String(100000000 + Math.floor(Math.random() * 900000000));
  const binding = await request.post(
    'http://127.0.0.1:3001/api/v1/integrations/qq/bind',
    {
      headers: { Authorization: `Bearer ${process.env.QQ_BOT_TOKEN}` },
      data: { qq, code },
    },
  );
  expect(binding.status()).toBe(200);
  await page.getByRole('button', { name: '刷新绑定状态', exact: true }).click();
  await expect(
    page.getByText(`已绑定 QQ：${qq}。机器人将私信汇总待办。`),
  ).toBeVisible();
  await page.getByRole('button', { name: '解除 QQ 绑定', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '生成绑定码', exact: true }),
  ).toBeVisible();
});

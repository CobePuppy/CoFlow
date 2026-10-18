import { test, expect } from '@playwright/test';

test('创建团队、复制团队码与队员自助注册', async ({ page, browser }) => {
  const suffix = Date.now();
  await page.goto('/');
  await page.getByRole('tab', { name: '注册', exact: true }).click();
  await page.getByLabel('姓名', { exact: true }).fill('自助创建者');
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(`creator-${suffix}@example.com`);
  await page.getByLabel('设置密码', { exact: true }).fill('Password8');
  await page.getByLabel('确认密码', { exact: true }).fill('Password8');
  await page.getByLabel('团队名称', { exact: true }).fill('自助注册演示团队');
  await page.getByRole('button', { name: '注册并创建团队' }).click();
  await expect(page.getByText('账号与团队已创建')).toBeVisible();
  const code = (await page.locator('.team-code-result h3').innerText()).trim();
  expect(code).toMatch(/^[A-F0-9]{12}$/);
  await page.screenshot({
    path: 'artifacts/browser/team-registration.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '前往登录' }).click();
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(`creator-${suffix}@example.com`);
  await page.getByLabel('密码', { exact: true }).fill('Password8');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await page
    .getByRole('navigation', { name: '首页导航' })
    .getByRole('button', { name: '团队', exact: true })
    .click();
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  const context = await browser.newContext();
  try {
    const member = await context.newPage();
    await member.goto('/');
    await member.getByRole('tab', { name: '注册', exact: true }).click();
    await member.getByText('我是团队队员', { exact: true }).click();
    await member.getByLabel('姓名', { exact: true }).fill('自助队员');
    await member
      .getByLabel('邮箱', { exact: true })
      .fill(`member-${suffix}@example.com`);
    await member.getByLabel('设置密码', { exact: true }).fill('Password8');
    await member.getByLabel('确认密码', { exact: true }).fill('Password8');
    await member.getByLabel('团队码', { exact: true }).fill(code);
    await member.getByRole('button', { name: '注册并加入团队' }).click();
    await expect(member.getByText('注册成功，已加入团队')).toBeVisible();
  } finally {
    await context.close();
  }
});

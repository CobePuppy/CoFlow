import { test, expect } from '@playwright/test';

test('头像上拉个人菜单、团队入口归位与两套导航', async ({ page }) => {
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://localhost:5174' },
    data: {
      email: 'product@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  expect(login.ok()).toBeTruthy();
  for (const edition of ['student', 'enterprise']) {
    await page.goto(`/${edition}/`);
    await expect(
      page.getByRole('heading', { name: '工作台', exact: true }),
    ).toBeVisible();
    const sidebar = page.locator('.portal-sidebar');
    await expect(
      sidebar.getByRole('button', { name: '团队操作', exact: true }),
    ).toHaveCount(0);
    await expect(
      sidebar.getByRole('link', { name: '个人设置', exact: true }),
    ).toHaveCount(0);
    const trigger = page.getByRole('button', { name: '个人菜单', exact: true });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu');
    await expect(
      menu.getByRole('link', { name: '个人资料', exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole('link', { name: '个人AI设置', exact: true }),
    ).toBeVisible();
    const anchor = await trigger.boundingBox();
    const panel = await menu.boundingBox();
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(anchor!.y + 2);
    await page.screenshot({
      path: `artifacts/browser/account-menu-${edition}.png`,
      animations: 'disabled',
    });
    await menu.getByRole('link', { name: '偏好设置', exact: true }).click();
    await expect(page).toHaveURL(/settingsTab=preferences/);
    await expect(
      page.getByRole('tab', { name: '偏好', exact: false }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.goto(`/${edition}/?section=members`);
    await expect(
      page.getByRole('heading', { name: '团队', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator('.portal-content')
        .getByRole('button', { name: '团队操作', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '团队操作', exact: true }).click();
    await expect(
      page.getByRole('menuitem', { name: '加入其他团队', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `artifacts/browser/team-actions-${edition}.png`,
      animations: 'disabled',
    });
    await page
      .getByRole('menuitem', { name: '加入其他团队', exact: true })
      .click();
    const teams = page.getByRole('dialog', { name: '我的团队', exact: true });
    await expect(
      teams.getByRole('tab', { name: '加入团队', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await teams.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: '团队操作', exact: true }).click();
    await page
      .getByRole('menuitem', { name: '创建新团队', exact: true })
      .click();
    await expect(
      teams.getByRole('tab', { name: '创建团队', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await teams.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await page.goto('/student/?app=work');
  await page.getByRole('button', { name: '个人菜单', exact: true }).click();
  await expect(
    page
      .getByRole('menu')
      .getByRole('link', { name: '个人AI设置', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/student/');
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page.getByRole('button', { name: '个人菜单', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.screenshot({
    path: 'artifacts/browser/account-menu-mobile.png',
    animations: 'disabled',
  });
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '登录工作空间', exact: true }),
  ).toBeVisible();
});

import { test, expect } from '@playwright/test';
test('学生与企业主题统一页签、选中条、收藏、统计及组件颜色', async ({
  page,
}) => {
  await page.request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://localhost:5174' },
    data: {
      email: 'product@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  for (const [edition, color] of [
    ['student', 'rgb(8, 127, 121)'],
    ['enterprise', 'rgb(20, 105, 216)'],
  ]) {
    await page.goto('/' + edition + '/');
    const active = page.locator('.portal-tabs button.active');
    await expect(active).toHaveCSS('color', color);
    expect(
      await active.evaluate(
        (el) => getComputedStyle(el, '::after').backgroundColor,
      ),
    ).toBe(color);
    expect(
      await page
        .locator('.portal-sidebar nav button.selected')
        .evaluate((el) => getComputedStyle(el, '::before').backgroundColor),
    ).toBe(color);
    await expect(page.locator('.portal-welcome b').first()).toHaveCSS(
      'color',
      color,
    );
    await expect(page.locator('.portal-star .anticon-star').first()).toHaveCSS(
      'color',
      color,
    );
    await page.getByRole('tab', { name: '协作', exact: true }).click();
    await expect(page.locator('.portal-tabs button.active')).toHaveCSS(
      'color',
      color,
    );
    await page.getByRole('tab', { name: '全部', exact: true }).click();
    await page.screenshot({
      path: `artifacts/browser/theme-${edition}.png`,
      animations: 'disabled',
    });
    await page.goto('/' + edition + '/?section=settings');
    await expect(
      page.locator('.ant-tabs-tab-active .ant-tabs-tab-btn'),
    ).toHaveCSS('color', color);
    await expect(
      page.getByRole('link', { name: '返回工作台', exact: true }),
    ).toHaveCSS('color', color);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/student/');
  await expect(page.locator('.portal-tabs button.active')).toHaveCSS(
    'color',
    'rgb(8, 127, 121)',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: 'artifacts/browser/theme-student-mobile.png',
    animations: 'disabled',
  });
});

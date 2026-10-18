import { test, expect } from '@playwright/test';

test('需求 Markdown 表格、清单、流程图、错误降级及手机布局', async ({
  page,
}) => {
  const fixture =
    process.cwd().replace(/\\/g, '/') + '/tests/fixtures/markdown.tsx';
  await page.route('**/__markdown', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body style="margin:16px"><div id="root"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`,
    }),
  );
  await page.goto('/__markdown');
  await expect(page.getByRole('heading', { name: '需求资料' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(1);
  await expect(
    page.getByRole('columnheader', { name: '验收证据' }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await expect(page.getByRole('checkbox').first()).toBeDisabled();
  await expect(page.locator('del')).toHaveText('废弃内容');
  await expect(page.locator('.markdown-diagram img')).toHaveCount(2, {
    timeout: 60000,
  });
  const diagrams = page.locator('.markdown-diagram img');
  const svg = decodeURIComponent((await diagrams.first().getAttribute('src'))!);
  expect(svg).toContain('<text');
  expect(svg).toContain('开发');
  await expect
    .poll(() =>
      diagrams.first().evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByText('流程图语法无法解析，已保留原始代码。'),
  ).toBeVisible();
  await expect(
    page.locator('pre code').filter({ hasText: 'const text' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: '危险链接' }),
  ).not.toHaveAttribute('href', /javascript:/);
  expect(await page.evaluate(() => 'markdownUnsafe' in window)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'artifacts/markdown-mobile.png',
    fullPage: true,
  });
});

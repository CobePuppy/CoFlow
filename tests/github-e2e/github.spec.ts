import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 10000 });
test('需求 GitHub 独立分区、仓库连接、文件引用、分支快照及手机布局', async ({
  page,
}) => {
  const origin = 'http://localhost:5174';
  const email = `github-ui-${randomUUID()}@example.com`,
    password = 'Github-ui-test-2026!';
  const registered = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      email,
      password,
      name: 'GitHub UI',
      teamName: 'GitHub UI团队',
    },
  });
  expect(registered.status()).toBe(201);
  const team = await registered.json();
  const logged = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email, password },
  });
  const auth = await logged.json();
  const headers = { Origin: origin, 'X-CSRF-Token': auth.csrf };
  const project = await (
    await page.request.post(`/api/v1/workspaces/${team.workspaceId}/projects`, {
      headers,
      data: { name: 'GitHub UI项目', workflow: 'SIMPLE' },
    })
  ).json();
  const task = await (
    await page.request.post(`/api/v1/projects/${project.id}/tasks`, {
      headers,
      data: {
        title: 'GitHub UI需求',
        productId: auth.user.id,
        criteria: ['实现需求关联', '检查回归'],
      },
    })
  ).json();
  await page.goto(
    `/student/?app=work&view=tasks&workspace=${team.workspaceId}&project=${project.id}`,
  );
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await page
    .getByLabel('项目默认 GitHub 仓库', { exact: true })
    .fill('demo/public');
  await page.getByRole('button', { name: '保存默认仓库', exact: true }).click();
  await expect(
    page.getByText('项目默认仓库已更新', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: '项目设置', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.goto(
    `/student/?app=work&view=tasks&workspace=${team.workspaceId}&project=${project.id}&task=${task.id}`,
  );
  await page.getByRole('tab', { name: 'GitHub 仓库', exact: true }).click();
  await page.context().route('https://github.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: 'GitHub authorization test page',
    }),
  );
  const popupPromise = page.waitForEvent('popup');
  await page
    .getByRole('button', { name: '登录 GitHub 并连接', exact: true })
    .click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL('https://github.com/login/device');
  await popup.close();
  await expect(page.getByText('TEST-CODE', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: '采用项目默认仓库', exact: true })
    .click();
  await page
    .locator('.ant-modal-confirm')
    .getByRole('button', { name: /确\s*定/ })
    .click();
  await expect(
    page.locator('.github-meta').filter({ hasText: '快照提交' }),
  ).toContainText('a'.repeat(40));
  await page.getByRole('button', { name: /📄 README.md/ }).click();
  await expect(page.locator('.github-source')).toContainText(
    '# CoFlow repository context',
  );
  await page.getByLabel('引用起始行', { exact: true }).fill('1');
  await page.getByLabel('引用结束行', { exact: true }).fill('1');
  await page
    .getByLabel('代码引用说明', { exact: true })
    .fill('关联需求的代码依据');
  await page.locator('.github-reference-form .ant-select-selector').click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByTitle('1. 实现需求关联', { exact: true })
    .click();
  await page
    .getByRole('button', { name: '保存为需求代码引用', exact: true })
    .click();
  await expect(page.locator('.github-reference')).toContainText('README.md');
  await expect(page.locator('.github-reference')).toContainText('L1–L1');
  await expect(page.locator('.github-reference')).toContainText(
    '关联需求的代码依据',
  );
  await page.getByRole('tab', { name: '测试与验收', exact: true }).click();
  await expect(
    page.getByRole('link', { name: '代码依据：README.md L1–L1', exact: true }),
  ).toHaveAttribute('href', /#L1-L1$/);
  await page.getByRole('tab', { name: 'GitHub 仓库', exact: true }).click();
  await page.getByLabel('GitHub 分支', { exact: true }).fill('next');
  await page
    .getByRole('button', { name: '更新关联与快照', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确\s*定/ })
    .click();
  await expect(
    page.locator('.github-meta').filter({ hasText: '快照提交' }),
  ).toContainText('c'.repeat(40));
  await page
    .locator('.github-reference')
    .getByRole('button', { name: 'README.md', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'README.md', exact: true }),
  ).toContainText('提交 ' + 'a'.repeat(12));
  await page
    .getByRole('dialog', { name: 'README.md', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: '检查文件更新', exact: true }).click();
  await expect(page.locator('.github-reference')).toContainText(
    '上游文件已有变化',
  );
  await page
    .getByRole('button', { name: '更新引用至当前快照', exact: true })
    .click();
  await page
    .locator('.ant-modal-confirm')
    .getByRole('button', { name: /确\s*定/ })
    .click();
  await expect(page.locator('.github-reference')).toContainText('c'.repeat(12));
  await page.getByLabel('GitHub PR 编号或地址', { exact: true }).fill('1');
  await page.getByRole('button', { name: '关联 PR', exact: true }).click();
  await expect(page.getByText('已合并', { exact: true })).toBeVisible();
  await expect(page.getByText('build：success', { exact: true })).toBeVisible();
  const unchanged = await (
    await page.request.get(`/api/v1/tasks/${task.id}`)
  ).json();
  expect(unchanged.status).toBe('DRAFT');
  await expect(page.locator('.ant-message-notice')).toHaveCount(0);
  await page
    .locator('.requirement-detail-sections')
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({
    path: 'artifacts/github-desktop.png',
    animations: 'disabled',
  });
  const prCard = page
    .locator('.github-panel > .ant-card')
    .filter({ hasText: '关联 Pull Request（只读同步）' });
  await prCard.screenshot({
    path: 'artifacts/github-pr-desktop.png',
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.shell > aside')).not.toBeInViewport();
  await page
    .locator('.requirement-detail-sections')
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({
    path: 'artifacts/github-mobile.png',
    animations: 'disabled',
  });
  await prCard.screenshot({
    path: 'artifacts/github-pr-mobile.png',
    animations: 'disabled',
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole('button', { name: '解除关联', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确\s*定/ })
    .click();
  await expect(
    page.getByRole('button', { name: '连接仓库', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.github-reference')).toHaveCount(0);
  await expect(
    page.getByText('已连接 @github-test', { exact: true }),
  ).toBeVisible({ timeout: 35000 });
  await page
    .getByRole('button', { name: '验证当前账号授权', exact: true })
    .click();
  await expect(
    page.getByText('账号授权已验证：@github-test', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/可见应用安装 1 项/)).toBeVisible();
  await page
    .getByRole('button', { name: '选择已授权仓库', exact: true })
    .click();
  await page.locator('.github-picker .ant-select-selector').first().click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByTitle('demo', { exact: true })
    .click();
  await page.locator('.github-picker .ant-select-selector').nth(1).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByTitle('demo/private（私有）', { exact: true })
    .click();
  await page.getByRole('button', { name: '连接仓库', exact: true }).click();
  await page.getByRole('button', { name: /📄 README.md/ }).click();
  await expect(page.locator('.github-source')).toContainText(
    '# CoFlow repository context',
  );
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(
    '/student/?app=work&view=github&workspace=' +
      team.workspaceId +
      '&project=' +
      project.id,
  );
  await expect(
    page.getByText('已连接 @github-test', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '选择已授权仓库', exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: 'artifacts/v3.2.0-github-project.png',
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

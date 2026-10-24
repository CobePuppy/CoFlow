import { test, expect, request } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('V4.3目标工作台：双版新建关联、目标历史与窄屏布局', async ({ page }) => {
  page.setDefaultTimeout(15000);
  const origin = 'http://localhost:5174';
  const email = 'assistant-' + Date.now() + '@example.com';
  const password = 'Assistant-test-2026!';
  const registered = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      name: '推进负责人',
      email,
      password,
      teamName: 'V4推进验证',
    },
  });
  expect(registered.status()).toBe(201);
  const team = await registered.json();
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email, password },
  });
  const session = await login.json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
  const post = async (path: string, data: any) => {
    const response = await page.request.post('/api/v1' + path, {
      headers,
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const project = await post('/workspaces/' + team.workspaceId + '/projects', {
    name: 'V4推进验证项目',
    workflow: 'SIMPLE',
  });
  await post('/projects/' + project.id + '/members', {
    userId: session.user.id,
    roles: ['PRODUCT', 'ENGINEER', 'QA', 'OPS'],
  });
  const task = await post('/projects/' + project.id + '/tasks', {
    title: '核对交付验收标准',
    description: '需要团队补充可验证标准',
    criteria: [],
    productId: session.user.id,
    engineerId: session.user.id,
    testerId: session.user.id,
    productReviewerId: session.user.id,
    qaReviewerId: session.user.id,
  });

  for (const edition of ['enterprise', 'student']) {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.goto(
      '/' +
        edition +
        '/?app=work&workspace=' +
        team.workspaceId +
        '&project=' +
        project.id +
        '&view=project-overview',
    );
    const panel = page.locator('.project-command-center');
    await panel
      .getByRole('button', { name: '新建项目目标', exact: true })
      .click();
    let dialog = page.getByRole('dialog', {
      name: '新建项目目标',
      exact: true,
    });
    await dialog
      .getByRole('textbox', { name: '目标名称', exact: true })
      .fill('目标交付 ' + edition);
    await dialog
      .getByRole('textbox', { name: '目标达成标准', exact: true })
      .fill('标准可复核');
    await dialog.getByRole('button', { name: '保存目标', exact: true }).click();
    await expect(dialog).toBeHidden();
    await panel.getByText('目标交付 ' + edition, { exact: true }).click();
    const item = panel
      .locator('.ant-collapse-item')
      .filter({ hasText: '目标交付 ' + edition });
    await item.getByRole('button', { name: '关联工作', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '关联工作', exact: true });
    await dialog
      .getByRole('combobox', { name: '关联目标需求', exact: true })
      .click();
    await page
      .locator('.ant-select-item-option')
      .filter({ hasText: '核对交付验收标准' })
      .click();
    await dialog
      .getByRole('textbox', { name: '目标变更原因', exact: true })
      .fill('纳入本轮交付');
    await dialog.getByRole('button', { name: '保存目标', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(item).toContainText('0/1 项需求已验收');
    await item
      .getByRole('button', { name: '目标变更历史', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toContainText('纳入本轮交付');
    await page.getByRole('dialog').locator('.ant-modal-close').click();
    await page.screenshot({
      path: 'artifacts/browser/v4.3-' + edition + '-goals-desktop.png',
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: 'artifacts/browser/v4.3-' + edition + '-goals-mobile.png',
      animations: 'disabled',
    });
  }
});

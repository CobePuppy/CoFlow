import { test, expect } from '@playwright/test';
test.use({ actionTimeout: 15000 });
for (const edition of ['enterprise', 'student'])
  test(edition + '文件分类排序、刷新、清除与手机体验', async ({ page }) => {
    const origin = 'http://localhost:5174',
      email = 'find-files-' + edition + '-' + Date.now() + '@example.com',
      password = 'File-discovery-2026!';
    const reg = await page.request.post('/api/v1/auth/register', {
      headers: { Origin: origin },
      data: {
        kind: 'creator',
        email,
        password,
        name: '资料管理员',
        teamName: '资料团队',
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
    for (const [name, mimeType, content] of [
      ['开发规范.md', 'text/markdown', '# 规范'],
      ['接口规范.txt', 'text/plain', '接口规范详细说明'],
      ['用户手册.pdf', 'application/pdf', '%PDF-1.4\n手册'],
    ]) {
      const r = await page.request.post(
        `/api/v1/workspaces/${team.workspaceId}/files`,
        {
          headers,
          multipart: { file: { name, mimeType, buffer: Buffer.from(content) } },
        },
      );
      expect(r.status(), await r.text()).toBe(201);
    }
    await page.goto(
      '/' +
        edition +
        '/?section=library&fileSpace=team&workspace=' +
        team.workspaceId +
        '&filePage=2',
    );
    const panel = page.getByRole('region', {
      name: '团队文件空间',
      exact: true,
    });
    await panel.locator('.ant-select[aria-label="文件类型"]').click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByTitle('文本与规范', { exact: true })
      .click();
    await expect(panel.locator('.space-file-row')).toHaveCount(2);
    await expect(page).not.toHaveURL(/filePage=2/);
    await panel.locator('.ant-select[aria-label="上传者筛选"]').click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByTitle('仅我上传', { exact: true })
      .click();
    await panel.locator('.ant-select[aria-label="文件排序"]').click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByTitle('文件从大到小', { exact: true })
      .click();
    await expect(panel.locator('.space-file-row').first()).toContainText(
      '接口规范.txt',
    );
    await page.getByPlaceholder('搜索文档或文件').fill('开发');
    await expect(panel.locator('.space-file-row')).toHaveCount(1);
    await page.reload();
    await expect(page.getByPlaceholder('搜索文档或文件')).toHaveValue('开发');
    await expect(panel.locator('.space-file-row')).toHaveCount(1);
    await expect(panel).toContainText('仅我上传');
    await panel
      .getByRole('button', { name: '清除查找条件', exact: true })
      .click();
    await expect(panel.locator('.space-file-row')).toHaveCount(3);
    await expect(page.getByPlaceholder('搜索文档或文件')).toHaveValue('');
    await panel.locator('.ant-select[aria-label="文件类型"]').click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByTitle('图片', { exact: true })
      .click();
    await expect(panel).toContainText('没有找到匹配的文件');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
    await page.screenshot({
      path: 'artifacts/file-discovery-' + edition + '-mobile.png',
    });
  });

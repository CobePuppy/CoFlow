import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
for (const edition of ['enterprise', 'student'])
  test(edition + '文件换版、历史恢复、固定引用及跟随切换', async ({ page }) => {
    const origin = 'http://localhost:5174',
      email = 'file-revision-' + randomUUID() + '@example.com',
      password = 'Revision-2026!';
    const reg = await page.request.post('/api/v1/auth/register', {
      headers: { Origin: origin },
      data: {
        kind: 'creator',
        email,
        password,
        name: '规范维护者',
        teamName: '版本团队',
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
    const uploaded = await page.request.post('/api/v1/me/files', {
      headers,
      multipart: {
        file: {
          name: '开发规范.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('第一版规范'),
        },
      },
    });
    expect(uploaded.status()).toBe(201);
    const file = await uploaded.json();
    await page.goto('/' + edition + '/?section=library&fileSpace=personal');
    await page.getByRole('button', { name: '内容版本', exact: true }).click();
    const versions = page.getByRole('dialog', {
      name: '文件内容版本 · 开发规范.md',
      exact: true,
    });
    await versions.getByLabel('选择新版本文件', { exact: true }).setInputFiles({
      name: '开发规范.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('第二版规范含代码检查'),
    });
    await versions
      .getByLabel('文件更新说明', { exact: true })
      .fill('补充代码检查');
    await versions
      .getByRole('button', { name: '保存文件新版本', exact: true })
      .click();
    await expect(versions.locator('[data-file-version="2"]')).toContainText(
      '补充代码检查',
    );
    expect(
      await (
        await page.request.get('/api/v1/space-files/' + file.id + '/download')
      ).text(),
    ).toBe('第二版规范含代码检查');
    await versions
      .locator('[data-file-version="1"]')
      .getByRole('button', { name: '恢复为新版本', exact: true })
      .click();
    await page
      .getByLabel('恢复内容原因', { exact: true })
      .fill('历史交付仍采用第一版');
    await page
      .getByRole('button', { name: '确认恢复内容', exact: true })
      .click();
    await expect(versions.locator('[data-file-version="3"]')).toContainText(
      '历史交付仍采用第一版',
    );
    expect(
      await (
        await page.request.get('/api/v1/space-files/' + file.id + '/download')
      ).text(),
    ).toBe('第一版规范');
    await versions.getByRole('button', { name: 'Close', exact: true }).click();
    const p = await (
      await page.request.post(
        `/api/v1/workspaces/${team.workspaceId}/projects`,
        { headers, data: { name: '引用版本项目', workflow: 'SIMPLE' } },
      )
    ).json();
    const task = await (
      await page.request.post(`/api/v1/projects/${p.id}/tasks`, {
        headers,
        data: {
          title: '固定规范交付',
          productId: session.user.id,
          engineerId: session.user.id,
        },
      })
    ).json();
    await page.goto('/' + edition + '/?app=work&task=' + task.id);
    await page.getByRole('tab', { name: '关联资料', exact: true }).click();
    await page
      .getByRole('button', { name: '引用已有资料', exact: true })
      .click();
    const modal = page.getByRole('dialog', {
      name: '引用已有资料',
      exact: true,
    });
    await modal.locator('.ant-select[aria-label="引用资料来源"]').click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByTitle('我的个人文件', { exact: true })
      .click();
    await modal.getByRole('button', { name: /开发规范.md · v/ }).click();
    await modal.locator('.ant-select[aria-label="新引用版本方式"]').click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByTitle('固定内容版本', { exact: true })
      .click();
    await modal.getByLabel('固定内容版本号', { exact: true }).fill('1');
    await modal.getByRole('checkbox').check();
    await modal
      .getByRole('button', { name: /^确\s*认\s*引\s*用$/, exact: true })
      .click();
    await expect(modal).toHaveCount(0);
    const panel = page.getByRole('tabpanel', { name: '关联资料', exact: true });
    await expect(panel).toContainText('固定内容 V1');
    const link = panel.getByRole('link', { name: '下载固定版本', exact: true });
    expect(
      await (await page.request.get((await link.getAttribute('href'))!)).text(),
    ).toBe('第一版规范');
    await panel
      .getByRole('button', { name: '调整引用方式', exact: true })
      .click();
    const mode = page.getByRole('dialog', {
      name: '调整引用方式',
      exact: true,
    });
    await mode.locator('.ant-select[aria-label="已有引用版本方式"]').click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByTitle('跟随最新版', { exact: true })
      .click();
    await mode
      .getByRole('button', { name: '保存引用方式', exact: true })
      .click();
    await expect(mode).toHaveCount(0);
    await expect(panel).toContainText('跟随最新版 · 内容 V3');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
    await page.screenshot({
      path: 'artifacts/file-revisions-' + edition + '-mobile.png',
    });
  });

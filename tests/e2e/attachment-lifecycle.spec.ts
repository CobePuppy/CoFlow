import { test, expect } from '@playwright/test';

test('各环节附件上传、权限、软删除和恢复', async ({ page, browser }) => {
  const origin = 'http://localhost:5174';
  const pid = '10000000-0000-4000-8000-000000000001';
  const login = async (request: any, email: string) => {
    const response = await request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: {
        email: `${email}@coflow.local`,
        password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
      },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const auth = await login(page.request, 'product');
  const headers = { Origin: origin, 'X-CSRF-Token': auth.csrf };
  const created = await page.request.post(`/api/v1/projects/${pid}/tasks`, {
    headers,
    data: {
      title: '附件全流程-' + Date.now(),
      productId: auth.user.id,
      engineerId: '',
      testerId: '',
      productReviewerId: '',
      qaReviewerId: '',
    },
  });
  expect(created.ok()).toBeTruthy();
  const task = await created.json();
  const peer = await browser.newContext({ baseURL: origin });
  try {
    const engineer = await login(peer.request, 'engineer');
    const peerHeaders = { Origin: origin, 'X-CSRF-Token': engineer.csrf };
    const uploaded: any[] = [];
    for (const stage of [
      'GENERAL',
      'REQUIREMENT',
      'SOLUTION',
      'REVIEW',
      'DEVELOPMENT',
      'TESTING',
      'ACCEPTANCE',
    ]) {
      const response = await page.request.post(
        `/api/v1/tasks/${task.id}/attachments`,
        {
          headers,
          multipart: {
            stage,
            file: {
              name: `${stage}.md`,
              mimeType: 'text/markdown',
              buffer: Buffer.from('# ' + stage),
            },
          },
        },
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      uploaded.push(await response.json());
    }
    const list = await (
      await page.request.get(`/api/v1/tasks/${task.id}/attachments`)
    ).json();
    expect(new Set(list.map((a: any) => a.stage)).size).toBe(7);
    expect(list.find((a: any) => a.stage === 'REQUIREMENT').stageVersion).toBe(
      1,
    );
    const target = uploaded[0];
    expect(
      (
        await peer.request.delete(`/api/v1/attachments/${target.id}`, {
          headers: peerHeaders,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.delete(`/api/v1/attachments/${target.id}`, {
          headers,
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await page.request.get(`/api/v1/attachments/${target.id}/download`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await (
          await page.request.get(`/api/v1/tasks/${task.id}/attachments`)
        ).json()
      ).some((a: any) => a.id === target.id),
    ).toBe(false);
    expect(
      (
        await (
          await peer.request.get(
            `/api/v1/tasks/${task.id}/attachments?includeDeleted=true`,
          )
        ).json()
      ).some((a: any) => a.id === target.id),
    ).toBe(false);
    expect(
      (
        await peer.request.post(`/api/v1/attachments/${target.id}/restore`, {
          headers: peerHeaders,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(`/api/v1/attachments/${target.id}/restore`, {
          headers,
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await page.request.get(`/api/v1/attachments/${target.id}/download`)
      ).ok(),
    ).toBeTruthy();
    const peerUpload = await peer.request.post(
      `/api/v1/tasks/${task.id}/attachments`,
      {
        headers: peerHeaders,
        multipart: {
          stage: 'DEVELOPMENT',
          file: {
            name: 'engineer.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('交付说明'),
          },
        },
      },
    );
    expect(peerUpload.ok()).toBeTruthy();
    const peerFile = await peerUpload.json();
    expect(
      (
        await page.request.delete(`/api/v1/attachments/${peerFile.id}`, {
          headers,
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await page.request.post(`/api/v1/attachments/${peerFile.id}/restore`, {
          headers,
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto(`/student/?app=work&task=${task.id}`);
    const requirement = page.getByRole('region', {
      name: '需求附件',
      exact: true,
    });
    await expect(
      requirement.getByRole('link', { name: 'GENERAL.md', exact: true }),
    ).toBeVisible();
    await requirement
      .getByRole('button', { name: /上传附件/ })
      .click({ trial: true });
    await requirement.locator('input[type=file]').setInputFiles({
      name: '页面上传.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('页面上传附件'),
    });
    await expect(
      requirement.getByRole('link', { name: '页面上传.txt', exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: '开发资料', exact: true }).click();
    for (const stage of ['方案附件', '评估附件', '开发交付附件']) {
      await expect(
        page
          .getByRole('region', { name: stage, exact: true })
          .getByRole('button', { name: /上传附件/ }),
      ).toBeVisible();
    }
    await page.getByRole('tab', { name: '测试资料', exact: true }).click();
    for (const stage of ['测试附件', '验收附件']) {
      await expect(
        page.getByRole('region', { name: stage, exact: true }),
      ).toBeVisible();
    }
    await page.getByRole('tab', { name: '开发资料', exact: true }).click();
    const panel = page.getByRole('region', { name: '方案附件', exact: true });
    await panel.getByRole('button', { name: /删\s*除/ }).click();
    await page
      .locator('.ant-popconfirm')
      .getByRole('button', { name: /删\s*除/ })
      .click();
    await expect(
      panel.getByRole('link', { name: 'SOLUTION.md', exact: true }),
    ).toHaveCount(0);
    await panel.getByText('已删除（1）', { exact: true }).click();
    await panel.getByRole('button', { name: /恢\s*复/ }).click();
    await expect(
      panel.getByRole('link', { name: 'SOLUTION.md', exact: true }),
    ).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'artifacts/browser/attachment-stages.png',
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'artifacts/browser/attachment-stages-mobile.png',
      animations: 'disabled',
    });
  } finally {
    await peer.close();
  }
});

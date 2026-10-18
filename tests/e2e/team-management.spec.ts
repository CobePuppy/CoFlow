import { test, expect } from '@playwright/test';

test('团队成员管理：邀请、资料、项目移动、跨团队转移与权限保护', async ({
  page,
  browser,
}) => {
  const origin = 'http://localhost:5174';
  const suffix = Date.now();
  const b = await browser.newContext({ baseURL: origin });
  const c = await browser.newContext({ baseURL: origin });
  async function register(request: any, tag: string) {
    const email = `team-manage-${tag}-${suffix}@example.com`,
      password = 'Team-manage-test-2026!';
    const response = await request.post('/api/v1/auth/register', {
      headers: { Origin: origin },
      data: {
        kind: 'creator',
        name: tag,
        email,
        password,
        teamName: `${tag}团队`,
      },
    });
    expect(response.status()).toBe(201);
    const team = await response.json();
    const session = await (
      await request.post('/api/v1/auth/login', {
        headers: { Origin: origin },
        data: { email, password },
      })
    ).json();
    return {
      ...team,
      ...session,
      email,
      headers: { Origin: origin, 'X-CSRF-Token': session.csrf },
    };
  }
  async function ok(response: any) {
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  try {
    const aAuth = await register(page.request, 'A');
    const bAuth = await register(b.request, 'B');
    const cAuth = await register(c.request, 'C');
    const wid = aAuth.workspaceId,
      userId = cAuth.user.id;
    const base = `/api/v1/workspaces/${wid}`;
    await ok(
      await c.request.post('/api/v1/workspaces/join', {
        headers: cAuth.headers,
        data: { teamCode: aAuth.teamCode },
      }),
    );
    // Ordinary members cannot rename, invite, edit, move or remove team members.
    for (const [method, path, data] of [
      ['patch', base, { name: '越权改名' }],
      ['post', `${base}/invitations`, { email: 'nobody@example.com' }],
      ['patch', `${base}/members/${aAuth.user.id}`, { displayName: '越权' }],
      [
        'post',
        `${base}/members/${userId}/move`,
        { targetId: 'missing', roles: ['PRODUCT'] },
      ],
      ['delete', `${base}/members/${aAuth.user.id}`, {}],
    ] as const)
      expect(
        (
          await (c.request as any)[method](path, {
            headers: cAuth.headers,
            data,
          })
        ).status(),
      ).toBe(403);
    await page.goto(`/student/?section=members&workspace=${wid}`);
    await page.getByRole('button', { name: '邀请成员', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '邀请成员', exact: true });
    await dialog.getByLabel('受邀邮箱').fill(`invited-${suffix}@example.com`);
    await dialog.getByRole('button', { name: '生成邀请链接' }).click();
    await expect(dialog.getByLabel('邀请链接')).toHaveValue(
      /\/student\/\?invite=/,
    );
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    let row = page.getByRole('row').filter({ hasText: cAuth.email });
    async function memberAction(name: string) {
      await row.locator('.ant-avatar').click();
      await page
        .getByRole('region', { name: '成员资料' })
        .getByRole('button', { name, exact: true })
        .click();
    }
    await expect(
      page.getByRole('columnheader', { name: '操作', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '修改资料', exact: true }),
    ).toHaveCount(0);
    const trigger = row.getByRole('button', { name: /^查看成员 / });
    await trigger.focus();
    await trigger.press('Enter');
    await expect(page.getByRole('region', { name: '成员资料' })).toContainText(
      cAuth.email.toLowerCase(),
    );
    await page.screenshot({
      path: 'artifacts/team-member-card-desktop.png',
      fullPage: true,
      animations: 'disabled',
    });
    await trigger.press('Escape');
    await expect(page.getByRole('region', { name: '成员资料' })).toHaveCount(0);
    const memberPage = await c.newPage();
    await memberPage.goto(`/student/?section=members&workspace=${wid}`);
    await memberPage
      .getByRole('button', { name: '查看成员 A', exact: true })
      .click();
    await expect(
      memberPage.getByRole('region', { name: '成员资料' }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole('region', { name: '成员资料' }).getByRole('button'),
    ).toHaveCount(0);
    await memberPage.close();
    await memberAction('修改资料');
    dialog = page.getByRole('dialog', { name: '修改成员资料' });
    await dialog.getByLabel('团队内显示名').fill('团队显示名');
    await dialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(row).toContainText('团队显示名');
    expect(
      (await (await c.request.get('/api/v1/auth/me')).json()).user.name,
    ).toBe('C');
    const p1 = await ok(
      await page.request.post(`${base}/projects`, {
        headers: aAuth.headers,
        data: { name: '来源项目' },
      }),
    );
    const p2 = await ok(
      await page.request.post(`${base}/projects`, {
        headers: aAuth.headers,
        data: { name: '目标项目' },
      }),
    );
    await memberAction('移动项目');
    dialog = page.getByRole('dialog', { name: '移动 / 分配项目' });
    await dialog.getByLabel('目标项目', { exact: true }).click();
    await page.getByTitle('来源项目', { exact: true }).click();
    await dialog.getByLabel('目标项目角色').click();
    await page.getByTitle('产品', { exact: true }).click();
    await dialog.getByLabel('目标项目角色').press('Escape');
    await dialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(dialog).not.toBeVisible();
    const task = await ok(
      await c.request.post(`/api/v1/projects/${p1.id}/tasks`, {
        headers: cAuth.headers,
        data: { title: '成员责任保护' },
      }),
    );
    expect(
      (
        await page.request.delete(`${base}/members/${userId}`, {
          headers: aAuth.headers,
          data: {},
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await page.request.post(`${base}/members/${userId}/move`, {
          headers: aAuth.headers,
          data: { sourceId: p1.id, targetId: p2.id, roles: ['ENGINEER'] },
        })
      ).status(),
    ).toBe(409);
    await ok(
      await c.request.patch(`/api/v1/tasks/${task.id}`, {
        headers: cAuth.headers,
        data: { expectedVersion: task.version, productId: aAuth.user.id },
      }),
    );
    await memberAction('移动项目');
    dialog = page.getByRole('dialog', { name: '移动 / 分配项目' });
    await dialog.getByLabel('来源项目（可选）').click();
    await page.getByTitle('来源项目', { exact: true }).click();
    await dialog.getByLabel('目标项目', { exact: true }).click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByTitle('目标项目', { exact: true })
      .click();
    await dialog.getByLabel('目标项目角色').click();
    await page.getByTitle('研发', { exact: true }).click();
    await dialog.getByLabel('目标项目角色').press('Escape');
    await dialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(dialog).not.toBeVisible();
    expect(
      (
        await (
          await page.request.get(`/api/v1/projects/${p1.id}/members`)
        ).json()
      ).some((m: any) => m.id === userId),
    ).toBe(false);
    expect(
      (
        await (
          await page.request.get(`/api/v1/projects/${p2.id}/members`)
        ).json()
      ).find((m: any) => m.id === userId).name,
    ).toBe('团队显示名');
    // Transferring requires administrator permission on both teams.
    expect(
      (
        await page.request.post(`${base}/members/${userId}/transfer`, {
          headers: aAuth.headers,
          data: { targetWorkspaceId: bAuth.workspaceId },
        })
      ).status(),
    ).toBe(404);
    await ok(
      await page.request.post('/api/v1/workspaces/join', {
        headers: aAuth.headers,
        data: { teamCode: bAuth.teamCode },
      }),
    );
    expect(
      (
        await page.request.post(`${base}/members/${userId}/transfer`, {
          headers: aAuth.headers,
          data: { targetWorkspaceId: bAuth.workspaceId },
        })
      ).status(),
    ).toBe(403);
    await ok(
      await b.request.patch(`/api/v1/workspaces/${bAuth.workspaceId}/members`, {
        headers: bAuth.headers,
        data: { userId: aAuth.user.id, role: 'ADMIN' },
      }),
    );
    // Last administrator cannot be demoted, removed, or transferred.
    expect(
      (
        await page.request.patch(`${base}/members/${aAuth.user.id}`, {
          headers: aAuth.headers,
          data: { displayName: '', role: 'MEMBER' },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await page.request.delete(`${base}/members/${aAuth.user.id}`, {
          headers: aAuth.headers,
          data: {},
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await page.request.post(`${base}/members/${aAuth.user.id}/transfer`, {
          headers: aAuth.headers,
          data: { targetWorkspaceId: bAuth.workspaceId },
        })
      ).status(),
    ).toBe(409);
    await page.getByRole('button', { name: '团队设置', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '团队设置' });
    await dialog.getByLabel('团队名称').fill('更新后的团队');
    await dialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(dialog).not.toBeVisible();
    expect(
      (await (await page.request.get('/api/v1/workspaces')).json()).find(
        (w: any) => w.id === wid,
      ).name,
    ).toBe('更新后的团队');
    await expect(page.locator('.ant-modal-wrap:visible')).toHaveCount(0);
    await page.screenshot({
      path: 'artifacts/team-management-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page
          .locator('.portal-sidebar')
          .evaluate((el) => el.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: 'artifacts/team-management-mobile.png',
      fullPage: true,
    });
    await row.locator('.ant-avatar').click();
    const mobileCard = page.getByRole('region', { name: '成员资料' });
    await expect(
      mobileCard.getByRole('button', { name: '移出团队', exact: true }),
    ).toBeVisible();
    const bounds = await mobileCard.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: 'artifacts/team-member-card-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    await row.getByRole('button', { name: /^查看成员 / }).press('Escape');
    await page.setViewportSize({ width: 1440, height: 980 });
    row = page.getByRole('row').filter({ hasText: cAuth.email });
    await memberAction('转移团队');
    dialog = page.getByRole('dialog', { name: '转移到其他团队' });
    await dialog.getByLabel('目标团队').click();
    await page.getByTitle('B团队', { exact: true }).click();
    await dialog.getByRole('button', { name: '确认转移' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toHaveCount(0);
    expect((await c.request.get(`${base}/members`)).status()).toBe(404);
    expect(
      (
        await (
          await b.request.get(`/api/v1/workspaces/${bAuth.workspaceId}/members`)
        ).json()
      ).find((m: any) => m.id === userId).role,
    ).toBe('MEMBER');
    const history = await ok(
      await page.request.get(`/api/v1/tasks/${task.id}`),
    );
    expect(history.id).toBe(task.id);
    // Rejoining then removing leaves the account and other team membership intact.
    await ok(
      await c.request.post('/api/v1/workspaces/join', {
        headers: cAuth.headers,
        data: { teamCode: aAuth.teamCode },
      }),
    );
    await page.reload();
    row = page.getByRole('row').filter({ hasText: cAuth.email });
    await memberAction('移出团队');
    dialog = page.getByRole('dialog', { name: '移出团队', exact: true });
    await dialog.getByRole('button', { name: '确认移出' }).click();
    await expect(row).toHaveCount(0);
    expect((await c.request.get(`${base}/members`)).status()).toBe(404);
    expect((await c.request.get('/api/v1/auth/me')).ok()).toBeTruthy();
    expect(
      (
        await c.request.get(`/api/v1/workspaces/${bAuth.workspaceId}/members`)
      ).ok(),
    ).toBeTruthy();
  } finally {
    await b.close();
    await c.close();
  }
});

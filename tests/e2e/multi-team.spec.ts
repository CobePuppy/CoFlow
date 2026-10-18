import { test, expect } from '@playwright/test';

test('多团队身份隔离、团队与项目管理分离', async ({ page, browser }) => {
  const origin = 'http://localhost:5174';
  const suffix = Date.now();
  const password = 'Multi-team-test-2026!';
  async function register(request: any, tag: string) {
    const email = `multi-${tag.startsWith('A') ? 'a' : 'b'}-${suffix}@example.com`;
    const response = await request.post('/api/v1/auth/register', {
      headers: { Origin: origin },
      data: {
        kind: 'creator',
        name: tag,
        email,
        password,
        teamName: `${tag}-${suffix}`,
      },
    });
    expect(response.status()).toBe(201);
    const team = await response.json();
    const login = await request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { email, password },
    });
    expect(login.ok()).toBeTruthy();
    const session = await login.json();
    return { ...team, ...session };
  }
  const other = await browser.newContext({ baseURL: origin });
  try {
    const a = await register(page.request, 'A团队管理员');
    const b = await register(other.request, 'B团队管理员');
    const headers = { Origin: origin, 'X-CSRF-Token': a.csrf };
    const projectResponse = await page.request.post(
      `/api/v1/workspaces/${a.workspaceId}/projects`,
      { headers, data: { name: '独立项目管理' } },
    );
    expect(projectResponse.ok()).toBeTruthy();
    const project = await projectResponse.json();
    await page.goto(`/student/?section=members&workspace=${a.workspaceId}`);
    await expect(
      page.getByRole('columnheader', { name: '团队身份', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '邀请成员', exact: true }).click();
    const teamDialog = page.getByRole('dialog', {
      name: '邀请成员',
      exact: true,
    });
    await expect(teamDialog.getByLabel('受邀邮箱')).toBeVisible();
    await expect(teamDialog.getByText(/项目角色/)).toHaveCount(0);
    await expect(
      teamDialog.getByRole('button', { name: '归档项目' }),
    ).toHaveCount(0);
    await teamDialog
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await page.goto(
      `/student/?section=projects&workspace=${a.workspaceId}&project=${project.id}`,
    );
    await page.getByRole('button', { name: '项目设置', exact: true }).click();
    await page
      .getByRole('button', { name: '管理项目成员', exact: true })
      .click();
    const projectDialog = page.getByRole('dialog', {
      name: '项目成员 · 独立项目管理',
      exact: true,
    });
    await expect(
      projectDialog.getByLabel('项目角色', { exact: true }),
    ).toBeVisible();
    await expect(
      projectDialog.getByText('邀请团队成员', { exact: true }),
    ).toHaveCount(0);
    await page.goto(`/student/?section=members&workspace=${a.workspaceId}`);
    await page.getByRole('button', { name: '团队操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '我的团队', exact: true }).click();
    const access = page.getByRole('dialog', { name: '我的团队', exact: true });
    await access.getByRole('tab', { name: '加入团队', exact: true }).click();
    await access.getByLabel('团队码', { exact: true }).fill(b.teamCode);
    await access.getByRole('button', { name: '加入团队', exact: true }).click();
    await expect(access).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp(`workspace=${b.workspaceId}`));
    const teams = await (await page.request.get('/api/v1/workspaces')).json();
    expect(teams.find((t: any) => t.id === a.workspaceId).role).toBe('ADMIN');
    expect(teams.find((t: any) => t.id === b.workspaceId).role).toBe('MEMBER');
    const forbidden = await page.request.patch(
      `/api/v1/workspaces/${b.workspaceId}/members`,
      { headers, data: { userId: a.user.id, role: 'ADMIN' } },
    );
    expect(forbidden.status()).toBe(403);
    const repeat = await page.request.post('/api/v1/workspaces/join', {
      headers,
      data: { teamCode: a.teamCode },
    });
    expect(repeat.ok()).toBeTruthy();
    expect((await repeat.json()).role).toBe('ADMIN');
    const invalid = await page.request.post('/api/v1/workspaces/join', {
      headers,
      data: { teamCode: '000000000000' },
    });
    expect(invalid.status()).toBe(422);
    await page.goto(`/student/?section=members&workspace=${b.workspaceId}`);
    await expect(
      page.getByRole('button', { name: '邀请成员', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: '团队操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '我的团队', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '我的团队' })).toContainText(
      '管理员',
    );
    await expect(page.getByRole('dialog', { name: '我的团队' })).toContainText(
      '成员',
    );
    const createDialog = page.getByRole('dialog', {
      name: '我的团队',
      exact: true,
    });
    await createDialog
      .getByRole('tab', { name: '创建团队', exact: true })
      .click();
    await createDialog
      .getByLabel('团队名称', { exact: true })
      .fill(`C团队-${suffix}`);
    await createDialog
      .getByRole('button', { name: '创建团队', exact: true })
      .click();
    await expect(createDialog).not.toBeVisible();
    const afterCreate = await (
      await page.request.get('/api/v1/workspaces')
    ).json();
    expect(
      afterCreate.find((t: any) => t.name === `C团队-${suffix}`).role,
    ).toBe('ADMIN');
    expect(afterCreate.find((t: any) => t.id === a.workspaceId).role).toBe(
      'ADMIN',
    );
    expect(afterCreate.find((t: any) => t.id === b.workspaceId).role).toBe(
      'MEMBER',
    );
    await page.getByRole('button', { name: '团队操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '我的团队', exact: true }).click();
    await page.screenshot({
      path: 'artifacts/browser/multi-team-roles.png',
      fullPage: false,
      animations: 'disabled',
    });
  } finally {
    await other.close();
  }
});

import { test, expect } from '@playwright/test';
test('团队竞赛跨成员共享、无项目成员只读、轮询更新及所属项目跳转', async ({
  page,
  browser,
}) => {
  const suffix = Date.now(),
    origin = 'http://localhost:5174',
    password = 'Competition-test-2026';
  const created = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      name: '竞赛负责人',
      email: `competition-owner-${suffix}@example.com`,
      password,
      teamName: '竞赛互通-' + suffix,
    },
  });
  expect(created.status()).toBe(201);
  const team = await created.json();
  const ownerLogin = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email: `competition-owner-${suffix}@example.com`, password },
  });
  expect(ownerLogin.ok()).toBeTruthy();
  const owner = await ownerLogin.json();
  const ownerPost = async (path: string, data: any) => {
    const r = await page.request.post('/api/v1' + path, {
      headers: { Origin: origin, 'X-CSRF-Token': owner.csrf },
      data,
    });
    expect(r.ok()).toBeTruthy();
    return r.json();
  };
  const project = await ownerPost(`/workspaces/${team.workspaceId}/projects`, {
    name: '参赛项目A',
  });
  const otherProject = await ownerPost(
    `/workspaces/${team.workspaceId}/projects`,
    { name: '参赛项目B' },
  );
  const peerContext = await browser.newContext({ baseURL: origin });
  try {
    const peer = await peerContext.newPage();
    const joined = await peer.request.post('/api/v1/auth/register', {
      headers: { Origin: origin },
      data: {
        kind: 'member',
        name: '竞赛队友',
        email: `competition-peer-${suffix}@example.com`,
        password,
        teamCode: team.teamCode,
      },
    });
    expect(joined.status()).toBe(201);
    const logged = await peer.request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { email: `competition-peer-${suffix}@example.com`, password },
    });
    const member = await logged.json();
    expect(logged.ok()).toBeTruthy();
    await peer.goto(
      `/student/?section=competitions&workspace=${team.workspaceId}`,
    );
    await expect(
      peer.getByRole('button', { name: '登记竞赛', exact: true }),
    ).toBeDisabled();
    await page.goto(
      `/student/?section=competitions&workspace=${team.workspaceId}&project=${project.id}`,
    );
    await page.getByRole('button', { name: '登记竞赛', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '竞赛信息', exact: true });
    const name = '共享参赛记录-' + suffix;
    await dialog.getByLabel('竞赛名称', { exact: true }).fill(name);
    await dialog.getByRole('button', { name: '保存竞赛', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const peerCard = peer
      .locator('.ant-card')
      .filter({ has: peer.getByText(name, { exact: true }) });
    await expect(peerCard).toBeVisible({ timeout: 22000 });
    await expect(peerCard).toContainText('所属项目：参赛项目A');
    await expect(
      peerCard.getByRole('button', {
        name: 'FirstStepAgent 分析竞赛',
        exact: true,
      }),
    ).toBeDisabled();
    await peerCard
      .getByRole('button', { name: '查看竞赛', exact: true })
      .click();
    const readonly = peer.getByRole('dialog', {
      name: '竞赛信息',
      exact: true,
    });
    await expect(
      readonly.getByLabel('竞赛名称', { exact: true }),
    ).toBeDisabled();
    await readonly.getByRole('button', { name: 'Close', exact: true }).click();
    await ownerPost(`/projects/${project.id}/members`, {
      userId: member.user.id,
      roles: ['ENGINEER'],
    });
    await peer.getByRole('button', { name: '刷新竞赛', exact: true }).click();
    await expect(
      peerCard.getByRole('button', { name: '编辑竞赛', exact: true }),
    ).toBeVisible();
    await peerCard
      .getByRole('button', { name: '编辑竞赛', exact: true })
      .click();
    const edit = peer.getByRole('dialog', { name: '竞赛信息', exact: true });
    await edit.locator('.ant-select-selector').click();
    await peer.getByTitle('已报名', { exact: true }).click();
    await edit.getByRole('button', { name: '保存竞赛', exact: true }).click();
    await expect(edit).not.toBeVisible();
    await page.getByRole('button', { name: '刷新竞赛', exact: true }).click();
    const ownerCard = page
      .locator('.ant-card')
      .filter({ has: page.getByText(name, { exact: true }) });
    await expect(ownerCard).toContainText('已报名');
    await page.goto(
      `/student/?section=competitions&workspace=${team.workspaceId}&project=${otherProject.id}`,
    );
    await expect(ownerCard).toBeVisible();
    await ownerCard
      .getByRole('button', { name: '准备参赛材料', exact: true })
      .click();
    expect(new URL(page.url()).searchParams.get('project')).toBe(project.id);
    const removed = await page.request.delete(
      '/api/v1/projects/' + project.id + '/members/' + owner.user.id,
      { headers: { Origin: origin, 'X-CSRF-Token': owner.csrf } },
    );
    expect(removed.ok()).toBeTruthy();
    await page.goto(
      '/student/?section=competitions&workspace=' + team.workspaceId,
    );
    await expect(
      ownerCard.getByRole('button', { name: '编辑竞赛', exact: true }),
    ).toBeVisible();
    await expect(
      ownerCard.getByRole('button', {
        name: 'FirstStepAgent 分析竞赛',
        exact: true,
      }),
    ).toBeDisabled();
    await ownerCard
      .getByRole('button', { name: '编辑竞赛', exact: true })
      .click();
    const adminEdit = page.getByRole('dialog', {
      name: '竞赛信息',
      exact: true,
    });
    await adminEdit
      .getByLabel('主办方', { exact: true })
      .fill('管理员更新主办方');
    await adminEdit
      .getByRole('button', { name: '保存竞赛', exact: true })
      .click();
    await expect(adminEdit).not.toBeVisible();
    await expect(ownerCard).toContainText('管理员更新主办方');
    await ownerCard
      .getByRole('button', { name: '管理参赛成员', exact: true })
      .click();
    const management = page.getByRole('dialog', {
      name: '项目成员 · 参赛项目A',
      exact: true,
    });
    await expect(
      management.getByText('竞赛队友', { exact: true }).last(),
    ).toBeVisible();
    await management.getByLabel('选择团队成员', { exact: true }).click();
    await page.getByTitle('竞赛负责人', { exact: true }).click();
    await management.getByLabel('项目角色', { exact: true }).click();
    await page.getByTitle('产品', { exact: true }).click();
    await management
      .getByRole('heading', { name: '项目角色 · 参赛项目A', exact: true })
      .click();
    await management
      .getByRole('button', { name: '保存成员角色', exact: true })
      .click();
    await expect(management.locator('.ant-table').last()).toContainText(
      '竞赛负责人',
    );
    await management
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(
      ownerCard.getByRole('button', {
        name: 'FirstStepAgent 分析竞赛',
        exact: true,
      }),
    ).toBeEnabled();
  } finally {
    await peerContext.close();
  }
});

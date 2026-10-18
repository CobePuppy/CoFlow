import { test, expect } from '@playwright/test';
test('属性浮层中的选项可反复点击、保存取消及窄屏操作', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    }),
  );
  const origin = 'http://localhost:5174',
    suffix = Date.now(),
    password = 'Property-test-2026!';
  const email = `property-${suffix}@example.com`;
  const registration = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      name: '属性负责人',
      email,
      password,
      teamName: '属性交互测试',
    },
  });
  const team = await registration.json();
  expect(registration.ok()).toBeTruthy();
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email, password },
  });
  const me = await login.json();
  const headers = { Origin: origin, 'X-CSRF-Token': me.csrf };
  const created = await page.request.post(
    '/api/v1/workspaces/' + team.workspaceId + '/projects',
    { headers, data: { name: '浮层项目' } },
  );
  const project = await created.json();
  const peerEmail = `property-peer-${suffix}@example.com`;
  await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'member',
      name: '属性队友',
      email: peerEmail,
      password,
      teamCode: team.teamCode,
    },
  });
  const members = await (
    await page.request.get(
      '/api/v1/workspaces/' + team.workspaceId + '/members',
    )
  ).json();
  const peer = members.find((m: any) => m.email === peerEmail);
  await page.request.post('/api/v1/projects/' + project.id + '/members', {
    headers,
    data: { userId: peer.id, roles: ['ENGINEER'] },
  });

  async function addMember(name: string, index: number) {
    const memberEmail =
      'property-extra-' + suffix + '-' + index + '@example.com';
    await page.request.post('/api/v1/auth/register', {
      headers: { Origin: origin },
      data: {
        kind: 'member',
        name,
        email: memberEmail,
        password,
        teamCode: team.teamCode,
      },
    });
    const list = await (
      await page.request.get(
        '/api/v1/workspaces/' + team.workspaceId + '/members',
      )
    ).json();
    const user = list.find((m: any) => m.email === memberEmail);
    await page.request.post('/api/v1/projects/' + project.id + '/members', {
      headers,
      data: { userId: user.id, roles: ['ENGINEER'] },
    });
    return user;
  }
  const qa = await addMember('独立测试评估人', 2);
  const engineer = await addMember('新研发负责人', 3);
  const reviewer = await addMember('新产品评估人', 4);
  const taskResponse = await page.request.post(
    '/api/v1/projects/' + project.id + '/tasks',
    {
      headers,
      data: {
        title: '属性点击需求',
        productId: me.user.id,
        engineerId: peer.id,
        testerId: qa.id,
        productReviewerId: me.user.id,
        qaReviewerId: qa.id,
      },
    },
  );
  const task = await taskResponse.json();
  await page.goto('/student/?app=work&task=' + task.id);
  const popover = page.locator('.property-popover');
  for (const [value, label] of [
    ['P0', 'P0 · 紧急'],
    ['P1', 'P1 · 高'],
    ['P2', 'P2 · 中'],
    ['P3', 'P3 · 低'],
  ]) {
    await page.getByRole('button', { name: '修改优先级', exact: true }).click();
    await popover.locator('.ant-select-selector').click();
    await popover.getByTitle(label, { exact: true }).click();
    await expect(popover).toBeVisible();
    await expect(popover.locator('.ant-select-selection-item')).toHaveText(
      label,
    );
    await popover.getByRole('button', { name: '保存', exact: true }).click();
    await expect(popover).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: '修改优先级', exact: true }),
    ).toContainText(value);
    expect(
      (await (await page.request.get('/api/v1/tasks/' + task.id)).json()).data
        .priority,
    ).toBe(value);
  }
  await page.getByRole('button', { name: '修改优先级', exact: true }).click();
  await popover.locator('.ant-select-selector').click();
  await popover.getByTitle('P1 · 高', { exact: true }).click();
  await popover.getByRole('button', { name: '取消', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '修改优先级', exact: true }),
  ).toContainText('P3');
  for (const [label, target] of [
    ['研发负责人', engineer.name],
    ['测试负责人', peer.name],
    ['产品评估人', reviewer.name],
    ['测试评估人', '属性负责人'],
  ]) {
    await page
      .getByRole('button', { name: '修改' + label, exact: true })
      .click();
    await popover
      .getByRole('combobox', { name: '选择' + label, exact: true })
      .fill(target);
    await popover.getByTitle(target, { exact: true }).click();
    await expect(popover).toBeVisible();
    await popover.getByRole('button', { name: '保存', exact: true }).click();
    await expect(popover).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: '修改' + label, exact: true }),
    ).toContainText(target);
  }
  await page.getByRole('button', { name: '修改计划截止', exact: true }).click();
  await popover.getByLabel('选择计划截止').fill('2026-12-10');
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '修改优先级', exact: true }).click();
  await popover.locator('.ant-select-selector').click();
  await popover.getByTitle('P0 · 紧急', { exact: true }).click();
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: '修改优先级', exact: true }),
  ).toContainText('P0');
  await page.screenshot({
    path: 'artifacts/browser/property-clicks-mobile.png',
    animations: 'disabled',
  });
});

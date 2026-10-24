import { test, expect, request } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('V4推进助手：双版生成草稿、真实保存关联、幂等与项目变化保护', async ({
  page,
}) => {
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
  const path = '/projects/' + project.id + '/assistant';
  const snapshot = await (await page.request.get('/api/v1' + path)).json();
  expect(snapshot.sources.map((s: any) => s.id)).toEqual([task.id]);
  expect(snapshot.sources[0].signals).toContain('缺少验收标准');
  const result = {
    summary: '先补齐验收标准，再推进交付',
    actions: [
      {
        taskId: task.id,
        priority: 'HIGH',
        action: '与团队确认可复核的交付标准',
        acceptance: '每项标准包含步骤与预期结果',
        evidence: '核对交付验收标准',
      },
    ],
    questions: ['本轮交付日期是否已经确定？'],
  };
  const payload = {
    result,
    fingerprint: snapshot.fingerprint,
    goal: '推进当前项目',
    requestKey: randomUUID(),
  };
  const receipt = await post(path + '/save', payload);
  expect((await post(path + '/save', payload)).id).toBe(receipt.id);
  const changedRetry = await page.request.post('/api/v1' + path + '/save', {
    headers,
    data: { ...payload, goal: '另一个目标' },
  });
  expect(changedRetry.status()).toBe(409);
  const fabricated = await page.request.post('/api/v1' + path + '/save', {
    headers,
    data: {
      ...payload,
      requestKey: randomUUID(),
      result: {
        ...result,
        actions: [{ ...result.actions[0], evidence: '不存在的执行证据' }],
      },
    },
  });
  expect(fabricated.status()).toBe(502);
  const crossTask = await page.request.post('/api/v1' + path + '/save', {
    headers,
    data: {
      ...payload,
      requestKey: randomUUID(),
      result: {
        ...result,
        actions: [{ ...result.actions[0], taskId: randomUUID() }],
      },
    },
  });
  expect(crossTask.status()).toBe(502);
  const document = await (
    await page.request.get('/api/v1/documents/' + receipt.id)
  ).json();
  expect(document.taskIds).toEqual([task.id]);
  expect(document.content).toContain('当前处理人：推进负责人');
  const missingKey = await page.request.post('/api/v1' + path + '/run', {
    headers,
    data: { fingerprint: snapshot.fingerprint, goal: '推进当前项目' },
  });
  expect(missingKey.status()).toBe(422);
  expect((await missingKey.json()).message).toContain('个人设置');
  const outsider = await request.newContext({ baseURL: origin });
  expect((await outsider.get('/api/v1' + path)).status()).toBe(401);
  const outsiderEmail = 'outsider-' + Date.now() + '@example.com';
  await outsider.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      name: '外部成员',
      email: outsiderEmail,
      password,
      teamName: '隔离团队',
    },
  });
  await outsider.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email: outsiderEmail, password },
  });
  expect((await outsider.get('/api/v1' + path)).status()).toBe(404);
  await outsider.dispose();
  // The browser uses a fixed model response; database reads and saves remain real.
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
  });
  await page.route('**/api/v1' + path + '/run', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        result,
        fingerprint: body.fingerprint,
        generatedAt: new Date().toISOString(),
        model: 'browser-test-fixture',
      },
    });
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
    await page.getByRole('tab', { name: 'AI推进', exact: true }).click();
    const panel = page.locator('.project-assistant');
    await expect(panel).toContainText('缺少验收标准');
    await panel
      .getByRole('button', { name: '生成推进计划', exact: true })
      .click();
    await expect(panel).toContainText(result.summary);
    await panel
      .getByRole('button', { name: '保存到项目文档', exact: true })
      .click();
    await expect(
      panel.getByRole('button', { name: '已保存到项目文档', exact: true }),
    ).toBeDisabled();
    const downloadPromise = page.waitForEvent('download');
    await panel
      .getByRole('button', { name: '导出行动草稿', exact: true })
      .click();
    expect((await downloadPromise).suggestedFilename()).toContain(
      '项目推进草稿',
    );
    await page.screenshot({
      path: 'artifacts/browser/v4-' + edition + '-assistant.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: 'artifacts/browser/v4-' + edition + '-assistant-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    await panel
      .getByRole('button', { name: task.data.title, exact: false })
      .click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
  }
  await page.request.patch('/api/v1/projects/' + project.id, {
    headers,
    data: { description: '项目目标已更新' },
  });
  const stale = await page.request.post('/api/v1' + path + '/save', {
    headers,
    data: { ...payload, requestKey: randomUUID() },
  });
  expect(stale.status()).toBe(409);
  const staleRun = await page.request.post('/api/v1' + path + '/run', {
    headers,
    data: { fingerprint: snapshot.fingerprint, goal: '推进项目' },
  });
  expect(staleRun.status()).toBe(409);
  await page.request.patch('/api/v1/projects/' + project.id, {
    headers,
    data: { archived: true },
  });
  const archived = await page.request.post('/api/v1' + path + '/save', {
    headers,
    data: { ...payload, requestKey: randomUUID() },
  });
  expect(archived.status()).toBe(409);
  expect((await page.request.get('/api/v1' + path)).ok()).toBeTruthy();
});

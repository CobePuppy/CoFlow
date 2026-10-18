import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const pid = '10000000-0000-4000-8000-000000000001';
const wid = '00000000-0000-4000-8000-000000000001';
test('项目分身：创建、隔离、并发、预算、实际试验、跨路线成果合并及冻结', async ({
  page,
  browser,
}) => {
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://localhost:5174' },
    data: {
      email: 'product@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  expect(login.ok()).toBeTruthy();
  const me = await login.json();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-CSRF-Token': me.csrf };
  await page.goto(
    `/student/?app=work&workspace=${wid}&project=${pid}&view=forks`,
  );
  await expect(
    page.getByRole('button', { name: '创建项目分身', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '创建项目分身', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: '创建项目分身',
    exact: true,
  });
  const title = '自研或API-' + Date.now();
  await dialog.getByLabel('决策问题', { exact: true }).fill(title);
  await dialog
    .getByLabel('共同目标', { exact: true })
    .fill('一天内完成可运行原型');
  await dialog
    .getByLabel('比较标准（明确口径与取舍）', { exact: true })
    .fill('同一测试集下比较响应时间和成本');
  await dialog
    .getByLabel('待验证的假设', { exact: true })
    .nth(0)
    .fill('本地模型可以满足延迟要求');
  await dialog
    .getByLabel('待验证的假设', { exact: true })
    .nth(1)
    .fill('云端接口可以低成本实现');
  await page.screenshot({ path: 'artifacts/browser/forks-create.png' });
  await dialog
    .getByRole('button', { name: '创建两条探索路线', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(title, { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '编辑路线 A', exact: true }).click();
  const editor = page.getByRole('dialog', {
    name: '编辑探索路线',
    exact: true,
  });
  await editor
    .getByRole('button', { name: '添加试验任务', exact: true })
    .click();
  await editor.getByLabel('试验任务', { exact: true }).fill('限时验证最小原型');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  const discard = page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(editor.getByLabel('试验任务', { exact: true })).toHaveValue(
    '限时验证最小原型',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      editor.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    )
    .toBeTruthy();
  await editor
    .getByRole('button', { name: '保存路线', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/browser/forks-editor-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 980 });
  await editor.getByRole('button', { name: '保存路线', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(
    page.getByText('限时验证最小原型', { exact: true }),
  ).toBeVisible();
  const all = await (
    await page.request.get(`/api/v1/projects/${pid}/forks`)
  ).json();
  let fork = all.items.find((x: any) => x.title === title);
  expect(fork).toBeTruthy();
  expect(fork.data.routes).toHaveLength(2);
  expect(new URL(page.url()).searchParams.get('fork')).toBe(fork.id);
  const newer = await page.request.post(`/api/v1/projects/${pid}/forks`, {
    headers,
    data: {
      title: '另一次探索-' + Date.now(),
      goal: fork.goal,
      criterion: fork.criterion,
      routes: fork.data.routes,
    },
  });
  expect(newer.ok()).toBeTruthy();
  const other = await browser.newContext();
  await other.request.post('http://localhost:5174/api/v1/auth/login', {
    headers: { Origin: 'http://localhost:5174' },
    data: {
      email: 'other@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  expect(
    (
      await other.request.get(
        `http://localhost:5174/api/v1/projects/${pid}/forks`,
      )
    ).status(),
  ).toBe(404);
  await other.close();
  const patch = (index: number, route: any, version = fork.version) =>
    page.request.patch(`/api/v1/forks/${fork.id}/routes/${index}`, {
      headers,
      data: { expectedVersion: version, route },
    });
  const routeB = structuredClone(fork.data.routes[1]);
  routeB.artifacts = [
    {
      id: randomUUID(),
      title: '可复用接口脚本',
      content: '来自另一条路线的真实试验成果说明',
    },
  ];
  let result = await patch(1, routeB);
  expect(result.ok()).toBeTruthy();
  fork = await result.json();
  const routeA = structuredClone(fork.data.routes[0]);
  routeA.experiments = [
    {
      id: randomUUID(),
      title: '测量响应延迟',
      ownerId: '',
      status: 'DONE',
      result: '',
    },
  ];
  expect((await patch(0, routeA)).status()).toBe(422);
  routeA.experiments[0].result =
    '固定设备与测试集，100次调用P95为180ms，来源：本地运行记录';
  routeA.actualHours = 9;
  routeA.actualCost = 0;
  routeA.outcome = '满足当前演示需求，设备更换时需要复测';
  const version = fork.version;
  result = await patch(0, routeA);
  expect(result.ok()).toBeTruthy();
  fork = await result.json();
  expect((await patch(0, routeA, version)).status()).toBe(409);
  await page.reload();
  await expect(page.locator('.fork-context .ant-card-head-title')).toHaveText(
    title,
  );
  await page
    .getByRole('combobox', { name: '选择项目分身', exact: true })
    .press('ArrowDown');
  await page
    .locator('.ant-select-item-option')
    .filter({ hasText: title })
    .click();
  await expect(
    page.getByText('已超出试验预算，请组织决策或调整预算'),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.screenshot({
    path: 'artifacts/browser/forks-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 980 });
  await page
    .getByRole('button', { name: '选择路线与合并成果', exact: true })
    .click();
  const decision = page.getByRole('dialog', {
    name: '选择路线与合并成果',
    exact: true,
  });
  await expect(decision.getByText('可决策', { exact: true })).toBeVisible();
  await decision
    .getByLabel('选择依据、放弃另一条路线的原因与重启条件', { exact: true })
    .fill('本地方案满足延迟要求且无调用成本；设备不足时再评估云端方案。');
  await decision.getByLabel('路线 B · 可复用接口脚本', { exact: true }).check();
  await decision
    .getByRole('button', { name: '确认决策并合并成果', exact: true })
    .click();
  await expect(decision).not.toBeVisible();
  await expect(page.getByText('已选择：路线 A', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '编辑路线 A', exact: true }),
  ).toBeDisabled();
  const final = await (
    await page.request.get(`/api/v1/projects/${pid}/forks`)
  ).json();
  fork = final.items.find((x: any) => x.id === fork.id);
  expect(fork.data.decision.documentIds).toHaveLength(2);
  expect((await patch(0, routeA)).status()).toBe(409);
  expect(
    (
      await page.request.post(`/api/v1/forks/${fork.id}/decide`, {
        headers,
        data: {
          expectedVersion: fork.version,
          selectedRoute: 0,
          reason: '重复提交不能再次创建任何成果文档',
          artifactIds: [],
        },
      })
    ).status(),
  ).toBe(409);
  const documents = await (
    await page.request.get(`/api/v1/projects/${pid}/documents`)
  ).json();
  expect(
    documents.some(
      (d: any) =>
        d.id === fork.data.decision.documentIds[0] &&
        d.title === '可复用接口脚本',
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: 'artifacts/browser/forks-decision.png',
    fullPage: true,
  });
  await page.getByRole('link', { name: '查看决策记录' }).click();
  await expect(page).toHaveURL(/view=documents/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByLabel('文档标题', { exact: true }),
  ).toHaveValue('项目分身决策 · ' + title);
  expect(pageErrors).toEqual([]);
});

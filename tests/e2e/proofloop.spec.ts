import { test, expect } from '@playwright/test';
const pid = '10000000-0000-4000-8000-000000000001',
  wid = '00000000-0000-4000-8000-000000000001';
test('ProofLoop登记证据、过期提示、补证任务和引用疑点展示（模型模拟）', async ({
  page,
}) => {
  await page.request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://localhost:5174' },
    data: {
      email: 'product@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const headers = { Origin: 'http://localhost:5174', 'X-CSRF-Token': me.csrf };
  const post = async (path: string, data: any) => {
    const r = await page.request.post('/api/v1' + path, { headers, data });
    expect(r.ok()).toBeTruthy();
    return r.json();
  };
  const competition = await post(`/projects/${pid}/competitions`, {
    name: 'ProofLoop专项-' + Date.now(),
  });
  const a = await post(`/projects/${pid}/documents`, {
    title: '论文结论-' + Date.now(),
    content: '在固定测试集上准确率为95%，采用同一套评估方法。',
    taskIds: [],
  });
  const b = await post(`/projects/${pid}/documents`, {
    title: '实验结果-' + Date.now(),
    content: '在固定测试集上准确率为89%，采用同一套评估方法。',
    taskIds: [],
  });
  await page.goto(
    `/student/?section=competitions&workspace=${wid}&project=${pid}`,
  );
  const card = page
    .locator('.ant-card')
    .filter({ has: page.getByText(competition.name, { exact: true }) });
  await card
    .getByRole('button', { name: 'ProofLoop 成果验证', exact: true })
    .click();
  const panel = page.getByRole('dialog', {
    name: 'ProofLoop · ' + competition.name,
    exact: true,
  });
  await panel
    .getByRole('button', { name: '登记成果主张', exact: true })
    .click();
  const editor = page.getByRole('dialog', {
    name: '主张与验证证据',
    exact: true,
  });
  await editor
    .getByLabel('需要证明的主张', { exact: true })
    .fill('在固定测试集上准确率达到95%');
  await editor
    .getByLabel('对应评分要求、指标口径或验证条件', { exact: true })
    .fill('有效性：固定测试集和同一评估方法');
  await editor.getByRole('combobox', { name: '证据文书', exact: true }).click();
  await page.getByTitle(a.title + ' · v1', { exact: true }).click();
  await editor
    .getByLabel('证据原文（逐字连续引用）', { exact: true })
    .fill('在固定测试集上准确率为95%');
  await editor.getByLabel('团队评估的重要度（1—5）', { exact: true }).fill('5');
  await editor.getByLabel('预计补证工时', { exact: true }).fill('4');
  await editor
    .getByRole('button', { name: '保存主张与证据', exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(
    panel.getByText('已关联 · 待人工核对', { exact: true }),
  ).toBeVisible();
  await panel
    .locator('.document-grid')
    .getByRole('button', { name: '人工核对', exact: true })
    .click();
  const review = page.getByRole('dialog', {
    name: '人工核对主张',
    exact: true,
  });
  await review
    .getByLabel('核对依据与适用范围（至少20字）', { exact: true })
    .fill(
      '已人工核对实验口径和原文，在指定测试集和当前模型版本内支持此项结论。',
    );
  await review
    .getByRole('button', { name: '记录署名核对', exact: true })
    .click();
  await expect(review).not.toBeVisible();
  await expect(panel.getByText('人工核对支持', { exact: true })).toBeVisible();
  const update = await page.request.patch(`/api/v1/documents/${a.id}`, {
    headers,
    data: {
      title: a.title,
      content: a.content + '\n补充实验条件。',
      taskIds: [],
      expectedVersion: 1,
    },
  });
  expect(update.ok()).toBeTruthy();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await card
    .getByRole('button', { name: 'ProofLoop 成果验证', exact: true })
    .click();
  await expect(panel.getByText('证据已过期', { exact: true })).toBeVisible();
  await expect(
    panel.getByText('下一步先补什么', { exact: true }),
  ).toBeVisible();
  await panel
    .locator('.document-grid')
    .getByRole('button', { name: '转为补证任务', exact: true })
    .click();
  const task = page.getByRole('dialog', {
    name: '将问题转为补证任务',
    exact: true,
  });
  for (const [label, name] of Object.entries({
    产品负责人: '林悦',
    研发负责人: '陈宇',
    产品评估人: '林悦',
    测试评估人: '苏宁',
    测试负责人: '苏宁',
  })) {
    const input = task.getByRole('combobox', { name: label, exact: true });
    await input.fill(name);
    await page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .getByText(name, { exact: true })
      .click();
    await expect(
      page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'),
    ).toHaveCount(0);
  }
  await task.getByRole('button', { name: '创建补证任务', exact: true }).click();
  await expect(task).not.toBeVisible();
  const taskLink = panel.locator('.document-grid').getByRole('link', {
    name: '查看补证任务',
    exact: true,
  });
  await expect(taskLink).toBeVisible();
  const linkedTaskId = new URL(
    'http://localhost' + (await taskLink.getAttribute('href')),
  ).searchParams.get('task');
  const linked = await (
    await page.request.get('/api/v1/tasks/' + linkedTaskId)
  ).json();
  expect(linked.data.description).toContain('准确率达到95%');
  const exporting = page.waitForResponse(
    (r) => r.url().endsWith('/proof/export') && r.status() === 200,
  );
  await panel
    .getByRole('button', { name: '生成交接证据包', exact: true })
    .click();
  const exported = await (await exporting).json();
  expect(exported.payload.unresolved).toHaveLength(1);
  expect(exported.payload.states[exported.payload.claims[0].id]).toBe(
    'OUTDATED',
  );
  const jsonDownload = page.waitForEvent('download');
  await panel
    .getByRole('button', { name: '下载JSON证据包', exact: true })
    .click();
  expect((await jsonDownload).suggestedFilename()).toMatch(/证据包\.json$/);
  const mdDownload = page.waitForEvent('download');
  await panel
    .getByRole('button', { name: '下载Markdown核对摘要', exact: true })
    .click();
  expect((await mdDownload).suggestedFilename()).toMatch(/核对摘要\.md$/);
  // Mock only the model report display; claims, evidence, version detection and task creation above use the real API.
  await page.route(
    `**/api/v1/competitions/${competition.id}/proof`,
    async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.data.checked = {
        at: new Date().toISOString(),
        model: '模拟模型',
        documentVersions: { [a.id]: 2, [b.id]: 1 },
      };
      data.checkOutdated = false;
      data.data.findings = [
        {
          id: crypto.randomUUID(),
          reason: '模拟检查：同一指标在两份文书中分别为95%和89%，需要核对。',
          suggestion: '核对同一测试集上的实验版本，并补充复测记录。',
          sources: [
            { documentId: a.id, quote: '准确率为95%' },
            { documentId: b.id, quote: '准确率为89%' },
          ],
        },
      ];
      await route.fulfill({ json: data });
    },
  );
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await card
    .getByRole('button', { name: 'ProofLoop 成果验证', exact: true })
    .click();
  await expect(panel.getByText(/模拟检查：同一指标/)).toBeVisible();
  await expect(panel.getByText('准确率为89%', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'artifacts/browser/proofloop.png',
    fullPage: false,
    animations: 'disabled',
  });
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await card
    .getByRole('button', { name: 'ProofLoop 成果验证', exact: true })
    .click();
  await expect(
    panel.getByRole('button', { name: '登记成果主张', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: 'artifacts/browser/proofloop-mobile.png',
    fullPage: false,
    animations: 'disabled',
  });
});

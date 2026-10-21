import { test, expect, type BrowserContext, type Page } from '@playwright/test';
const origin = 'http://localhost:5174';
const pid = '10000000-0000-4000-8000-000000000001';
for (const failure of [false, true])
  test(
    failure
      ? '测试失败关联缺陷、再次提测后完成交付'
      : '多角色正常交付闭环，刷新后保留结果',
    async ({ browser }) => {
      const contexts: BrowserContext[] = [],
        pages: Page[] = [],
        auth: any[] = [];
      try {
        for (const email of ['product', 'engineer', 'qa']) {
          const c = await browser.newContext({ baseURL: origin });
          await c.addInitScript(() =>
            Object.defineProperty(globalThis.crypto, 'randomUUID', {
              value: undefined,
              configurable: true,
            }),
          );
          contexts.push(c);
          const page = await c.newPage();
          pages.push(page);
          await page.goto('/enterprise/');
          await page.waitForLoadState('networkidle');
          await page
            .getByLabel('邮箱', { exact: true })
            .fill(email + '@coflow.local');
          await page
            .getByLabel('密码', { exact: true })
            .fill(process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!');
          await page
            .getByRole('button', { name: '登录工作空间', exact: true })
            .click();
          await expect(
            page.getByRole('heading', { name: '工作台', exact: true }),
          ).toBeVisible();
          await page.getByRole('button', { name: '进入需求协作' }).click();
          await expect(
            page
              .getByRole('navigation', { name: '项目导航' })
              .getByRole('button', { name: '需求与交付', exact: true }),
          ).toBeVisible();
          auth.push(await (await c.request.get('/api/v1/auth/me')).json());
        }
        async function create(
          title: string,
          type = 'REQUIREMENT',
          parentId?: string,
        ) {
          const response = await contexts[0].request.post(
            `/api/v1/projects/${pid}/tasks`,
            {
              headers: { Origin: origin, 'X-CSRF-Token': auth[0].csrf },
              data: {
                title,
                background: '浏览器验证背景',
                goal: '验证交付闭环',
                description: '真实 PostgreSQL 持久化需求',
                criteria: ['功能可用'],
                priority: 'P1',
                productId: auth[0].user.id,
                engineerId: auth[1].user.id,
                productReviewerId: auth[0].user.id,
                qaReviewerId: auth[2].user.id,
                testerId: auth[2].user.id,
                type,
                ...(parentId
                  ? { parentId, parentRound: 1, severity: 'MAJOR' }
                  : {}),
              },
            },
          );
          expect(response.ok(), await response.text()).toBeTruthy();
          return response.json();
        }
        async function action(
          idx: number,
          id: string,
          label: string,
          fields: Record<string, string> = {},
        ) {
          const page = pages[idx];
          await page.goto('/?task=' + id);
          const drawer = page.locator('.task-detail-drawer .ant-drawer-body');
          const target = drawer.getByRole('button', {
            name: label,
            exact: true,
          });
          if (!(await target.isVisible()))
            await drawer.locator('.action-bar summary').click();
          await drawer
            .getByRole('button', { name: label, exact: true })
            .click();
          const dialog = page.locator('.ant-modal-content').last();
          for (const [k, v] of Object.entries(fields))
            await dialog.getByLabel(k, { exact: true }).fill(v);
          if (label === '验收关闭') await dialog.getByRole('checkbox').check();
          await dialog
            .getByRole('button', { name: '确认' + label, exact: true })
            .click();
          await expect(dialog).not.toBeVisible();
        }
        const t = await create('浏览器交付 ' + Date.now());
        await action(0, t.id, '提交需求');
        await action(1, t.id, '提交方案', {
          方案正文: '可复现的实现方案',
          影响范围: 'API / Web',
          '预计工作量（人日）': '2',
          风险说明: '无',
          预计开始日期: '2026-10-16',
          预计结束日期: '2026-10-17',
        });
        await action(0, t.id, '评估通过');
        await pages[1].goto('/?task=' + t.id);
        await expect(
          pages[1].getByRole('button', { name: '开始开发', exact: true }),
        ).toHaveCount(0);
        await action(2, t.id, '评估通过');
        await action(1, t.id, '开始开发');
        const dev = {
          开发说明: '实现完成',
          自测结果: '全部通过',
          交付版本: 'demo-1.0',
          环境地址或说明: '本地测试环境',
          已知问题: '无',
        };
        await action(1, t.id, '开发完成并提测', dev);
        await action(2, t.id, '开始测试', { 测试环境: '本地测试' });
        if (failure) {
          const bug = await create('关联回归缺陷', 'BUG', t.id);
          await action(2, t.id, '测试不通过', {
            失败原因: '界面显示异常',
            测试执行记录: '复现问题',
            部署验证说明: '环境正常',
            '关联缺陷 ID（逗号分隔）': bug.id,
          });
          await action(1, t.id, '开发完成并提测', dev);
          await action(2, t.id, '开始测试', { 测试环境: '第二轮回归环境' });
        }
        await action(2, t.id, '测试通过', {
          测试执行记录: '全部验收项通过',
          部署验证说明: '环境正常',
        });
        await action(0, t.id, '验收关闭');
        await pages[0].reload();
        await expect(
          pages[0]
            .locator('.detail-heading')
            .getByText('已关闭', { exact: true }),
        ).toBeVisible();
        const result = await (
          await contexts[0].request.get('/api/v1/tasks/' + t.id)
        ).json();
        expect(result.status).toBe('CLOSED');
        expect(result.data.tests).toHaveLength(failure ? 2 : 1);
        await pages[0].screenshot({
          path: `artifacts/browser/${failure ? 'return-flow' : 'normal-flow'}.png`,
          fullPage: false,
          animations: 'disabled',
        });
      } finally {
        for (const c of contexts) await c.close();
      }
    },
  );

test('新建需求表单、看板、中文品牌与窄屏导航', async ({ page }) => {
  await page.goto('/enterprise/');
  await expect(page.locator('.brand').first()).toContainText('汇流');
  await page.getByLabel('邮箱', { exact: true }).fill('product@coflow.local');
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await page.getByRole('button', { name: '进入需求协作' }).click();
  await page.goto('/?app=work&project=' + pid + '&view=tasks');
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const form = page.locator('.ant-modal-content');
  await expect(
    form.getByRole('heading', { name: '创建需求', exact: true }),
  ).toBeVisible();
  await expect(form.getByLabel('背景', { exact: true })).not.toBeVisible();
  await page.screenshot({
    path: 'artifacts/browser/requirement-create.png',
    fullPage: false,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'artifacts/browser/requirement-create-mobile.png',
    fullPage: false,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 980 });
  await form.getByRole('button', { name: '完善更多信息' }).click();
  const title = '界面创建 ' + Date.now();
  await form.getByLabel('需求标题', { exact: true }).fill(title);
  await form.getByLabel('背景', { exact: true }).fill('测试背景');
  await form.getByLabel('目标', { exact: true }).fill('测试目标');
  await form
    .getByLabel('需求描述（Markdown）', { exact: true })
    .fill('创建草稿测试');
  await form
    .getByLabel('验收标准（每行一项）', { exact: true })
    .fill('创建成功并可刷新');
  await form.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(form).not.toBeVisible();
  const created = await (
    await page.request.get(
      `/api/v1/projects/${pid}/tasks?q=${encodeURIComponent(title)}`,
    )
  ).json();
  const task = created.items.find((t: any) => t.data.title === title);
  expect(task).toBeTruthy();
  await page.goto('/?task=' + task.id);
  await page.getByRole('button', { name: '编辑草稿', exact: true }).click();
  await form.getByRole('button', { name: '完善更多信息' }).click();
  await expect(form.getByLabel('需求标题', { exact: true })).toHaveValue(title);
  await expect(form.getByLabel('目标', { exact: true })).toHaveValue(
    '测试目标',
  );
  await form.getByLabel('目标', { exact: true }).fill('编辑后保留完整需求内容');
  await form.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.locator('.requirement-article')).toContainText(
    '编辑后保留完整需求内容',
  );
  const persisted = await (
    await page.request.get('/api/v1/tasks/' + task.id)
  ).json();
  expect(persisted.data.background).toBe('测试背景');
  expect(persisted.data.goal).toBe('编辑后保留完整需求内容');
  await page.getByRole('button', { name: '修改优先级', exact: true }).click();
  await page.locator('.property-popover .ant-select-selector').click();
  await page.getByText('P1 · 高', { exact: true }).click();
  await page
    .locator('.property-popover')
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '修改优先级', exact: true }),
  ).toContainText('P1');
  await page.getByRole('button', { name: '修改计划截止', exact: true }).click();
  await page.getByLabel('选择计划截止', { exact: true }).fill('2026-12-01');
  await page
    .locator('.property-popover')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '修改计划截止', exact: true }),
  ).toContainText('未设置');
  await page
    .getByRole('button', { name: '修改测试负责人', exact: true })
    .click();
  await page.locator('.property-popover .ant-select-selector').click();
  const choices = page.locator(
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  );
  await choices.getByText('陈宇', { exact: true }).click();
  await expect(page.getByLabel('负责人变更原因', { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: 'artifacts/browser/requirement-properties.png',
    animations: 'disabled',
  });
  await page
    .locator('.property-popover')
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '修改测试负责人', exact: true }),
  ).toContainText('陈宇');
  const changed = await (
    await page.request.get('/api/v1/tasks/' + task.id)
  ).json();
  expect(changed.data.priority).toBe('P1');
  expect(changed.data.history.at(-1).action).toBe('TRANSFER');
  await page.getByRole('button', { name: '选择状态操作', exact: true }).click();
  await page.screenshot({
    path: 'artifacts/browser/requirement-state-menu.png',
    animations: 'disabled',
  });
  await page
    .locator('.property-state-menu')
    .getByRole('button', { name: '提交需求', exact: true })
    .click();
  await page
    .locator('.ant-modal-content')
    .getByRole('button', { name: '确认提交需求', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '选择状态操作', exact: true }),
  ).toContainText('待出方案');
  await page.locator('.task-detail-drawer .ant-drawer-body').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: 'artifacts/browser/requirement-detail.png',
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'artifacts/browser/requirement-detail-mobile.png',
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.getByRole('button', { name: '返回需求列表', exact: true }).click();
  await page
    .getByRole('navigation', { name: '项目导航' })
    .getByRole('button', { name: '需求与交付', exact: true })
    .click();
  await page.getByRole('button', { name: '看板视图', exact: true }).click();
  await expect(page.locator('.board-column')).toHaveCount(10);
  await page.screenshot({
    path: 'artifacts/browser/board-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(
    page.locator('aside .brand, aside .project-brand'),
  ).toBeInViewport();
  await page.getByRole('button', { name: '关闭导航', exact: true }).click();
  await expect(
    page.locator('aside .brand, aside .project-brand'),
  ).not.toBeInViewport();
  await page.screenshot({
    path: 'artifacts/browser/board-mobile.png',
    fullPage: true,
  });
});

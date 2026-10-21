import { test, expect } from '@playwright/test';
test.use({ actionTimeout: 15000 });
const origin = 'http://localhost:5174';
for (const edition of ['enterprise', 'student']) {
  test(
    edition + '需求易用性：排序搜索、速览处理、保存视图及手机布局',
    async ({ page }) => {
      const email = 'usability-' + edition + '-' + Date.now() + '@example.com';
      const password = 'Usability-test-2026!';
      const reg = await page.request.post('/api/v1/auth/register', {
        headers: { Origin: origin },
        data: {
          kind: 'creator',
          name: '需求处理人',
          email,
          password,
          teamName: '需求易用性团队',
        },
      });
      expect(reg.status(), await reg.text()).toBe(201);
      const team = await reg.json();
      const login = await page.request.post('/api/v1/auth/login', {
        headers: { Origin: origin },
        data: { email, password },
      });
      const session = await login.json();
      const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
      async function post(path: string, data: any) {
        const response = await page.request.post('/api/v1' + path, {
          headers,
          data,
        });
        expect(response.ok(), await response.text()).toBeTruthy();
        return response.json();
      }
      const project = await post(
        '/workspaces/' + team.workspaceId + '/projects',
        { name: '需求日常工作', workflow: 'SIMPLE' },
      );
      await post('/projects/' + project.id + '/members', {
        userId: session.user.id,
        roles: ['PRODUCT', 'ENGINEER', 'QA'],
      });
      const tasks: any[] = [];
      for (let index = 0; index < 23; index++)
        tasks.push(
          await post('/projects/' + project.id + '/tasks', {
            title:
              index === 22
                ? '正文引用 CF-001 的其他需求'
                : '交付需求 ' + (index + 1),
            description: '可操作的真实需求说明',
            goal: '减少日常处理步骤',
            criteria: ['交付内容可以验证'],
            productId: session.user.id,
            engineerId: session.user.id,
            priority: index === 0 ? 'P0' : 'P2',
            ...(index === 22
              ? {}
              : {
                  dueAt:
                    '2026-10-' +
                    String(index + 1).padStart(2, '0') +
                    'T00:00:00.000Z',
                }),
            submit: true,
          }),
        );
      const base =
        '/' + edition + '/?app=work&view=tasks&project=' + project.id;
      for (const sort of ['due', 'priority', 'updated']) {
        const response = await page.request.get(
          '/api/v1/projects/' +
            project.id +
            '/task-summaries?scope=all&sort=' +
            sort +
            '&pageSize=100',
        );
        expect(response.status()).toBe(200);
        const list = (await response.json()).items;
        expect(list).toHaveLength(23);
        if (sort === 'due') {
          expect(list[0].id).toBe(tasks[0].id);
          expect(list.at(-1).id).toBe(tasks[22].id);
        }
        if (sort === 'priority') expect(list[0].id).toBe(tasks[0].id);
      }
      expect(
        (
          await page.request.get(
            '/api/v1/projects/' + project.id + '/task-summaries?sort=bad',
          )
        ).status(),
      ).toBe(422);
      await page.goto(base + '&sort=due&page=2');
      await expect(page.locator('tbody tr[data-task-id]')).toHaveCount(3);
      await expect(
        page.locator('.ant-select[aria-label="需求排序"]'),
      ).toContainText('截止时间优先');
      const row = page.locator('tbody tr[data-task-id]').first();
      const rowId = await row.getAttribute('data-task-id');
      await row.locator('td').nth(1).click();
      const preview = page.getByRole('complementary', { name: '需求速览' });
      await expect(preview).toContainText('交付内容可以验证');
      await preview
        .getByRole('button', { name: '下一条', exact: true })
        .click();
      await expect(preview).toContainText('本页 2 / 3');
      await preview
        .getByRole('button', { name: '上一条', exact: true })
        .click();
      await page.evaluate(() => window.scrollTo(0, 220));
      const scroll = await page.evaluate(() => window.scrollY);
      await preview
        .getByRole('button', { name: '打开完整需求详情', exact: true })
        .click();
      await expect(page.locator('.task-detail-drawer')).toBeVisible();
      await page
        .getByRole('button', { name: '返回需求列表', exact: true })
        .click();
      await expect(page.locator('.task-detail-drawer')).toHaveCount(0);
      await expect(
        page.locator('tr[data-task-id="' + rowId + '"]'),
      ).toBeFocused();
      expect(
        Math.abs((await page.evaluate(() => window.scrollY)) - scroll),
      ).toBeLessThan(4);
      expect(new URL(page.url()).searchParams.get('page')).toBe('2');
      await preview
        .getByRole('button', { name: '关闭需求速览', exact: true })
        .click();
      await page.getByLabel('搜索需求', { exact: true }).fill('cf-001');
      await page.getByLabel('搜索需求', { exact: true }).press('Enter');
      await expect(page.locator('tbody tr[data-task-id]')).toHaveCount(1);
      await expect(page.locator('tbody')).toContainText('交付需求 1');
      await expect(page.getByLabel('当前需求条件')).toContainText(
        '搜索：cf-001',
      );
      await page
        .getByRole('button', { name: '保存当前视图', exact: true })
        .click();
      const save = page.getByRole('dialog', { name: '保存当前视图' });
      await save.getByRole('textbox').fill('编号与截止排序');
      await save.getByRole('button', { name: '保存视图', exact: true }).click();
      await expect(save).toHaveCount(0);
      await page.reload();
      await expect(
        page.locator('.ant-select[aria-label="需求排序"]'),
      ).toContainText('截止时间优先');
      await page
        .locator('tbody tr[data-task-id]')
        .first()
        .locator('td')
        .nth(1)
        .click();
      await preview
        .getByRole('button', { name: '开始处理', exact: true })
        .click();
      const start = page.getByRole('dialog', { name: '开始处理', exact: true });
      await expect(start).toContainText('交接预览');
      await start
        .getByRole('button', { name: '确认开始处理', exact: true })
        .click();
      await expect(start).toHaveCount(0);
      await expect(
        preview.getByRole('button', { name: '提交验收', exact: true }),
      ).toBeVisible();
      await preview
        .getByRole('button', { name: '更多操作', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: '修改优先级', exact: true })
        .click();
      const priority = page.getByRole('dialog', {
        name: '修改优先级',
        exact: true,
      });
      await priority.locator('.ant-select-selector').click();
      await page.getByTitle('P1', { exact: true }).click();
      await priority.getByRole('button', { name: '保存', exact: true }).click();
      await expect(priority).toHaveCount(0);
      await expect(preview.locator('.preview-tags')).toContainText('P1');
      await expect(page.locator('.ant-message-notice')).toHaveCount(0);
      await page.screenshot({
        path: 'artifacts/v3.4.0-' + edition + '-desktop.png',
        animations: 'disabled',
      });
      await preview
        .getByRole('button', { name: '关闭需求速览', exact: true })
        .click();
      await page.getByRole('button', { name: '清空筛选', exact: true }).click();
      await page.getByRole('combobox', { name: '使用常用视图' }).click();
      await page.getByTitle('编号与截止排序', { exact: true }).click();
      await expect(page.locator('tbody tr[data-task-id]')).toHaveCount(1);
      expect(new URL(page.url()).searchParams.get('sort')).toBe('due');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.project-mobile-cards')).toBeVisible();
      await page.getByRole('button', { name: '需求速览', exact: true }).click();
      const mobilePreview = page.getByRole('dialog', {
        name: '需求速览',
        exact: true,
      });
      await expect(mobilePreview).toContainText('交付内容可以验证');
      await mobilePreview
        .getByRole('button', { name: '提交验收', exact: true })
        .click();
      const handoff = page.getByRole('dialog', {
        name: '提交验收',
        exact: true,
      });
      await handoff
        .getByLabel('完成说明', { exact: true })
        .fill('已实现并自测，请核对验收条件');
      const current = await (
        await page.request.get('/api/v1/tasks/' + tasks[0].id)
      ).json();
      const concurrent = await page.request.patch(
        '/api/v1/tasks/' + tasks[0].id + '/properties',
        { headers, data: { expectedVersion: current.version, priority: 'P2' } },
      );
      expect(concurrent.ok(), await concurrent.text()).toBeTruthy();
      await handoff
        .getByRole('button', { name: '确认提交验收', exact: true })
        .click();
      await expect(
        handoff.getByRole('button', {
          name: '按最新状态重新提交',
          exact: true,
        }),
      ).toBeVisible();
      await expect(handoff.getByLabel('完成说明', { exact: true })).toHaveValue(
        '已实现并自测，请核对验收条件',
      );
      await handoff
        .getByRole('button', { name: '按最新状态重新提交', exact: true })
        .click();
      await expect(handoff).toHaveCount(0);
      await expect(
        mobilePreview.getByRole('button', { name: '验收关闭', exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await mobilePreview.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await expect(page.locator('.ant-message-notice')).toHaveCount(0);
      await page.screenshot({
        path: 'artifacts/v3.4.0-' + edition + '-mobile.png',
        animations: 'disabled',
      });
      await mobilePreview
        .getByRole('button', { name: '验收关闭', exact: true })
        .click();
      const acceptance = page.getByRole('dialog', {
        name: '验收关闭',
        exact: true,
      });
      await acceptance.getByRole('checkbox').check();
      const taskPath = '**/api/v1/tasks/' + tasks[0].id;
      await page.route(taskPath, (route) =>
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ message: '项目权限已撤销' }),
        }),
      );
      await page.route(taskPath + '/actions', (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ message: '项目权限已撤销' }),
        }),
      );
      await acceptance
        .getByRole('button', { name: '确认验收关闭', exact: true })
        .click();
      await expect(mobilePreview).toContainText(
        '需求速览读取失败或已无访问权限',
      );
      await mobilePreview.locator('.ant-drawer-close').click();
      await expect(mobilePreview).toHaveCount(0);
      await page.unroute(taskPath);
      await page.unroute(taskPath + '/actions');
      await page.request.patch('/api/v1/projects/' + project.id, {
        headers,
        data: { archived: true },
      });
      await page.reload();
      await page.getByRole('button', { name: '需求速览', exact: true }).click();
      await expect(
        page.getByRole('dialog', { name: '需求速览', exact: true }),
      ).toContainText('项目已归档');
      await expect(
        page.getByRole('button', { name: '验收关闭', exact: true }),
      ).toHaveCount(0);
    },
  );
}

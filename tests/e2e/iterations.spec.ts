import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const origin = 'http://localhost:5174';
for (const edition of ['enterprise', 'student'])
  test(
    edition + '迭代计划、里程碑、真实验收进度、延期说明与刷新恢复',
    async ({ page }) => {
      const email =
          'iteration-ui-' + edition + '-' + Date.now() + '@example.com',
        password = 'Iteration-ui-2026!';
      const reg = await page.request.post('/api/v1/auth/register', {
        headers: { Origin: origin },
        data: {
          kind: 'creator',
          email,
          password,
          name: '迭代负责人',
          teamName: '迭代团队',
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
        const r = await page.request.post('/api/v1' + path, { headers, data });
        expect(r.ok(), await r.text()).toBeTruthy();
        return r.status() === 204 ? null : r.json();
      }
      const p = await post('/workspaces/' + team.workspaceId + '/projects', {
        name: '迭代验证项目',
        workflow: 'SIMPLE',
      });
      const task = await post('/projects/' + p.id + '/tasks', {
        title: '真实验收需求',
        description: '交付一份规范',
        criteria: ['规范内容完整'],
        productId: session.user.id,
        engineerId: session.user.id,
        submit: true,
      });
      const draft = await post('/projects/' + p.id + '/tasks', {
        title: '延期需要跟进的需求',
        productId: session.user.id,
        engineerId: session.user.id,
      });
      for (let n = 0; n < 10; n++)
        await post('/projects/' + p.id + '/tasks', {
          title: '候选需求' + n,
          productId: session.user.id,
        });
      const base = '/' + edition + '/?app=work&view=iterations&project=' + p.id;
      await page.goto(base);
      await expect(
        page.getByRole('button', { name: '迭代与里程碑', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: '新建迭代', exact: true }).click();
      const create = page.getByRole('dialog', {
        name: '新建迭代',
        exact: true,
      });
      await create.getByLabel('迭代名称', { exact: true }).fill('第一轮交付');
      await create
        .getByLabel('迭代目标', { exact: true })
        .fill('把规范和需求推进到真实验收');
      await create.getByLabel('开始日期', { exact: true }).fill('2000-01-01');
      await create.getByLabel('结束日期', { exact: true }).fill('2099-12-31');
      await create
        .getByRole('button', { name: '保存计划', exact: true })
        .click();
      await expect(create).toHaveCount(0);
      await expect(page.locator('.iteration-detail')).toContainText(
        '尚无有效需求，不标记为完成',
      );
      const iteration = new URL(page.url()).searchParams.get('iteration')!;
      await page
        .getByRole('button', { name: '新增里程碑', exact: true })
        .click();
      const milestone = page.getByRole('dialog', {
        name: '新增里程碑',
        exact: true,
      });
      await milestone
        .getByLabel('里程碑名称', { exact: true })
        .fill('规范验收检查点');
      await milestone
        .getByLabel('交付检查点说明', { exact: true })
        .fill('验收规范和登记延期原因');
      await milestone
        .getByLabel('里程碑截止日期', { exact: true })
        .fill('2000-01-02');
      await milestone
        .getByRole('button', { name: '保存计划', exact: true })
        .click();
      await expect(milestone).toHaveCount(0);
      await page.getByRole('button', { name: '加入需求', exact: true }).click();
      const adding = page.getByRole('dialog', {
        name: '加入迭代需求',
        exact: true,
      });
      await expect(adding.locator('.ant-pagination-item-2')).toBeVisible();
      await adding.locator('.ant-pagination-item-2').click();
      await expect(adding.locator('.iteration-candidate')).toHaveCount(2);
      await adding.locator('.ant-select[aria-label="加入时的里程碑"]').click();
      await page
        .locator('.ant-select-dropdown:visible')
        .getByTitle('规范验收检查点', { exact: true })
        .click();
      for (const t of [task, draft]) {
        await adding
          .getByLabel('搜索可加入迭代的需求', { exact: true })
          .fill('CF-' + String(t.number).padStart(3, '0'));
        await adding
          .getByLabel('搜索可加入迭代的需求', { exact: true })
          .press('Enter');
        await adding
          .getByRole('checkbox', { name: new RegExp(t.title) })
          .check();
      }
      await adding
        .getByRole('button', { name: '加入所选需求（2）', exact: true })
        .click();
      await expect(adding).toHaveCount(0);
      await expect(page.locator('.iteration-detail')).toContainText(
        '已验收 0 / 有效需求 2',
      );
      const delayed = page
        .locator('.iteration-task')
        .filter({ hasText: '延期需要跟进的需求' });
      await expect(delayed).toContainText('计划延期');
      await delayed
        .getByRole('button', { name: '更新安排', exact: true })
        .click();
      const arrangement = page.getByRole('dialog', {
        name: '更新需求安排',
        exact: true,
      });
      await arrangement
        .getByLabel('延期或调整说明', { exact: true })
        .fill('依赖外部接口，周五复查');
      await arrangement
        .getByRole('button', { name: '保存计划', exact: true })
        .click();
      await expect(arrangement).toHaveCount(0);
      await expect(delayed).toContainText('依赖外部接口，周五复查');
      let current = await (
        await page.request.get('/api/v1/tasks/' + task.id)
      ).json();
      for (const [action, payload] of [
        ['START_WORK', {}],
        ['SUBMIT_ACCEPTANCE', { summary: '规范已交付' }],
        ['ACCEPT', { checks: [true] }],
      ] as const) {
        const r = await page.request.post(
          '/api/v1/tasks/' + task.id + '/actions',
          {
            headers: { ...headers, 'Idempotency-Key': randomUUID() },
            data: { action, expectedVersion: current.version, payload },
          },
        );
        expect(r.ok(), await r.text()).toBeTruthy();
        current = await r.json();
      }
      expect(current.status).toBe('CLOSED');
      await page.reload();
      await expect(page.locator('.iteration-detail')).toContainText(
        '已验收 1 / 有效需求 2',
      );
      await expect(page.locator('.iteration-detail')).toContainText('50%');
      await page.locator('.ant-select[aria-label="迭代需求筛选"]').click();
      await page
        .locator('.ant-select-dropdown:visible')
        .getByTitle('延期项', { exact: true })
        .click();
      await expect(page.locator('.iteration-task')).toHaveCount(1);
      await page.reload();
      expect(new URL(page.url()).searchParams.get('iterationFilter')).toBe(
        'overdue',
      );
      await expect(delayed).toBeVisible();
      await page.getByRole('button', { name: '编辑迭代', exact: true }).click();
      const edit = page.getByRole('dialog', { name: '编辑迭代', exact: true });
      await edit.getByLabel('结束日期', { exact: true }).fill('2100-01-01');
      await edit.getByRole('button', { name: '保存计划', exact: true }).click();
      await expect(edit).toContainText('调整迭代日期须填写排期调整原因');
      await expect(edit.getByLabel('结束日期', { exact: true })).toHaveValue(
        '2100-01-01',
      );
      await edit
        .getByLabel('排期调整原因', { exact: true })
        .fill('根据实际交付范围延长观察窗口');
      await edit.getByRole('button', { name: '保存计划', exact: true }).click();
      await expect(edit).toHaveCount(0);
      await expect(page.locator('.iteration-events')).toContainText(
        '根据实际交付范围延长观察窗口',
      );
      await page.locator('.iteration-detail').screenshot({
        path: 'artifacts/v3.8.0-' + edition + '-iteration.png',
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await delayed.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: 'artifacts/v3.8.0-' + edition + '-iteration-mobile.png',
        fullPage: false,
        animations: 'disabled',
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await delayed
        .getByRole('button', { name: '移出迭代', exact: true })
        .click();
      await page
        .getByRole('button', { name: '确认移出迭代', exact: true })
        .click();
      await expect(page.locator('.iteration-task')).toHaveCount(0);
      await page.setViewportSize({ width: 1440, height: 980 });
      const plan = await (
        await page.request.get(
          '/api/v1/projects/' + p.id + '/iterations/' + iteration,
        )
      ).json();
      expect(plan.progress.percent).toBe(100);
      const unchanged = await (
        await page.request.get('/api/v1/tasks/' + draft.id)
      ).json();
      expect(unchanged.status).toBe('DRAFT');
      expect(unchanged.version).toBe(draft.version);
      await page.goto('/' + edition + '/?app=work&task=' + task.id);
      await expect(page.getByText('迭代安排', { exact: true })).toBeVisible();
      await page.getByRole('link', { name: '第一轮交付', exact: true }).click();
      await expect(page.locator('.iteration-detail')).toContainText(
        '已验收 1 / 有效需求 1',
      );
      const archived = await page.request.patch('/api/v1/projects/' + p.id, {
        headers,
        data: { archived: true },
      });
      expect(archived.ok(), await archived.text()).toBeTruthy();
      await page.reload();
      await expect(page.locator('.iteration-detail')).toContainText(
        '项目已归档，迭代计划只读',
      );
      await expect(
        page.getByRole('button', { name: '加入需求', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: '新建迭代', exact: true }),
      ).toHaveCount(0);
    },
  );

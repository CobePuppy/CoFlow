import { test, expect, request } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
test.use({ actionTimeout: 15000 });

test('双版项目推进：行动闭环、聚焦筛选、独立改期与历史简报', async ({
  page,
}) => {
  const url = process.env.TEST_DATABASE_URL!;
  expect(new URL(url).pathname).toBe('/coflow_test');
  expect(url).not.toBe(process.env.DATABASE_URL);
  const db = new PrismaClient({ datasources: { db: { url } } });
  const origin = 'http://localhost:5174',
    password = 'Progress-browser-2026!';
  const second = await request.newContext({ baseURL: origin });
  async function register(client: any, name: string) {
    const email = randomUUID() + '@example.com';
    const reg = await client.post('/api/v1/auth/register', {
      headers: { Origin: origin },
      data: { kind: 'creator', name, email, password, teamName: name },
    });
    expect(reg.status()).toBe(201);
    const team = await reg.json();
    const login = await client.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { email, password },
    });
    return { ...(await login.json()), workspaceId: team.workspaceId };
  }
  try {
    const admin = await register(page.request, '推进审核人'),
      member = await register(second, '协作执行人');
    const headers = { Origin: origin, 'X-CSRF-Token': admin.csrf };
    const memberHeaders = { Origin: origin, 'X-CSRF-Token': member.csrf };
    async function post(path: string, data: any) {
      const r = await page.request.post('/api/v1' + path, { headers, data });
      expect(r.ok(), await r.text()).toBeTruthy();
      return r.json();
    }
    await db.workspaceMember.create({
      data: {
        workspaceId: admin.workspaceId,
        userId: member.user.id,
        role: 'MEMBER',
      },
    });
    await page.addInitScript(() => {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: undefined,
        configurable: true,
      });
    });
    for (const edition of ['enterprise', 'student']) {
      const p = await post('/workspaces/' + admin.workspaceId + '/projects', {
        name: 'V4.1团队行动-' + edition,
        workflow: 'SIMPLE',
      });
      await db.projectMember.create({
        data: { projectId: p.id, userId: member.user.id, roles: ['ENGINEER'] },
      });
      const task = await post('/projects/' + p.id + '/tasks', {
        title: '补齐交付说明-' + edition,
        description: '行动闭环验证',
        criteria: [],
        productId: admin.user.id,
        engineerId: member.user.id,
        testerId: admin.user.id,
        productReviewerId: admin.user.id,
        qaReviewerId: admin.user.id,
      });
      const root = '/projects/' + p.id;
      await page.route('**/api/v1' + root + '/assistant/run', (route) =>
        route.fulfill({
          json: {
            result: {
              summary: '优先完善验收资料',
              actions: [
                {
                  taskId: task.id,
                  priority: 'HIGH',
                  action: '整理可复核交付说明',
                  acceptance: '给出步骤及实际结果',
                  evidence: task.data.title,
                },
              ],
              questions: [],
            },
            fingerprint: route.request().postDataJSON().fingerprint,
            generatedAt: new Date().toISOString(),
            model: 'test-fixture',
          },
        }),
      );
      await page.setViewportSize({ width: 1440, height: 980 });
      await page.goto(
        '/' +
          edition +
          '/?app=work&workspace=' +
          admin.workspaceId +
          '&project=' +
          p.id +
          '&view=project-overview',
      );
      await page.getByRole('tab', { name: 'AI推进', exact: true }).click();
      const assistant = page.locator('.project-assistant'),
        panel = page.locator('.project-progress');
      await assistant
        .getByRole('button', { name: '生成推进计划', exact: true })
        .click();
      await assistant
        .getByRole('button', { name: '将全部建议转为行动', exact: true })
        .click();
      await page.getByRole('tab', { name: '行动与复盘', exact: true }).click();
      await expect(panel).toContainText('整理可复核交付说明');
      await panel
        .getByRole('tab', { name: '交付准备检查', exact: true })
        .click();
      await expect(panel).toContainText('验收标准');
      await expect(panel).toContainText('待补齐或核对');
      await panel.screenshot({
        path: 'artifacts/browser/v4.2-' + edition + '-readiness.png',
        animations: 'disabled',
      });
      await panel.getByRole('tab', { name: '推进检查点', exact: true }).click();
      await panel
        .getByRole('textbox', { name: '检查点说明', exact: true })
        .fill('认领前的真实基线');
      await panel
        .getByRole('button', { name: '记录当前检查点', exact: true })
        .click();
      await expect(panel).toContainText('与最近检查点相比暂无变化');
      await panel.getByRole('tab', { name: '行动跟进', exact: true }).click();
      async function modalAction(button: string, note: string) {
        await panel.getByRole('button', { name: button, exact: true }).click();
        const modal = page.getByRole('dialog', { name: button, exact: true });
        await modal
          .getByRole('textbox', { name: '成果或操作说明', exact: true })
          .fill(note);
        return modal;
      }
      let modal = await modalAction('认领行动', '先认领并核对交付要求');
      await modal
        .getByRole('textbox', { name: '行动截止日期', exact: true })
        .fill('2026-10-22');
      await modal
        .getByRole('button', { name: '确认操作', exact: true })
        .click();
      await expect(
        panel.getByRole('button', { name: '提交成果', exact: true }),
      ).toBeVisible();
      modal = await modalAction('调整截止日', '保留这份改期说明，等待团队核对');
      await modal
        .getByRole('textbox', { name: '行动截止日期', exact: true })
        .fill('2099-01-01');
      const openedAction = (
        await (await page.request.get('/api/v1' + root + '/progress')).json()
      ).actions[0];
      await post(root + '/actions/' + openedAction.id + '/change', {
        expectedVersion: openedAction.version,
        expectedTaskVersion: task.version,
        operation: 'RESCHEDULE',
        note: '模拟另一成员先更新日期',
        dueDate: '2098-01-01',
        requestKey: randomUUID(),
      });
      await modal
        .getByRole('button', { name: '确认操作', exact: true })
        .click();
      await expect(modal).toContainText('行动或需求已变化');
      await expect(
        modal.getByRole('textbox', { name: '成果或操作说明', exact: true }),
      ).toHaveValue('保留这份改期说明，等待团队核对');
      await modal
        .getByRole('button', { name: '核对最新行动，保留输入', exact: true })
        .click();
      await expect(modal).toContainText('输入已保留');
      await modal
        .getByRole('button', { name: '确认操作', exact: true })
        .click();
      await expect(panel).toContainText('2099-01-01');
      await expect(
        panel.getByRole('button', { name: '提交成果', exact: true }),
      ).toBeVisible();
      modal = await modalAction('提交成果', '已提交交付说明草稿');
      await modal
        .getByRole('button', { name: '确认操作', exact: true })
        .click();
      await expect(
        panel.getByRole('button', { name: '确认完成', exact: true }),
      ).toBeDisabled();
      modal = await modalAction('分配行动', '转交执行人补充并重新提交');
      await modal
        .getByRole('combobox', { name: '行动负责人', exact: true })
        .press('ArrowDown');
      await page.getByText('协作执行人', { exact: true }).last().click();
      await modal
        .getByRole('button', { name: '确认操作', exact: true })
        .click();
      await expect(panel).toContainText('负责人：协作执行人');
      const progress = await (
        await page.request.get('/api/v1' + root + '/progress')
      ).json();
      const a = progress.actions[0];
      const submitted = await second.post(
        '/api/v1' + root + '/actions/' + a.id + '/change',
        {
          headers: memberHeaders,
          data: {
            expectedVersion: a.version,
            expectedTaskVersion: task.version,
            operation: 'SUBMIT',
            note: '交付说明与核对结果已补齐',
            requestKey: randomUUID(),
          },
        },
      );
      expect(submitted.ok(), await submitted.text()).toBeTruthy();
      await panel.getByRole('tab', { name: '推进检查点', exact: true }).click();
      await panel
        .getByRole('button', { name: '刷新进展', exact: true })
        .click();
      await expect(panel).toContainText('待认领 → 待确认');
      await panel.getByRole('tab', { name: '行动跟进', exact: true }).click();
      modal = await modalAction('确认完成', '对照验收要求核对结果，确认完成');
      await modal
        .getByRole('button', { name: '确认操作', exact: true })
        .click();
      await expect(panel).toContainText('已确认完成');
      await panel.getByRole('button', { name: '我的 0', exact: true }).click();
      await expect(panel).toContainText('当前筛选无匹配行动');
      await panel
        .getByRole('button', { name: '重置筛选', exact: true })
        .click();
      await panel
        .getByRole('searchbox', { name: '搜索项目行动', exact: true })
        .fill('不会匹配的字词');
      await panel
        .getByRole('button', { name: '搜索行动', exact: true })
        .click();
      await expect(panel).toContainText('当前筛选无匹配行动');
      await panel
        .getByRole('button', { name: '重置筛选', exact: true })
        .click();
      await panel.screenshot({
        path: 'artifacts/browser/v4.2-' + edition + '-actions.png',
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await panel.screenshot({
        path: 'artifacts/browser/v4.2-' + edition + '-actions-mobile.png',
        animations: 'disabled',
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await panel.getByRole('tab', { name: '推进检查点', exact: true }).click();
      await expect(panel).toContainText('待认领 → 已确认完成');
      await panel
        .getByRole('textbox', { name: '检查点说明', exact: true })
        .fill('确认完成后的新记录');
      await panel
        .getByRole('button', { name: '记录当前检查点', exact: true })
        .click();
      await expect(panel).toContainText('与最近检查点相比暂无变化');
      await panel
        .getByRole('combobox', { name: '对比检查点', exact: true })
        .press('ArrowDown');
      await page
        .locator('.ant-select-item-option')
        .filter({ hasText: '认领前的真实基线' })
        .click();
      await expect(panel).toContainText('待认领 → 已确认完成');
      await expect(panel).toContainText('对比基线：认领前的真实基线');
      const briefDownload = page.waitForEvent('download');
      await panel
        .getByRole('button', { name: '导出推进简报', exact: true })
        .click();
      const brief = await briefDownload;
      const briefText = await readFile((await brief.path())!, 'utf8');
      expect(briefText).toContain('认领前的真实基线');
      expect(briefText).toContain('全项目行动（1项');
      expect(briefText).toContain('协作执行人');
      await panel.screenshot({
        path: 'artifacts/browser/v4.2-' + edition + '-history-mobile.png',
        animations: 'disabled',
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await panel.screenshot({
        path: 'artifacts/browser/v4.2-' + edition + '-checkpoint-mobile.png',
        animations: 'disabled',
      });
    }
  } finally {
    await second.dispose();
    await db.$disconnect();
  }
});

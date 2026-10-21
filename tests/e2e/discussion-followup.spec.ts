import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
for (const edition of ['enterprise', 'student'])
  test(
    edition + '澄清指派、跨需求列表、通知定位、转交与手机',
    async ({ page, browser }) => {
      const origin = 'http://localhost:5174',
        url = process.env.TEST_DATABASE_URL;
      if (
        !url ||
        new URL(url).pathname !== '/coflow_test' ||
        url === process.env.DATABASE_URL
      )
        throw Error('仅隔离测试库');
      const db = new PrismaClient({ datasources: { db: { url } } }),
        peer = await browser.newContext({ baseURL: origin });
      async function register(request: any, name: string) {
        const email = 'follow-' + randomUUID() + '@example.com',
          password = 'Followup-2026!';
        const reg = await request.post('/api/v1/auth/register', {
          headers: { Origin: origin },
          data: {
            kind: 'creator',
            email,
            password,
            name,
            teamName: '跟进团队',
          },
        });
        expect(reg.status()).toBe(201);
        const team = await reg.json();
        const session = await (
          await request.post('/api/v1/auth/login', {
            headers: { Origin: origin },
            data: { email, password },
          })
        ).json();
        return { ...session, workspaceId: team.workspaceId };
      }
      try {
        const a = await register(page.request, '提出人'),
          b = await register(peer.request, '跟进人');
        const headers = { Origin: origin, 'X-CSRF-Token': a.csrf };
        const p = await (
          await page.request.post(
            `/api/v1/workspaces/${a.workspaceId}/projects`,
            { headers, data: { name: '澄清项目', workflow: 'SIMPLE' } },
          )
        ).json();
        await db.workspaceMember.create({
          data: { workspaceId: a.workspaceId, userId: b.user.id },
        });
        await db.projectMember.create({
          data: { projectId: p.id, userId: b.user.id, roles: ['ENGINEER'] },
        });
        const task = await (
          await page.request.post(`/api/v1/projects/${p.id}/tasks`, {
            headers,
            data: {
              title: '验收范围待确认',
              productId: a.user.id,
              engineerId: b.user.id,
            },
          })
        ).json();
        await page.goto('/' + edition + '/?app=work&task=' + task.id);
        await page.getByRole('tab', { name: '动态记录', exact: true }).click();
        const panel = page.getByRole('region', {
          name: '讨论与决策',
          exact: true,
        });
        await panel.locator('.ant-select[aria-label="讨论类型"]').click();
        await page
          .locator('.ant-select-dropdown:visible')
          .getByTitle('待澄清问题', { exact: true })
          .click();
        await panel.locator('.ant-select[aria-label="新问题跟进人"]').click();
        await page
          .locator('.ant-select-dropdown:visible')
          .getByTitle('跟进人', { exact: true })
          .click();
        await panel
          .getByLabel('新问题截止日期', { exact: true })
          .fill('2000-01-01');
        await panel
          .getByLabel('讨论内容', { exact: true })
          .fill('请确认验收需要哪些材料');
        await panel
          .getByRole('button', { name: '发表评论', exact: true })
          .click();
        await expect(panel).toContainText('跟进人：跟进人');
        const pp = await peer.newPage();
        await pp.goto(
          '/' +
            edition +
            '/?app=work&workspace=' +
            a.workspaceId +
            '&view=discussions',
        );
        const center = pp.getByRole('region', {
          name: '澄清事项中心',
          exact: true,
        });
        await expect(center).toContainText('请确认验收需要哪些材料');
        await expect(center).toContainText('逾期');
        await center
          .getByRole('button', { name: '查看并跟进', exact: true })
          .click();
        const question = pp.getByRole('region', {
          name: '讨论与决策',
          exact: true,
        });
        await expect(
          pp.getByRole('tab', { name: '动态记录', exact: true }),
        ).toHaveAttribute('aria-selected', 'true');
        const id = new URL(pp.url()).searchParams.get('discussion')!;
        await expect(pp.locator('#discussion-' + id)).toBeFocused();
        await pp.reload();
        await expect(pp.locator('#discussion-' + id)).toBeVisible();
        await question
          .getByRole('button', { name: '调整跟进安排', exact: true })
          .click();
        const modal = pp.getByRole('dialog', {
          name: '调整跟进安排',
          exact: true,
        });
        await modal.locator('.ant-select[aria-label="调整问题跟进人"]').click();
        await pp
          .locator('.ant-select-dropdown:visible')
          .getByTitle('提出人', { exact: true })
          .click();
        await modal.getByLabel('截止日期', { exact: true }).fill('2099-01-01');
        await modal
          .getByLabel('调整原因', { exact: true })
          .fill('由产品补充最终验收材料');
        await modal
          .getByRole('button', { name: '保存跟进安排', exact: true })
          .click();
        await expect(modal).toHaveCount(0);
        await expect(question).toContainText('由产品补充最终验收材料');
        await page.goto(
          '/' +
            edition +
            '/?app=work&workspace=' +
            a.workspaceId +
            '&view=notifications',
        );
        await page
          .getByRole('button', { name: /调整了澄清问题的跟进安排/ })
          .click();
        await expect(page).toHaveURL(new RegExp('discussion=' + id));
        await expect(page.locator('#discussion-' + id)).toBeFocused();
        await page
          .getByRole('region', { name: '讨论与决策' })
          .getByRole('button', { name: '标记解决', exact: true })
          .click();
        await page.getByLabel('结论或重新打开原因').fill('验收材料范围已对齐');
        await page
          .getByRole('button', { name: '保存问题状态', exact: true })
          .click();
        await expect(page.locator('#discussion-' + id)).toContainText(
          '问题已解决',
        );
        await pp
          .getByRole('button', { name: '返回需求列表', exact: true })
          .click();
        await pp.getByRole('button', { name: '澄清事项', exact: true }).click();
        await expect(center).toContainText('暂无符合条件');
        await page.setViewportSize({ width: 390, height: 844 });
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBeTruthy();
        await page.screenshot({
          path: 'artifacts/followup-' + edition + '-mobile.png',
        });
      } finally {
        await peer.close();
        await db.$disconnect();
      }
    },
  );

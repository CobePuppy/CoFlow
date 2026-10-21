import { test, expect } from '@playwright/test';
test.use({ actionTimeout: 15000 });
for (const edition of ['enterprise', 'student'])
  test(
    edition + '讨论提问、回复、解决、重开、决策与手机布局',
    async ({ page }) => {
      const origin = 'http://localhost:5174',
        email = 'discussion-' + edition + '-' + Date.now() + '@example.com',
        password = 'Discussion-2026!';
      const reg = await page.request.post('/api/v1/auth/register', {
        headers: { Origin: origin },
        data: {
          kind: 'creator',
          email,
          password,
          name: '讨论负责人',
          teamName: '讨论团队',
        },
      });
      expect(reg.status()).toBe(201);
      const team = await reg.json();
      const login = await page.request.post('/api/v1/auth/login', {
        headers: { Origin: origin },
        data: { email, password },
      });
      const session = await login.json();
      const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
      const p = await (
        await page.request.post(
          `/api/v1/workspaces/${team.workspaceId}/projects`,
          { headers, data: { name: '讨论项目', workflow: 'SIMPLE' } },
        )
      ).json();
      const task = await (
        await page.request.post(`/api/v1/projects/${p.id}/tasks`, {
          headers,
          data: {
            title: '讨论需求',
            productId: session.user.id,
            engineerId: session.user.id,
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
      await panel
        .getByLabel('讨论内容', { exact: true })
        .fill('是否需要分阶段验收？');
      await panel
        .getByRole('button', { name: '发表评论', exact: true })
        .click();
      await expect(panel.locator('.history-card')).toHaveCount(1);
      await panel
        .getByRole('button', { name: '回复此讨论', exact: true })
        .click();
      await panel
        .getByLabel('讨论内容', { exact: true })
        .fill('先验收开发规范');
      await panel
        .getByRole('button', { name: '保存回复', exact: true })
        .click();
      await expect(panel.locator('blockquote')).toContainText('先验收开发规范');
      await panel
        .getByRole('button', { name: '标记解决', exact: true })
        .click();
      await page.getByLabel('结论或重新打开原因').fill('按两个阶段验收');
      await page
        .getByRole('button', { name: '保存问题状态', exact: true })
        .click();
      await expect(
        panel.getByRole('button', { name: '重新打开问题', exact: true }),
      ).toBeVisible();
      await panel
        .getByRole('button', { name: '重新打开问题', exact: true })
        .click();
      await page.getByLabel('结论或重新打开原因').fill('需补充第二阶段范围');
      await page
        .getByRole('button', { name: '保存问题状态', exact: true })
        .click();
      await expect(
        panel.getByRole('button', { name: '标记解决', exact: true }),
      ).toBeVisible();
      await panel.locator('.ant-select[aria-label="讨论类型"]').click();
      await page
        .locator('.ant-select-dropdown:visible')
        .getByTitle('决策记录', { exact: true })
        .click();
      await panel
        .getByLabel('讨论内容', { exact: true })
        .fill('采用分阶段验收');
      await panel
        .getByRole('button', { name: '发表评论', exact: true })
        .click();
      await expect(panel.locator('.history-card')).toHaveCount(2);
      await panel
        .getByLabel('搜索讨论', { exact: true })
        .fill('先验收开发规范');
      await expect(panel.locator('.history-card')).toHaveCount(1);
      await page.setViewportSize({ width: 390, height: 844 });
      await panel.getByLabel('搜索讨论', { exact: true }).fill('');
      await panel
        .getByRole('heading', { name: '讨论与决策' })
        .scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBeTruthy();
      await page.screenshot({
        path: 'artifacts/discussions-' + edition + '-mobile.png',
      });
    },
  );

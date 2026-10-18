import { test, expect } from '@playwright/test';
import { firstStepSections } from '../../packages/contracts/firststep.js';
const pid = '10000000-0000-4000-8000-000000000001',
  wid = '00000000-0000-4000-8000-000000000001';
test('个人设置持久化及FirstStepAgent失败恢复、六份成果保存（模拟模型）', async ({
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
  const key = 'sk-simulated-browser-only-key';
  await page.goto('/student/?section=settings');
  await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
  await page.locator('input[aria-label="DeepSeek API Key"]').fill(key);
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(
    page.getByText('已保存Key：••••-key', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
  await expect(
    page.locator('input[aria-label="DeepSeek API Key"]'),
  ).toHaveValue('');
  await expect(
    page.getByText('已保存Key：••••-key', { exact: true }),
  ).toBeVisible();
  await page.route('**/api/v1/settings/ai/verify', async (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({ json: { ok: true, model: 'deepseek-flash' } });
  });
  await page
    .getByRole('button', { name: '验证已保存配置', exact: true })
    .click();
  await expect(
    page.getByText('已保存的Key与模型可用', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'artifacts/browser/personal-settings.png',
    fullPage: true,
    animations: 'disabled',
  });
  const created = await page.request.post(
    `/api/v1/projects/${pid}/competitions`,
    {
      headers: { Origin: 'http://localhost:5174', 'X-CSRF-Token': me.csrf },
      data: {
        name: 'FirstStep竞赛-' + Date.now(),
        notes: '依据赛题制作原型和答辩材料',
      },
    },
  );
  expect(created.ok()).toBeTruthy();
  const competition = await created.json();
  await page.goto(
    `/student/?section=competitions&workspace=${wid}&project=${pid}`,
  );
  const card = page
    .locator('.ant-card')
    .filter({ has: page.getByText(competition.name, { exact: true }) });
  await card
    .getByRole('button', { name: 'FirstStepAgent 分析竞赛', exact: true })
    .click();
  const panel = page.getByRole('dialog', {
    name: 'FirstStepAgent · 竞赛启动助手',
    exact: true,
  });
  await expect(
    panel.locator('input[aria-label="DeepSeek API Key"]'),
  ).toHaveCount(0);
  const generate = panel.getByRole('button', {
    name: '使用我的Key生成6份成果',
    exact: true,
  });
  await expect(generate).toBeDisabled();
  await panel
    .getByLabel('赛题原文、评分与交付要求（必填）', { exact: true })
    .fill(
      '为校园创新项目设计可展示和验证的原型，提交需求分析、实现说明、测试证据和答辩演示。需要合理的技术选型、团队分工与明确的验收标准。',
    );
  await panel
    .getByRole('button', { name: '预览提示词（无需Key）', exact: true })
    .click();
  await panel.getByText('查看实际发送的提示词与资料', { exact: true }).click();
  await expect(panel.locator('pre')).toContainText('FirstStepAgent');
  await expect(panel.locator('pre')).toContainText('slides');

  await panel.getByRole('checkbox').check();
  let calls = 0;
  const bundle = {
    ...Object.fromEntries(
      Object.keys(firstStepSections).map((k) => [
        k,
        '## ' +
          firstStepSections[k as keyof typeof firstStepSections] +
          '\n' +
          '模拟模型输出，用于验证界面与保存流程，真实分析需要用户Key。'.repeat(
            3,
          ),
      ]),
    ),
    questions: ['待确认官方评分标准'],
  };
  await page.route(
    `**/api/v1/competitions/${competition.id}/firststep/run`,
    async (route) => {
      const input = route.request().postDataJSON();
      expect(input.apiKey).toBeUndefined();
      expect(input.consent).toBe(true);
      expect(route.request().url()).not.toContain(key);
      calls++;
      if (calls === 1)
        await route.fulfill({
          status: 422,
          json: {
            message:
              'DeepSeek Key无效或无权限，请到平台检查；CoFlow登录状态未受影响',
          },
        });
      else
        await route.fulfill({
          json: {
            bundle,
            model: 'deepseek-flash',
            competitionVersion: competition.version,
            generatedAt: new Date().toISOString(),
            usage: { promptTokens: 100, completionTokens: 500 },
          },
        });
    },
  );
  await generate.click();
  await expect(panel.getByText(/DeepSeek Key无效或无权限/)).toBeVisible();
  expect((await page.request.get('/api/v1/auth/me')).ok()).toBeTruthy();
  await generate.click();
  await expect(
    panel.getByRole('region', { name: 'FirstStepAgent成果' }),
  ).toBeVisible();
  await expect(
    panel.getByRole('tab', { name: 'PPT生成提示词', exact: true }),
  ).toBeVisible();
  await panel.getByRole('tab', { name: 'PPT生成提示词', exact: true }).click();
  await expect(panel.getByRole('tabpanel')).toContainText('模拟模型输出');
  expect(
    await page.evaluate(
      (value) =>
        JSON.stringify({ ...localStorage }) +
        JSON.stringify({ ...sessionStorage }),
      key,
    ),
  ).not.toContain(key);
  const downloading = page.waitForEvent('download');
  await panel
    .getByRole('button', { name: '下载全部Markdown', exact: true })
    .click();
  expect((await downloading).suggestedFilename()).toMatch(/\.md$/);
  await panel
    .getByRole('button', { name: '保存6份草稿到文书中心', exact: true })
    .click();
  await expect(
    panel.getByRole('link').filter({ hasText: ' · FirstStep · ' }),
  ).toHaveCount(6);
  await expect(
    panel.getByRole('button', { name: '保存6份草稿到文书中心', exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: 'artifacts/browser/firststep-results.png',
    fullPage: true,
    animations: 'disabled',
  });
  await panel
    .getByRole('link')
    .filter({ hasText: ' · FirstStep · ' })
    .first()
    .click();
  await expect(
    page.getByRole('dialog', { name: '项目文档', exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/^\/student\/?$/);
  await expect(page.getByLabel('Markdown 内容', { exact: true })).toHaveValue(
    /尚未人工核对/,
  );
  await page.goto('/student/?section=settings');
  await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
  await page.getByRole('button', { name: '删除API Key', exact: true }).click();
  await page.getByRole('button', { name: /确.*定/ }).click();
  await expect(
    page.getByText('尚未配置API Key', { exact: true }),
  ).toBeVisible();
});

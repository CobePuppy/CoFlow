import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const requireWeb = createRequire(
  new URL('../../apps/web/package.json', import.meta.url),
);
const { zipSync, strToU8 } = requireWeb('fflate');
const origin = 'http://localhost:5174';
const pid = '10000000-0000-4000-8000-000000000001';

async function login(request: any, role: string) {
  const response = await request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: {
      email: role + '@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
const headers = (auth: any) => ({ Origin: origin, 'X-CSRF-Token': auth.csrf });
async function upload(
  request: any,
  auth: any,
  id: string,
  stage: string,
  name: string,
  content: string,
) {
  const response = await request.post(`/api/v1/tasks/${id}/attachments`, {
    headers: headers(auth),
    multipart: {
      stage,
      file: { name, mimeType: 'text/markdown', buffer: Buffer.from(content) },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('已上传方案MD、开发DOCX及测试TXT/MD可解析填表，确认前不保存或流转', async ({
  page,
  browser,
}) => {
  const p = await login(page.request, 'product');
  const ec = await browser.newContext({ baseURL: origin });
  const qc = await browser.newContext({ baseURL: origin });
  try {
    const e = await login(ec.request, 'engineer');
    const q = await login(qc.request, 'qa');
    const eng = await ec.newPage();
    const qa = await qc.newPage();
    const created = await page.request.post(`/api/v1/projects/${pid}/tasks`, {
      headers: headers(p),
      data: {
        title: '阶段材料导入-' + Date.now(),
        background: '文件导入验证',
        goal: '复用已有资料',
        description: '支持文件解析并填入阶段表单',
        criteria: ['资料完整且保存后可查看'],
        productId: p.user.id,
        engineerId: e.user.id,
        productReviewerId: p.user.id,
        qaReviewerId: q.user.id,
        testerId: q.user.id,
      },
    });
    expect(created.ok()).toBeTruthy();
    const task = await created.json();
    const read = async () =>
      (await page.request.get(`/api/v1/tasks/${task.id}`)).json();
    const act = async (request: any, auth: any, action: string) => {
      const fresh = await read();
      const response = await request.post(`/api/v1/tasks/${task.id}/actions`, {
        headers: { ...headers(auth), 'Idempotency-Key': crypto.randomUUID() },
        data: { action, expectedVersion: fresh.version, payload: {} },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    };
    await act(page.request, p, 'SUBMIT_REQUIREMENT');
    const source =
      '# 技术方案\n实现文件导出并保留审计。\n## 影响范围\nWeb与API\n## 工作量\n2.5 人日\n## 风险说明\n兼容性回归\n## 开始日期\n2026/10/18\n## 结束日期\n2026/10/20';
    const attachment = await upload(
      ec.request,
      e,
      task.id,
      'SOLUTION',
      '开发方案.md',
      source,
    );
    await qa.goto(`/student/?app=work&task=${task.id}`);
    await qa.getByRole('tab', { name: '开发资料', exact: true }).click();
    await expect(
      qa.getByRole('button', {
        name: '解析附件并填入：开发方案.md',
        exact: true,
      }),
    ).toBeDisabled();
    await eng.goto(`/student/?app=work&task=${task.id}`);
    await eng.getByRole('tab', { name: '开发资料', exact: true }).click();
    await expect(
      eng.getByText('开发交付与自测', { exact: true }),
    ).toBeVisible();
    await expect(
      eng.getByText('测试与验收', { exact: true }),
    ).not.toBeVisible();
    await eng
      .getByRole('button', { name: '解析附件并填入：开发方案.md', exact: true })
      .click();
    const importer = eng.getByRole('dialog', {
      name: '文件解析与填入',
      exact: true,
    });
    await expect(importer.getByLabel('解析正文预览')).toHaveValue(source);
    await expect(
      importer.getByRole('button', { name: 'AI整理字段', exact: true }),
    ).toBeDisabled();
    await importer
      .getByRole('button', { name: '按原文提取字段', exact: true })
      .click();
    await importer
      .getByRole('button', { name: '确认填入表单', exact: true })
      .click();
    const form = eng.locator('.requirement-transition');
    await expect(form.getByLabel('方案正文', { exact: true })).toHaveValue(
      '实现文件导出并保留审计。',
    );
    await expect(
      form.getByLabel('预计工作量（人日）', { exact: true }),
    ).toHaveValue('2.5');
    await expect(form.getByLabel('预计开始日期', { exact: true })).toHaveValue(
      '2026-10-18',
    );
    expect((await read()).status).toBe('SOLUTION_PENDING');
    expect((await read()).data.solutions).toHaveLength(0);
    await form
      .getByRole('button', { name: '确认提交方案', exact: true })
      .click();
    await expect(form).not.toBeVisible();
    await act(page.request, p, 'APPROVE_SOLUTION');
    await act(qc.request, q, 'APPROVE_SOLUTION');
    await act(ec.request, e, 'START_DEVELOPMENT');

    await eng.reload();
    await eng
      .locator('.next-step-card')
      .getByRole('button', { name: '开发完成并提测', exact: true })
      .click();
    await form
      .getByRole('button', { name: '从文件解析填入', exact: true })
      .click();
    const paragraphs = [
      '开发说明：完成导出接口',
      '自测结果：本地用例通过',
      '发布版本：v3.2',
      '环境：https://example.test',
      '已知问题：无',
    ];
    const docx = zipSync({
      'word/document.xml': strToU8(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
          paragraphs
            .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
            .join('') +
          '</w:body></w:document>',
      ),
    });
    await importer.getByLabel('选择信息文件').setInputFiles({
      name: '开发交付.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(docx),
    });
    await expect(importer.getByLabel('解析正文预览')).toHaveValue(
      /完成导出接口/,
    );
    await importer
      .getByRole('button', { name: '按原文提取字段', exact: true })
      .click();
    await importer
      .getByRole('button', { name: '确认填入表单', exact: true })
      .click();
    await expect(form.getByLabel('自测结果', { exact: true })).toHaveValue(
      '本地用例通过',
    );
    await expect(form.getByLabel('交付版本', { exact: true })).toHaveValue(
      'v3.2',
    );
    expect((await read()).status).toBe('DEVELOPING');
    await form
      .getByRole('button', { name: '确认开发完成并提测', exact: true })
      .click();
    await expect(form).not.toBeVisible();

    await qa.reload();
    await qa
      .locator('.next-step-card')
      .getByRole('button', { name: '开始测试', exact: true })
      .click();
    const testForm = qa.locator('.requirement-transition');
    await testForm
      .getByRole('button', { name: '从文件解析填入', exact: true })
      .click();
    const testImporter = qa.getByRole('dialog', {
      name: '文件解析与填入',
      exact: true,
    });
    await testImporter.getByLabel('选择信息文件').setInputFiles({
      name: '环境.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('测试环境：https://example.test'),
    });
    await expect(testImporter.getByLabel('解析正文预览')).toHaveValue(
      /测试环境/,
    );
    await testImporter
      .getByRole('button', { name: '按原文提取字段', exact: true })
      .click();
    await testImporter
      .getByRole('button', { name: '确认填入表单', exact: true })
      .click();
    await expect(testForm.getByLabel('测试环境', { exact: true })).toHaveValue(
      'https://example.test',
    );
    await testForm
      .getByRole('button', { name: '确认开始测试', exact: true })
      .click();
    await expect(testForm).not.toBeVisible();
    const testText =
      '## 测试执行记录\n导出文件可打开，内容一致。\n## 部署验证说明\n测试环境部署正常。';
    await upload(qc.request, q, task.id, 'TESTING', '测试报告.md', testText);
    await qa.reload();
    await qa.getByRole('tab', { name: '测试资料', exact: true }).click();
    await expect(qa.getByText('测试与验收', { exact: true })).toBeVisible();
    await expect(qa.getByText('技术方案', { exact: true })).not.toBeVisible();
    await qa
      .getByRole('button', { name: '解析附件并填入：测试报告.md', exact: true })
      .click();
    await expect(
      qa.getByRole('dialog', { name: '选择测试记录的填写入口' }),
    ).toBeVisible();
    expect((await read()).status).toBe('TESTING');
    await qa.getByRole('button', { name: '填写通过记录', exact: true }).click();
    await expect(testImporter.getByLabel('解析正文预览')).toHaveValue(testText);
    await testImporter
      .getByRole('button', { name: '按原文提取字段', exact: true })
      .click();
    await testImporter
      .getByRole('button', { name: '确认填入表单', exact: true })
      .click();
    await expect(
      testForm.getByLabel('测试执行记录', { exact: true }),
    ).toHaveValue('导出文件可打开，内容一致。');
    expect((await read()).status).toBe('TESTING');
    await qa.screenshot({
      path: 'artifacts/browser/material-import-testing.png',
      animations: 'disabled',
    });
    await testForm
      .getByRole('button', { name: '确认测试通过', exact: true })
      .click();
    await expect(testForm).not.toBeVisible();
    const saved = await read();
    expect(saved.status).toBe('ACCEPTANCE_PENDING');
    expect(saved.data.tests[0].record).toBe('导出文件可打开，内容一致。');
    expect(saved.data.solutions[0].effort).toBe(2.5);
    expect(saved.attachments.some((a: any) => a.id === attachment.id)).toBe(
      true,
    );
  } finally {
    await ec.close();
    await qc.close();
  }
});

test('附件读取失败保留现有表单输入，不能确认填入', async ({ page }) => {
  const p = await login(page.request, 'product');
  const team = await (await page.request.get('/api/v1/workspaces')).json();
  const projectResponse = await page.request.post(
    `/api/v1/workspaces/${team[0].id}/projects`,
    { headers: headers(p), data: { name: '解析失败验证', workflow: 'SIMPLE' } },
  );
  const project = await projectResponse.json();
  const response = await page.request.post(
    `/api/v1/projects/${project.id}/tasks`,
    {
      headers: headers(p),
      data: {
        title: '简易资料导入',
        description: '验证解析失败',
        criteria: ['输入保留'],
        engineerId: p.user.id,
        submit: true,
      },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  const task = await response.json();
  const start = await page.request.post(`/api/v1/tasks/${task.id}/actions`, {
    headers: { ...headers(p), 'Idempotency-Key': crypto.randomUUID() },
    data: { action: 'START_WORK', expectedVersion: task.version, payload: {} },
  });
  expect(start.ok()).toBeTruthy();
  const file = await upload(
    page.request,
    p,
    task.id,
    'DEVELOPMENT',
    '交付说明.md',
    '交付说明正文',
  );
  await page.route(`**/api/v1/attachments/${file.id}/download`, (route) =>
    route.fulfill({ status: 404, json: { message: '附件已删除' } }),
  );
  await page.goto(`/student/?app=work&task=${task.id}`);
  await page
    .locator('.next-step-card')
    .getByRole('button', { name: '提交验收', exact: true })
    .click();
  const form = page.locator('.requirement-transition');
  await form.getByLabel('完成说明', { exact: true }).fill('尚未保存的人工输入');
  await form
    .getByRole('button', { name: '解析附件并填入：交付说明.md', exact: true })
    .click();
  const importer = page.getByRole('dialog', {
    name: '文件解析与填入',
    exact: true,
  });
  await expect(
    importer.getByText('附件不存在或已删除', { exact: true }),
  ).toBeVisible();
  await expect(
    importer.getByRole('button', { name: '确认填入表单', exact: true }),
  ).toHaveCount(0);
  await importer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(form.getByLabel('完成说明', { exact: true })).toHaveValue(
    '尚未保存的人工输入',
  );
  expect(
    (await (await page.request.get(`/api/v1/tasks/${task.id}`)).json()).status,
  ).toBe('DEVELOPING');
});

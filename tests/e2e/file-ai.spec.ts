import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const requireWeb = createRequire(
  new URL('../../apps/web/package.json', import.meta.url),
);
const { zipSync, strToU8 } = requireWeb('fflate');
function pdfFixture() {
  const stream = 'BT /F1 12 Tf 30 100 Td (PDF import requirement text) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = text.length;
  text +=
    'xref\n0 6\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(text);
}
test('TXT/DOCX/PDF解析、需求填入及AI配置复用与评审展示（模型模拟）', async ({
  page,
}) => {
  const origin = 'http://localhost:5174',
    suffix = Date.now(),
    email = `file-ai-${suffix}@example.com`,
    password = 'File-AI-test-2026!';
  const registration = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      name: '资料负责人',
      email,
      password,
      teamName: '文件导入测试',
    },
  });
  expect(registration.status()).toBe(201);
  const team = await registration.json();
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email, password },
  });
  const session = await login.json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
  const created = await page.request.post(
    '/api/v1/workspaces/' + team.workspaceId + '/projects',
    { headers, data: { name: '导入项目' } },
  );
  const project = await created.json();
  await page.request.post('/api/v1/projects/' + project.id + '/members', {
    headers,
    data: { userId: session.user.id, roles: ['PRODUCT', 'ENGINEER', 'QA'] },
  });
  let hasKey = false;
  await page.route('**/api/v1/settings', (r) =>
    r.fulfill({ json: { hasKey, model: 'deepseek-flash' } }),
  );
  await page.goto(
    '/student/?app=work&workspace=' +
      team.workspaceId +
      '&project=' +
      project.id +
      '&view=tasks',
  );
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const editor = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: '创建需求', exact: true }),
  });
  await editor
    .getByRole('button', { name: '从文件导入信息', exact: true })
    .click();
  const importer = page.getByRole('dialog', {
    name: '文件解析与填入',
    exact: true,
  });
  await importer.getByLabel('选择信息文件').setInputFiles({
    name: '导入需求.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      '用户需要导出报告，验收时检查导出的PDF文件能够正常打开。',
    ),
  });
  await expect(importer.getByLabel('解析正文预览')).toHaveValue(
    /用户需要导出报告/,
  );
  await expect(
    importer.getByRole('button', { name: 'AI整理字段', exact: true }),
  ).toBeDisabled();
  const docx = zipSync({
    'word/document.xml': strToU8(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX需求正文与验收要求</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  await importer.getByLabel('选择信息文件').setInputFiles({
    name: '文书.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(docx),
  });
  await expect(importer.getByLabel('解析正文预览')).toHaveValue(
    'DOCX需求正文与验收要求',
  );
  await importer.getByLabel('选择信息文件').setInputFiles({
    name: '需求.pdf',
    mimeType: 'application/pdf',
    buffer: pdfFixture(),
  });
  await expect(importer.getByLabel('解析正文预览')).toHaveValue(
    /PDF import requirement text/,
    { timeout: 20000 },
  );
  await importer
    .getByRole('button', { name: '按正文填入说明', exact: true })
    .click();
  await importer
    .getByRole('button', { name: '确认填入表单', exact: true })
    .click();
  await expect(
    editor.getByLabel('需求描述（Markdown）', { exact: true }),
  ).toHaveValue(/PDF import requirement text/);
  await editor.getByLabel('需求标题', { exact: true }).fill('文件导入后的需求');
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(editor).not.toBeVisible();
  const list = await (
    await page.request.get('/api/v1/projects/' + project.id + '/tasks')
  ).json();
  const task = list.items[0];
  await page.goto('/student/?app=work&task=' + task.id);
  await page.getByRole('tab', { name: 'AI评审', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '开始AI评审', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('link', { name: '个人AI设置', exact: true }),
  ).toBeVisible();
  hasKey = true;
  let reports: any[] = [];
  await page.route('**/api/v1/tasks/*/ai-reviews', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.consent).toBe(true);
      expect(body).not.toHaveProperty('apiKey');
      reports = [
        {
          id: 'mock-report',
          kind: body.kind,
          model: 'deepseek-flash',
          taskVersion: task.version,
          at: new Date().toISOString(),
          stale: false,
          result: {
            outcome: 'NEEDS_CHANGES',
            summary: '验收标准尚未明确，需要补充可验证条件。',
            checks: [
              {
                criterion: '验收标准',
                status: 'MISSING',
                explanation: '未填写验收标准，无法判断交付是否完整。',
                suggestion: '补充可验证的预期与实际结果。',
                evidence: [],
              },
            ],
          },
        },
      ];
      await route.fulfill({ json: reports[0] });
    } else await route.fulfill({ json: { items: reports } });
  });
  await page.reload();
  await page.getByRole('tab', { name: 'AI评审', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: '同意将上述资料发送至DeepSeek，可能产生个人API费用',
    })
    .check();
  await page.getByRole('button', { name: '开始AI评审', exact: true }).click();
  await expect(
    page.getByText('需求文档 · 需要修改', { exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get('/api/v1/tasks/' + task.id)).json()).status,
  ).toBe('DRAFT');
  await page.screenshot({
    path: 'artifacts/browser/ai-quality.png',
    animations: 'disabled',
  });
  reports[0].stale = true;
  await page.reload();
  await page.getByRole('tab', { name: 'AI评审', exact: true }).click();
  await expect(
    page.getByText('资料已变更 · 需重评', { exact: true }),
  ).toBeVisible();
  await page.route('**/api/v1/ai/import', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.kind).toBe('project');
    expect(body.consent).toBe(true);
    expect(body.text).toContain('项目目标');
    expect(body).not.toHaveProperty('apiKey');
    await route.fulfill({
      json: {
        fields: {
          name: 'AI整理项目',
          description: '项目目标：帮助团队导出报告，减少手工整理。',
        },
        model: 'deepseek-flash',
      },
    });
  });
  await page.goto('/student/?section=projects&workspace=' + team.workspaceId);
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', {
    name: '项目设置',
    exact: true,
  });
  await settingsDialog
    .getByRole('button', { name: '从文件导入信息', exact: true })
    .click();
  await importer.getByLabel('选择信息文件').setInputFiles({
    name: '项目介绍.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('项目目标：帮助团队导出报告，减少手工整理。'),
  });
  await importer
    .getByRole('checkbox', {
      name: /同意将预览正文发送至个人设置的DeepSeek模型/,
    })
    .check();
  await importer
    .getByRole('button', { name: 'AI整理字段', exact: true })
    .click();
  await expect(importer.getByText('AI整理项目', { exact: true })).toBeVisible();
  await importer
    .getByRole('button', { name: '确认填入表单', exact: true })
    .click();
  await expect(
    settingsDialog.getByLabel('项目名称', { exact: true }),
  ).toHaveValue('AI整理项目');
  await settingsDialog
    .getByRole('button', { name: '保存项目信息', exact: true })
    .click();
  await expect(settingsDialog).not.toBeVisible();
  const savedProject = await (
    await page.request.get('/api/v1/projects/' + project.id)
  ).json();
  expect(savedProject.name).toBe('AI整理项目');
});

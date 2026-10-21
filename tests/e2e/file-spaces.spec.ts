import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
test.use({ actionTimeout: 15000 });
const origin = 'http://localhost:5174';
for (const edition of ['enterprise', 'student'])
  test(
    edition + '个人与团队文件空间：无项目、共享权限、冲突恢复及手机',
    async ({ page, browser }) => {
      const url = process.env.TEST_DATABASE_URL;
      if (
        !url ||
        new URL(url).pathname !== '/coflow_test' ||
        url === process.env.DATABASE_URL
      )
        throw new Error('仅允许隔离测试库');
      const peer = await browser.newContext({ baseURL: origin });
      const db = new PrismaClient({ datasources: { db: { url } } });
      async function register(request: any, tag: string) {
        const email = 'file-ui-' + tag + '-' + Date.now() + '@example.com',
          password = 'File-ui-test-2026!';
        const reg = await request.post('/api/v1/auth/register', {
          headers: { Origin: origin },
          data: {
            kind: 'creator',
            email,
            password,
            name: tag,
            teamName: tag + '文件团队',
          },
        });
        expect(reg.status()).toBe(201);
        const team = await reg.json();
        const login = await request.post('/api/v1/auth/login', {
          headers: { Origin: origin },
          data: { email, password },
        });
        return { ...(await login.json()), workspaceId: team.workspaceId };
      }
      const a = await register(page.request, 'owner-' + edition),
        b = await register(peer.request, 'member-' + edition);
      const headers = { Origin: origin, 'X-CSRF-Token': a.csrf };
      try {
        await db.workspaceMember.create({
          data: { workspaceId: a.workspaceId, userId: b.user.id },
        });
        expect(
          await db.project.count({ where: { workspaceId: a.workspaceId } }),
        ).toBe(0);
        await page.goto('/' + edition + '/?section=library');
        const personal = page.getByRole('region', {
          name: '个人文件空间',
          exact: true,
        });
        await expect(personal).toBeVisible();
        await expect(
          page.getByRole('combobox', { name: '选择项目' }),
        ).toHaveCount(0);
        await page.locator('input[type=file]').setInputFiles({
          name: '个人笔记.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('私人文件不可被团队管理员读取'),
        });
        await expect(personal.locator('.space-file-row')).toContainText(
          '个人笔记.txt',
        );
        const privateLink = await personal
          .getByRole('link', { name: '下载', exact: true })
          .getAttribute('href');
        expect((await peer.request.get(privateLink!)).status()).toBe(404);
        await page
          .getByRole('tab', { name: '团队文件空间', exact: true })
          .click();
        const team = page.getByRole('region', {
          name: '团队文件空间',
          exact: true,
        });
        await expect(team).toBeVisible();
        await expect(team).not.toContainText('个人笔记.txt');
        await page.locator('input[type=file]').setInputFiles({
          name: '开发规范.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('# 开发规范\n提交前完成检查。'),
        });
        await expect(team.locator('.space-file-row')).toContainText(
          '开发规范.md',
        );
        const guide = (
          await (
            await page.request.get(
              '/api/v1/workspaces/' + a.workspaceId + '/files',
            )
          ).json()
        ).items[0];
        const peerPage = await peer.newPage();
        await peerPage.goto(
          '/' +
            edition +
            '/?section=library&fileSpace=team&workspace=' +
            a.workspaceId,
        );
        const shared = peerPage.getByRole('region', {
          name: '团队文件空间',
          exact: true,
        });
        await expect(shared).toContainText('开发规范.md');
        await expect(
          shared.getByRole('button', { name: '删除', exact: true }),
        ).toHaveCount(0);
        expect(
          (
            await peer.request.get(
              '/api/v1/space-files/' + guide.id + '/download',
            )
          ).status(),
        ).toBe(200);
        await peerPage.locator('input[type=file]').setInputFiles({
          name: '公共模板.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('成员上传的团队资料'),
        });
        await expect(shared).toContainText('公共模板.txt');
        await page.reload();
        await expect(team).toContainText('公共模板.txt');
        const guideRow = team
          .locator('.space-file-row')
          .filter({ hasText: '开发规范' });
        await guideRow
          .getByRole('button', { name: '重命名', exact: true })
          .click();
        const rename = page.getByRole('dialog', {
          name: '重命名文件',
          exact: true,
        });
        await rename
          .getByLabel('文件名称（保留扩展名）', { exact: true })
          .fill('开发规范-最新版.md');
        expect(
          (
            await page.request.patch('/api/v1/space-files/' + guide.id, {
              headers,
              data: {
                expectedVersion: guide.version,
                name: '开发规范-他人更新.md',
              },
            })
          ).ok(),
        ).toBeTruthy();
        await rename
          .getByRole('button', { name: '保存名称', exact: true })
          .click();
        await expect(rename).toContainText('名称输入已保留');
        await expect(
          rename.getByLabel('文件名称（保留扩展名）', { exact: true }),
        ).toHaveValue('开发规范-最新版.md');
        await rename
          .getByRole('button', { name: '保存名称', exact: true })
          .click();
        await expect(rename).toHaveCount(0);
        await expect(guideRow).toContainText('开发规范-最新版.md');
        await guideRow
          .getByRole('button', { name: '删除', exact: true })
          .click();
        await page
          .getByRole('button', { name: '确认文件操作', exact: true })
          .click();
        await expect(guideRow).toHaveCount(0);
        await team
          .getByRole('button', { name: '已删除文件', exact: true })
          .click();
        await expect(guideRow).toContainText('开发规范-最新版.md');
        await expect(
          guideRow.getByRole('link', { name: '下载', exact: true }),
        ).toHaveCount(0);
        await guideRow
          .getByRole('button', { name: '恢复', exact: true })
          .click();
        await page
          .getByRole('button', { name: '确认文件操作', exact: true })
          .click();
        await team
          .getByRole('button', { name: '全部文件', exact: true })
          .click();
        await expect(guideRow).toBeVisible();
        await expect(page.locator('.ant-message-notice')).toHaveCount(0);
        await page.screenshot({
          path: 'artifacts/v3.5.0-' + edition + '-team-desktop.png',
          animations: 'disabled',
        });
        await page
          .getByRole('tab', { name: '个人文件空间', exact: true })
          .click();
        await expect(personal).toContainText('个人笔记.txt');
        for (let i = 0; i < 20; i++) {
          const form = {
            file: {
              name: '资料-' + i + '.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from('分页资料'),
            },
          };
          expect(
            (
              await page.request.post('/api/v1/me/files', {
                headers,
                multipart: form,
              })
            ).ok(),
          ).toBeTruthy();
        }
        await page.reload();
        await expect(personal).toContainText('共 21 个文件');
        await personal.locator('.ant-pagination-item-2').click();
        await expect(personal.locator('.space-file-row')).toHaveCount(1);
        await page.getByLabel('搜索当前页面', { exact: true }).fill('个人笔记');
        await expect(personal.locator('.space-file-row')).toHaveCount(1);
        await expect(personal).toContainText('个人笔记.txt');
        expect(new URL(page.url()).searchParams.has('filePage')).toBe(false);
        await page.setViewportSize({ width: 390, height: 844 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: 'artifacts/v3.5.0-' + edition + '-personal-mobile.png',
          animations: 'disabled',
        });
        await page
          .getByRole('tab', { name: '团队文件空间', exact: true })
          .click();
        await expect(team).toContainText('开发规范-最新版.md');
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.reload();
        await expect(team).toBeVisible();
        expect(new URL(page.url()).searchParams.get('fileSpace')).toBe('team');
        const revoked = await page.request.delete(
          '/api/v1/workspaces/' + a.workspaceId + '/members/' + b.user.id,
          { headers, data: {} },
        );
        expect(revoked.ok()).toBeTruthy();
        expect(
          (
            await peer.request.get(
              '/api/v1/space-files/' + guide.id + '/download',
            )
          ).status(),
        ).toBe(404);
        if (edition === 'enterprise') {
          await page
            .getByRole('tab', { name: '个人文件空间', exact: true })
            .click();
          let releaseUpload!: () => void;
          const gate = new Promise<void>((resolve) => {
            releaseUpload = resolve;
          });
          await page.route('**/api/v1/me/files', async (route) => {
            if (route.request().method() === 'POST') await gate;
            await route.continue();
          });
          try {
            const started = page.waitForRequest(
              (request) =>
                request.url().endsWith('/api/v1/me/files') &&
                request.method() === 'POST',
            );
            await page.locator('input[type=file]').setInputFiles({
              name: '切换时上传.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from('应留在个人空间'),
            });
            await started;
            await page
              .getByRole('tab', { name: '团队文件空间', exact: true })
              .click();
            const uploaded = page.waitForResponse(
              (response) =>
                response.url().endsWith('/api/v1/me/files') &&
                response.request().method() === 'POST',
            );
            releaseUpload();
            expect((await uploaded).status()).toBe(201);
            await expect(
              page.getByText('已上传至个人文件空间', { exact: true }),
            ).toBeVisible();
            await expect(
              page.getByRole('tab', { name: '团队文件空间', exact: true }),
            ).toHaveAttribute('aria-selected', 'true');
            await expect(team).not.toContainText('切换时上传.txt');
            expect(new URL(page.url()).searchParams.get('fileSpace')).toBe(
              'team',
            );
            const response = await page.request.get('/api/v1/me/files');
            expect(response.headers()['cache-control']).toBe(
              'private, no-store',
            );
            expect(
              (await response.json()).items.some(
                (f: any) => f.name === '切换时上传.txt',
              ),
            ).toBe(true);
          } finally {
            releaseUpload();
            await page.unroute('**/api/v1/me/files');
          }
        }
      } finally {
        await peer.close();
        await db.$disconnect();
      }
    },
  );

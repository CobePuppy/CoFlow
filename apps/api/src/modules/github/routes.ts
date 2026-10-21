import { githubConfiguration } from './configuration.js';
import {
  githubReferenceInput,
  pullNumber,
  referenceLineCount,
} from '@coflow/contracts/github.js';
import { z } from 'zod';
import {
  GitHubClient,
  parseRepository,
  safePath,
} from '../../infrastructure/github/client.js';
import {
  decryptKey,
  encryptionReady,
  encryptKey,
} from '../../infrastructure/security/encryption.js';
import { assert, BusinessError } from '../requirements/domain.js';

const expected = z.object({ version: z.number().int().min(0) });
export function installGitHubRoutes(
  router: any,
  { db, wrap, task, project, projectWrite, record }: any,
) {
  const clientId = () => {
    assert(
      process.env.GITHUB_APP_CLIENT_ID?.trim() && encryptionReady(),
      '私有仓库尚未配置 GitHub App 与服务器加密密钥；公开仓库可直接连接',
      503,
    );
    return process.env.GITHUB_APP_CLIENT_ID!.trim();
  };
  // Serializes refresh, authorization and disconnect across processes. Tokens never leave this module.
  async function account<T>(
    userId: string,
    fn: (tx: any, row: any) => Promise<T>,
  ): Promise<T> {
    return db.$transaction(
      async (tx: any) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        const row = await tx.gitHubAccount.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        return fn(tx, row);
      },
      { timeout: 45000 },
    );
  }
  async function github(userId: string) {
    const token = await account(userId, async (tx, row) => {
      if (!row.credentials) return undefined;
      let c = JSON.parse(decryptKey(row.credentials, userId));
      if (c.expiresAt && c.expiresAt < Date.now() + 60000) {
        assert(
          c.refresh_token && c.refreshExpiresAt > Date.now(),
          'GitHub 授权已过期，请重新连接',
          403,
        );
        const updated = await new GitHubClient().json(
          'oauth/access_token',
          {
            client_id: clientId(),
            grant_type: 'refresh_token',
            refresh_token: c.refresh_token,
          },
          true,
        );
        assert(
          updated.access_token?.startsWith('ghu_'),
          'GitHub 授权已失效，请重新连接',
          403,
        );
        c = credentials(updated);
        await tx.gitHubAccount.update({
          where: { userId },
          data: { credentials: encryptKey(JSON.stringify(c), userId) },
        });
      }
      return c.access_token as string;
    });
    return new GitHubClient(token);
  }
  function credentials(data: any) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
      refreshExpiresAt:
        Date.now() + (data.refresh_token_expires_in || 0) * 1000,
    };
  }
  router.get(
    '/github/account',
    wrap(async (r: any, s: any) => {
      const row = await db.gitHubAccount.findUnique({
        where: { userId: r.user.id },
      });
      const slug = process.env.GITHUB_APP_SLUG;
      s.setHeader('Cache-Control', 'private, no-store');
      s.json({
        configured:
          githubConfiguration(process.env).clientId && encryptionReady(),
        configuration: githubConfiguration(process.env),
        login: row?.login || null,
        installationUrl:
          slug && /^[a-z0-9-]+$/.test(slug)
            ? `https://github.com/apps/${slug}/installations/new`
            : null,
      });
    }),
  );
  router.post(
    '/github/account/check',
    wrap(async (r: any, s: any) => {
      clientId();
      const client = await authorized(r);
      const profile = await client.json('/user');
      const installations = await client.json(
        '/user/installations?per_page=1&page=1',
      );
      s.setHeader('Cache-Control', 'private, no-store');
      s.json({
        login: profile.login,
        checkedAt: new Date().toISOString(),
        visibleInstallations:
          installations.total_count ?? installations.installations?.length ?? 0,
      });
    }),
  );
  async function authorized(r: any) {
    const row = await db.gitHubAccount.findUnique({
      where: { userId: r.user.id },
    });
    assert(row?.credentials, '请先连接 GitHub 账号', 403);
    return github(r.user.id);
  }
  router.get(
    '/github/installations',
    wrap(async (r: any, s: any) => {
      const g = await authorized(r);
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(1)
        .parse(r.query.page);
      const d = await g.json(`/user/installations?per_page=100&page=${page}`);
      assert(Array.isArray(d.installations), 'GitHub 安装数据无效', 502);
      s.json({
        page,
        hasMore: page * 100 < d.total_count,
        items: d.installations.map((x: any) => ({
          id: x.id,
          name: x.account?.login || String(x.id),
        })),
      });
    }),
  );
  router.get(
    '/github/repositories',
    wrap(async (r: any, s: any) => {
      const g = await authorized(r);
      const id = z.coerce
        .number()
        .int()
        .positive()
        .safe()
        .parse(r.query.installationId);
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(1)
        .parse(r.query.page);
      const d = await g.json(
        `/user/installations/${id}/repositories?per_page=100&page=${page}`,
      );
      assert(Array.isArray(d.repositories), 'GitHub 仓库数据无效', 502);
      s.json({
        page,
        hasMore: page * 100 < d.total_count,
        items: d.repositories.map((x: any) => ({
          name: x.full_name,
          private: !!x.private,
        })),
      });
    }),
  );
  router.get(
    '/projects/:id/github',
    wrap(async (r: any, s: any) => {
      const p = await project(r, r.params.id);
      const value = await db.projectGitHub.findUnique({
        where: { projectId: p.id },
      });
      s.json(
        value?.data.unlinked ? { version: value.version, data: null } : value,
      );
    }),
  );
  router.put(
    '/projects/:id/github',
    wrap(async (r: any, s: any) => {
      const p = await project(r, r.params.id, true);
      const input = expected
        .extend({
          repository: z.string().max(300),
          branch: z.string().max(255).optional(),
        })
        .parse(r.body);
      const member = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: p.workspaceId, userId: r.user.id },
        },
      });
      assert(member?.role === 'ADMIN', '只有团队管理员可设置项目默认仓库', 403);
      const repo = await (
        await github(r.user.id)
      ).repository(parseRepository(input.repository));
      const snapshot = await (
        await github(r.user.id)
      ).snapshot(repo.name, input.branch || repo.defaultBranch);
      s.json(
        await db.$transaction(async (tx: any) => {
          await projectWrite(tx, r, p.id);
          const m = await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: {
                workspaceId: p.workspaceId,
                userId: r.user.id,
              },
            },
          });
          assert(m?.role === 'ADMIN', '需要团队管理员权限', 403);
          const current = await tx.projectGitHub.findUnique({
            where: { projectId: p.id },
          });
          assert(
            (current?.version || 0) === input.version,
            '项目默认仓库已更新，请刷新',
            409,
          );
          const data = {
            name: repo.name,
            repoId: repo.id,
            branch: snapshot.branch,
          };
          await record(tx, r, p.workspaceId, p.id, 'GITHUB_PROJECT_UPDATE');
          return tx.projectGitHub.upsert({
            where: { projectId: p.id },
            create: { projectId: p.id, data },
            update: { version: { increment: 1 }, data },
          });
        }),
      );
    }),
  );
  router.delete(
    '/projects/:id/github',
    wrap(async (r: any, s: any) => {
      const p = await project(r, r.params.id, true);
      const input = expected.parse(r.body);
      await db.$transaction(async (tx: any) => {
        await projectWrite(tx, r, p.id);
        const m = await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: p.workspaceId,
              userId: r.user.id,
            },
          },
        });
        assert(m?.role === 'ADMIN', '需要团队管理员权限', 403);
        const current = await tx.projectGitHub.findUnique({
          where: { projectId: p.id },
        });
        assert(
          current && current.version === input.version,
          '项目默认仓库已更新，请刷新',
          409,
        );
        await tx.projectGitHub.update({
          where: { projectId: p.id },
          data: { version: { increment: 1 }, data: { unlinked: true } },
        });
        await record(tx, r, p.workspaceId, p.id, 'GITHUB_PROJECT_UNLINK');
      });
      s.json({ ok: true });
    }),
  );
  router.delete(
    '/github/account',
    wrap(async (r: any, s: any) => {
      await account(r.user.id, async (tx) => {
        await tx.gitHubAccount.update({
          where: { userId: r.user.id },
          data: { credentials: null, attempt: null, login: null },
        });
      });
      s.json({ ok: true });
    }),
  );
  router.post(
    '/github/device',
    wrap(async (r: any, s: any) => {
      const id = clientId();
      const result = await account(r.user.id, async (tx, row) => {
        if (row.attempt) {
          const previous = JSON.parse(decryptKey(row.attempt, r.user.id));
          assert(
            previous.startedAt < Date.now() - 60000,
            '请稍候再申请设备码',
            429,
          );
        }
        const d = await new GitHubClient().json(
          'device/code',
          { client_id: id, scope: 'offline_access' },
          true,
        );
        assert(
          typeof d.device_code === 'string' &&
            typeof d.user_code === 'string' &&
            Number.isFinite(d.expires_in) &&
            d.expires_in > 0,
          'GitHub 设备授权不可用，请检查 App 是否启用设备流程',
          502,
        );
        const interval = Math.max(5, Number(d.interval) || 5);
        const attempt = {
          deviceCode: d.device_code,
          expiresAt: Date.now() + Math.min(d.expires_in, 900) * 1000,
          interval,
          nextPoll: Date.now() + interval * 1000,
          startedAt: Date.now(),
        };
        await tx.gitHubAccount.update({
          where: { userId: r.user.id },
          data: { attempt: encryptKey(JSON.stringify(attempt), r.user.id) },
        });
        return {
          code: d.user_code,
          verificationUrl: 'https://github.com/login/device',
          expiresAt: attempt.expiresAt,
          interval,
        };
      });
      s.json(result);
    }),
  );
  router.post(
    '/github/device/poll',
    wrap(async (r: any, s: any) => {
      const result = await account(r.user.id, async (tx, row) => {
        assert(row.attempt, '请先获取设备码', 409);
        const a = JSON.parse(decryptKey(row.attempt, r.user.id));
        assert(a.expiresAt > Date.now(), '设备码已过期，请重新申请', 409);
        if (a.nextPoll > Date.now())
          return {
            pending: true,
            interval: Math.ceil((a.nextPoll - Date.now()) / 1000),
          };
        const d = await new GitHubClient().json(
          'oauth/access_token',
          {
            client_id: clientId(),
            device_code: a.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          },
          true,
        );
        if (d.error === 'authorization_pending' || d.error === 'slow_down') {
          if (d.error === 'slow_down') a.interval += 5;
          a.nextPoll = Date.now() + a.interval * 1000;
          await tx.gitHubAccount.update({
            where: { userId: r.user.id },
            data: { attempt: encryptKey(JSON.stringify(a), r.user.id) },
          });
          return { pending: true, interval: a.interval };
        }
        assert(
          d.access_token?.startsWith('ghu_'),
          '授权未完成、被拒绝或已过期，请重新申请设备码',
          403,
        );
        const u = await new GitHubClient(d.access_token).json('/user');
        assert(typeof u.login === 'string', '无法读取 GitHub 账号', 502);
        await tx.gitHubAccount.update({
          where: { userId: r.user.id },
          data: {
            login: u.login,
            credentials: encryptKey(JSON.stringify(credentials(d)), r.user.id),
            attempt: null,
          },
        });
        return { login: u.login };
      });
      s.json(result);
    }),
  );
  async function binding(r: any) {
    const t = await task(r, r.params.id);
    const b = await db.taskGitHub.findUnique({ where: { taskId: t.id } });
    return { t, b };
  }
  async function readable(r: any, loaded?: { t: any; b: any }) {
    const { t, b } = loaded || (await binding(r));
    assert(b && !b.data.unlinked, '需求尚未连接仓库', 404);
    const g = await github(r.user.id);
    const repo = await g.repository(b.data.name);
    assert(repo.id === b.data.repoId, '仓库已变更，请重新连接', 409);
    return { t, b, g, repo };
  }
  async function write(
    r: any,
    version: number,
    fn: (tx: any, current: any, t: any) => Promise<any>,
  ) {
    const initial = await task(r, r.params.id, true);
    return db.$transaction(async (tx: any) => {
      await projectWrite(tx, r, initial.projectId);
      const t = await tx.task.findUnique({ where: { id: initial.id } });
      assert(
        t && t.projectId === initial.projectId && !t.deletedAt,
        '需求已变更，请刷新',
        409,
      );
      const member = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: t.workspaceId, userId: r.user.id },
        },
      });
      assert(
        [t.data.productId, t.data.engineerId].includes(r.user.id) ||
          member?.role === 'ADMIN',
        '只有需求产品、研发负责人或团队管理员可维护仓库',
        403,
      );
      const current = await tx.taskGitHub.findUnique({
        where: { taskId: t.id },
      });
      assert(
        (current?.version || 0) === version,
        '仓库关联已更新，请刷新后重试',
        409,
      );
      const result = await fn(tx, current, t);
      await record(tx, r, t.workspaceId, t.id, 'GITHUB_UPDATE');
      return result;
    });
  }
  router.get(
    '/tasks/:id/github',
    wrap(async (r: any, s: any) => {
      const loaded = await binding(r);
      const { b } = loaded;
      if (!b) return s.json(null);
      if (b.data.unlinked) return s.json({ version: b.version, data: null });
      // Reference paths are only disclosed after independently authorizing this reader.
      try {
        const { repo } = await readable(r, loaded);
        s.json({ ...b, repository: repo });
      } catch (error) {
        if (!(error instanceof BusinessError)) throw error;
        s.json({
          taskId: b.taskId,
          version: b.version,
          data: {
            name: b.data.name,
            branch: b.data.branch,
            commit: b.data.commit,
            readAt: b.data.readAt,
            references: [],
          },
          accessError: error.message,
        });
      }
    }),
  );
  router.put(
    '/tasks/:id/github',
    wrap(async (r: any, s: any) => {
      await task(r, r.params.id, true);
      const input = expected
        .extend({
          repository: z.string().max(300),
          branch: z.string().max(255).optional(),
          inheritVersion: z.number().int().positive().optional(),
        })
        .parse(r.body);
      const g = await github(r.user.id);
      const repo = await g.repository(parseRepository(input.repository));
      const snapshot = await g.snapshot(
        repo.name,
        input.branch || repo.defaultBranch,
      );
      s.json(
        await write(r, input.version, async (tx, current, t) => {
          if (input.inheritVersion) {
            const source = await tx.projectGitHub.findUnique({
              where: { projectId: t.projectId },
            });
            assert(
              source &&
                source.version === input.inheritVersion &&
                source.data.repoId === repo.id &&
                source.data.name === repo.name &&
                source.data.branch === snapshot.branch,
              '项目默认仓库已更新，请刷新后重试',
              409,
            );
          }
          const data = {
            repoId: repo.id,
            name: repo.name,
            ...snapshot,
            references:
              current?.data.repoId === repo.id ? current.data.references : [],
            pulls:
              current?.data.repoId === repo.id ? current.data.pulls || [] : [],
            source: input.inheritVersion ? 'PROJECT' : 'TASK',
          };
          return tx.taskGitHub.upsert({
            where: { taskId: r.params.id },
            create: { taskId: r.params.id, version: 1, data },
            update: { version: { increment: 1 }, data },
          });
        }),
      );
    }),
  );
  router.delete(
    '/tasks/:id/github',
    wrap(async (r: any, s: any) => {
      const { version } = expected.parse(r.body);
      await write(r, version, async (tx) => {
        await tx.taskGitHub.update({
          where: { taskId: r.params.id },
          data: { version: { increment: 1 }, data: { unlinked: true } },
        });
      });
      s.json({ ok: true });
    }),
  );
  router.get(
    '/tasks/:id/github/branches',
    wrap(async (r: any, s: any) => {
      const { g, b } = await readable(r);
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(1)
        .parse(r.query.page);
      const items = await g.json(
        `/repos/${b.data.name}/branches?per_page=100&page=${page}`,
      );
      assert(
        Array.isArray(items) &&
          items.every((x: any) => typeof x.name === 'string'),
        'GitHub 分支数据无效',
        502,
      );
      s.json({
        items: items.map((x: any) => x.name),
        hasMore: items.length === 100,
        page,
      });
    }),
  );
  router.get(
    '/tasks/:id/github/tree',
    wrap(async (r: any, s: any) => {
      const { g, b } = await readable(r);
      const path = safePath(z.string().default('').parse(r.query.path));
      const entry = await g.locate(b.data.name, b.data.tree, path);
      assert(entry.mode === '040000', '只支持浏览普通目录');
      s.json({
        path,
        commit: b.data.commit,
        items: await g.entries(b.data.name, entry.sha),
      });
    }),
  );
  router.get(
    '/tasks/:id/github/file',
    wrap(async (r: any, s: any) => {
      const { g, b } = await readable(r);
      const path = safePath(z.string().min(1).parse(r.query.path));
      const ref =
        r.query.reference === '1'
          ? b.data.references.find((x: any) => x.path === path)
          : null;
      assert(r.query.reference !== '1' || ref, '引用不存在', 404);
      s.json({
        ...(await g.file(b.data.name, ref?.tree || b.data.tree, path)),
        commit: ref?.commit || b.data.commit,
        readAt: new Date().toISOString(),
        version: b.version,
        reference: ref || null,
      });
    }),
  );
  router.post(
    '/tasks/:id/github/references',
    wrap(async (r: any, s: any) => {
      const input = githubReferenceInput.parse(r.body);
      const { g, b } = await readable(r);
      const path = safePath(input.path);
      const previous = input.keepSnapshot
        ? b.data.references.find((x: any) => x.path === path)
        : null;
      assert(!input.keepSnapshot || previous, '原引用不存在，请刷新', 409);
      const file = input.remove
        ? null
        : await g.file(b.data.name, previous?.tree || b.data.tree, path);
      if (file && input.endLine !== undefined)
        assert(
          input.endLine <= referenceLineCount(file.text),
          '所选行号超出文件范围',
        );
      s.json(
        await write(r, input.version, async (tx, current, t) => {
          if (!input.remove && input.criterion)
            assert(
              t.data.criteria[input.criterion.index] === input.criterion.text,
              '验收项已变更，请刷新后重新关联',
              409,
            );
          assert(
            current && current.version === b.version,
            '仓库快照已更新，请刷新',
            409,
          );
          const references = current.data.references.filter(
            (x: any) => x.path !== path,
          );
          assert(
            input.remove || references.length < 50,
            '每项需求最多保存 50 个代码引用',
          );
          if (file)
            references.push({
              path,
              sha: file.sha,
              commit: previous?.commit || b.data.commit,
              tree: previous?.tree || b.data.tree,
              readAt: new Date().toISOString(),
              startLine: input.startLine ?? null,
              endLine: input.endLine ?? null,
              note: input.note,
              criterion: input.criterion,
            });
          return tx.taskGitHub.update({
            where: { taskId: r.params.id },
            data: {
              version: { increment: 1 },
              data: { ...current.data, references },
            },
          });
        }),
      );
    }),
  );
  router.get(
    '/tasks/:id/github/upstream',
    wrap(async (r: any, s: any) => {
      const { g, b } = await readable(r);
      const latest = await g.snapshot(b.data.name, b.data.branch);
      const path =
        r.query.path === undefined
          ? null
          : safePath(z.string().min(1).parse(r.query.path));
      if (!path)
        return s.json({ ...latest, changed: latest.commit !== b.data.commit });
      const ref = b.data.references.find((x: any) => x.path === path);
      assert(ref, '引用不存在', 404);
      try {
        const entry = await g.locate(b.data.name, latest.tree, path);
        s.json({
          ...latest,
          path,
          changed: entry.sha !== ref.sha,
          supported: ['100644', '100755'].includes(entry.mode),
        });
      } catch (e) {
        if (e instanceof BusinessError && e.status === 404)
          return s.json({ ...latest, path, changed: true, deleted: true });
        throw e;
      }
    }),
  );
  router.post(
    '/tasks/:id/github/pulls',
    wrap(async (r: any, s: any) => {
      const input = expected
        .extend({
          pull: z.string().min(1).max(300),
          remove: z.boolean().default(false),
        })
        .parse(r.body);
      const { g, b } = await readable(r);
      let number: number;
      try {
        number = pullNumber(input.pull, b.data.name);
      } catch {
        assert(false, '请输入当前仓库的 PR 编号或完整 GitHub PR 地址');
      }
      if (!input.remove) {
        const pr = await g.json(`/repos/${b.data.name}/pulls/${number!}`);
        assert(
          pr.base?.repo?.id === b.data.repoId,
          'PR 不属于需求关联仓库',
          422,
        );
      }
      s.json(
        await write(r, input.version, async (tx, current) => {
          assert(
            current && current.version === b.version,
            '仓库关联已更新，请刷新',
            409,
          );
          const pulls = (current.data.pulls || []).filter(
            (x: number) => x !== number!,
          );
          assert(
            input.remove || pulls.length < 10,
            '每项需求最多关联 10 个 PR',
          );
          if (!input.remove) pulls.push(number!);
          return tx.taskGitHub.update({
            where: { taskId: r.params.id },
            data: {
              version: { increment: 1 },
              data: { ...current.data, pulls },
            },
          });
        }),
      );
    }),
  );
  router.get(
    '/tasks/:id/github/pulls/:number',
    wrap(async (r: any, s: any) => {
      const { g, b } = await readable(r);
      const number = z.coerce
        .number()
        .int()
        .positive()
        .max(999999999)
        .parse(r.params.number);
      assert((b.data.pulls || []).includes(number), 'PR 尚未关联', 404);
      const p = await g.json(`/repos/${b.data.name}/pulls/${number}`);
      assert(
        p.base?.repo?.id === b.data.repoId &&
          /^[a-f0-9]{40}$/.test(p.head?.sha),
        'PR 数据无效或仓库已变更',
        409,
      );
      // Read only the base repository. Fork checks may be unavailable; never borrow fork permissions.
      const prefix = `/repos/${b.data.name}/commits/${p.head.sha}`;
      const [checks, statuses] = await Promise.allSettled([
        g
          .json(prefix + '/check-runs?per_page=100&filter=latest')
          .then((value) => {
            assert(
              Number.isInteger(value.total_count) &&
                value.total_count >= 0 &&
                Array.isArray(value.check_runs),
              '检查结果无效',
              502,
            );
            return value;
          }),
        g.json(prefix + '/status?per_page=100').then((value) => {
          assert(
            Number.isInteger(value.total_count) &&
              value.total_count >= 0 &&
              Array.isArray(value.statuses),
            '提交状态无效',
            502,
          );
          return value;
        }),
      ]);
      s.json({
        number,
        title: p.title,
        state: p.merged
          ? 'merged'
          : p.state === 'closed'
            ? 'closed'
            : p.draft
              ? 'draft'
              : p.state,
        head: p.head.ref,
        base: p.base.ref,
        sha: p.head.sha,
        url: `https://github.com/${b.data.name}/pull/${number}`,
        readAt: new Date().toISOString(),
        checks:
          checks.status === 'fulfilled'
            ? {
                total: checks.value.total_count,
                items: (checks.value.check_runs || []).map((x: any) => ({
                  name: x.name,
                  status: x.status,
                  conclusion: x.conclusion,
                })),
                incomplete: checks.value.total_count > 100,
              }
            : {
                error:
                  '检查结果不可读，请检查 Checks 只读授权、提交可用性或稍后重试',
              },
        statuses:
          statuses.status === 'fulfilled'
            ? {
                state: statuses.value.state,
                total: statuses.value.total_count,
                items: (statuses.value.statuses || []).map((x: any) => ({
                  name: x.context,
                  state: x.state,
                })),
                incomplete: statuses.value.total_count > 100,
              }
            : {
                error:
                  '提交状态不可读，请检查 Commit statuses 只读授权或稍后重试',
              },
      });
    }),
  );
}

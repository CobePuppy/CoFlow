import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';

import { randomBytes } from 'node:crypto';

import { z } from 'zod';
import { assert } from '../requirements/domain.js';

import {
  db,
  hash,
  origin,
  project,
  projectWrite,
  record,
  removeTeamMember,
  workspace,
  wrap,
} from '../../shared/context.js';
export function installWorkspacesRoutes(router: express.Router) {
  router.get(
    '/workspaces',
    wrap(async (r, s) => {
      const ms = await db.workspaceMember.findMany({
        where: { userId: r.user.id },
      });
      const teams = await db.workspace.findMany({
        where: { id: { in: ms.map((m) => m.workspaceId) } },
      });
      s.json(
        teams.map((team) => ({
          ...team,
          role: ms.find((m) => m.workspaceId === team.id)!.role,
        })),
      );
    }),
  );

  router.post(
    '/workspaces',
    wrap(async (r, s) => {
      const name = z.string().trim().min(1).max(100).parse(r.body.name);
      s.json(
        await db.$transaction(async (tx) => {
          const w = await tx.workspace.create({ data: { name } });
          await tx.workspaceMember.create({
            data: { workspaceId: w.id, userId: r.user.id, role: 'ADMIN' },
          });
          await record(tx, r, w.id, w.id, 'TEAM_CREATE');
          return { ...w, role: 'ADMIN' };
        }),
      );
    }),
  );

  router.post(
    '/workspaces/join',
    wrap(async (r, s) => {
      const teamCode = z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-F0-9]{12}$/, '请输入有效的12位团队码')
        .parse(r.body.teamCode);
      const result = await db.$transaction(async (tx) => {
        const code = await tx.teamCode.findUnique({
          where: { code: teamCode },
        });
        assert(code, '团队码无效，请向管理员确认', 422);
        const team = await tx.workspace.findUnique({
          where: { id: code.workspaceId },
        });
        assert(team, '团队不存在', 404);
        const membership = await tx.workspaceMember.upsert({
          where: {
            workspaceId_userId: { workspaceId: team.id, userId: r.user.id },
          },
          create: { workspaceId: team.id, userId: r.user.id, role: 'MEMBER' },
          update: {},
        });
        await record(tx, r, team.id, team.id, 'TEAM_CODE_JOIN');
        return { ...team, role: membership.role };
      });
      s.json(result);
    }),
  );

  router.get(
    '/workspaces/:id/team-code',
    wrap(async (r, s) => {
      const id = String(r.params.id);
      await workspace(r, id, true);
      const code = await db.teamCode.upsert({
        where: { workspaceId: id },
        create: {
          workspaceId: id,
          code: randomBytes(6).toString('hex').toUpperCase(),
        },
        update: {},
      });
      s.json({ teamCode: code.code });
    }),
  );

  router.get(
    '/workspaces/:id/members',
    wrap(async (r, s) => {
      await workspace(r, String(r.params.id));
      const ms = await db.workspaceMember.findMany({
        where: { workspaceId: String(r.params.id) },
      });
      const us = await db.user.findMany({
        where: { id: { in: ms.map((m) => m.userId) } },
        select: { id: true, email: true, name: true },
      });
      s.json(
        us.map((u) => ({
          ...u,
          accountName: u.name,
          name: ms.find((m) => m.userId === u.id)!.displayName || u.name,
          displayName: ms.find((m) => m.userId === u.id)!.displayName,
          role: ms.find((m) => m.userId === u.id)!.role,
        })),
      );
    }),
  );

  router.patch(
    '/workspaces/:id/members',
    wrap(async (r, s) => {
      const id = String(r.params.id);
      await workspace(r, id, true);
      const role = z.enum(['ADMIN', 'MEMBER']).parse(r.body.role);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
        const admin = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: id, userId: r.user.id } },
        });
        assert(admin?.role === 'ADMIN', '需要团队管理员权限', 403);
        const current = await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: id, userId: r.body.userId },
          },
        });
        assert(current, '成员不存在', 404);
        if (current.role === 'ADMIN' && role !== 'ADMIN')
          assert(
            (await tx.workspaceMember.count({
              where: { workspaceId: id, role: 'ADMIN' },
            })) > 1,
            '必须保留至少一位管理员',
          );
        await tx.workspaceMember.update({
          where: {
            workspaceId_userId: { workspaceId: id, userId: r.body.userId },
          },
          data: { role },
        });
        await record(tx, r, id, id, 'MEMBER_ROLE');
      });
      s.json({ ok: true });
    }),
  );

  router.patch(
    '/workspaces/:id',
    wrap(async (r, s) => {
      const id = String(r.params.id);
      const data = z
        .object({ name: z.string().trim().min(1).max(80) })
        .strict()
        .parse(r.body);
      await workspace(r, id, true);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
        assert(
          (
            await tx.workspaceMember.findUnique({
              where: {
                workspaceId_userId: { workspaceId: id, userId: r.user.id },
              },
            })
          )?.role === 'ADMIN',
          '需要团队管理员权限',
          403,
        );
        await tx.workspace.update({ where: { id }, data });
        await record(tx, r, id, id, 'TEAM_UPDATE');
      });
      s.json({ ok: true });
    }),
  );

  router.get(
    '/workspaces/:id/members/:userId/projects',
    wrap(async (r, s) => {
      const id = String(r.params.id),
        userId = String(r.params.userId);
      await workspace(r, id, true);
      const projects = await db.project.findMany({
        where: { workspaceId: id },
        orderBy: { name: 'asc' },
      });
      const assignments = await db.projectMember.findMany({
        where: { userId, projectId: { in: projects.map((p) => p.id) } },
      });
      s.json(
        projects.map((p) => ({
          id: p.id,
          name: p.name,
          archivedAt: p.archivedAt,
          roles: assignments.find((m) => m.projectId === p.id)?.roles || [],
        })),
      );
    }),
  );

  router.post(
    '/workspaces/:id/members/:userId/move',
    wrap(async (r, s) => {
      const id = String(r.params.id),
        userId = String(r.params.userId);
      const data = z
        .object({
          sourceId: z.string().optional(),
          targetId: z.string().min(1),
          roles: z.array(z.enum(['PRODUCT', 'ENGINEER', 'QA', 'OPS'])).min(1),
        })
        .strict()
        .parse(r.body);
      assert(data.sourceId !== data.targetId, '请选择不同的目标项目');
      await workspace(r, id, true);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
        assert(
          (
            await tx.workspaceMember.findUnique({
              where: {
                workspaceId_userId: { workspaceId: id, userId: r.user.id },
              },
            })
          )?.role === 'ADMIN',
          '需要团队管理员权限',
          403,
        );
        assert(
          await tx.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: id, userId } },
          }),
          '成员不存在',
          404,
        );
        // The same project locks are used by requirement mutations and project membership writes.
        const ids = [
          data.targetId,
          ...(data.sourceId ? [data.sourceId] : []),
        ].sort();
        for (const projectId of ids)
          await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        for (const projectId of ids) {
          const p = await tx.project.findUnique({ where: { id: projectId } });
          assert(p?.workspaceId === id, '项目不属于当前团队', 404);
          assert(!p.archivedAt, '项目已归档，只能读取', 409);
        }
        if (data.sourceId) {
          assert(
            await tx.projectMember.findUnique({
              where: { projectId_userId: { projectId: data.sourceId, userId } },
            }),
            '成员不在来源项目中',
            409,
          );
          const tasks = await tx.task.findMany({
            where: {
              projectId: data.sourceId,
              status: { notIn: ['CLOSED', 'CANCELLED'] },
            },
          });
          assert(
            !tasks.some((t) =>
              [
                'productId',
                'engineerId',
                'testerId',
                'productReviewerId',
                'qaReviewerId',
              ].some((key) => (t.data as any)[key] === userId),
            ),
            '请先转交来源项目中未结束需求的责任（包括回收站中的需求）',
            409,
          );
          await tx.projectMember.delete({
            where: { projectId_userId: { projectId: data.sourceId, userId } },
          });
        }
        const existing = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId: data.targetId, userId } },
        });
        const roles = [...new Set([...(existing?.roles || []), ...data.roles])];
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: data.targetId, userId } },
          create: { projectId: data.targetId, userId, roles },
          update: { roles },
        });
        await record(tx, r, id, userId, 'MEMBER_PROJECT_MOVE');
      });
      s.json({ ok: true });
    }),
  );

  router.patch(
    '/workspaces/:id/members/:userId',
    wrap(async (r, s) => {
      const id = String(r.params.id),
        userId = String(r.params.userId);
      const data = z
        .object({
          displayName: z.string().trim().max(80),
          role: z.enum(['ADMIN', 'MEMBER']).optional(),
        })
        .strict()
        .parse(r.body);
      await workspace(r, id, true);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
        assert(
          (
            await tx.workspaceMember.findUnique({
              where: {
                workspaceId_userId: { workspaceId: id, userId: r.user.id },
              },
            })
          )?.role === 'ADMIN',
          '需要团队管理员权限',
          403,
        );
        const member = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: id, userId } },
        });
        assert(member, '成员不存在', 404);
        if (member.role === 'ADMIN' && data.role === 'MEMBER')
          assert(
            (await tx.workspaceMember.count({
              where: { workspaceId: id, role: 'ADMIN' },
            })) > 1,
            '必须保留至少一位管理员',
            409,
          );
        const result = await tx.workspaceMember.updateMany({
          where: { workspaceId: id, userId },
          data: {
            displayName: data.displayName || null,
            ...(data.role ? { role: data.role } : {}),
          },
        });
        assert(result.count, '成员不存在', 404);
        await record(tx, r, id, userId, 'MEMBER_PROFILE');
      });
      s.json({ ok: true });
    }),
  );

  router.get(
    '/workspaces/:id/member-transfer-targets',
    wrap(async (r, s) => {
      const id = String(r.params.id);
      await workspace(r, id, true);
      const memberships = await db.workspaceMember.findMany({
        where: { userId: r.user.id, role: 'ADMIN', workspaceId: { not: id } },
      });
      s.json(
        await db.workspace.findMany({
          where: { id: { in: memberships.map((m) => m.workspaceId) } },
          select: { id: true, name: true },
        }),
      );
    }),
  );

  router.post(
    '/workspaces/:id/members/:userId/transfer',
    wrap(async (r, s) => {
      const id = String(r.params.id),
        userId = String(r.params.userId);
      const { targetWorkspaceId } = z
        .object({ targetWorkspaceId: z.string().min(1) })
        .strict()
        .parse(r.body);
      assert(targetWorkspaceId !== id, '请选择其他团队');
      await workspace(r, id, true);
      await workspace(r, targetWorkspaceId, true);
      await db.$transaction(async (tx) => {
        for (const wid of [id, targetWorkspaceId].sort())
          await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${wid} FOR UPDATE`;
        assert(
          (
            await tx.workspaceMember.findUnique({
              where: {
                workspaceId_userId: {
                  workspaceId: targetWorkspaceId,
                  userId: r.user.id,
                },
              },
            })
          )?.role === 'ADMIN',
          '需要目标团队管理员权限',
          403,
        );
        const member = await removeTeamMember(tx, r, id, userId);
        await tx.workspaceMember.upsert({
          where: {
            workspaceId_userId: { workspaceId: targetWorkspaceId, userId },
          },
          create: {
            workspaceId: targetWorkspaceId,
            userId,
            role: 'MEMBER',
            displayName: member.displayName,
          },
          update: {},
        });
        await record(tx, r, id, userId, 'MEMBER_TRANSFER_OUT');
        await record(tx, r, targetWorkspaceId, userId, 'MEMBER_TRANSFER_IN');
      });
      s.json({ ok: true });
    }),
  );

  router.delete(
    '/workspaces/:id/members/:userId',
    wrap(async (r, s) => {
      const id = String(r.params.id),
        userId = String(r.params.userId);
      await workspace(r, id, true);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
        await removeTeamMember(tx, r, id, userId);
      });
      s.json({ ok: true });
    }),
  );

  router.post(
    '/workspaces/:id/invitations',
    wrap(async (r, s) => {
      const id = String(r.params.id);
      await workspace(r, id, true);
      const email = z.email().parse(r.body.email).toLowerCase(),
        token = randomBytes(32).toString('hex');
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
        assert(
          (
            await tx.workspaceMember.findUnique({
              where: {
                workspaceId_userId: { workspaceId: id, userId: r.user.id },
              },
            })
          )?.role === 'ADMIN',
          '需要团队管理员权限',
          403,
        );
        const invitation = await tx.invitation.create({
          data: {
            workspaceId: id,
            email,
            hash: hash(token),
            expiresAt: new Date(Date.now() + 7 * 86400000),
          },
        });
        await record(tx, r, id, invitation.id, 'INVITATION_CREATE');
      });
      s.json({ url: `${origin}/?invite=${token}`, expiresInDays: 7 });
    }),
  );

  router.post(
    '/invitations/accept',
    wrap(async (r, s) => {
      const token = z.string().parse(r.body.token);
      await db.$transaction(async (tx) => {
        const pending = await tx.invitation.findUnique({
          where: { hash: hash(token) },
        });
        assert(pending, '邀请无效或已过期');
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${pending.workspaceId} FOR UPDATE`;
        const i = await tx.invitation.findUnique({
          where: { hash: hash(token) },
        });
        assert(
          i && !i.acceptedAt && i.expiresAt.getTime() > Date.now(),
          '邀请无效或已过期',
        );
        assert(i.email === r.user.email, '邀请邮箱与当前账号不一致', 403);
        const updated = await tx.invitation.updateMany({
          where: { id: i.id, acceptedAt: null, expiresAt: { gt: new Date() } },
          data: { acceptedAt: new Date() },
        });
        assert(updated.count, '邀请已使用', 409);
        await tx.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: i.workspaceId,
              userId: r.user.id,
            },
          },
          create: {
            workspaceId: i.workspaceId,
            userId: r.user.id,
            role: 'MEMBER',
          },
          update: {},
        });
        await record(tx, r, i.workspaceId, i.id, 'INVITATION_ACCEPT');
      });
      s.json({ ok: true });
    }),
  );

  router.delete(
    '/projects/:id/members/:userId',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id), true, true);
      await workspace(r, p.workspaceId, true);
      const userId = String(r.params.userId);
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, p.id, true);
        const tasks = await tx.task.findMany({
          where: {
            projectId: p.id,
            status: { notIn: ['CLOSED', 'CANCELLED'] },
          },
        });
        assert(
          !tasks.some((t) =>
            [
              'productId',
              'engineerId',
              'productReviewerId',
              'qaReviewerId',
              'testerId',
            ].some((k) => (t.data as any)[k] === userId),
          ),
          '请先转交未结束任务的责任',
        );
        await tx.projectMember.delete({
          where: { projectId_userId: { projectId: p.id, userId } },
        });
        await record(tx, r, p.workspaceId, p.id, 'PROJECT_MEMBER_REMOVE');
      });
      s.json({ ok: true });
    }),
  );
}

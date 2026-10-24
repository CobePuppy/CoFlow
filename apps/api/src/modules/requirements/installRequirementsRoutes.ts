import { notifyDiscussion } from './discussion-notifications.js';
import { discussionView } from '@coflow/contracts/discussion.js';
import { isOverdue } from '@coflow/contracts/deadline.js';

import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';

import { randomUUID } from 'node:crypto';

import { actions, terminal } from '@coflow/contracts/index.js';
import {
  compareRequirements,
  matchesRequirementSearch,
  requirementSorts,
  type RequirementSort,
} from '@coflow/contracts/requirement-list.js';
import { z } from 'zod';
import {
  allowedActions,
  assert,
  execute,
  handlers,
  metrics,
  required,
} from './domain.js';

import {
  actionHandler,
  asTask,
  changeTrash,
  db,
  draftSchema,
  members,
  page,
  project,
  projectWrite,
  record,
  save,
  task,
  validateDraftOwners,
  workspace,
  wrap,
} from '../../shared/context.js';
export function installRequirementsRoutes(router: express.Router) {
  router.get(
    '/projects/:id/tasks',
    wrap(async (r, s) => {
      const projectInfo = await project(r, String(r.params.id));
      const teamMember = await workspace(r, projectInfo.workspaceId);
      const trash = r.query.scope === 'trash';
      let items = (
        await db.task.findMany({
          where: {
            projectId: String(r.params.id),
            deletedAt: trash ? { not: null } : null,
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        })
      ).map(asTask);
      const scope = String(
        r.query.scope || (r.query.status ? 'all' : 'active'),
      );
      if (scope === 'active') items = items.filter((t) => !terminal(t.status));
      if (scope === 'ended') items = items.filter((t) => terminal(t.status));
      if (scope === 'handling')
        items = items.filter(
          (t) => !terminal(t.status) && handlers(t).includes(r.user.id),
        );
      if (scope === 'mine')
        items = items.filter((t) =>
          [
            t.data.productId,
            t.data.engineerId,
            t.data.testerId,
            t.data.productReviewerId,
            t.data.qaReviewerId,
          ].includes(r.user.id),
        );
      if (scope === 'overdue')
        items = items.filter(
          (t) => !terminal(t.status) && isOverdue(t.data.dueAt),
        );
      for (const k of ['status', 'priority', 'blocked', 'owner', 'q']) {
        const v = String(r.query[k] || '');
        if (v)
          items = items.filter((t) =>
            k === 'status'
              ? t.status === v
              : k === 'priority'
                ? t.data.priority === v
                : k === 'blocked'
                  ? t.data.blocks.some((b) => !b.end) === (v === 'true')
                  : k === 'owner'
                    ? [
                        t.data.productId,
                        t.data.engineerId,
                        t.data.testerId,
                        t.data.productReviewerId,
                        t.data.qaReviewerId,
                      ].includes(v)
                    : matchesRequirementSearch(t, v),
          );
      }
      const sort = String(r.query.sort || 'updated');
      assert(requirementSorts.includes(sort as any), '排序方式无效');
      items.sort((a, b) => compareRequirements(sort as RequirementSort, a, b));
      const p = page(r);
      s.json({
        ...p,
        total: items.length,
        canManage: teamMember.role === 'ADMIN',
        readOnly: !!projectInfo.archivedAt,
        items: items.slice((p.page - 1) * p.pageSize, p.page * p.pageSize),
      });
    }),
  );

  router.post(
    '/projects/:id/tasks',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id), true);
      assert(
        p.workflow === 'SIMPLE' ||
          p.member?.roles.some((x) =>
            ['PRODUCT', 'QA', 'ENGINEER'].includes(x),
          ),
        '无权创建任务',
        403,
      );
      const input = draftSchema.parse({
        ...r.body,
        productId: r.body.productId || r.user.id,
      });
      await validateDraftOwners(p.id, input);
      const submit = z.boolean().default(false).parse(r.body.submit);
      if (submit)
        assert(
          input.productId === r.user.id,
          '请以需求负责人身份提交，或保存草稿交给负责人',
          403,
        );
      if (input.type === 'BUG') {
        assert(
          input.parentId && input.severity && input.parentRound,
          '缺陷必须关联父任务及测试轮次',
        );
        const parent = await task(r, input.parentId);
        assert(
          parent.projectId === p.id &&
            (parent.data as any).tests.some(
              (t: any) => t.round === input.parentRound,
            ),
          '父任务或测试轮次无效',
        );
      } else assert(!input.parentId, '普通需求不能指定缺陷父任务');
      s.json(
        await db.$transaction(async (tx) => {
          await projectWrite(tx, r, p.id);
          await validateDraftOwners(p.id, input);
          const project = await tx.project.update({
            where: { id: p.id },
            data: { sequence: { increment: 1 } },
          });
          const created = await tx.task.create({
            data: {
              workspaceId: p.workspaceId,
              projectId: p.id,
              number: project.sequence,
              data: {
                ...input,
                workflow: p.workflow as 'SIMPLE' | 'STANDARD',
                createdBy: r.user.id,
                requirementVersion: 0,
                requirements: [],
                solutions: [],
                reviews: [],
                development: [],
                tests: [],
                acceptances: [],
                changes: [],
                blocks: [],
                comments: [],
                history: [],
              },
            },
          });
          if (!submit) return created;
          const people = await members(p.id);
          const next = execute(
            asTask(created),
            'SUBMIT_REQUIREMENT',
            {},
            people.find((m) => m.id === r.user.id)!,
            people,
          );
          const saved = await tx.task.update({
            where: { id: created.id },
            data: {
              status: next.status,
              version: next.version,
              data: next.data as any,
            },
          });
          await record(tx, r, p.workspaceId, created.id, 'SUBMIT_REQUIREMENT');
          if (input.engineerId && input.engineerId !== r.user.id)
            await tx.notification.create({
              data: {
                recipientId: input.engineerId,
                workspaceId: p.workspaceId,
                projectId: p.id,
                taskId: saved.id,
                message: next.data.title + '：待你处理',
                dedupe: saved.id + ':submit:' + input.engineerId,
              },
            });
          return saved;
        }),
      );
    }),
  );

  router.get(
    '/tasks/:id',
    wrap(async (r, s) => {
      const t = await task(
        r,
        String(r.params.id),
        false,
        r.query.omitComments === 'true',
      );
      const people = await members(t.projectId);
      const p = await project(r, t.projectId);
      const isAdmin = (await workspace(r, t.workspaceId)).role === 'ADMIN';
      s.json({
        ...t,
        handlerIds: handlers(asTask(t)),
        readOnly: !!p.archivedAt || !!t.deletedAt,
        canManage: isAdmin,
        editableFields:
          !p.archivedAt &&
          !t.deletedAt &&
          !['CLOSED', 'CANCELLED'].includes(t.status) &&
          ((t.data as any).productId === r.user.id || isAdmin) &&
          people.some((m) => m.id === r.user.id)
            ? ['priority', 'dueAt']
            : [],
        allowedActions:
          p.archivedAt || t.deletedAt
            ? []
            : allowedActions(
                asTask(t),
                people.find((m) => m.id === r.user.id)!,
                isAdmin,
              ),
        attachments: await db.attachment.findMany({
          where: { taskId: t.id, deletedAt: null },
          select: {
            id: true,
            name: true,
            size: true,
            createdAt: true,
            stage: true,
            stageVersion: true,
          },
        }),
      });
    }),
  );

  router.patch(
    '/tasks/:id/properties',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id), true);
      const input = z
        .object({
          expectedVersion: z.number().int().positive(),
          priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
          dueAt: z.iso.datetime().nullable().optional(),
        })
        .strict()
        .parse(r.body);
      assert(
        input.priority !== undefined || input.dueAt !== undefined,
        '请选择需要修改的字段',
      );
      const result = await db.$transaction(async (tx) => {
        await projectWrite(tx, r, t.projectId);
        const fresh = await tx.task.findUnique({ where: { id: t.id } });
        assert(
          fresh && !fresh.deletedAt && fresh.version === input.expectedVersion,
          '版本冲突，请保留选择并刷新',
          409,
        );
        const data = fresh.data as any;
        const pm = await tx.projectMember.findUnique({
          where: {
            projectId_userId: { projectId: t.projectId, userId: r.user.id },
          },
        });
        assert(
          !!pm &&
            (data.productId === r.user.id ||
              (
                await tx.workspaceMember.findUnique({
                  where: {
                    workspaceId_userId: {
                      workspaceId: t.workspaceId,
                      userId: r.user.id,
                    },
                  },
                })
              )?.role === 'ADMIN'),
          '仅需求负责人或团队管理员可修改基本信息',
          403,
        );
        assert(
          !['CLOSED', 'CANCELLED'].includes(fresh.status),
          '终态任务仅可查看',
          409,
        );
        const changes: Record<string, any> = {};
        if (input.priority !== undefined) {
          changes.priority = { from: data.priority, to: input.priority };
          data.priority = input.priority;
        }
        if (input.dueAt !== undefined) {
          changes.dueAt = { from: data.dueAt || null, to: input.dueAt };
          if (input.dueAt === null) delete data.dueAt;
          else data.dueAt = input.dueAt;
        }
        data.history.push({
          id: randomUUID(),
          at: new Date().toISOString(),
          actor: r.user.id,
          name: r.user.name,
          action: 'UPDATE_PROPERTIES',
          from: fresh.status,
          to: fresh.status,
          payload: { changes },
        });
        const updated = await tx.task.updateMany({
          where: { id: t.id, version: input.expectedVersion, deletedAt: null },
          data: { data, version: { increment: 1 } },
        });
        assert(updated.count, '版本冲突，请保留选择并刷新', 409);
        await record(tx, r, t.workspaceId, t.id, 'UPDATE_PROPERTIES');
        for (const uid of new Set([
          data.productId,
          data.engineerId,
          data.testerId,
        ]))
          if (uid && uid !== r.user.id)
            await tx.notification.create({
              data: {
                recipientId: uid,
                workspaceId: t.workspaceId,
                projectId: t.projectId,
                taskId: t.id,
                message: `${data.title}：基本信息已更新`,
                dedupe: `${t.id}:${fresh.version + 1}:${uid}`,
              },
            });
        return tx.task.findUnique({ where: { id: t.id } });
      });
      s.json(result);
    }),
  );

  router.patch(
    '/tasks/:id',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id), true),
        d = t.data as any;
      assert(t.status === 'DRAFT', '已提交需求只能通过变更流程修改', 409);
      assert(d.productId === r.user.id, '仅产品负责人可编辑', 403);
      assert(
        !('status' in r.body) && !('version' in r.body) && !('data' in r.body),
        '状态与内部版本只能通过业务动作修改',
      );
      const input = draftSchema.parse({ ...d, ...r.body });
      const targetId = z.string().parse(r.body.projectId || t.projectId);
      await validateDraftOwners(targetId, input);
      if (targetId !== t.projectId) {
        const target = await project(r, targetId, true);
        assert(target.workspaceId === t.workspaceId, '只能调整到同团队项目');
        assert(
          d.type !== 'BUG' && input.type !== 'BUG' && !input.parentId,
          '关联缺陷不能跨项目调整',
          409,
        );
        const expected = z
          .number()
          .int()
          .positive()
          .parse(r.body.expectedVersion);
        const moved = await db.$transaction(async (tx) => {
          for (const id of [t.projectId, targetId].sort())
            await projectWrite(tx, r, id);
          await validateDraftOwners(targetId, input);
          const latest = await tx.task.findUnique({ where: { id: t.id } });
          assert(
            latest?.version === expected &&
              !latest.deletedAt &&
              latest.status === 'DRAFT' &&
              (latest.data as any).productId === r.user.id,
            '版本冲突，请刷新',
            409,
          );
          assert(
            (latest.data as any).requirements.length === 0,
            '已提交过的需求不能调整所属项目',
            409,
          );
          const refs = await Promise.all([
            tx.iterationTask.count({ where: { taskId: t.id } }),
            tx.projectAction.count({ where: { taskId: t.id } }),
            tx.projectGoalTask.count({ where: { taskId: t.id } }),
            tx.taskResource.count({ where: { taskId: t.id } }),
            tx.taskGitHub
              .findUnique({ where: { taskId: t.id } })
              .then((binding) =>
                binding && !(binding.data as any).unlinked ? 1 : 0,
              ),
            tx.attachment.count({ where: { taskId: t.id } }),
            tx.document.count({ where: { taskIds: { has: t.id } } }),
            tx.notification.count({ where: { taskId: t.id } }),
            tx.task.count({
              where: { data: { path: ['parentId'], equals: t.id } },
            }),
          ]);
          assert(
            refs.every((n) => n === 0),
            '需求已有关联材料、迭代、行动、通知或缺陷；有行动历史的需求应保留原项目',
            409,
          );
          const linkedPlans = [
            ...(await tx.proofBoard.findMany({
              where: { projectId: t.projectId },
              select: { data: true },
            })),
            ...(await tx.projectFork.findMany({
              where: { projectId: t.projectId },
              select: { data: true },
            })),
          ];
          assert(
            !linkedPlans.some((x) => JSON.stringify(x.data).includes(t.id)),
            '需求仍关联成果验证或项目分身，请先解除关联再调整项目',
            409,
          );
          const dest = await tx.project.update({
            where: { id: targetId },
            data: { sequence: { increment: 1 } },
          });
          const result = await tx.task.updateMany({
            where: { id: t.id, version: expected },
            data: {
              projectId: targetId,
              number: dest.sequence,
              data: { ...d, ...input },
              version: { increment: 1 },
            },
          });
          assert(result.count, '版本冲突', 409);
          await record(tx, r, t.workspaceId, t.id, 'DRAFT_PROJECT_CHANGE');
          return tx.task.findUnique({ where: { id: t.id } });
        });
        s.json(moved);
        return;
      }
      assert(
        input.parentId === d.parentId &&
          input.type === d.type &&
          input.parentRound === d.parentRound,
        '不能修改缺陷关联',
      );
      s.json(await save(r, t, { ...d, ...input }));
    }),
  );

  router.delete(
    '/tasks/:id',
    wrap(async (r, s) => s.json(await changeTrash(r, false))),
  );

  router.post(
    '/tasks/:id/restore',
    wrap(async (r, s) => s.json(await changeTrash(r, true))),
  );

  router.delete(
    '/tasks/:id/permanent',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id));
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, t.projectId);
        const member = await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: t.workspaceId,
              userId: r.user.id,
            },
          },
        });
        assert(member?.role === 'ADMIN', '仅团队管理员可永久删除', 403);
        const fresh = await tx.task.findUnique({ where: { id: t.id } });
        assert(fresh?.deletedAt, '请先移入回收站', 409);
        assert(
          fresh.version ===
            z.number().int().positive().parse(r.body.expectedVersion),
          '版本冲突',
          409,
        );
        assert(
          r.body.confirmTitle === (fresh.data as any).title,
          '请输入需求标题确认永久删除',
        );
        assert(
          !(await tx.document.count({ where: { taskIds: { has: t.id } } })),
          '仍有文档引用，请保留回收站记录',
          409,
        );
        assert(
          !(await tx.task.count({
            where: { data: { path: ['parentId'], equals: t.id } },
          })),
          '仍有缺陷引用，请保留回收站记录',
          409,
        );
        const plans = [
          ...(await tx.proofBoard.findMany({
            where: { projectId: t.projectId },
            select: { data: true },
          })),
          ...(await tx.projectFork.findMany({
            where: { projectId: t.projectId },
            select: { data: true },
          })),
        ];
        assert(
          !plans.some((x) => JSON.stringify(x.data).includes(t.id)),
          '仍有成果验证或项目分身引用，请保留回收站记录',
          409,
        );
        await tx.notification.deleteMany({ where: { taskId: t.id } });
        assert(
          !(await tx.projectAction.count({ where: { taskId: t.id } })),
          '仍有行动历史，请保留回收站记录',
          409,
        );
        await tx.attachment.deleteMany({ where: { taskId: t.id } });
        assert(
          !(await tx.projectGoalTask.count({ where: { taskId: t.id } })),
          '仍有目标引用，请先解除目标关联或保留回收站记录',
          409,
        );
        await tx.task.delete({ where: { id: t.id } });
        await record(tx, r, t.workspaceId, t.id, 'TASK_PURGE');
      });
      s.json({ ok: true });
    }),
  );

  router.post('/tasks/:id/actions', actionHandler);

  router.post('/tasks/:id/blocks', (r, s, n) => {
    r.body = {
      action: 'BLOCK',
      expectedVersion: r.body.expectedVersion,
      payload: { reason: r.body.reason },
    };
    actionHandler(r, s, n);
  });

  router.post(
    '/tasks/:id/blocks/:blockId/resolve',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id), true);
      assert(
        (t.data as any).blocks.some(
          (b: any) => b.id === r.params.blockId && !b.end,
        ),
        '当前阻塞不存在',
        404,
      );
      r.body = {
        action: 'UNBLOCK',
        expectedVersion: r.body.expectedVersion,
        payload: { reason: r.body.reason },
      };
      await new Promise<void>((resolve, reject) => {
        s.once('finish', resolve);
        actionHandler(r, s, reject);
      });
    }),
  );

  router.post('/tasks/:id/solutions', (r, s, n) => {
    if (r.body.submit === true) {
      r.body = {
        action: 'SUBMIT_SOLUTION',
        expectedVersion: r.body.expectedVersion,
        payload: r.body.payload,
      };
      actionHandler(r, s, n);
      return;
    }
    wrap(async (req, res) => {
      const t = await task(req, String(req.params.id), true),
        d = t.data as any;
      assert(t.status === 'SOLUTION_PENDING', '当前阶段不能编辑方案草稿', 409);
      const p = await project(req, t.projectId, true);
      assert(d.engineerId === req.user.id, '只有指定研发可保存方案草稿', 403);
      const draft = z
        .object({
          body: z.string().max(100000).default(''),
          scope: z.string().max(10000).default(''),
          effort: z.number().nonnegative().default(0),
          risk: z.string().max(10000).default(''),
          start: z.string().max(50).default(''),
          end: z.string().max(50).default(''),
        })
        .parse(req.body.payload);
      d.solutionDraft = {
        ...draft,
        by: req.user.id,
        at: new Date().toISOString(),
        requirementVersion: d.requirementVersion,
      };
      res.json(await save(req, t, d));
    })(r, s, n);
  });

  router.post(
    '/tasks/:id/requirement-changes',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id), true);
      assert(
        !terminal(t.status as any) && t.status !== 'DRAFT',
        '当前阶段不能提出变更',
      );
      const p = await project(r, t.projectId, true);
      assert(
        p.member?.roles.some((role) =>
          ['PRODUCT', 'ENGINEER', 'QA'].includes(role),
        ),
        '当前角色不能提出需求变更',
        403,
      );
      required(r.body, ['description', 'reason', 'impact']);
      const d = t.data as any;
      d.changes.push({
        id: randomUUID(),
        description: r.body.description,
        reason: r.body.reason,
        impact: r.body.impact,
        by: r.user.id,
        at: new Date().toISOString(),
        decision: 'PROPOSED',
      });
      s.json(await save(r, t, d));
    }),
  );

  router.get(
    '/tasks/:id/timeline',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id));
      const d = t.data as any;
      const attachments = await db.attachment.findMany({
        where: { taskId: t.id, deletedAt: null },
        select: { id: true, name: true, userId: true, createdAt: true },
      });
      const audit = await db.auditEvent.findMany({
        where: { workspaceId: t.workspaceId, resourceId: t.id },
        orderBy: { createdAt: 'asc' },
      });
      const events = [
        ...d.history.map((h: any) => ({ ...h, type: 'TRANSITION' })),
        ...d.comments.map((c: any) => ({ ...c, type: 'COMMENT' })),
        ...d.changes
          .filter((c: any) => c.decision === 'PROPOSED')
          .map((c: any) => ({ ...c, type: 'CHANGE_PROPOSAL' })),
        ...attachments.map((a) => ({
          ...a,
          type: 'ATTACHMENT',
          at: a.createdAt,
        })),
        ...audit
          .filter(
            (a) =>
              !actions.includes(a.action as any) &&
              !['COMMENT', 'ATTACHMENT'].includes(a.action),
          )
          .map((a) => ({ ...a, type: 'AUDIT', at: a.createdAt })),
      ];
      s.json(
        events.sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at)),
      );
    }),
  );

  router.get(
    '/tasks/:id/comments',
    wrap(async (r, s) =>
      s.json(((await task(r, String(r.params.id))).data as any).comments),
    ),
  );

  router.post(
    '/tasks/:id/comments',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id), true);
      const body = z.string().trim().min(1).max(20000).parse(r.body.body),
        mentions = z
          .array(z.string())
          .max(50)
          .parse(r.body.mentions || []);
      const people = await members(t.projectId);
      assert(
        mentions.every((id) => people.some((m) => m.id === id)),
        '只能提及项目成员',
      );
      assert(
        z.number().int().positive().parse(r.body.expectedVersion) === t.version,
        '版本冲突，请保留输入并刷新',
        409,
      );
      const d = t.data as any;
      const kind = z
        .enum(['COMMENT', 'QUESTION', 'DECISION'])
        .parse(r.body.kind || 'COMMENT');
      const replyTo = z.string().uuid().optional().parse(r.body.replyTo);
      if (replyTo) {
        assert(
          d.comments.some((c: any) => c.id === replyTo && !c.replyTo),
          '回复的讨论不存在',
          404,
        );
        assert(kind === 'COMMENT', '回复不能创建新的问题或决策');
      }
      const assigneeId =
        kind === 'QUESTION'
          ? z
              .string()
              .uuid()
              .parse(r.body.assigneeId || r.user.id)
          : undefined;
      const dueAt =
        kind === 'QUESTION'
          ? z.iso
              .date()
              .nullable()
              .parse(r.body.dueAt ?? null)
          : undefined;
      if (assigneeId)
        assert(
          people.some((m) => m.id === assigneeId),
          '负责人须为当前项目成员',
        );
      const parent = replyTo
        ? discussionView(d.comments).find((c) => c.id === replyTo)
        : undefined;
      const comment = {
        id: randomUUID(),
        ...(assigneeId ? { assigneeId, dueAt } : {}),
        body,
        mentions,
        kind,
        ...(replyTo ? { replyTo } : {}),
        requirementVersion: d.requirementVersion,
        by: r.user.id,
        name: r.user.name,
        at: new Date().toISOString(),
      };
      d.comments.push(comment);
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, t.projectId);
        const current = await tx.projectMember.findMany({
          where: { projectId: t.projectId },
        });
        assert(
          mentions.every((id) => current.some((m) => m.userId === id)),
          '提及成员已移出项目',
          409,
        );
        if (assigneeId)
          assert(
            current.some((m) => m.userId === assigneeId),
            '负责人已移出项目',
            409,
          );
        const u = await tx.task.updateMany({
          where: { id: t.id, version: r.body.expectedVersion, deletedAt: null },
          data: { data: d, version: { increment: 1 } },
        });
        assert(u.count, '版本冲突，请刷新', 409);
        await record(tx, r, t.workspaceId, t.id, 'COMMENT');
        await notifyDiscussion(
          tx,
          r,
          t,
          {
            id: comment.id,
            discussionId: replyTo || comment.id,
            message:
              kind === 'QUESTION'
                ? r.user.name + ' 创建并指派了澄清问题'
                : replyTo
                  ? r.user.name + ' 回复了讨论'
                  : r.user.name + ' 在评论中提及你',
          },
          [...mentions, assigneeId, parent?.by, parent?.assigneeId],
        );
      });
      s.json(comment);
    }),
  );

  router.get(
    '/me/todos',
    wrap(async (r, s) => {
      const ps = await db.projectMember.findMany({
          where: { userId: r.user.id },
        }),
        activeProjects = await db.project.findMany({
          where: { id: { in: ps.map((p) => p.projectId) }, archivedAt: null },
          select: { id: true },
        }),
        ts = await db.task.findMany({
          where: {
            projectId: { in: activeProjects.map((p) => p.id) },
            status: { notIn: ['CLOSED', 'CANCELLED'] },
            deletedAt: null,
          },
        });
      s.json(ts.map(asTask).filter((t) => handlers(t).includes(r.user.id)));
    }),
  );

  router.get(
    '/projects/:id/metrics',
    wrap(async (r, s) => {
      await project(r, String(r.params.id));
      s.json(
        metrics(
          (
            await db.task.findMany({
              where: { projectId: String(r.params.id), deletedAt: null },
            })
          ).map(asTask),
        ),
      );
    }),
  );
}

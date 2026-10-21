import { notifyDiscussion } from './discussion-notifications.js';
import { randomUUID } from 'node:crypto';
import { discussionView } from '@coflow/contracts/discussion.js';
import type { Router } from 'express';
import { z } from 'zod';
import { db, projectWrite, record, task, wrap } from '../../shared/access.js';
import { assert } from './domain.js';
export function installDiscussionRoutes(router: Router) {
  router.patch(
    '/tasks/:id/comments/:commentId',
    wrap(async (r, s) => {
      const input = z
        .object({
          expectedVersion: z.number().int().positive(),
          resolved: z.boolean(),
          reason: z.string().trim().min(1).max(2000),
        })
        .strict()
        .parse(r.body);
      const t = await task(r, String(r.params.id), true);
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, t.projectId);
        const current = await tx.task.findUniqueOrThrow({
          where: { id: t.id },
        });
        const data = current.data as any;
        const comment = discussionView(data.comments).find(
          (c: any) => c.id === r.params.commentId,
        );
        assert(
          comment && !comment.replyTo && comment.kind === 'QUESTION',
          '问题不存在',
          404,
        );
        assert(
          comment.by === r.user.id ||
            data.productId === r.user.id ||
            comment.assigneeId === r.user.id,
          '仅问题作者、跟进人或需求负责人可调整问题状态',
          403,
        );
        assert(
          !!comment.resolved !== input.resolved,
          '问题状态已变化，请刷新',
          409,
        );
        const eventId = randomUUID();
        data.comments.push({
          id: eventId,
          kind: 'QUESTION_STATE',
          replyTo: comment.id,
          requirementVersion: data.requirementVersion,
          resolved: input.resolved,
          body: input.reason,
          by: r.user.id,
          name: r.user.name,
          at: new Date().toISOString(),
        });
        const updated = await tx.task.updateMany({
          where: { id: t.id, deletedAt: null, version: input.expectedVersion },
          data: { data, version: { increment: 1 } },
        });
        assert(updated.count, '版本冲突，请保留输入并刷新', 409);
        await record(
          tx,
          r,
          t.workspaceId,
          t.id,
          input.resolved ? 'DISCUSSION_RESOLVE' : 'DISCUSSION_REOPEN',
        );
        await notifyDiscussion(
          tx,
          r,
          t,
          {
            id: eventId,
            discussionId: comment.id,
            message:
              r.user.name +
              (input.resolved ? ' 解决了澄清问题' : ' 重新打开了澄清问题'),
          },
          [comment.by, comment.assigneeId],
        );
      });
      s.json({ ok: true });
    }),
  );
  router.patch(
    '/tasks/:id/comments/:commentId/assignment',
    wrap(async (r, s) => {
      const input = z
        .object({
          expectedVersion: z.number().int().positive(),
          assigneeId: z.string().uuid().nullable(),
          dueAt: z.iso.date().nullable(),
          reason: z.string().trim().min(1).max(2000),
        })
        .strict()
        .parse(r.body);
      const t = await task(r, String(r.params.id), true);
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, t.projectId);
        const fresh = await tx.task.findUniqueOrThrow({ where: { id: t.id } });
        const data = fresh.data as any;
        const comment = discussionView(data.comments).find(
          (c) => c.id === r.params.commentId,
        );
        assert(
          comment && comment.kind === 'QUESTION' && !comment.replyTo,
          '问题不存在',
          404,
        );
        assert(
          comment.by === r.user.id ||
            comment.assigneeId === r.user.id ||
            data.productId === r.user.id,
          '仅问题作者、跟进人或需求负责人可调整安排',
          403,
        );
        if (input.assigneeId)
          assert(
            (await tx.projectMember.findUnique({
              where: {
                projectId_userId: {
                  projectId: t.projectId,
                  userId: input.assigneeId,
                },
              },
            })) &&
              (await tx.workspaceMember.findUnique({
                where: {
                  workspaceId_userId: {
                    workspaceId: t.workspaceId,
                    userId: input.assigneeId,
                  },
                },
              })),
            '负责人须为当前项目成员',
          );
        const id = randomUUID();
        data.comments.push({
          id,
          kind: 'QUESTION_ASSIGNMENT',
          replyTo: comment.id,
          assigneeId: input.assigneeId,
          dueAt: input.dueAt,
          body: input.reason,
          by: r.user.id,
          name: r.user.name,
          at: new Date().toISOString(),
          requirementVersion: data.requirementVersion,
        });
        const updated = await tx.task.updateMany({
          where: { id: t.id, version: input.expectedVersion, deletedAt: null },
          data: { data, version: { increment: 1 } },
        });
        assert(updated.count, '版本冲突，请保留输入并刷新', 409);
        await record(tx, r, t.workspaceId, t.id, 'DISCUSSION_ASSIGN');
        await notifyDiscussion(
          tx,
          r,
          t,
          {
            id,
            discussionId: comment.id,
            message: r.user.name + ' 调整了澄清问题的跟进安排',
          },
          [comment.by, comment.assigneeId, input.assigneeId],
        );
      });
      s.json({ ok: true });
    }),
  );
}

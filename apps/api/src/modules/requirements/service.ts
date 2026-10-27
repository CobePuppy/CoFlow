import 'dotenv/config';
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { actions } from '@coflow/contracts/index.js';
import { z } from 'zod';
import { assert, execute, handlers } from './domain.js';

import { parsePayload } from './validation.js';

import {
  asTask,
  canonical,
  db,
  hash,
  members,
  projectWrite,
  record,
  task,
  wrap,
  type AuthRequest,
} from '../../shared/access.js';
async function validateDraftOwners(projectId: string, d: any) {
  const people = await members(projectId);
  const needed: Record<string, string[]> = {
    productId: ['PRODUCT'],
    engineerId: ['ENGINEER'],
    productReviewerId: ['PRODUCT'],
    qaReviewerId: ['QA'],
    testerId: ['QA', 'OPS'],
  };
  assert(d.productId, '草稿必须指定产品负责人');
  for (const [key, roles] of Object.entries(needed))
    if (d[key])
      assert(
        people.some((m) => m.id === d[key]),
        `${key} 必须属于当前项目`,
      );
}
const draftSchema = z.object({
  title: z.string().min(1).max(200),
  background: z.string().max(10000).default(''),
  goal: z.string().max(10000).default(''),
  description: z.string().max(100000).default(''),
  criteria: z.array(z.string().max(2000)).max(100).default([]),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2'),
  productId: z.string().default(''),
  engineerId: z.string().default(''),
  productReviewerId: z.string().default(''),
  qaReviewerId: z.string().default(''),
  testerId: z.string().default(''),
  dueAt: z.iso.datetime().optional(),
  type: z.enum(['REQUIREMENT', 'BUG']).default('REQUIREMENT'),
  severity: z.enum(['BLOCKER', 'MAJOR', 'MINOR']).optional(),
  parentId: z.string().optional(),
  parentRound: z.number().int().optional(),
});
async function changeTrash(r: AuthRequest, restore: boolean) {
  const t = await task(r, String(r.params.id));
  const expected = z.number().int().positive().parse(r.body.expectedVersion);
  return db.$transaction(async (tx) => {
    await projectWrite(tx, r, t.projectId);
    const team = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: t.workspaceId, userId: r.user.id },
      },
    });
    const fresh = await tx.task.findUnique({ where: { id: t.id } });
    assert(fresh && fresh.version === expected, '版本冲突，请刷新后重试', 409);
    const d = fresh.data as any;
    assert(
      team?.role === 'ADMIN' ||
        d.productId === r.user.id ||
        d.createdBy === r.user.id,
      '仅创建人、需求负责人或团队管理员可管理回收站',
      403,
    );
    assert(
      restore ? !!fresh.deletedAt : !fresh.deletedAt,
      restore ? '需求不在回收站' : '需求已移入回收站',
      409,
    );
    const history = [
      ...d.history,
      {
        id: randomUUID(),
        at: new Date().toISOString(),
        actor: r.user.id,
        name: r.user.name,
        action: restore ? 'TASK_RESTORE' : 'TASK_TRASH',
        from: fresh.status,
        to: fresh.status,
        payload: {},
      },
    ];
    const result = await tx.task.updateMany({
      where: { id: t.id, version: expected },
      data: {
        deletedAt: restore ? null : new Date(),
        deletedBy: restore ? null : r.user.id,
        version: { increment: 1 },
        data: { ...d, history },
      },
    });
    assert(result.count, '版本冲突', 409);
    await record(
      tx,
      r,
      t.workspaceId,
      t.id,
      restore ? 'TASK_RESTORE' : 'TASK_TRASH',
    );
    return { ok: true };
  });
}
const actionHandler = wrap(async (r, s) => {
  const t = await task(r, String(r.params.id), true);
  const input = z
    .object({
      action: z.enum(actions),
      expectedVersion: z.number().int().positive(),
      payload: z.record(z.string(), z.any()).default({}),
    })
    .parse(r.body);
  const key = z.string().min(8).max(200).parse(r.headers['idempotency-key']);
  const digest = hash(JSON.stringify(canonical({ id: t.id, ...input })));
  input.payload = parsePayload(input.action, input.payload);
  const result = await db.$transaction(async (tx) => {
    // Lock project before checking membership/archive to serialize administration and business writes.
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${t.projectId} FOR UPDATE`;
    const p = await tx.project.findUnique({ where: { id: t.projectId } });
    assert(p && !p.archivedAt, '项目已归档', 409);
    const ms = await tx.projectMember.findMany({
      where: { projectId: t.projectId },
    });
    assert(
      ms.some((m) => m.userId === r.user.id),
      '不是项目成员',
      403,
    );
    const old = await tx.idempotencyRecord.findUnique({
      where: { userId_key: { userId: r.user.id, key } },
    });
    if (old) {
      assert(old.digest === digest, '幂等键已被其他请求使用', 409);
      return old.result;
    }
    const fresh = await tx.task.findUnique({ where: { id: t.id } });
    assert(
      fresh && fresh.version === input.expectedVersion,
      '版本冲突，请刷新后重试，保留当前输入',
      409,
    );
    const users = await tx.user.findMany({
      where: { id: { in: ms.map((m) => m.userId) } },
      select: { id: true, name: true, email: true },
    });
    const people = users.map((u) => ({
      ...u,
      roles: ms.find((m) => m.userId === u.id)!.roles as any,
    }));
    const me = people.find((m) => m.id === r.user.id)!;
    if (input.action === 'FAIL_TEST') {
      const ids = z
        .array(z.string())
        .min(1)
        .max(100)
        .parse(input.payload.defectIds);
      const bugs = await tx.task.findMany({
        where: { id: { in: ids }, projectId: t.projectId },
      });
      assert(
        bugs.length === new Set(ids).size &&
          bugs.every(
            (b) =>
              (b.data as any).type === 'BUG' &&
              (b.data as any).parentId === t.id &&
              (b.data as any).parentRound === (fresh.data as any).tests.length,
          ),
        '缺陷必须属于本任务当前测试轮次',
      );
    }
    if (input.action === 'PASS_TEST') {
      const related = await tx.task.findMany({
        where: { projectId: t.projectId },
      });
      assert(
        !related.some(
          (b) =>
            (b.data as any).parentId === t.id &&
            (b.data as any).severity === 'BLOCKER' &&
            b.status !== 'CLOSED',
        ),
        '阻断缺陷尚未关闭',
      );
    }
    const next = execute(
      asTask(fresh),
      input.action,
      input.payload,
      me,
      people,
      undefined,
      (
        await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: t.workspaceId,
              userId: r.user.id,
            },
          },
        })
      )?.role === 'ADMIN',
      p.qualityGate === 'STRICT',
    );
    const update = await tx.task.updateMany({
      where: { id: t.id, version: input.expectedVersion },
      data: {
        status: next.status,
        version: next.version,
        data: next.data as any,
      },
    });
    assert(update.count, '版本冲突', 409);
    await record(tx, r, t.workspaceId, t.id, input.action);
    for (const uid of new Set([
      ...handlers(next),
      next.data.productId,
      next.data.engineerId,
      next.data.testerId,
    ]))
      if (uid && uid !== r.user.id)
        await tx.notification.create({
          data: {
            recipientId: uid,
            workspaceId: t.workspaceId,
            projectId: t.projectId,
            taskId: t.id,
            message: `${next.data.title}：${input.action}`,
            dedupe: `${t.id}:${next.version}:${uid}`,
          },
        });
    await tx.idempotencyRecord.create({
      data: {
        userId: r.user.id,
        key,
        digest,
        result: next as any,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    return next;
  });
  s.json(result);
});
export { actionHandler, changeTrash, draftSchema, validateDraftOwners };

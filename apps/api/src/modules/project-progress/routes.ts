import type { Router } from 'express';
import { z } from 'zod';
import {
  actionCreate,
  actionChange,
  compareCheckpoints,
  checkpointFollowUps,
  deliveryChecks,
  actionStatusLabels,
  actionFilters,
  matchesAction,
  progressBrief,
  type ProgressSnapshot,
} from '@coflow/contracts/project-progress.js';
import { terminal, type Task } from '@coflow/contracts/index.js';
import {
  db,
  hash,
  project,
  projectWrite,
  record,
  wrap,
} from '../../shared/access.js';
import { assert } from '../requirements/domain.js';
import { assistantSources } from '../ai/project-assistant.js';
import { readAssistantSnapshot } from '../ai/project-assistant-snapshot.js';

async function state(tx: any, id: string) {
  const tasks = await tx.task.findMany({
    where: { projectId: id },
    orderBy: { id: 'asc' },
    take: 501,
  });
  const actions = await tx.projectAction.findMany({
    where: { projectId: id },
    orderBy: { id: 'asc' },
    take: 501,
  });
  assert(
    tasks.length <= 500 && actions.length <= 500,
    '推进检查点暂支持最多500项需求与500项行动',
    422,
  );
  const snapshot: ProgressSnapshot = {
    tasks: tasks.map((t: any) => ({
      id: t.id,
      number: t.number,
      title: t.data.title,
      status: t.status,
      version: t.version,
      deleted: !!t.deletedAt,
    })),
    actions: actions.map((a: any) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      version: a.version,
    })),
  };
  return {
    tasks,
    actions,
    snapshot,
    fingerprint: hash(JSON.stringify(snapshot)),
  };
}
async function reviewer(tx: any, r: any, p: any, t: any) {
  const [m, team] = await Promise.all([
    tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: p.id, userId: r.user.id } },
    }),
    tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: p.workspaceId, userId: r.user.id },
      },
    }),
  ]);
  return (
    !!m &&
    !!team &&
    (team.role === 'ADMIN' ||
      m.roles.includes('PRODUCT') ||
      t?.data.productId === r.user.id)
  );
}
async function eligibleOwner(tx: any, p: any, id: string) {
  assert(
    (await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: p.id, userId: id } },
    })) &&
      (await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: p.workspaceId, userId: id },
        },
      })),
    '负责人必须是当前项目成员',
    422,
  );
}
async function idempotent(
  tx: any,
  r: any,
  key: string,
  input: any,
  run: () => Promise<any>,
) {
  const digest = hash(JSON.stringify(input));
  const old = await tx.idempotencyRecord.findUnique({
    where: { userId_key: { userId: r.user.id, key } },
  });
  if (old) {
    assert(old.digest === digest, '请求标识已使用，请核对后重试', 409);
    return old.result;
  }
  const result = await run();
  await tx.idempotencyRecord.create({
    data: {
      userId: r.user.id,
      key,
      digest,
      result: JSON.parse(JSON.stringify(result)),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  return result;
}
export function installProjectProgressRoutes(router: Router) {
  router.post(
    '/projects/:id/actions/adopt',
    wrap(async (r, s) => {
      const input = z
        .object({
          planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          requestKey: z.uuid(),
          actions: z
            .array(actionCreate.omit({ planFingerprint: true }))
            .min(1)
            .max(12),
        })
        .strict()
        .parse(r.body);
      assert(
        new Set(input.actions.map((a) => a.taskId)).size ===
          input.actions.length,
        '同一需求只能采纳一项建议',
      );
      const result = await db.$transaction(async (tx) => {
        const p = await projectWrite(tx, r, String(r.params.id));
        return idempotent(
          tx,
          r,
          'actions-adopt:' + p.id + ':' + input.requestKey,
          input,
          async () => {
            const snapshot = await readAssistantSnapshot(tx, p.id);
            assert(
              snapshot.fingerprint === input.planFingerprint,
              '目标、行动或迭代计划已变化，请重新生成后采纳',
              409,
            );
            const items = [];
            for (const action of input.actions) {
              const t = await tx.task.findUnique({
                where: { id: action.taskId },
              });
              assert(
                t &&
                  t.projectId === p.id &&
                  !t.deletedAt &&
                  t.version === action.expectedTaskVersion &&
                  !terminal(t.status as any),
                '来源需求已变化，请重新生成',
                409,
              );
              assert(
                assistantSources([t as unknown as Task])[0]?.text.includes(
                  action.evidence,
                ),
                '行动依据不属于当前需求原文',
              );
              const sourceKey = hash(JSON.stringify(action));
              const old = await tx.projectAction.findUnique({
                where: { projectId_sourceKey: { projectId: p.id, sourceKey } },
              });
              if (old) {
                items.push({ id: old.id, taskId: old.taskId });
                continue;
              }
              assert(
                (await tx.projectAction.count({ where: { projectId: p.id } })) <
                  500,
                '单项目最多500项行动',
              );
              const a = await tx.projectAction.create({
                data: {
                  ...{
                    title: action.title,
                    acceptance: action.acceptance,
                    evidence: action.evidence,
                  },
                  projectId: p.id,
                  workspaceId: p.workspaceId,
                  taskId: t.id,
                  sourceVersion: t.version,
                  sourceKey,
                  createdBy: r.user.id,
                  events: [
                    {
                      operation: 'CREATE',
                      by: r.user.id,
                      at: new Date().toISOString(),
                      taskVersion: t.version,
                    },
                  ],
                },
              });
              await record(tx, r, p.workspaceId, a.id, 'PROJECT_ACTION_CREATE');
              items.push({ id: a.id, taskId: a.taskId });
            }
            return { items };
          },
        );
      });
      s.json(result);
    }),
  );
  router.get(
    '/projects/:id/actions/:actionId',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id));
      const result = await db.$transaction(
        async (tx) => {
          const a = await tx.projectAction.findFirst({
            where: { id: String(r.params.actionId), projectId: p.id },
          });
          assert(a, '行动不存在', 404);
          const t = await tx.task.findUnique({ where: { id: a.taskId } });
          const review = await reviewer(tx, r, p, t);
          return {
            ...a,
            taskNumber: t?.number,
            taskTitle: (t?.data as any)?.title,
            taskVersion: t?.version,
            sourceChanged: t?.version !== a.sourceVersion,
            unavailable: !t || !!t.deletedAt,
            canReview: review,
            canAssign: review || a.createdBy === r.user.id,
            canReschedule:
              a.status !== 'DONE' &&
              (review || a.createdBy === r.user.id || a.ownerId === r.user.id),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.setHeader('Cache-Control', 'private, no-store');
      s.json(result);
    }),
  );
  router.get(
    '/projects/:id/progress-brief',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id));
      const baselineId = z
        .string()
        .min(1)
        .max(100)
        .optional()
        .parse(r.query.checkpointId);
      const result = await db.$transaction(
        async (tx) => {
          const current = await state(tx, p.id);
          const baseline = baselineId
            ? await tx.projectCheckpoint.findFirst({
                where: { id: baselineId, projectId: p.id },
              })
            : await tx.projectCheckpoint.findFirst({
                where: { projectId: p.id },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              });
          assert(!baselineId || baseline, '检查点不存在或不属于当前项目', 404);
          const users = await tx.user.findMany({
            where: {
              id: {
                in: current.actions.map((a: any) => a.ownerId).filter(Boolean),
              },
            },
            select: { id: true, name: true },
          });
          return progressBrief({
            projectName: p.name,
            asOf: new Date().toISOString(),
            baseline: baseline
              ? {
                  ...baseline,
                  createdAt: baseline.createdAt.toISOString(),
                  snapshot: baseline.snapshot as ProgressSnapshot,
                }
              : null,
            current: current.snapshot,
            actions: current.actions.map((a: any) => ({
              ...a,
              ownerName:
                users.find((u) => u.id === a.ownerId)?.name ||
                '未分配或已离开项目',
              taskNumber: current.tasks.find((t: any) => t.id === a.taskId)
                ?.number,
            })),
          });
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.setHeader('Cache-Control', 'private, no-store');
      s.json({ filename: 'CoFlow-项目推进简报.md', content: result });
    }),
  );
  router.get(
    '/projects/:id/checkpoints',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id));
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .default(1)
        .parse(r.query.page);
      const result = await db.$transaction(
        async (tx) => ({
          total: await tx.projectCheckpoint.count({
            where: { projectId: p.id },
          }),
          items: await tx.projectCheckpoint.findMany({
            where: { projectId: p.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * 20,
            take: 20,
            select: { id: true, note: true, createdAt: true },
          }),
        }),
        { isolationLevel: 'RepeatableRead' },
      );
      s.setHeader('Cache-Control', 'private, no-store');
      s.json(result);
    }),
  );
  router.get(
    '/projects/:id/progress',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id));
      const filters = actionFilters.parse(r.query);
      const baselineId = z
        .string()
        .min(1)
        .max(100)
        .optional()
        .parse(r.query.checkpointId);
      const result = await db.$transaction(
        async (tx) => {
          const current = await state(tx, p.id);
          const checkpoints = await tx.projectCheckpoint.findMany({
            where: { projectId: p.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 5,
          });
          const latest = checkpoints[0];
          const baseline = baselineId
            ? await tx.projectCheckpoint.findFirst({
                where: { id: baselineId, projectId: p.id },
              })
            : latest;
          assert(!baselineId || baseline, '检查点不存在或不属于当前项目', 404);
          const members = await tx.projectMember.findMany({
            where: { projectId: p.id },
          });
          const users = await tx.user.findMany({
            where: { id: { in: members.map((m) => m.userId) } },
            select: { id: true, name: true },
          });
          const canReview = await reviewer(tx, r, p, null);
          const documents = await tx.document.findMany({
            where: { projectId: p.id },
            select: { taskIds: true },
          });
          const attachments = await tx.attachment.groupBy({
            by: ['taskId'],
            where: { projectId: p.id, deletedAt: null, taskId: { not: null } },
            _count: true,
          });
          const ordered = [...current.actions].sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              a.id.localeCompare(b.id),
          );
          const decorated = ordered.map((a) => {
            const t = current.tasks.find((t: any) => t.id === a.taskId);
            const review = canReview || t?.data.productId === r.user.id;
            return {
              ...a,
              taskNumber: t?.number,
              taskTitle: t?.data.title,
              taskVersion: t?.version,
              unavailable: !t || !!t.deletedAt,
              sourceChanged: t?.version !== a.sourceVersion,
              canReview: review,
              canAssign: review || a.createdBy === r.user.id,
              canReschedule:
                a.status !== 'DONE' &&
                (!a.ownerId || members.some((m) => m.userId === a.ownerId)) &&
                (review ||
                  a.createdBy === r.user.id ||
                  a.ownerId === r.user.id),
            };
          });
          const counts = {
            all: decorated.length,
            mine: decorated.filter((a) => a.ownerId === r.user.id).length,
            review: decorated.filter(
              (a) =>
                a.status === 'SUBMITTED' &&
                a.canReview &&
                a.ownerId !== r.user.id &&
                !a.unavailable,
            ).length,
            overdue: decorated.filter((a) =>
              matchesAction(
                a,
                { page: 1, q: '', scope: 'OVERDUE', status: 'ALL' },
                r.user.id,
              ),
            ).length,
          };
          const filtered = decorated.filter((a) =>
            matchesAction(
              a,
              filters,
              r.user.id,
              users.find((m) => m.id === a.ownerId)?.name,
            ),
          );
          return {
            fingerprint: current.fingerprint,
            total: filtered.length,
            counts,
            members: users,
            actions: filtered.slice((filters.page - 1) * 20, filters.page * 20),
            readiness: current.tasks
              .filter((t: any) => !t.deletedAt && !terminal(t.status))
              .map((t: any) => ({
                id: t.id,
                number: t.number,
                title: t.data.title,
                status: t.status,
                checks: [
                  ...deliveryChecks(t as Task),
                  {
                    key: 'defects',
                    label: '阻断缺陷',
                    ok: !current.tasks.some(
                      (b: any) =>
                        b.data.parentId === t.id &&
                        b.data.severity === 'BLOCKER' &&
                        b.status !== 'CLOSED',
                    ),
                    detail:
                      '按既有规则核对关联阻断缺陷，取消或回收站记录不视为已关闭',
                  },
                  {
                    key: 'materials',
                    label: '交付资料',
                    ok:
                      documents.some((d) => d.taskIds.includes(t.id)) ||
                      attachments.some((a) => a.taskId === t.id),
                    detail:
                      '核对直接关联项目文档或未删除的需求附件；其他资料引用请进入需求核对',
                  },
                ],
              })),
            latest: latest
              ? {
                  id: latest.id,
                  note: latest.note,
                  createdAt: latest.createdAt,
                }
              : null,
            checkpoints: checkpoints.map((c) => ({
              id: c.id,
              note: c.note,
              createdAt: c.createdAt,
            })),
            baseline: baseline
              ? {
                  id: baseline.id,
                  note: baseline.note,
                  createdAt: baseline.createdAt,
                }
              : null,
            comparison: compareCheckpoints(
              (baseline?.snapshot as ProgressSnapshot) || null,
              current.snapshot,
            ),
            followUps: checkpointFollowUps(
              (baseline?.snapshot as ProgressSnapshot) || null,
              current.snapshot,
            ),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.setHeader('Cache-Control', 'private, no-store');
      s.json(result);
    }),
  );
  router.post(
    '/projects/:id/actions',
    wrap(async (r, s) => {
      const input = actionCreate.parse(r.body);
      const result = await db.$transaction(async (tx) => {
        const p = await projectWrite(tx, r, String(r.params.id));
        const t = await tx.task.findUnique({ where: { id: input.taskId } });
        assert(t && t.projectId === p.id && !t.deletedAt, '需求不存在', 404);
        assert(
          t.version === input.expectedTaskVersion && !terminal(t.status as any),
          '需求已变化，请重新生成行动',
          409,
        );
        const source = assistantSources([t as unknown as Task])[0];
        assert(
          source?.text.includes(input.evidence),
          '行动依据不属于当前需求原文',
          422,
        );
        if (input.planFingerprint) {
          const snapshot = await readAssistantSnapshot(tx, p.id);
          assert(
            snapshot.fingerprint === input.planFingerprint,
            '目标、行动或迭代计划已变化，请重新生成后转入',
            409,
          );
        }
        const { planFingerprint, ...actionInput } = input;
        const sourceKey = hash(JSON.stringify(actionInput));
        const existing = await tx.projectAction.findUnique({
          where: { projectId_sourceKey: { projectId: p.id, sourceKey } },
        });
        if (existing) return existing;
        assert(
          (await tx.projectAction.count({ where: { projectId: p.id } })) < 500,
          '单项目最多500项行动',
          422,
        );
        const created = await tx.projectAction.create({
          data: {
            projectId: p.id,
            workspaceId: p.workspaceId,
            taskId: t.id,
            sourceVersion: t.version,
            sourceKey,
            title: input.title,
            acceptance: input.acceptance,
            evidence: input.evidence,
            createdBy: r.user.id,
            events: [
              {
                operation: 'CREATE',
                by: r.user.id,
                at: new Date().toISOString(),
                taskVersion: t.version,
              },
            ],
          },
        });
        await record(tx, r, p.workspaceId, created.id, 'PROJECT_ACTION_CREATE');
        return created;
      });
      s.json(result);
    }),
  );
  router.post(
    '/projects/:id/actions/:actionId/change',
    wrap(async (r, s) => {
      const input = actionChange.extend({ requestKey: z.uuid() }).parse(r.body);
      const result = await db.$transaction(async (tx) => {
        const p = await projectWrite(tx, r, String(r.params.id));
        return idempotent(
          tx,
          r,
          'action-change:' +
            p.id +
            ':' +
            String(r.params.actionId) +
            ':' +
            input.requestKey,
          input,
          async () => {
            const a = await tx.projectAction.findUnique({
              where: { id: String(r.params.actionId) },
            });
            assert(a && a.projectId === p.id, '行动不存在', 404);
            const t = await tx.task.findUnique({ where: { id: a.taskId } });
            assert(
              t && t.projectId === p.id && !t.deletedAt,
              '来源需求已不可用，请先恢复需求',
              409,
            );
            assert(
              a.version === input.expectedVersion &&
                t.version === input.expectedTaskVersion,
              '行动或需求已变化，请刷新并核对后重试',
              409,
            );
            const review = await reviewer(tx, r, p, t);
            let status = a.status,
              ownerId = a.ownerId,
              outcome = a.outcome;
            const op = input.operation;
            if (op === 'CLAIM') {
              assert(a.status === 'OPEN' && !a.ownerId, '行动已被认领', 409);
              ownerId = r.user.id;
              status = 'DOING';
            } else if (op === 'ASSIGN') {
              assert(
                review || a.createdBy === r.user.id,
                '仅创建者或项目负责人可分配',
                403,
              );
              assert(
                ['OPEN', 'DOING', 'SUBMITTED'].includes(a.status),
                '当前状态不可分配',
                409,
              );
              assert(
                a.status !== 'SUBMITTED' || review,
                '待确认成果须由项目负责人重新分配',
                403,
              );
              assert(input.ownerId, '请选择负责人');
              ownerId = input.ownerId;
              status = 'DOING';
              outcome = '';
            } else if (op === 'RESCHEDULE') {
              assert(
                review || a.createdBy === r.user.id || a.ownerId === r.user.id,
                '仅负责人、创建者或项目负责人可调整截止日',
                403,
              );
              assert(
                a.status !== 'DONE',
                '已完成行动不能调整截止日，请先重开',
                409,
              );
              assert(input.dueDate !== undefined, '请填写截止日或明确清空');
              assert(
                input.dueDate !== a.dueDate,
                '截止日未变化，请核对后再提交',
              );
            } else if (op === 'SUBMIT') {
              assert(a.ownerId === r.user.id, '仅行动负责人可提交成果', 403);
              assert(a.status === 'DOING', '当前状态不可提交', 409);
              outcome = input.note;
              status = 'SUBMITTED';
            } else {
              assert(review, '仅项目产品负责人或团队管理员可确认', 403);
              if (op === 'ACCEPT') {
                assert(
                  a.ownerId !== r.user.id,
                  '须由负责人以外的成员独立确认',
                  403,
                );
                assert(a.status === 'SUBMITTED', '当前状态不可确认', 409);
                status = 'DONE';
              } else if (op === 'RETURN') {
                assert(a.status === 'SUBMITTED', '当前状态不可退回', 409);
                status = 'DOING';
              } else {
                assert(a.status === 'DONE', '仅已完成行动可重开', 409);
                status = 'DOING';
              }
            }
            if (ownerId && ['RETURN', 'REOPEN'].includes(op)) {
              const member = await tx.projectMember.findUnique({
                where: {
                  projectId_userId: { projectId: p.id, userId: ownerId },
                },
              });
              const team = await tx.workspaceMember.findUnique({
                where: {
                  workspaceId_userId: {
                    workspaceId: p.workspaceId,
                    userId: ownerId,
                  },
                },
              });
              if (!member || !team) {
                ownerId = null;
                status = 'OPEN';
              }
            }
            if (ownerId) await eligibleOwner(tx, p, ownerId);
            assert(
              input.dueDate === undefined ||
                ['CLAIM', 'ASSIGN', 'RESCHEDULE'].includes(op),
              '当前操作不可调整截止日',
            );
            assert(
              input.ownerId === undefined || op === 'ASSIGN',
              '当前操作不可变更负责人',
            );
            const event = {
              operation: op,
              by: r.user.id,
              at: new Date().toISOString(),
              note: input.note,
              taskVersion: t.version,
              ownerId,
              dueDate: input.dueDate === undefined ? a.dueDate : input.dueDate,
              previousDueDate: a.dueDate,
              from: a.status,
              to: status,
            };
            const updated = await tx.projectAction.updateMany({
              where: { id: a.id, version: a.version },
              data: {
                status,
                ownerId,
                outcome,
                ...(input.dueDate !== undefined
                  ? { dueDate: input.dueDate }
                  : {}),
                version: { increment: 1 },
                events: [...(a.events as any[]), event],
              },
            });
            assert(updated.count, '行动已变化，请刷新后重试', 409);
            await record(tx, r, p.workspaceId, a.id, 'PROJECT_ACTION_' + op);
            const recipients = [
              ...new Set(
                [
                  ownerId,
                  a.createdBy,
                  t.data && (t.data as any).productId,
                ].filter(Boolean),
              ),
            ] as string[];
            for (const recipientId of recipients)
              if (
                recipientId !== r.user.id &&
                (await tx.projectMember.findUnique({
                  where: {
                    projectId_userId: { projectId: p.id, userId: recipientId },
                  },
                })) &&
                (await tx.workspaceMember.findUnique({
                  where: {
                    workspaceId_userId: {
                      workspaceId: p.workspaceId,
                      userId: recipientId,
                    },
                  },
                }))
              ) {
                await tx.notification.create({
                  data: {
                    recipientId,
                    workspaceId: p.workspaceId,
                    projectId: p.id,
                    taskId: t.id,
                    message:
                      '项目行动：' +
                      a.title +
                      ' · ' +
                      (op === 'RESCHEDULE'
                        ? '截止日调整为 ' + (input.dueDate || '未设置')
                        : actionStatusLabels[status]),
                    dedupe:
                      'action:' +
                      a.id +
                      ':' +
                      (a.version + 1) +
                      ':' +
                      recipientId,
                  },
                });
              }
            return tx.projectAction.findUniqueOrThrow({ where: { id: a.id } });
          },
        );
      });
      s.json(result);
    }),
  );
  router.post(
    '/projects/:id/checkpoints',
    wrap(async (r, s) => {
      const input = z
        .object({
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          latestId: z.string().nullable(),
          note: z.string().trim().min(1).max(1000),
          requestKey: z.uuid(),
        })
        .strict()
        .parse(r.body);
      const result = await db.$transaction(async (tx) => {
        const p = await projectWrite(tx, r, String(r.params.id));
        return idempotent(
          tx,
          r,
          'checkpoint:' + p.id + ':' + input.requestKey,
          input,
          async () => {
            const latest = await tx.projectCheckpoint.findFirst({
              where: { projectId: p.id },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            });
            const current = await state(tx, p.id);
            assert(
              (latest?.id || null) === input.latestId &&
                current.fingerprint === input.fingerprint,
              '项目或检查点已变化，请刷新后再记录',
              409,
            );
            const c = await tx.projectCheckpoint.create({
              data: {
                projectId: p.id,
                workspaceId: p.workspaceId,
                createdBy: r.user.id,
                note: input.note,
                snapshot: current.snapshot,
              },
            });
            await record(
              tx,
              r,
              p.workspaceId,
              c.id,
              'PROJECT_CHECKPOINT_CREATE',
            );
            return { id: c.id, createdAt: c.createdAt };
          },
        );
      });
      s.json(result);
    }),
  );
}

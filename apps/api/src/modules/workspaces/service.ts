import 'dotenv/config';
import 'reflect-metadata';

import { type Prisma } from '@prisma/client';

import { assert } from '../requirements/domain.js';

import { record, type AuthRequest } from '../../shared/access.js';
async function removeTeamMember(
  tx: Prisma.TransactionClient,
  r: AuthRequest,
  id: string,
  userId: string,
) {
  assert(
    (
      await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: r.user.id } },
      })
    )?.role === 'ADMIN',
    '需要团队管理员权限',
    403,
  );
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: id, userId } },
  });
  assert(member, '成员不存在', 404);
  if (member.role === 'ADMIN')
    assert(
      (await tx.workspaceMember.count({
        where: { workspaceId: id, role: 'ADMIN' },
      })) > 1,
      '必须保留至少一位管理员',
      409,
    );
  await tx.$queryRaw`SELECT id FROM "Project" WHERE "workspaceId" = ${id} ORDER BY id FOR UPDATE`;
  const tasks = await tx.task.findMany({
    where: { workspaceId: id, status: { notIn: ['CLOSED', 'CANCELLED'] } },
  });
  const fields = [
    'productId',
    'engineerId',
    'testerId',
    'productReviewerId',
    'qaReviewerId',
  ];
  assert(
    !tasks.some((t: any) => fields.some((field) => t.data[field] === userId)),
    '请先转交未结束需求的责任（包括回收站中的需求），再移出团队',
    409,
  );
  const projects = await tx.project.findMany({
    where: { workspaceId: id },
    select: { id: true },
  });
  await tx.projectMember.deleteMany({
    where: { projectId: { in: projects.map((p: any) => p.id) }, userId },
  });
  await tx.qQBinding.deleteMany({ where: { workspaceId: id, userId } });
  await tx.qQBindingCode.deleteMany({ where: { workspaceId: id, userId } });
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  await tx.invitation.deleteMany({
    where: { workspaceId: id, email: user.email, acceptedAt: null },
  });
  await tx.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId: id, userId } },
  });
  await record(tx, r, id, userId, 'MEMBER_REMOVE');
  return member;
}
export { removeTeamMember };

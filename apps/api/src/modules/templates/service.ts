import 'dotenv/config';
import 'reflect-metadata';

import { assert } from '../requirements/domain.js';

import {
  project,
  projectWrite,
  workspace,
  type AuthRequest,
} from '../../shared/access.js';
async function templateAccess(
  r: AuthRequest,
  projectId: string,
  write = false,
) {
  const p = await project(r, projectId, write);
  const membership = await workspace(r, p.workspaceId);
  return {
    project: p,
    canManage:
      membership.role === 'ADMIN' || p.member?.roles.includes('PRODUCT'),
  };
}
async function templateWrite(tx: any, r: AuthRequest, projectId: string) {
  const p = await projectWrite(tx, r, projectId);
  const membership = await tx.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: p.workspaceId, userId: r.user.id },
    },
  });
  assert(
    membership?.role === 'ADMIN' || p.member?.roles.includes('PRODUCT'),
    '仅团队管理员或项目产品成员可管理模板',
    403,
  );
  return p;
}
export { templateAccess, templateWrite };

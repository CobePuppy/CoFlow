import { record } from '../../shared/access.js';
import { assert } from '../requirements/domain.js';
export type Scope =
  | { scope: 'PERSONAL'; ownerId: string; workspaceId: null }
  | { scope: 'TEAM'; ownerId: null; workspaceId: string };
export async function access(tx: any, r: any, scope: Scope, write = false) {
  if (scope.scope === 'PERSONAL') {
    assert(scope.ownerId === r.user.id, '文件不存在', 404);
    return true;
  }
  if (write)
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${scope.workspaceId} FOR NO KEY UPDATE`;
  else
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${scope.workspaceId} FOR SHARE`;
  const member = await tx.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: scope.workspaceId, userId: r.user.id },
    },
  });
  assert(member, '文件空间不存在或已无权限', 404);
  return member.role === 'ADMIN';
}
export const scopeFor = (r: any): Scope =>
  r.params.workspaceId
    ? {
        scope: 'TEAM',
        ownerId: null,
        workspaceId: String(r.params.workspaceId),
      }
    : { scope: 'PERSONAL', ownerId: r.user.id, workspaceId: null };
export function visible(file: any, admin: boolean, userId: string) {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    mime: file.mime,
    userId: file.userId,
    version: file.version,
    contentVersion: file.contentVersion,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    deletedAt: file.deletedAt,
    canManage: admin || file.userId === userId,
  };
}
export async function audit(tx: any, r: any, file: any, action: string) {
  await tx.spaceFileEvent.create({
    data: { fileId: file.id, actorId: r.user.id, action },
  });
  if (file.workspaceId) await record(tx, r, file.workspaceId, file.id, action);
}

import type { Prisma } from '@prisma/client';
type TaskScope = {
  id: string;
  projectId: string;
  workspaceId: string;
  data: unknown;
};
type Source = {
  name: string;
  version: number;
  scope: string;
  deletedAt?: Date | null;
  contentVersion?: number;
  ownerId?: string | null;
};
// Resolve each source type once. Never load document content/revisions or task history.
export async function taskResourceSummaries(
  tx: Prisma.TransactionClient,
  t: TaskScope,
  userId: string,
) {
  const refs = await tx.taskResource.findMany({
    where: { taskId: t.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  if (!refs.length) return [];
  const ids = (kind: string) =>
    refs.filter((r) => r.kind === kind).map((r) => r.sourceId);
  const documentIds = ids('DOCUMENT'),
    fileIds = ids('FILE'),
    attachmentIds = ids('ATTACHMENT');
  const product = (t.data as { productId?: string }).productId === userId;
  const [documents, files, attachments, member] = await Promise.all([
    documentIds.length
      ? tx.document.findMany({
          where: { id: { in: documentIds }, projectId: t.projectId },
          select: { id: true, title: true, version: true },
        })
      : [],
    fileIds.length
      ? tx.spaceFile.findMany({
          where: {
            id: { in: fileIds },
            OR: [{ scope: 'PERSONAL' }, { workspaceId: t.workspaceId }],
          },
          select: {
            id: true,
            name: true,
            version: true,
            scope: true,
            contentVersion: true,
            ownerId: true,
            deletedAt: true,
          },
        })
      : [],
    attachmentIds.length
      ? tx.attachment.findMany({
          where: { id: { in: attachmentIds }, projectId: t.projectId },
          select: { id: true, name: true, taskId: true, deletedAt: true },
        })
      : [],
    !product && refs.some((r) => r.createdBy !== userId)
      ? tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: t.workspaceId, userId } },
          select: { role: true },
        })
      : null,
  ]);
  const pins = refs.filter((r) => r.kind === 'FILE' && r.fileVersion !== null);
  const pinnedRows = pins.length
    ? await tx.spaceFileRevision.findMany({
        where: {
          OR: pins.map((r) => ({ fileId: r.sourceId, number: r.fileVersion! })),
        },
        select: { fileId: true, number: true },
      })
    : [];
  const pinned = new Set(pinnedRows.map((r) => r.fileId + ':' + r.number));
  const parentIds = [
    ...new Set(attachments.flatMap((a) => (a.taskId ? [a.taskId] : []))),
  ];
  const deletedParents = new Set(
    parentIds.length
      ? (
          await tx.task.findMany({
            where: { id: { in: parentIds }, deletedAt: { not: null } },
            select: { id: true },
          })
        ).map((p) => p.id)
      : [],
  );
  const sources = new Map<string, Source>();
  for (const d of documents)
    sources.set('DOCUMENT:' + d.id, {
      name: d.title,
      version: d.version,
      scope: 'PROJECT',
    });
  for (const f of files) sources.set('FILE:' + f.id, f);
  for (const a of attachments)
    if (!a.taskId || !deletedParents.has(a.taskId))
      sources.set('ATTACHMENT:' + a.id, { ...a, version: 1, scope: 'PROJECT' });
  return refs.map((ref) => {
    const f = sources.get(ref.kind + ':' + ref.sourceId);
    const fixed = ref.kind === 'FILE' && ref.fileVersion !== null;
    const available =
      !!f &&
      (!fixed || pinned.has(ref.sourceId + ':' + ref.fileVersion)) &&
      !f.deletedAt &&
      (f.scope !== 'PERSONAL' || ref.personalShared);
    return {
      id: ref.id,
      kind: ref.kind,
      title: ref.title,
      scope: ref.sourceScope,
      sourceVersion: ref.sourceVersion,
      fileVersion: ref.fileVersion,
      canChangeFileMode:
        ref.kind === 'FILE' &&
        (ref.createdBy === userId || product || member?.role === 'ADMIN') &&
        !!f &&
        (f.scope !== 'PERSONAL' || f.ownerId === userId),
      latestContentVersion: available
        ? fixed && f.scope === 'PERSONAL' && f.ownerId !== userId
          ? ref.fileVersion
          : f.contentVersion
        : null,
      latestSourceVersion: available ? f.version : null,
      currentVersion: available
        ? fixed
          ? ref.sourceVersion
          : f.version
        : null,
      currentTitle: available ? (fixed ? ref.title : f.name) : null,
      status: !available
        ? 'UNAVAILABLE'
        : !fixed && f.version !== ref.sourceVersion
          ? 'UPDATED'
          : 'CURRENT',
      canManage:
        ref.createdBy === userId || product || member?.role === 'ADMIN',
      createdAt: ref.createdAt,
      documentId:
        ref.kind === 'DOCUMENT' && available ? ref.sourceId : undefined,
    };
  });
}

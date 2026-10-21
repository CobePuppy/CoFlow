import type { Prisma } from '@prisma/client';
export async function notifyDiscussion(
  tx: Prisma.TransactionClient,
  r: any,
  t: any,
  event: { id: string; discussionId: string; message: string },
  recipients: (string | null | undefined)[],
) {
  const ids = [
    ...new Set(
      recipients.filter((id): id is string => !!id && id !== r.user.id),
    ),
  ];
  if (!ids.length) return;
  const members = await tx.projectMember.findMany({
    where: { projectId: t.projectId, userId: { in: ids } },
    select: { userId: true },
  });
  await tx.notification.createMany({
    data: members.map((m) => ({
      recipientId: m.userId,
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      taskId: t.id,
      discussionId: event.discussionId,
      message: event.message,
      dedupe: `discussion:${event.id}:${m.userId}`,
    })),
  });
}

export type Discussion = {
  id: string;
  body: string;
  by: string;
  name: string;
  at: string;
  kind?:
    | 'COMMENT'
    | 'QUESTION'
    | 'DECISION'
    | 'QUESTION_STATE'
    | 'QUESTION_ASSIGNMENT';
  replyTo?: string;
  requirementVersion?: number;
  resolved?: boolean;
  assigneeId?: string | null;
  dueAt?: string | null;
  checkedVersion?: number;
  assignments?: {
    by: string;
    name: string;
    at: string;
    reason: string;
    assigneeId: string | null;
    dueAt: string | null;
  }[];
  resolutions?: {
    resolved: boolean;
    reason: string;
    by: string;
    name: string;
    at: string;
  }[];
};
export function discussionRoots(
  comments: Discussion[],
  filter: string,
  query: string,
) {
  const search = query.trim().toLocaleLowerCase();
  const matches = new Set<string>();
  if (search)
    for (const c of comments) {
      if ((c.body + ' ' + c.name).toLocaleLowerCase().includes(search))
        matches.add(c.replyTo || c.id);
    }
  return comments.filter(
    (c) =>
      !c.replyTo &&
      (filter !== 'OPEN' || (c.kind === 'QUESTION' && !c.resolved)) &&
      (filter !== 'DECISION' || c.kind === 'DECISION') &&
      (!search || matches.has(c.id)),
  );
}

export function discussionView(comments: Discussion[]): Discussion[] {
  const states = new Map<string, Discussion[]>(),
    transfers = new Map<string, Discussion[]>();
  for (const c of comments) {
    if (!c.replyTo) continue;
    const target =
      c.kind === 'QUESTION_STATE'
        ? states
        : c.kind === 'QUESTION_ASSIGNMENT'
          ? transfers
          : undefined;
    if (target) {
      const list = target.get(c.replyTo) || [];
      list.push(c);
      target.set(c.replyTo, list);
    }
  }
  return comments.map((c) => {
    if (c.replyTo || c.kind !== 'QUESTION') return c;
    const events = states.get(c.id) || [];
    const assignments = transfers.get(c.id) || [];
    const last = assignments.at(-1);
    return {
      ...c,
      assigneeId: last ? last.assigneeId : c.assigneeId,
      dueAt: last ? last.dueAt : c.dueAt,
      checkedVersion: events.at(-1)?.requirementVersion ?? c.requirementVersion,
      assignments: assignments.map((r) => ({
        by: r.by,
        name: r.name,
        at: r.at,
        reason: r.body,
        assigneeId: r.assigneeId ?? null,
        dueAt: r.dueAt ?? null,
      })),
      resolved: events.at(-1)?.resolved || false,
      resolutions: events.map((r) => ({
        resolved: !!r.resolved,
        reason: r.body,
        by: r.by,
        name: r.name,
        at: r.at,
      })),
    };
  });
}

export type DiscussionSnapshot = {
  comments: Discussion[];
  total: number;
  taskVersion: number;
  requirementVersion: number;
};
export type DiscussionUpdate = DiscussionSnapshot & {
  from: number;
  reset: boolean;
};
// Offsets are safe because discussion entries are append-only, including state changes.
export function mergeDiscussionUpdates(
  previous: DiscussionSnapshot | undefined,
  next: DiscussionUpdate,
): DiscussionSnapshot {
  if (!next.reset && (!previous || next.from !== previous.total))
    throw new Error('讨论增量位置不一致，请重新加载');
  const comments = next.reset
    ? next.comments
    : [...previous!.comments, ...next.comments];
  if (comments.length !== next.total)
    throw new Error('讨论增量不完整，请重新加载');
  return {
    comments,
    total: next.total,
    taskVersion: next.taskVersion,
    requirementVersion: next.requirementVersion,
  };
}

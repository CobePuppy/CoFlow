export type ProofState =
  | 'MISSING'
  | 'OUTDATED'
  | 'RECORDED'
  | 'VERIFIED'
  | 'REFUTED';
export const proofStateLabels: Record<ProofState, string> = {
  MISSING: '待补证',
  OUTDATED: '证据已过期',
  RECORDED: '已关联 · 待人工核对',
  VERIFIED: '人工核对支持',
  REFUTED: '人工核对不支持',
};
type PlanClaim = {
  id: string;
  statement: string;
  importance?: number;
  effortHours?: number;
  taskId?: string;
};
/** Transparent heuristic: importance × evidence-gap urgency / team-estimated hours. Not a contest score or an optimal schedule. */
export function planProofWork(
  claims: PlanClaim[],
  states: Record<string, string>,
  budgetHours: number,
) {
  const urgency: Record<string, number> = {
    MISSING: 3,
    OUTDATED: 2,
    RECORDED: 1,
    REFUTED: 3,
    VERIFIED: 0,
  };
  let remaining = Math.max(0, Number.isFinite(budgetHours) ? budgetHours : 0);
  const ranked = claims
    .map((c) => {
      const importance = Math.min(5, Math.max(1, c.importance || 3)),
        hours = Math.min(80, Math.max(0.5, c.effortHours || 2));
      const factor = urgency[states[c.id]] ?? 1;
      return {
        ...c,
        importance,
        hours,
        urgency: factor,
        priority: (importance * factor) / hours,
      };
    })
    .filter((c) => c.urgency > 0)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const selected: typeof ranked = [];
  for (const item of ranked)
    if (item.hours <= remaining && selected.length < 3) {
      selected.push(item);
      remaining -= item.hours;
    }
  return {
    selected,
    ranked,
    plannedHours: selected.reduce((n, c) => n + c.hours, 0),
    remainingHours: remaining,
  };
}

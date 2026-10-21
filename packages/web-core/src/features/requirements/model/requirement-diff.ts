export const requirementFields = [
  ['title', '需求标题'],
  ['background', '背景'],
  ['goal', '目标'],
  ['description', '需求描述'],
  ['criteria', '验收标准'],
] as const;
function missing(from: string[], to: string[]) {
  const counts = new Map<string, number>();
  for (const x of to) counts.set(x, (counts.get(x) || 0) + 1);
  return from.filter((x) => {
    const n = counts.get(x) || 0;
    if (n) {
      counts.set(x, n - 1);
      return false;
    }
    return true;
  });
}
export function requirementDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
) {
  return requirementFields.flatMap(([field, label]) => {
    if (!(field in after)) return [];
    const old = before?.[field],
      next = after[field];
    const normalize = (v: unknown) =>
      field === 'criteria'
        ? Array.isArray(v)
          ? v.map(String)
          : []
        : typeof v === 'string'
          ? v
          : '';
    const a = normalize(old),
      b = normalize(next);
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    return [
      {
        field,
        label,
        before: a,
        after: b,
        unknownBefore: !!before && !(field in before),
        added:
          field === 'criteria' ? missing(b as string[], a as string[]) : [],
        removed:
          field === 'criteria' ? missing(a as string[], b as string[]) : [],
      },
    ];
  });
}

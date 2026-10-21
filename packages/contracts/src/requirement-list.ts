export const requirementSorts = ['updated', 'due', 'priority'] as const;
export type RequirementSort = (typeof requirementSorts)[number];
export function requirementNumber(query: string): number | null {
  const match = /^CF-(\d+)$/i.exec(query.trim());
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
export function matchesRequirementSearch(
  task: { number?: number; data: { title: string; description: string } },
  query: string,
) {
  const text = query.trim();
  const number = requirementNumber(text);
  return number !== null
    ? task.number === number
    : `${task.data.title} ${task.data.description}`
        .toLowerCase()
        .includes(text.toLowerCase());
}
export function compareRequirements(
  sort: RequirementSort,
  a: {
    id: string;
    updatedAt: string;
    data: { priority: string; dueAt?: string };
  },
  b: {
    id: string;
    updatedAt: string;
    data: { priority: string; dueAt?: string };
  },
) {
  const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const key = (t: typeof a) =>
    sort === 'due'
      ? t.data.dueAt?.slice(0, 10) || '9999-99-99'
      : ['P0', 'P1', 'P2', 'P3'].includes(t.data.priority)
        ? t.data.priority
        : 'P9';
  return (
    (sort === 'updated' ? 0 : compare(key(a), key(b))) ||
    compare(b.updatedAt, a.updatedAt) ||
    compare(a.id, b.id)
  );
}

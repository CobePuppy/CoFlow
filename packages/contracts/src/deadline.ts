// Project deadlines are calendar dates in the product's Asia/Shanghai timezone.
export function isOverdue(dueAt: string | undefined, now = Date.now()) {
  if (!dueAt || !Number.isFinite(Date.parse(dueAt))) return false;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  return dueAt.slice(0, 10) < today;
}

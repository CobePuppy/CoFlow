export function taskIdFromParams(params: URLSearchParams) {
  const value = params.get('task')?.trim();
  return value && !['null', 'undefined'].includes(value) ? value : null;
}
export function patchSearchParams(
  base: URLSearchParams,
  patch: Record<string, string | null | undefined>,
) {
  const next = new URLSearchParams(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') next.delete(key);
    else next.set(key, value);
  }
  if (next.has('task') && !taskIdFromParams(next)) next.delete('task');
  return next;
}

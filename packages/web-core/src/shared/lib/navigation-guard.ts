const contextKeys = [
  'app',
  'section',
  'workspace',
  'project',
  'task',
  'document',
  'iteration',
  'fileSpace',
  'tab',
];
export function leavesEditingContext(
  current: { pathname: string; search: string },
  next: { pathname: string; search: string },
) {
  if (current.pathname !== next.pathname) return true;
  const a = new URLSearchParams(current.search),
    b = new URLSearchParams(next.search);
  if (contextKeys.some((k) => a.get(k) !== b.get(k))) return true;
  // Detail tabs and list filters retain their mounted editors; workspace pages do not.
  return !a.get('task') && a.get('view') !== b.get('view');
}

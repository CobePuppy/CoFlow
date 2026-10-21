import { taskIdFromParams } from '../../shared/lib/navigation.js';
const sharedApps = new Set(['work', 'library', 'projects', 'members']);
const sharedViews = new Set([
  'project-overview',
  'github',
  'tasks',
  'iterations',
  'todos',
  'dashboard',
  'documents',
  'templates',
  'forks',
  'metrics',
  'notifications',
  'discussions',
]);
export function editionDestination(
  target: 'student' | 'enterprise',
  current: string,
) {
  const url = new URL(current, 'https://coflow.invalid');
  const next = new URLSearchParams();
  const app = url.searchParams.get('app'),
    view = url.searchParams.get('view');
  for (const key of ['workspace', 'project'])
    if (url.searchParams.has(key)) next.set(key, url.searchParams.get(key)!);
  if ((!app || sharedApps.has(app)) && (!view || sharedViews.has(view))) {
    for (const key of [
      'app',
      'view',
      'task',
      'taskTab',
      'discussion',
      ...(view === 'discussions'
        ? [
            'discussionScope',
            'discussionState',
            'discussionOverdue',
            'discussionPage',
            'discussionQ',
          ]
        : []),
      ...(view === 'iterations'
        ? [
            'iteration',
            'iterationPage',
            'iterationTasksPage',
            'iterationFilter',
          ]
        : []),
    ])
      if (url.searchParams.has(key)) next.set(key, url.searchParams.get(key)!);
  }
  if (url.searchParams.get('section') === 'library' || app === 'library') {
    for (const key of [
      'section',
      'fileSpace',
      'fileQ',
      'fileType',
      'fileUploader',
      'fileSort',
      'fileDeleted',
      'filePage',
    ])
      if (url.searchParams.has(key)) next.set(key, url.searchParams.get(key)!);
  }
  if (next.has('task') && !taskIdFromParams(next)) next.delete('task');
  const query = next.toString();
  return '/' + target + '/' + (query ? '?' + query : '');
}

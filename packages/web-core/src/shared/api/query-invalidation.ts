import type { QueryClient, QueryKey } from '@tanstack/react-query';

// Task changes can affect cross-project references, so invalidate task-related
// families while retaining account settings, members and unrelated page data.
const taskFamilies = new Set([
  'projectAssistant',
  'projectProgress',
  'projectGoals',
  'task',
  'discussionCenter',
  'taskDiscussions',
  'iterations',
  'iteration',
  'iterationTasks',
  'iterationCandidates',
  'taskIteration',
  'taskGithub',
  'githubTree',
  'githubPull',
  'tasks',
  'todos',
  'metrics',
  'overview',
  'notifications',
  'taskOptions',
  'documentTasks',
  'relatedDocuments',
  'taskResources',
  'fileGrants',
  'proof',
  'forks',
  'fork-tasks',
  'attachments',
  'libraryFiles',
]);
export function isTaskQuery(key: QueryKey) {
  return taskFamilies.has(String(key[0]));
}
export function invalidateTaskQueries(client: QueryClient) {
  return client.invalidateQueries({
    predicate: (q) => isTaskQuery(q.queryKey),
  });
}

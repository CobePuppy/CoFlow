import type { SavedViewContent } from '@coflow/contracts/collaboration.js';
import { statuses, type Status } from '@coflow/contracts/index.js';
import {
  matchesRequirementSearch,
  requirementSorts,
} from '@coflow/contracts/requirement-list.js';
export type TaskFilters = SavedViewContent['filters'];
export const filterKeys = [
  'scope',
  'q',
  'status',
  'priority',
  'owner',
  'blocked',
  'sort',
] as const;
export function readWorkspaceState(params: URLSearchParams) {
  const filters: TaskFilters = {};
  const scope = params.get('scope');
  if (
    scope &&
    ['active', 'all', 'mine', 'handling', 'overdue', 'ended', 'trash'].includes(
      scope,
    )
  )
    filters.scope = scope as TaskFilters['scope'];
  const q = params.get('q')?.trim();
  if (q) filters.q = q;
  const status = params.get('status');
  if (statuses.includes(status as Status)) filters.status = status as Status;
  const priority = params.get('priority');
  if (priority && ['P0', 'P1', 'P2', 'P3'].includes(priority))
    filters.priority = priority as TaskFilters['priority'];
  const owner = params.get('owner');
  if (owner) filters.owner = owner;
  const blocked = params.get('blocked');
  if (blocked === 'true' || blocked === 'false') filters.blocked = blocked;
  const sort = params.get('sort');
  if (requirementSorts.includes(sort as any))
    filters.sort = sort as TaskFilters['sort'];
  const rawPage = Number(params.get('page') || 1);
  return {
    filters,
    page:
      Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 1000000
        ? rawPage
        : 1,
    view: [
      'dashboard',
      'project-overview',
      'github',
      'todos',
      'tasks',
      'iterations',
      'documents',
      'metrics',
      'notifications',
      'discussions',
      'templates',
      'forks',
    ].includes(params.get('view') || '')
      ? params.get('view')!
      : 'dashboard',
    mode:
      params.get('mode') === 'board' ? ('board' as const) : ('list' as const),
  };
}
export function matchesTaskFilters(
  task: {
    number?: number;
    status: string;
    data: {
      title: string;
      description: string;
      priority: string;
      productId: string;
      engineerId: string;
      testerId: string;
      productReviewerId: string;
      qaReviewerId: string;
      blocks: { end?: string }[];
    };
  },
  filters: TaskFilters,
) {
  const d = task.data;
  return (
    (!filters.status || task.status === filters.status) &&
    (!filters.priority || d.priority === filters.priority) &&
    (!filters.owner ||
      [
        d.productId,
        d.engineerId,
        d.testerId,
        d.productReviewerId,
        d.qaReviewerId,
      ].includes(filters.owner)) &&
    (!filters.blocked ||
      d.blocks.some((b) => !b.end) === (filters.blocked === 'true')) &&
    (!filters.q || matchesRequirementSearch(task, filters.q))
  );
}

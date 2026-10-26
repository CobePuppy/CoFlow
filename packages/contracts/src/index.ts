export const statuses = [
  'DRAFT',
  'SOLUTION_PENDING',
  'SOLUTION_REVIEW',
  'READY_FOR_DEV',
  'DEVELOPING',
  'READY_FOR_TEST',
  'TESTING',
  'ACCEPTANCE_PENDING',
  'CLOSED',
  'CANCELLED',
] as const;
export type Status = (typeof statuses)[number];
export const labels: Record<Status, string> = {
  DRAFT: '需求草稿',
  SOLUTION_PENDING: '待出方案',
  SOLUTION_REVIEW: '方案评估中',
  READY_FOR_DEV: '待开发',
  DEVELOPING: '开发中',
  READY_FOR_TEST: '待测试',
  TESTING: '测试中',
  ACCEPTANCE_PENDING: '待验收',
  CLOSED: '已关闭',
  CANCELLED: '已取消',
};
export type Role = 'PRODUCT' | 'ENGINEER' | 'QA' | 'OPS';
export type Member = { id: string; name: string; email: string; roles: Role[] };
export type Entry = {
  id: string;
  at: string;
  actor: string;
  name: string;
  action: string;
  from: Status;
  to: Status;
  payload: any;
};
export type TaskData = {
  workflow?: 'SIMPLE' | 'STANDARD';
  roleMode?: 'STANDARD' | 'COMPACT';
  createdBy?: string;
  title: string;
  background: string;
  goal: string;
  description: string;
  criteria: string[];
  priority: string;
  productId: string;
  engineerId: string;
  productReviewerId: string;
  qaReviewerId: string;
  testerId: string;
  dueAt?: string;
  type?: string;
  severity?: string;
  parentId?: string;
  parentRound?: number;
  requirementVersion: number;
  requirements: any[];
  solutions: any[];
  reviews: any[];
  reviewSnapshot?: any;
  development: any[];
  tests: any[];
  acceptances: any[];
  changes: any[];
  blocks: any[];
  comments: any[];
  history: Entry[];
};
export type Task = {
  deletedAt?: string | null;
  deletedBy?: string | null;
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  status: Status;
  version: number;
  createdAt: string;
  updatedAt: string;
  data: TaskData;
};
export const terminal = (s: Status) => s === 'CLOSED' || s === 'CANCELLED';
export const actions = [
  'START_WORK',
  'SUBMIT_ACCEPTANCE',
  'SUBMIT_REQUIREMENT',
  'RETURN_REQUIREMENT',
  'SUBMIT_SOLUTION',
  'APPROVE_SOLUTION',
  'REJECT_SOLUTION',
  'START_DEVELOPMENT',
  'COMPLETE_DEVELOPMENT',
  'START_TEST',
  'FAIL_TEST',
  'PASS_TEST',
  'ACCEPT',
  'REJECT_ACCEPTANCE',
  'APPLY_REQUIREMENT_CHANGE',
  'BLOCK',
  'UNBLOCK',
  'TRANSFER',
  'CANCEL',
] as const;
export type Action = (typeof actions)[number];
export function getHandlerIds(t: Task): string[] {
  if (t.deletedAt) return [];
  const d = t.data;
  if (t.status === 'DRAFT' || t.status === 'ACCEPTANCE_PENDING')
    return [d.productId];
  if (t.status === 'SOLUTION_REVIEW')
    return [...new Set([d.productReviewerId, d.qaReviewerId])].filter(
      (id) =>
        !d.reviews.some(
          (r) => r.round === d.solutions.length && r.userId === id,
        ),
    );
  if (t.status === 'READY_FOR_TEST' || t.status === 'TESTING')
    return [d.testerId];
  return terminal(t.status) ? [] : [d.engineerId];
}

export interface ProjectAttachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  taskId: string | null;
  createdAt: string;
  stage?: string;
  stageVersion?: number | null;
  deletedAt?: string | null;
  canDelete?: boolean;
}
export interface TaskOption {
  id: string;
  title: string;
}

export interface TemplateContent {
  title: string;
  background: string;
  goal: string;
  description: string;
  criteria: string[];
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}
export interface RequirementTemplate {
  id: string;
  projectId: string;
  name: string;
  content: TemplateContent;
  active: boolean;
  version: number;
  updatedAt: string;
}
export interface TemplateList {
  items: RequirementTemplate[];
  canManage: boolean;
  readOnly: boolean;
}

export const competitionStages = {
  PREPARING: '备赛中',
  REGISTERED: '已报名',
  SUBMITTED: '已提交',
  FINISHED: '已结束',
} as const;
export interface Competition {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  organizer: string;
  url: string;
  deadline: string;
  stage: keyof typeof competitionStages;
  outcome: string;
  notes: string;
  version: number;
  updatedAt: string;
}

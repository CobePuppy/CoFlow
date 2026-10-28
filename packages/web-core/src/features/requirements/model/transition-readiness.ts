import type { Task } from '@coflow/contracts/index.js';
export function requirementReadiness(task: Task, memberIds?: string[]) {
  const d = task.data;
  const issues: { field: string; message: string }[] = [];
  const content: string[] = [];
  const assignment: string[] = [];
  const simple = d.workflow === 'SIMPLE';
  const compact = !simple && d.roleMode === 'COMPACT';
  for (const [key, label] of [
    ['title', '需求标题'],
    ['background', '背景'],
    ['goal', '目标'],
    ['description', '需求说明'],
  ] as const)
    if ((!simple || !['background', 'goal'].includes(key)) && !d[key]?.trim()) {
      content.push(label);
      issues.push({ field: key, message: label });
    }
  if (!d.criteria.length || d.criteria.some((c) => !c.trim())) {
    content.push('至少一项可验证的验收标准');
    issues.push({ field: 'criteria', message: '至少一项可验证的验收标准' });
  }
  for (const [key, label] of [
    ['productId', compact ? '需求负责人' : '产品负责人'],
    ['engineerId', compact ? '执行人' : '研发负责人'],
    ['testerId', compact ? '验收人' : '测试负责人'],
    ['productReviewerId', '产品评估人'],
    ['qaReviewerId', '测试评估人'],
  ] as const)
    if (
      (!simple || ['productId', 'engineerId'].includes(key)) &&
      (!compact || key !== 'productReviewerId') &&
      (!compact || key !== 'qaReviewerId') &&
      (!d[key] || (memberIds && !memberIds.includes(d[key])))
    ) {
      issues.push({ field: key, message: label + '需指定项目成员' });
      assignment.push(label + '需指定项目成员');
    }
  if (
    !simple &&
    !compact &&
    d.productReviewerId &&
    d.productReviewerId === d.qaReviewerId
  ) {
    assignment.push('产品与测试评估人须为不同成员');
    issues.push({
      field: 'qaReviewerId',
      message: '产品与测试评估人须为不同成员',
    });
  }
  if (
    !simple &&
    d.engineerId &&
    ((compact && d.engineerId === d.productId) ||
      d.engineerId === d.productReviewerId ||
      d.engineerId === d.qaReviewerId)
  ) {
    assignment.push('执行人不能评估自己的方案');
    issues.push({
      field: 'engineerId',
      message: '执行人不能评估自己的方案',
    });
  }
  if (
    !simple &&
    d.testerId &&
    ((compact && d.testerId === d.productId) ||
      (!compact && d.testerId === d.qaReviewerId))
  ) {
    assignment.push('测试负责人不能评估自己的测试结果');
    issues.push({
      field: 'testerId',
      message: '测试负责人不能评估自己的测试结果',
    });
  }
  const blocked = task.data.blocks.some((b) => !b.end);
  return {
    issues,
    content,
    assignment,
    blocked,
    ready: !content.length && !assignment.length && !blocked,
  };
}
export const forwardActions = [
  'START_WORK',
  'SUBMIT_ACCEPTANCE',
  'SUBMIT_REQUIREMENT',
  'SUBMIT_SOLUTION',
  'APPROVE_SOLUTION',
  'START_DEVELOPMENT',
  'COMPLETE_DEVELOPMENT',
  'START_TEST',
  'PASS_TEST',
  'ACCEPT',
];
export const nextDestinations: Record<string, string> = {
  START_WORK: '进行中',
  SUBMIT_ACCEPTANCE: '待验收',
  SUBMIT_REQUIREMENT: '待出方案',
  SUBMIT_SOLUTION: '方案评估',
  APPROVE_SOLUTION: '完成当前评估',
  START_DEVELOPMENT: '开发中',
  COMPLETE_DEVELOPMENT: '待测试',
  START_TEST: '测试中',
  PASS_TEST: '待验收',
  ACCEPT: '验收关闭',
};

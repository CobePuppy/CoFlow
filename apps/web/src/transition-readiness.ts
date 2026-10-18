import type { Task } from '../../../packages/contracts/index.js';
export function requirementReadiness(task: Task, memberIds?: string[]) {
  const d = task.data;
  const content: string[] = [];
  const assignment: string[] = [];
  const simple = d.workflow === 'SIMPLE';
  for (const [key, label] of [
    ['title', '需求标题'],
    ['background', '背景'],
    ['goal', '目标'],
    ['description', '需求说明'],
  ] as const)
    if ((!simple || !['background', 'goal'].includes(key)) && !d[key]?.trim())
      content.push(label);
  if (!d.criteria.length || d.criteria.some((c) => !c.trim()))
    content.push('至少一项可验证的验收标准');
  for (const [key, label] of [
    ['productId', '产品负责人'],
    ['engineerId', '研发负责人'],
    ['testerId', '测试负责人'],
    ['productReviewerId', '产品评估人'],
    ['qaReviewerId', '测试评估人'],
  ] as const)
    if (
      (!simple || ['productId', 'engineerId'].includes(key)) &&
      (!d[key] || (memberIds && !memberIds.includes(d[key])))
    )
      assignment.push(
        (simple && key === 'engineerId'
          ? '执行人'
          : simple && key === 'productId'
            ? '需求负责人'
            : label) + '需指定项目成员',
      );
  if (!simple && d.productReviewerId && d.productReviewerId === d.qaReviewerId)
    assignment.push('产品与测试评估人须为不同成员');
  if (
    !simple &&
    d.engineerId &&
    (d.engineerId === d.productReviewerId || d.engineerId === d.qaReviewerId)
  )
    assignment.push('研发负责人不能评估自己的方案');
  const blocked = task.data.blocks.some((b) => !b.end);
  return {
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

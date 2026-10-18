import type { Status } from '../../../packages/contracts/index.js';

// Describe the actual server workflow, independently of the viewer's permissions.
export const requirementWorkflow: Record<
  Status,
  {
    instruction: string;
    deliverables: string[];
    outcome: string;
  }
> = {
  DRAFT: {
    instruction: '产品负责人明确问题、目标和验收标准，再交给研发出方案。',
    deliverables: [
      '需求背景、目标与说明',
      '可验证的验收标准',
      '责任人与独立评估人',
    ],
    outcome: '提交后进入待出方案；研发可说明原因退回草稿。',
  },
  SOLUTION_PENDING: {
    instruction: '研发负责人根据当前需求编写可执行方案。',
    deliverables: ['方案正文、范围和风险', '工作量与开始、结束排期'],
    outcome: '提交后由产品与测试分别评估；需求不清楚时可退回补充。',
  },
  SOLUTION_REVIEW: {
    instruction: '产品与测试评估人分别确认方案，研发不能评估自己的方案。',
    deliverables: ['产品评估结论', '测试评估结论'],
    outcome: '两方通过后进入待开发；任一退回则回到待出方案。',
  },
  READY_FOR_DEV: {
    instruction: '研发负责人确认已通过评估的需求与方案，开始开发。',
    deliverables: ['当前需求及方案的有效评估结果'],
    outcome: '开始后进入开发中。',
  },
  DEVELOPING: {
    instruction: '研发完成实现与自测，整理测试可直接使用的交付资料。',
    deliverables: ['实现摘要与自测记录', '发布版本、测试环境及已知问题'],
    outcome: '提交后进入待测试，交给测试负责人。',
  },
  READY_FOR_TEST: {
    instruction: '测试负责人核对研发交付，确认本轮测试环境。',
    deliverables: ['本轮测试环境'],
    outcome: '开始后进入测试中。',
  },
  TESTING: {
    instruction: '测试负责人对照需求与验收标准完成验证。',
    deliverables: ['测试记录与部署信息', '失败时填写原因并关联缺陷'],
    outcome: '通过后交产品验收；失败则退回研发修复。',
  },
  ACCEPTANCE_PENDING: {
    instruction: '产品负责人逐项验证验收标准，确认交付符合需求。',
    deliverables: ['全部验收项的确认结果'],
    outcome: '全部通过后关闭；不通过可说明原因退回开发或待测试。',
  },
  CLOSED: {
    instruction: '需求已完成验收。',
    deliverables: [],
    outcome: '交付与流转记录可追溯。',
  },
  CANCELLED: {
    instruction: '需求已取消。',
    deliverables: [],
    outcome: '取消原因与流转记录可追溯。',
  },
};

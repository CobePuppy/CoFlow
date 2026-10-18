import { Alert, Tag } from 'antd';
import { edition } from '../edition.js';
import {
  labels,
  type Task,
  type Member,
  type Status,
} from '../../../../packages/contracts/index.js';
import { requirementWorkflow } from '../requirement-workflow.js';
import { workflowLabel } from '../../../../packages/contracts/workflow.js';

export function HandoffPreview({
  task,
  action,
  members,
  userId,
}: {
  task: Task;
  action: string;
  members: Member[];
  userId: string;
}) {
  const d = task.data;
  const targets: Record<string, [Status, string[]]> = {
    APPROVE_SOLUTION: d.reviews.some(
      (r: any) => r.round === d.solutions.length && r.approved,
    )
      ? ['READY_FOR_DEV', [d.engineerId]]
      : [
          'SOLUTION_REVIEW',
          [d.productReviewerId, d.qaReviewerId].filter(
            (id) =>
              id !== userId &&
              !d.reviews.some(
                (r: any) => r.round === d.solutions.length && r.userId === id,
              ),
          ),
        ],
    SUBMIT_REQUIREMENT: [
      d.workflow === 'SIMPLE' ? 'READY_FOR_DEV' : 'SOLUTION_PENDING',
      [d.engineerId],
    ],
    START_WORK: ['DEVELOPING', [d.engineerId]],
    SUBMIT_ACCEPTANCE: ['ACCEPTANCE_PENDING', [d.productId]],
    SUBMIT_SOLUTION: ['SOLUTION_REVIEW', [d.productReviewerId, d.qaReviewerId]],
    START_DEVELOPMENT: ['DEVELOPING', [d.engineerId]],
    COMPLETE_DEVELOPMENT: ['READY_FOR_TEST', [d.testerId]],
    START_TEST: ['TESTING', [d.testerId]],
    PASS_TEST: ['ACCEPTANCE_PENDING', [d.productId]],
    ACCEPT: ['CLOSED', []],
    RETURN_REQUIREMENT: ['DRAFT', [d.productId]],
    REJECT_SOLUTION: ['SOLUTION_PENDING', [d.engineerId]],
    FAIL_TEST: ['DEVELOPING', [d.engineerId]],
  };
  const target = targets[action];
  if (!target) return null;
  const [status, ids] = target;
  return (
    <section className="handoff-preview" aria-label="交接预览">
      <div className="handoff-route">
        <Tag>{workflowLabel(task)}</Tag>
        <span>→</span>
        <Tag color={edition.primary}>{workflowLabel({ status, data: d })}</Tag>
      </div>
      <strong>交接预览</strong>
      <p>
        {ids.length
          ? `确认后交给：${ids.map((id) => members.find((m) => m.id === id)?.name || '未指定成员').join('、')}`
          : '确认后完成验收，保留完整交付记录。'}
      </p>
      <p className="muted">
        {d.workflow === 'SIMPLE'
          ? '简易流程保留交付与验收记录，可退回继续处理。'
          : requirementWorkflow[task.status].outcome}
      </p>
      {ids.some((id) => !members.some((m) => m.id === id)) && (
        <Alert type="warning" message="接手人不完整，请先调整责任分工。" />
      )}
    </section>
  );
}

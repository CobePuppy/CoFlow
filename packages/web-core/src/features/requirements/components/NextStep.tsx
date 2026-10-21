import { Button, Card, Space, Tag } from 'antd';
import {
  forwardActions,
  nextDestinations,
  requirementReadiness,
} from '../model/transition-readiness.js';
import { terminal, type Status } from '@coflow/contracts/index.js';
import { workflowLabel } from '@coflow/contracts/workflow.js';
import { requirementWorkflow } from '../model/requirement-workflow.js';

export function NextStep({
  task,
  members,
  user,
  begin,
  edit,
  actionLabels,
}: any) {
  const action = forwardActions.find((a) => task.allowedActions.includes(a));
  const simple = task.data.workflow === 'SIMPLE';
  const readiness = requirementReadiness(
    task,
    members?.map((m: any) => m.id),
  );
  const names = task.handlerIds
    .map(
      (id: string) =>
        members?.find((m: any) => m.id === id)?.name || '成员已不可用',
    )
    .join('、');
  const stage = requirementWorkflow[task.status as Status];
  const instruction = simple
    ? task.status === 'DRAFT'
      ? '填写需求说明、验收标准并指定执行人，再提交到待办。'
      : task.status === 'READY_FOR_DEV'
        ? '执行人确认任务后开始处理。'
        : task.status === 'DEVELOPING'
          ? '完成后填写交付说明，提交给需求负责人验收。'
          : '逐项核对验收标准；不符合时可退回继续处理。'
    : stage.instruction;
  const destination =
    simple && action === 'SUBMIT_REQUIREMENT'
      ? '待办'
      : action
        ? nextDestinations[action]
        : '';
  return (
    <Card className="next-step-card" size="small" title="下一步">
      {task.readOnly ? (
        <p>
          {task.deletedAt
            ? '需求已移入回收站，恢复后可继续处理。'
            : '项目已归档，当前只读。'}
        </p>
      ) : terminal(task.status) ? (
        <p>需求已结束，历史记录已保留。</p>
      ) : (
        <>
          <div className="next-step-layout">
            <div>
              <Space wrap>
                <strong>{workflowLabel(task)}</strong>
                <Tag>当前处理人：{names || '尚未指定'}</Tag>
              </Space>
              <p>{instruction}</p>
              {!action && (
                <p className="muted">
                  由 {names || '指定负责人'}{' '}
                  处理当前阶段。需更换人员时，请联系需求负责人或团队管理员转交。
                </p>
              )}
              {readiness.blocked && (
                <p className="next-step-warning">
                  当前存在阻塞，请先解除阻塞再推进。
                </p>
              )}
            </div>
            <Space direction="vertical" className="next-step-controls">
              {readiness.blocked && task.allowedActions.includes('UNBLOCK') && (
                <Button onClick={() => begin('UNBLOCK')}>解除阻塞</Button>
              )}
              <Button
                type="primary"
                disabled={
                  !action ||
                  readiness.blocked ||
                  (task.status === 'DRAFT' && !readiness.ready)
                }
                onClick={() => begin(action)}
              >
                {action ? actionLabels[action] : '等待处理人操作'}
              </Button>
              {destination && (
                <small className="muted">下一步：{destination}</small>
              )}
            </Space>
          </div>
          {task.status === 'DRAFT' && !readiness.ready ? (
            <div className="readiness-group">
              <strong>提交前需补齐</strong>
              <p>
                {[...readiness.content, ...readiness.assignment].join('、')}
              </p>
              <Space wrap>
                {task.data.productId === user.id && (
                  <Button onClick={edit}>补全需求和分工</Button>
                )}
                {task.allowedActions.includes('TRANSFER') && (
                  <Button onClick={() => begin('TRANSFER')}>
                    调整责任分工
                  </Button>
                )}
              </Space>
            </div>
          ) : (
            !simple && (
              <details>
                <summary>查看本阶段交付要求</summary>
                <ul>
                  {stage.deliverables.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p>{stage.outcome}</p>
              </details>
            )
          )}
        </>
      )}
    </Card>
  );
}

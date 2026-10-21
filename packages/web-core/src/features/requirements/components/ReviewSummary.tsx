import { Avatar, Card, Tag, Empty } from 'antd';
import type { Task, Member } from '@coflow/contracts/index.js';
export function ReviewSummary({
  task,
  members,
  handlerIds = [],
}: {
  task: Task;
  members: Member[];
  handlerIds?: string[];
}) {
  const d = task.data,
    solution = d.solutions.at(-1);
  return (
    <div className="review-summary">
      <Card title="双角色评估" size="small">
        <p className="muted small">
          {solution
            ? `本轮绑定需求 v${solution.requirementVersion} · 方案 v${solution.version}`
            : '方案提交后开启评估'}
        </p>
        {solution ? (
          (['PRODUCT', 'QA'] as const).map((slot) => {
            const decision = d.reviews.find(
                (r) => r.round === solution.version && r.slot === slot,
              ),
              person = members.find(
                (m) =>
                  m.id ===
                  (slot === 'PRODUCT' ? d.productReviewerId : d.qaReviewerId),
              );
            return (
              <div className="review-slot" key={slot}>
                <div>
                  <strong>
                    {slot === 'PRODUCT' ? '产品评估' : '测试评估'}
                  </strong>
                  <Tag
                    bordered={false}
                    color={
                      solution.requirementVersion !== d.requirementVersion
                        ? 'default'
                        : decision
                          ? decision.approved
                            ? 'green'
                            : 'red'
                          : 'blue'
                    }
                  >
                    {solution.requirementVersion !== d.requirementVersion
                      ? '已过期'
                      : decision
                        ? decision.approved
                          ? '已通过'
                          : '已退回'
                        : '待评估'}
                  </Tag>
                </div>
                <p>
                  <Avatar size="small">{person?.name[0] || '?'}</Avatar>{' '}
                  {person?.name || '未指定'} · 指定评估人
                </p>
                {decision?.reason && <p>{decision.reason}</p>}
              </div>
            );
          })
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="尚未提交方案"
          />
        )}
        <p className="small muted">
          两个槽位分别通过后进入待开发。方案提交人不可审批自己的方案。
        </p>
      </Card>
      <Card title="近期动态" size="small">
        {d.history.length === 0 && <p className="muted small">暂无流转记录</p>}
        {d.history
          .slice(-3)
          .reverse()
          .map((h) => (
            <div className="recent-event" key={h.id}>
              <strong>{h.name}</strong>
              <p className="muted small">
                {new Date(h.at).toLocaleString('zh-CN')}
              </p>
              <span className="small">
                {h.payload.reason || '已更新任务流转记录'}
              </span>
            </div>
          ))}
      </Card>
    </div>
  );
}

import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Grid,
  Space,
  Skeleton,
  Tag,
} from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useData } from '../../shared/api/runtime.js';
import {
  getHandlerIds,
  terminal,
  type Task,
  type Status,
} from '@coflow/contracts/index.js';
import { workflowLabel } from '@coflow/contracts/workflow.js';
import { requirementWorkflow } from '../requirements/model/requirement-workflow.js';
import { useState } from 'react';
import { PreviewActions } from '../requirements/components/PreviewActions.js';
import { RequirementSignal } from '../requirements/components/RequirementSignal.js';
export function RequirementPreview({
  id,
  projectId,
  members,
  onClose,
  onOpen,
  user,
  position,
  onPrevious,
  onNext,
}: any) {
  const [working, setWorking] = useState(false);
  const query = useData(['task', id], '/tasks/' + id, !!id);
  const screens = Grid.useBreakpoint();
  const task = query.data as (Task & { readOnly?: boolean }) | undefined;
  const content = (
    <>
      {query.isPending ? (
        <Skeleton active />
      ) : query.error ? (
        <Alert
          type="error"
          message="需求速览读取失败或已无访问权限"
          action={<Button onClick={() => query.refetch()}>重试</Button>}
        />
      ) : !task || task.projectId !== projectId ? (
        <Empty description="需求已不属于当前项目" />
      ) : (
        <>
          <p className="muted">CF-{String(task.number).padStart(3, '0')}</p>
          <h2>{task.data.title}</h2>
          <div className="preview-tags">
            <Tag>{workflowLabel(task)}</Tag>
            <Tag>{task.data.priority}</Tag>
            {task.readOnly && <Tag>只读</Tag>}
            <RequirementSignal task={task} />
          </div>
          <Descriptions
            column={1}
            size="small"
            items={[
              {
                key: 'handler',
                label: '当前处理人',
                children:
                  getHandlerIds(task)
                    .map(
                      (id: string) =>
                        members.find((m: any) => m.id === id)?.name ||
                        '成员已不可用',
                    )
                    .join('、') || '已结束',
              },
              {
                key: 'owner',
                label: '需求负责人',
                children:
                  members.find((m: any) => m.id === task.data.productId)
                    ?.name || '未指定',
              },
              {
                key: 'due',
                label: '计划截止',
                children: task.data.dueAt
                  ? task.data.dueAt.slice(0, 10)
                  : '未设置',
              },
            ]}
          />
          <div className="preview-next">
            <strong>下一步</strong>
            <p>
              {task.deletedAt
                ? '需求已移入回收站，请在完整详情中恢复。'
                : task.readOnly
                  ? '项目已归档，当前仅可查阅交付与流转记录。'
                  : task.data.blocks.some((block: any) => !block.end)
                    ? '当前存在阻塞，请查看下方原因；有权限时可直接解除阻塞。'
                    : terminal(task.status)
                      ? '需求已结束，历史资料已保留。'
                      : task.data.workflow === 'SIMPLE'
                        ? (
                            {
                              DRAFT:
                                '补齐需求说明和验收标准，指定执行人后提交。',
                              READY_FOR_DEV: '等待执行人确认并开始处理。',
                              DEVELOPING:
                                '整理交付说明，提交给需求负责人验收。',
                              ACCEPTANCE_PENDING:
                                '由需求负责人逐项核对验收标准。',
                            } as Record<string, string>
                          )[task.status] || '请在完整详情中查看当前阶段操作。'
                        : requirementWorkflow[task.status as Status]
                            ?.instruction}
            </p>
            <PreviewActions
              key={task.id}
              task={task}
              members={members}
              user={user}
              query={query}
              onOpen={onOpen}
              onBusyChange={setWorking}
            />
            <Button onClick={() => onOpen(task.id)}>打开完整需求详情</Button>
          </div>
          <h3>需求目标</h3>
          <p className="preview-description">
            {task.data.goal || '尚未填写目标'}
          </p>
          <h3>验收标准</h3>
          {task.data.criteria.length ? (
            <ol className="preview-criteria">
              {task.data.criteria.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ol>
          ) : (
            <p className="muted">尚未填写验收标准</p>
          )}
          {task.data.blocks
            .filter((b) => !b.end)
            .map((b, index) => (
              <Alert key={index} type="warning" message={b.reason} />
            ))}
          <h3>需求说明</h3>
          <p className="preview-description">
            {task.data.description || '尚未填写需求说明'}
          </p>
          <h3>最近交付摘要</h3>
          <p className="preview-description">
            {task.data.development.at(-1)?.summary || '尚未提交开发交付说明'}
          </p>
          <p className="muted">交付资料、评审与验收记录在完整详情中查看。</p>
        </>
      )}
    </>
  );
  return screens.xl ? (
    <aside className="requirement-preview" aria-label="需求速览">
      <div className="preview-heading">
        <strong>需求速览</strong>
        <Button
          type="text"
          aria-label="关闭需求速览"
          icon={<CloseOutlined />}
          disabled={working}
          onClick={onClose}
        />
      </div>
      <Space className="preview-navigation">
        <Button disabled={working || !onPrevious} onClick={onPrevious}>
          上一条
        </Button>
        <span className="muted">{position}</span>
        <Button disabled={working || !onNext} onClick={onNext}>
          下一条
        </Button>
      </Space>
      <div className="preview-body">{content}</div>
    </aside>
  ) : (
    <Drawer
      open
      title="需求速览"
      width="min(420px,100vw)"
      onClose={() => !working && onClose()}
      destroyOnHidden
    >
      <Space className="preview-navigation">
        <Button disabled={working || !onPrevious} onClick={onPrevious}>
          上一条
        </Button>
        <span className="muted">{position}</span>
        <Button disabled={working || !onNext} onClick={onNext}>
          下一条
        </Button>
      </Space>
      {content}
    </Drawer>
  );
}

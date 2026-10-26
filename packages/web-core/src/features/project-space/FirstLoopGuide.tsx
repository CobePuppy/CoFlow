import { useEffect, useState } from 'react';
import { Button, Card, Skeleton, Tag } from 'antd';
import {
  CheckCircleOutlined,
  DownOutlined,
  RocketOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { Member } from '@coflow/contracts/index.js';
import { edition } from '../../app/edition.js';

const ORDER = [
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
];

// 第③步提供的可修改示例需求（仅内容字段，角色沿用创建表单默认值）。
export const SAMPLE_REQUIREMENT = {
  type: 'REQUIREMENT',
  priority: 'P2',
  title: '示例：完成团队的第一条需求闭环',
  background: '新团队刚进入项目，还不熟悉需求从提出到验收的完整协作流程。',
  goal: '通过一条可以直接修改的示例需求走完完整闭环，让团队熟悉分工与流转。',
  description:
    '这是一条示例需求，你可以直接修改为团队真实的第一个需求：调整标题、背景、目标与验收标准后照常提交。需求会依次经过研发方案、双评估、开发交付、测试验证，最终验收关闭。',
  criteria: [
    '项目首页展示第一条闭环引导卡片',
    '每个步骤显示当前负责人并可直达',
    '闭环完成后引导卡片显示闭环已完成',
  ].join('\n'),
};

export function FirstLoopGuide({
  project,
  user,
  members,
  firstLoop,
  isAdmin,
  onOpenTask,
  onManageMembers,
  onSample,
}: any) {
  const storageKey = `coflow-first-loop-hidden:${project?.id}`;
  const [hidden, setHidden] = useState(
    () => !project || localStorage.getItem(storageKey) === '1',
  );
  useEffect(() => {
    setHidden(!project || localStorage.getItem(storageKey) === '1');
  }, [storageKey]);
  const collapse = () => {
    localStorage.setItem(storageKey, '1');
    setHidden(true);
  };
  const restore = () => {
    localStorage.removeItem(storageKey);
    setHidden(false);
  };
  if (!project || project.archivedAt) return null;
  if (firstLoop?.isPending)
    return (
      <Card className="first-loop-guide">
        <Skeleton active paragraph={{ rows: 3 }} />
      </Card>
    );
  if (firstLoop?.error) return null;

  const rows: any[] = firstLoop?.data?.items || [];
  const total = firstLoop?.data?.total || 0;
  // 项目需求过多（超出单页）且本页没有已关闭需求时，不再展示新项目引导。
  if (total > rows.length && !rows.some((x: any) => x.status === 'CLOSED'))
    return null;
  const pool = rows.filter((x: any) => x.status !== 'CANCELLED');
  const first = [...(pool.length ? pool : rows)].sort(
    (a: any, b: any) => (a.number || 0) - (b.number || 0),
  )[0];
  const task = first;
  const d: any = first?.data || {};
  const status: any = first?.status;
  const rank = (s: string) => Math.max(0, ORDER.indexOf(s));
  const simple = project.workflow === 'SIMPLE';
  const compact = !simple && project.roleMode === 'COMPACT';
  const nameOf = (id: string) =>
    (members || []).find((m: Member) => m.id === id)?.name || '未指定成员';
  const membersNeeded = simple ? 1 : 3;
  const reviewerIds =
    d.productReviewerId || d.qaReviewerId
      ? [...new Set([d.productReviewerId, d.qaReviewerId].filter(Boolean))]
      : compact && d.productId
        ? [d.productId]
        : [];
  const rolesReady =
    !!task &&
    (simple
      ? !!(d.productId && d.engineerId)
      : compact
        ? !!(d.productId && d.engineerId && d.testerId)
        : !!(
            d.productId &&
            d.engineerId &&
            d.testerId &&
            d.productReviewerId &&
            d.qaReviewerId
          ));
  const ownerView = (ids: string[], note = '') => {
    const valid = ids.filter(Boolean);
    if (!valid.length) return { mine: false, text: '待分配负责人' };
    const mine = valid.includes(user.id);
    return {
      mine,
      text:
        (mine ? `由你负责${note}` : `等待 ${valid.map(nameOf).join('、')} 处理${note}`),
    };
  };
  const afterSubmit = { mine: false, text: '提交需求后进行' };
  const openTask = task ? () => onOpenTask(task.id) : onSample;
  const steps = [
    {
      label: '邀请成员',
      done: (members?.length || 0) >= membersNeeded,
      owner: isAdmin
        ? { mine: true, text: '由你负责邀请' }
        : { mine: false, text: '等待管理员邀请成员' },
      open: onManageMembers,
    },
    {
      label: '分配角色',
      done: rolesReady,
      owner: task ? ownerView([d.productId]) : { mine: true, text: '由你负责创建' },
      open: openTask,
    },
    {
      label: '提交需求',
      done: !!task && rank(status) >= rank('SOLUTION_PENDING'),
      owner: task
        ? ownerView([d.productId])
        : { mine: true, text: '由你负责提交（含可修改示例）' },
      open: openTask,
    },
    ...(simple
      ? []
      : [
          {
            label: '研发方案',
            done: !!task && rank(status) >= rank('SOLUTION_REVIEW'),
            owner: task ? ownerView([d.engineerId]) : afterSubmit,
            open: openTask,
          },
          {
            label: '双评估',
            done: !!task && rank(status) >= rank('READY_FOR_DEV'),
            owner: task
              ? ownerView(reviewerIds, compact ? '（同一人兼任两项评估）' : '')
              : afterSubmit,
            open: openTask,
          },
        ]),
    {
      label: '开发交付',
      done:
        !!task &&
        rank(status) >= rank(simple ? 'ACCEPTANCE_PENDING' : 'READY_FOR_TEST'),
      owner: task ? ownerView([d.engineerId]) : afterSubmit,
      open: openTask,
    },
    ...(simple
      ? []
      : [
          {
            label: '测试验证',
            done: !!task && rank(status) >= rank('ACCEPTANCE_PENDING'),
            owner: task ? ownerView([d.testerId]) : afterSubmit,
            open: openTask,
          },
        ]),
    {
      label: '验收关闭',
      done: status === 'CLOSED',
      owner: task ? ownerView([d.productId]) : afterSubmit,
      open: openTask,
    },
  ];
  const doneCount = steps.filter((s: any) => s.done).length;
  const loopClosed = status === 'CLOSED';
  const current = steps.findIndex((s: any) => !s.done);

  if (hidden)
    return (
      <div className="first-loop-restore">
        <span>
          第一条闭环引导已收起{loopClosed ? '，本项目闭环已完成' : ''}。
        </span>
        <Button size="small" type="link" onClick={restore}>
          重新打开引导
        </Button>
      </div>
    );

  return (
    <Card
      className={'first-loop-guide' + (loopClosed ? ' is-complete' : '')}
      title={
        <div className="first-loop-head">
          <RocketOutlined />
          <span>第一条闭环{loopClosed ? ' · 闭环已完成' : ''}</span>
          <Tag color={loopClosed ? 'green' : 'gold'}>
            {loopClosed ? '已完成' : `${doneCount}/${steps.length} 步`}
          </Tag>
        </div>
      }
      extra={
        <Button
          size="small"
          type="text"
          icon={<DownOutlined />}
          onClick={collapse}
        >
          收起
        </Button>
      }
    >
      <p className="first-loop-intro">
        {loopClosed
          ? '团队已经完整走过一次需求闭环，可继续按此节奏推进后续需求。'
          : `跟随 ${steps.length} 个步骤完成第一条需求的完整闭环；每一步显示当前负责人，点击可直达。`}
      </p>
      <ol className="first-loop-steps">
        {steps.map((s: any, i: number) => (
          <li
            key={s.label}
            className={
              'first-loop-step' +
              (s.done ? ' is-done' : '') +
              (i === current ? ' is-current' : '')
            }
            style={i === current ? { borderLeftColor: edition.primary } : {}}
          >
            <span className="first-loop-index">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="first-loop-label">{s.label}</span>
            <span className="first-loop-owner">
              {s.done ? <CheckCircleOutlined /> : null}
              {s.done ? '已完成' : s.owner.text}
            </span>
            <Button
              size="small"
              type={s.done ? 'default' : s.owner.mine ? 'primary' : 'link'}
              onClick={s.open}
            >
              {s.done ? '查看' : s.owner.mine ? '去处理' : '查看进度'}
            </Button>
          </li>
        ))}
      </ol>
      {!task && (
        <div className="first-loop-sample">
          <TeamOutlined />
          <span>还没有需求？第 3 步提供了一条可修改的示例需求：</span>
          <Button size="small" onClick={onSample}>
            用示例需求创建第一条需求
          </Button>
        </div>
      )}
    </Card>
  );
}

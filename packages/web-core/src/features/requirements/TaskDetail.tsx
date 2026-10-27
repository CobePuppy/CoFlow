import { useSearchParams } from 'react-router-dom';
import { patchSearchParams } from '../../shared/lib/navigation.js';
import { TaskDiscussions } from './components/TaskDiscussions.js';
import { TaskIteration } from '../iterations/TaskIteration.js';
import {
  RequirementVersions,
  RequirementDiff,
} from './components/RequirementVersions.js';
import { TaskResources } from '../documents/components/TaskResources.js';
import { TaskActionDialog } from './TaskActionDialog.js';

import { TaskGitHub } from '../github/components/TaskGitHub.js';
import { GitHubAcceptanceLinks } from '../github/components/GitHubDelivery.js';

import { invalidateTaskQueries } from '../../shared/api/query-invalidation.js';

import { workflowLabel, workflowStatuses } from '@coflow/contracts/workflow.js';

import { DeleteRequirement } from './components/DeleteRequirement.js';
import { AttachmentPanel } from '../documents/components/AttachmentPanel.js';

import { DeliveryMaterials } from './components/DeliveryMaterials.js';
import { NextStep } from './components/NextStep.js';

import {
  forwardActions,
  requirementReadiness,
} from './model/transition-readiness.js';
import { createClientId } from '../../shared/lib/client-id.js';
import { RequirementContent } from './components/RequirementContent.js';

import { RelatedDocuments } from '../documents/components/DocumentLinks.js';

import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Grid,
  Space,
  Spin,
  Tabs,
  Tag,
  Timeline,
} from 'antd';
import { useState } from 'react';

import {
  labels,
  statuses,
  terminal,
  type Member,
  type Task,
} from '@coflow/contracts/index.js';
import { ApiError } from '../../shared/api/api-response.js';
import { BrandMark } from '../../shared/ui/BrandMark.js';
import { Markdown } from '../../shared/ui/Markdown.js';
import { ReviewSummary } from './components/ReviewSummary.js';
import { TaskEditor } from './components/TaskEditor.js';
import { TaskProperties } from './components/TaskProperties.js';
import { AIQuality } from '../../app/pages.js';
import { api, useData } from '../../shared/api/runtime.js';
import { actionLabels } from './model/action-ui.js';

import { useUnsavedChanges } from '../../shared/lib/unsaved.js';
export function TaskDetail({ id, user, onClose }: any) {
  const qc = useQueryClient(),
    { message } = AntApp.useApp();
  const q = useData(['task', id], `/tasks/${id}?omitComments=true`),
    t = q.data as Task & {
      attachments: any[];
      allowedActions: string[];
      handlerIds: string[];
      readOnly: boolean;
      canManage: boolean;
    };
  const screens = Grid.useBreakpoint();
  const [params, setParams] = useSearchParams();
  const [actionForm] = Form.useForm();
  const people = useData(
    ['members', t?.projectId],
    `/projects/${t?.projectId}/members`,
    !!t,
  );
  const [action, setAction] = useState(''),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [actionError, setActionError] = useState('');
  useUnsavedChanges(!!action || editing);
  const [requestKey, setRequestKey] = useState('');
  const [importSource, setImportSource] = useState<{
    id: string;
    name: string;
  }>();
  const projectInfo = useData(
    ['project', t?.projectId],
    `/projects/${t?.projectId}`,
    !!t,
  );
  const [conflict, setConflict] = useState(false);
  const run = async (payload: any) => {
    setBusy(true);
    setActionError('');
    try {
      await api(
        `/tasks/${id}/actions`,
        'POST',
        { action, expectedVersion: t.version, payload },
        requestKey,
      );
      setAction('');
      message.success('操作成功');
      invalidateTaskQueries(qc);
      return true;
    } catch (e) {
      setActionError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setRequestKey(createClientId());
      }
      q.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  };
  const begin = (a: string, source?: { id: string; name: string }) => {
    setImportSource(source);
    setActionError('');
    setConflict(false);
    actionForm.resetFields();
    if (a === 'REJECT_ACCEPTANCE' && t.data.workflow === 'SIMPLE')
      actionForm.setFieldsValue({ target: 'DEVELOPING' });
    if (a === 'SUBMIT_SOLUTION' && (t.data as any).solutionDraft)
      actionForm.setFieldsValue((t.data as any).solutionDraft);
    setRequestKey(createClientId());
    setAction(a);
  };
  const d = t?.data;
  const actions = t?.allowedActions || [];
  const primaryAction = forwardActions.find((a) => actions.includes(a));
  const secondaryActions = actions.filter((a) => a !== primaryAction);
  const readiness = t
    ? requirementReadiness(
        t,
        people.data?.map((m: Member) => m.id),
      )
    : undefined;
  const closeDetail = onClose;
  return (
    <Drawer
      className="task-detail-drawer"
      width="100%"
      mask={!screens.lg}
      open
      title={
        <div className="detail-topbar">
          <BrandMark />
          <span>需求协作</span>
          <Tag>
            {t ? `CF-${String(t.number).padStart(3, '0')}` : '需求详情'}
          </Tag>
        </div>
      }
      extra={<Button onClick={closeDetail}>返回需求列表</Button>}
      onClose={closeDetail}
    >
      {q.isPending ? (
        <Spin />
      ) : q.error ? (
        <Alert type="error" message={q.error.message} />
      ) : (
        d && (
          <>
            <section className="detail-overview">
              <div className="detail-heading">
                <h2>
                  <small className="detail-code">
                    {d.type === 'BUG' ? '缺陷修复' : '产品需求'} · CF-
                    {String(t.number).padStart(3, '0')}
                  </small>
                  {d.title}
                </h2>
                <Space>
                  <Tag>{workflowLabel(t)}</Tag>
                  <Tag>{d.priority}</Tag>
                  <span className="muted">版本 {t.version}</span>
                  <Button onClick={() => q.refetch()}>刷新</Button>
                  <DeleteRequirement
                    task={t}
                    userId={user.id}
                    readOnly={!!projectInfo.data?.archivedAt}
                    admin={t.canManage}
                    onDeleted={onClose}
                  />
                  {t.status === 'DRAFT' &&
                    user.id === d.productId &&
                    !t.readOnly && (
                      <Button onClick={() => setEditing(true)}>编辑草稿</Button>
                    )}
                </Space>
              </div>
              {t.readOnly && (
                <Alert
                  type="info"
                  message={
                    t.deletedAt
                      ? '需求已移入回收站，历史和附件保留，可恢复后继续处理。'
                      : '项目已归档，当前仅可查看历史'
                  }
                />
              )}
              <div className="flow-strip">
                {workflowStatuses(d.workflow === 'SIMPLE')
                  .filter((s) => s !== 'CANCELLED')
                  .map((s) => (
                    <span
                      key={s}
                      className={
                        t.status === s
                          ? 'current'
                          : statuses.indexOf(s) < statuses.indexOf(t.status) &&
                              t.status !== 'CANCELLED'
                            ? 'completed'
                            : ''
                      }
                      aria-current={t.status === s ? 'step' : undefined}
                    >
                      {workflowLabel({ status: s, data: d })}
                    </span>
                  ))}
              </div>
            </section>
            {d.blocks.some((b) => !b.end) && (
              <Alert
                showIcon
                type="warning"
                message={`阻塞：${d.blocks.find((b) => !b.end).reason}`}
              />
            )}
            {secondaryActions.length > 0 && (
              <details className="action-bar">
                <summary>更多操作 · 转交、变更与取消</summary>
                <Space wrap>
                  {secondaryActions.map((a) => (
                    <Button
                      key={a}
                      type="default"
                      danger={
                        a.startsWith('REJECT') ||
                        a === 'CANCEL' ||
                        a === 'FAIL_TEST'
                      }
                      onClick={() => begin(a)}
                    >
                      {actionLabels[a]}
                    </Button>
                  ))}
                </Space>
              </details>
            )}
            <NextStep
              task={t}
              members={people.data || []}
              user={user}
              begin={begin}
              edit={() => setEditing(true)}
              actionLabels={actionLabels}
            />
            <div className="detail-layout">
              <div className="detail-tabs">
                <Tabs
                  className="requirement-detail-sections"
                  activeKey={
                    [
                      'requirement',
                      'solution',
                      'development',
                      'testing',
                      'ai-quality',
                      'related-documents',
                      'github',
                      'activity',
                    ].includes(params.get('taskTab') || '')
                      ? params.get('taskTab')!
                      : d.workflow !== 'SIMPLE' &&
                          ['READY_FOR_TEST', 'TESTING'].includes(t.status)
                        ? 'testing'
                        : t.status === 'SOLUTION_REVIEW'
                          ? 'solution'
                          : 'requirement'
                  }
                  onChange={(key) =>
                    setParams(
                      patchSearchParams(params, {
                        taskTab: key,
                        discussion: null,
                      }),
                    )
                  }
                  items={[
                    {
                      key: 'requirement',
                      label: '需求说明',
                      children: (
                        <div className="requirement-article">
                          <RequirementContent
                            key={t.id}
                            task={t}
                            user={user}
                            onChangeRequest={
                              !terminal(t.status) &&
                              t.status !== 'DRAFT' &&
                              !t.readOnly &&
                              people.data
                                ?.find((m: Member) => m.id === user.id)
                                ?.roles.some((role: string) =>
                                  ['PRODUCT', 'QA', 'ENGINEER'].includes(role),
                                )
                                ? () => begin('PROPOSE_CHANGE')
                                : undefined
                            }
                          />
                          <AttachmentPanel
                            taskId={id}
                            stage="REQUIREMENT"
                            readOnly={t.readOnly}
                          />
                          <RequirementVersions key={t.id} task={t} />
                          {d.requirements.length > 0 && <h3>提交版本</h3>}
                          {d.requirements.map((r: any) => (
                            <details key={r.version}>
                              <summary>
                                需求 v{r.version} ·{' '}
                                {new Date(r.at).toLocaleString('zh-CN')}
                              </summary>
                              <Markdown>{r.description}</Markdown>
                              {r.criteria.map((c: string, i: number) => (
                                <p key={i}>□ {c}</p>
                              ))}
                            </details>
                          ))}
                          {d.changes.length > 0 && <h3>变更记录与提议</h3>}
                          {d.changes.map((c: any, i: number) => (
                            <Card
                              size="small"
                              key={i}
                              title={
                                c.decision === 'PROPOSED'
                                  ? '待产品确认的变更提议'
                                  : '已确认变更'
                              }
                            >
                              <p>{c.description}</p>
                              {c.decision === 'PROPOSED' && (
                                <>
                                  <Tag>提议尚未生效，以下对比当前正式版本</Tag>
                                  <RequirementDiff
                                    before={d.requirements.at(-1) || null}
                                    after={{
                                      ...d.requirements.at(-1),
                                      description: c.description,
                                      ...(c.criteria
                                        ? { criteria: c.criteria }
                                        : {}),
                                    }}
                                  />
                                </>
                              )}
                              <p>
                                原因：{c.reason} · 影响：{c.impact}
                              </p>
                            </Card>
                          ))}
                          {!terminal(t.status) &&
                            t.status !== 'DRAFT' &&
                            !t.readOnly &&
                            people.data
                              ?.find((m: Member) => m.id === user.id)
                              ?.roles.some((r: string) =>
                                ['PRODUCT', 'QA', 'ENGINEER'].includes(r),
                              ) && (
                              <Button onClick={() => begin('PROPOSE_CHANGE')}>
                                提出变更建议
                              </Button>
                            )}
                        </div>
                      ),
                    },

                    ...(d.workflow === 'SIMPLE'
                      ? []
                      : [
                          {
                            key: 'solution',
                            label: '方案与评审',
                            children: (
                              <DeliveryMaterials
                                task={t}
                                begin={begin}
                                section="solution"
                              />
                            ),
                          },
                        ]),
                    {
                      key: 'development',
                      label: '开发交付',
                      children:
                        d.workflow === 'SIMPLE' ? (
                          <>
                            <Card title="交付说明">
                              {d.development.length ? (
                                d.development.map((item: any, i: number) => (
                                  <details
                                    key={i}
                                    open={i === d.development.length - 1}
                                  >
                                    <summary>
                                      第 {i + 1} 次交付 ·{' '}
                                      {new Date(item.at).toLocaleString(
                                        'zh-CN',
                                      )}
                                    </summary>
                                    <Markdown>{item.summary}</Markdown>
                                  </details>
                                ))
                              ) : (
                                <Empty description="执行人提交验收时填写交付说明" />
                              )}
                            </Card>
                            <AttachmentPanel
                              taskId={id}
                              stage="DEVELOPMENT"
                              readOnly={t.readOnly}
                              onParse={
                                !t.readOnly &&
                                t.allowedActions.includes('SUBMIT_ACCEPTANCE')
                                  ? (file) => begin('SUBMIT_ACCEPTANCE', file)
                                  : undefined
                              }
                              parseUnavailableReason={
                                t.allowedActions.includes('SUBMIT_ACCEPTANCE')
                                  ? undefined
                                  : '进行中时，由执行人提交交付说明'
                              }
                            />
                          </>
                        ) : (
                          <DeliveryMaterials
                            task={t}
                            begin={begin}
                            section="development"
                          />
                        ),
                    },
                    {
                      key: 'testing',
                      label: '测试与验收',
                      children: (
                        <>
                          <Card title={`验收标准 · ${d.criteria.length} 项`}>
                            {d.criteria.length ? (
                              <ol className="requirement-criteria">
                                {d.criteria.map((c, i) => (
                                  <li key={i}>
                                    {c}
                                    <GitHubAcceptanceLinks
                                      taskId={t.id}
                                      index={i}
                                      text={c}
                                    />
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <Empty description="尚未填写可验证的验收标准" />
                            )}
                            {t.status === 'DRAFT' &&
                              user.id === d.productId &&
                              !t.readOnly && (
                                <Button onClick={() => setEditing(true)}>
                                  编辑验收项
                                </Button>
                              )}
                            <p className="muted">
                              用于方案评估、测试与最终逐项验收。
                            </p>
                            {d.workflow === 'SIMPLE' && (
                              <AttachmentPanel
                                taskId={id}
                                stage="ACCEPTANCE"
                                readOnly={t.readOnly}
                              />
                            )}
                          </Card>
                          {d.workflow !== 'SIMPLE' && (
                            <DeliveryMaterials
                              task={t}
                              begin={begin}
                              section="testing"
                            />
                          )}
                        </>
                      ),
                    },
                    {
                      key: 'ai-quality',
                      label: 'AI评审',
                      children: <AIQuality task={t} />,
                    },
                    {
                      key: 'related-documents',
                      label: '关联资料',
                      children: (
                        <>
                          <TaskResources key={t.id} task={t} />
                          <RelatedDocuments taskId={id} hideEmpty />
                        </>
                      ),
                    },
                    {
                      key: 'github',
                      label: 'GitHub 仓库',
                      children: (
                        <TaskGitHub key={t.id} task={t} userId={user.id} />
                      ),
                    },
                    {
                      key: 'activity',
                      label: '动态记录',
                      children: (
                        <>
                          <TaskDiscussions
                            key={t.id}
                            task={t}
                            userId={user.id}
                            members={people.data || []}
                          />
                          <AttachmentPanel
                            taskId={id}
                            readOnly={t.readOnly}
                            title="全部附件"
                          />
                          <h3>审计时间线</h3>
                          <Timeline
                            items={[...d.history].reverse().map((h) => ({
                              children: (
                                <>
                                  <strong>
                                    {actionLabels[h.action] || h.action}
                                  </strong>{' '}
                                  · {h.name}
                                  <p className="muted">
                                    {labels[h.from]} → {labels[h.to]} ·{' '}
                                    {new Date(h.at).toLocaleString('zh-CN')}
                                  </p>
                                  {h.payload.reason && (
                                    <p>{h.payload.reason}</p>
                                  )}
                                  {h.action ===
                                    'CRITERIA_WARNINGS_IGNORED' && (
                                    <p className="muted">
                                      提交时忽略 {h.payload.warnings?.length || 0}{' '}
                                      条验收标准质量提醒
                                      {h.payload.strict
                                        ? '（严格模式'
                                        : '（提醒模式'}
                                      {h.payload.overrideReason
                                        ? ` · 管理员放行：${h.payload.overrideReason}）`
                                        : '）'}
                                    </p>
                                  )}
                                </>
                              ),
                            }))}
                          />
                        </>
                      ),
                    },
                  ]}
                />
              </div>
              <aside className="detail-sidebar">
                <TaskIteration key={t.id} task={t} />
                <Card title="基本信息" size="small">
                  <TaskProperties
                    task={t}
                    user={user}
                    members={people.data || []}
                    projectName={projectInfo.data?.name}
                    request={api}
                    begin={begin}
                    actionLabels={actionLabels}
                  />
                </Card>
                <ReviewSummary
                  task={t}
                  members={people.data || []}
                  handlerIds={t.handlerIds}
                />
              </aside>
            </div>
            <TaskEditor
              userId={user.id}
              workspaceId={t.workspaceId}
              resourceId={t.id}
              baseVersion={t.version}
              open={editing}
              initial={d}
              projectId={t.projectId}
              projectName={projectInfo.data?.name}
              members={people.data || []}
              onClose={() => setEditing(false)}
              onSave={async (v: any) => {
                try {
                  await api(`/tasks/${id}`, 'PATCH', {
                    ...v,
                    expectedVersion: v.expectedVersion ?? t.version,
                  });
                  setEditing(false);
                  invalidateTaskQueries(qc);
                } catch (e) {
                  message.error((e as Error).message);
                  throw e;
                }
              }}
            />
          </>
        )
      )}
      {action && t && (
        <TaskActionDialog
          setEditing={setEditing}
          actions={actions}
          begin={begin}
          action={action}
          t={t}
          setAction={setAction}
          actionForm={actionForm}
          busy={busy}
          setBusy={setBusy}
          run={run}
          people={people}
          id={id}
          user={user}
          importSource={importSource}
          setImportSource={setImportSource}
          actionError={actionError}
          setActionError={setActionError}
          conflict={conflict}
          setConflict={setConflict}
          readiness={readiness}
          q={q}
        />
      )}
    </Drawer>
  );
}

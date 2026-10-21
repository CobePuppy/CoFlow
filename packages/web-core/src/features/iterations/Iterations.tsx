import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Progress,
  Select,
  Space,
  Spin,
  Tag,
} from 'antd';
import type {
  IterationDetail,
  IterationSummary,
  IterationTask,
  IterationMilestone,
  IterationProgress,
} from '@coflow/contracts/iterations.js';
import { workflowLabel } from '@coflow/contracts/workflow.js';
import { api } from '../../shared/api/runtime.js';
import { patchSearchParams } from '../../shared/lib/navigation.js';
import { useUnsavedChanges } from '../../shared/lib/unsaved.js';
import './iterations.css';
const pageNumber = (v: string | null) => {
  const n = Number(v || 1);
  return Number.isInteger(n) && n > 0 && n <= 1000000 ? n : 1;
};
const eventNames: Record<string, string> = {
  CREATE: '创建迭代',
  UPDATE: '调整迭代',
  ADD_TASKS: '加入需求',
  REMOVE_TASK: '移出需求',
  UPDATE_TASK: '更新需求安排',
  ADD_MILESTONE: '新增里程碑',
  UPDATE_MILESTONE: '调整里程碑',
  REMOVE_MILESTONE: '移除里程碑',
};
function ProgressSummary({ value }: { value: IterationProgress }) {
  return (
    <div>
      <Progress
        percent={value.percent}
        status={value.planned && value.percent === 100 ? 'success' : 'normal'}
      />
      <Space wrap>
        <span>
          已验收 {value.accepted} / 有效需求 {value.planned}
        </span>
        <Tag color={value.overdue ? 'red' : 'default'}>
          延期 {value.overdue}
        </Tag>
        <Tag>未验收 {value.unfinished}</Tag>
        {!!value.blocked && <Tag color="orange">阻塞 {value.blocked}</Tag>}
        {!!value.cancelled && <Tag>已取消 {value.cancelled}（不计进度）</Tag>}
        {!!value.deleted && <Tag>回收站 {value.deleted}（不计进度）</Tag>}
      </Space>
      {!value.planned && <p className="muted">尚无有效需求，不标记为完成。</p>}
    </div>
  );
}
type Editor = {
  kind: 'create' | 'iteration' | 'milestone' | 'arrangement';
  version: number;
  milestone?: IterationMilestone;
  task?: IterationTask;
};
export default function Iterations({
  projectId,
  members,
  onOpen,
}: {
  projectId: string;
  members: { id: string; name: string }[];
  onOpen: (id: string) => void;
}) {
  const qc = useQueryClient(),
    { message, modal } = App.useApp();
  const [params, setParams] = useSearchParams();
  const page = pageNumber(params.get('iterationPage')),
    taskPage = pageNumber(params.get('iterationTasksPage'));
  const filter = ['all', 'unfinished', 'overdue'].includes(
    params.get('iterationFilter') || '',
  )
    ? params.get('iterationFilter')!
    : 'all';
  const list = useQuery<{
    items: IterationSummary[];
    total: number;
    canCreate: boolean;
    readOnly: boolean;
  }>({
    queryKey: ['iterations', projectId, page],
    enabled: !!projectId,
    queryFn: () =>
      api(
        '/projects/' + projectId + '/iterations?page=' + page + '&pageSize=10',
      ),
  });
  const selected = params.get('iteration') || list.data?.items[0]?.id || '';
  const base = '/projects/' + projectId + '/iterations',
    detailBase = base + '/' + selected;
  const detail = useQuery<IterationDetail>({
    queryKey: ['iteration', projectId, selected],
    enabled: !!projectId && !!selected,
    queryFn: () => api(detailBase),
  });
  const tasks = useQuery<{ items: IterationTask[]; total: number }>({
    queryKey: ['iterationTasks', projectId, selected, taskPage, filter],
    enabled: !!detail.data,
    queryFn: () =>
      api(
        detailBase +
          '/tasks?' +
          new URLSearchParams({
            page: String(taskPage),
            pageSize: '10',
            filter,
          }),
      ),
  });
  const [editor, setEditor] = useState<Editor>(),
    [form] = Form.useForm(),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [adding, setAdding] = useState(false),
    [addVersion, setAddVersion] = useState(0),
    [candidatePage, setCandidatePage] = useState(1),
    [q, setQ] = useState(''),
    [chosen, setChosen] = useState<Record<string, string>>({}),
    [target, setTarget] = useState<string | null>(null);
  const candidates = useQuery<{
    items: {
      id: string;
      number: number;
      title: string;
      status: string;
      workflow: string;
      iterationName: string | null;
      iterationId: string | null;
    }[];
    total: number;
  }>({
    queryKey: ['iterationCandidates', projectId, selected, candidatePage, q],
    enabled: adding && !!selected,
    queryFn: ({ signal }) =>
      api(
        detailBase +
          '/candidates?' +
          new URLSearchParams({
            page: String(candidatePage),
            pageSize: '10',
            q,
          }),
        'GET',
        undefined,
        undefined,
        signal,
      ),
  });
  useEffect(() => {
    if (
      editor?.kind === 'create' &&
      members.length &&
      !form.getFieldValue('ownerId')
    )
      form.setFieldsValue({ ownerId: members[0].id });
  }, [editor?.kind, members, form]);
  const content = useRef<HTMLDivElement>(null);
  useUnsavedChanges(!!editor && dirty);
  const navigate = (patch: Record<string, string | null>) =>
    setParams(patchSearchParams(params, patch));
  const refresh = () =>
    qc.invalidateQueries({
      predicate: (x) =>
        [
          'iterations',
          'iteration',
          'iterationTasks',
          'iterationCandidates',
          'taskIteration',
        ].includes(String(x.queryKey[0])),
    });
  const person = (id: string) =>
    members.find((m) => m.id === id)?.name || '成员已不可用';
  function begin(next: Editor) {
    setError('');
    setDirty(false);
    form.resetFields();
    if (next.kind === 'iteration' && detail.data)
      form.setFieldsValue(detail.data);
    if (next.kind === 'milestone' && next.milestone)
      form.setFieldsValue(next.milestone);
    if (next.kind === 'arrangement' && next.task)
      form.setFieldsValue({
        milestoneId: next.task.milestoneId,
        delayNote: next.task.delayNote,
      });
    if (next.kind === 'create')
      form.setFieldsValue({ ownerId: members[0]?.id });
    setEditor(next);
  }
  function close() {
    if (busy) return;
    if (dirty)
      modal.confirm({
        title: '放弃尚未保存的计划输入？',
        content: '当前输入尚未保存，放弃后需要重新填写。',
        okText: '放弃输入',
        cancelText: '继续编辑',
        onOk: () => {
          setEditor(undefined);
          setDirty(false);
        },
      });
    else setEditor(undefined);
  }
  async function mutate(path: string, method: string, data: any) {
    setBusy(true);
    setError('');
    try {
      const result = await api(path, method, data);
      await refresh();
      return { ok: true, result };
    } catch (e) {
      setError((e as Error).message);
      await refresh();
      return { ok: false, result: null };
    } finally {
      setBusy(false);
    }
  }
  const current = detail.data;
  return (
    <div className="iteration-module">
      <div className="iteration-heading">
        <div>
          <h2>迭代与里程碑</h2>
          <p className="muted">
            把阶段目标、需求与检查点放在一起；按真实验收结果查看当前进度。
          </p>
        </div>
        {list.data?.canCreate && (
          <Button
            type="primary"
            onClick={() => begin({ kind: 'create', version: 0 })}
          >
            新建迭代
          </Button>
        )}
      </div>
      {error && !editor && !adding && <Alert type="error" message={error} />}{' '}
      {list.isPending ? (
        <Spin />
      ) : list.error ? (
        <Alert
          type="error"
          message="迭代加载失败"
          action={<Button onClick={() => list.refetch()}>重试加载迭代</Button>}
        />
      ) : !list.data?.total ? (
        <Empty description="暂无迭代，先创建一个阶段目标" />
      ) : (
        <div className="iteration-layout">
          <aside className="iteration-list" aria-label="迭代列表">
            {list.data.items.map((i) => (
              <button
                key={i.id}
                className={
                  'iteration-choice ' + (selected === i.id ? 'active' : '')
                }
                aria-pressed={selected === i.id}
                onClick={() => {
                  navigate({
                    iteration: i.id,
                    iterationTasksPage: null,
                    iterationFilter: null,
                  });
                  setError('');
                  setTimeout(
                    () => content.current?.scrollIntoView({ block: 'start' }),
                    50,
                  );
                }}
              >
                <strong>{i.name}</strong>
                <small>
                  {i.startDate} 至 {i.endDate}
                </small>
                <span>
                  已验收 {i.progress.accepted}/{i.progress.planned} · 延期{' '}
                  {i.progress.overdue}
                </span>
              </button>
            ))}
            <Pagination
              simple
              current={page}
              pageSize={10}
              total={list.data.total}
              showSizeChanger={false}
              onChange={(p) =>
                navigate({
                  iterationPage: String(p),
                  iteration: null,
                  iterationTasksPage: null,
                  iterationFilter: null,
                })
              }
            />
          </aside>
          <div ref={content} className="iteration-detail">
            {detail.isPending ? (
              <Spin />
            ) : detail.error ? (
              <Alert
                type="error"
                message="迭代不可访问或加载失败"
                action={
                  <Button onClick={() => detail.refetch()}>重试当前迭代</Button>
                }
              />
            ) : (
              current && (
                <>
                  <Card
                    title={current.name}
                    extra={
                      current.canManage && (
                        <Button
                          onClick={() =>
                            begin({
                              kind: 'iteration',
                              version: current.version,
                            })
                          }
                        >
                          编辑迭代
                        </Button>
                      )
                    }
                  >
                    <p className="iteration-goal">{current.goal}</p>
                    <p>
                      负责人：{person(current.ownerId)} · {current.startDate} 至{' '}
                      {current.endDate}
                    </p>
                    {current.readOnly && (
                      <Alert type="info" message="项目已归档，迭代计划只读" />
                    )}
                    <ProgressSummary value={current.progress} />
                    <p className="muted">
                      进度按需求条数计算，不代表工时；仅已验收需求计为完成。延期按需求、里程碑、迭代截止中最早日期判断，使用北京时间。
                    </p>
                  </Card>
                  <Card
                    title="里程碑"
                    extra={
                      current.canManage && (
                        <Button
                          onClick={() =>
                            begin({
                              kind: 'milestone',
                              version: current.version,
                            })
                          }
                        >
                          新增里程碑
                        </Button>
                      )
                    }
                  >
                    <p className="muted">
                      里程碑是迭代内的交付检查点，进度随关联需求验收自动更新。
                    </p>
                    {!current.milestones.length ? (
                      <Empty description="尚未设置里程碑，可先加入需求再完善检查点" />
                    ) : (
                      current.milestones.map((m) => (
                        <section className="iteration-milestone" key={m.id}>
                          <h3>
                            {m.name} <Tag>{m.dueDate}</Tag>
                          </h3>
                          {m.goal && <p>{m.goal}</p>}
                          <ProgressSummary value={m.progress} />
                          {current.canManage && (
                            <Space wrap>
                              <Button
                                onClick={() =>
                                  begin({
                                    kind: 'milestone',
                                    version: current.version,
                                    milestone: m,
                                  })
                                }
                              >
                                编辑里程碑
                              </Button>
                              <Popconfirm
                                title="移除这个空里程碑？"
                                description="有需求的里程碑需先调整需求安排。"
                                okText="确认移除里程碑"
                                onConfirm={async () => {
                                  await mutate(
                                    detailBase + '/milestones/' + m.id,
                                    'DELETE',
                                    { expectedVersion: current.version },
                                  );
                                }}
                              >
                                <Button disabled={busy}>移除里程碑</Button>
                              </Popconfirm>
                            </Space>
                          )}
                        </section>
                      ))
                    )}
                    <p className="muted">
                      未归入里程碑：有效需求 {current.unassigned.planned}
                      ，已验收 {current.unassigned.accepted}，延期{' '}
                      {current.unassigned.overdue}。
                    </p>
                  </Card>
                  <Card
                    title="迭代需求"
                    extra={
                      current.canManage && (
                        <Button
                          type="primary"
                          onClick={() => {
                            setAdding(true);
                            setAddVersion(current.version);
                            setChosen({});
                            setTarget(null);
                            setCandidatePage(1);
                            setQ('');
                            setError('');
                          }}
                        >
                          加入需求
                        </Button>
                      )
                    }
                  >
                    <Select
                      aria-label="迭代需求筛选"
                      value={filter}
                      options={[
                        { value: 'all', label: '全部安排' },
                        { value: 'unfinished', label: '未验收' },
                        { value: 'overdue', label: '延期项' },
                      ]}
                      onChange={(v) =>
                        navigate({
                          iterationFilter: v,
                          iterationTasksPage: null,
                        })
                      }
                    />
                    {tasks.isPending ? (
                      <Spin />
                    ) : tasks.error ? (
                      <Alert
                        type="error"
                        message="迭代需求加载失败"
                        action={
                          <Button onClick={() => tasks.refetch()}>
                            重试迭代需求
                          </Button>
                        }
                      />
                    ) : !tasks.data?.items.length ? (
                      <Empty
                        description={
                          filter === 'all'
                            ? '尚未加入需求'
                            : '当前筛选下没有需求'
                        }
                      />
                    ) : (
                      tasks.data.items.map((t) => (
                        <article
                          key={t.id}
                          className="iteration-task"
                          data-task-id={t.taskId}
                        >
                          <div>
                            <Button
                              type="link"
                              onClick={() => onOpen(t.taskId)}
                            >
                              CF-{String(t.number).padStart(3, '0')} · {t.title}
                            </Button>
                            <Space wrap>
                              <Tag>
                                {workflowLabel({
                                  status: t.status,
                                  data: { workflow: t.workflow },
                                } as any)}
                              </Tag>
                              {t.deletedAt ? (
                                <Tag>回收站 · 不计进度</Tag>
                              ) : t.status === 'CANCELLED' ? (
                                <Tag>已取消 · 不计进度</Tag>
                              ) : (
                                t.overdue && <Tag color="red">计划延期</Tag>
                              )}
                              <Tag>
                                {current.milestones.find(
                                  (m) => m.id === t.milestoneId,
                                )?.name || '未归入里程碑'}
                              </Tag>
                            </Space>
                          </div>
                          <p>
                            当前处理人：
                            {t.handlerIds.map(person).join('、') ||
                              '无需处理'}{' '}
                            · 计划截止：
                            <time style={{ whiteSpace: 'nowrap' }}>
                              {t.dueDate}
                            </time>
                          </p>
                          {t.blockReasons.length > 0 && (
                            <Alert
                              type="warning"
                              message={'阻塞原因：' + t.blockReasons.join('；')}
                            />
                          )}
                          <p className={t.delayNote ? '' : 'muted'}>
                            延期说明：{t.delayNote || '尚未登记'}
                          </p>
                          {current.canManage && (
                            <Space wrap>
                              <Button
                                disabled={busy}
                                onClick={() =>
                                  begin({
                                    kind: 'arrangement',
                                    version: current.version,
                                    task: t,
                                  })
                                }
                              >
                                更新安排
                              </Button>
                              <Popconfirm
                                title="将需求移出当前迭代？"
                                description="只移除计划安排，需求正文、流程和资料保留。"
                                okText="确认移出迭代"
                                onConfirm={async () => {
                                  await mutate(
                                    detailBase + '/tasks/' + t.taskId,
                                    'DELETE',
                                    { expectedVersion: current.version },
                                  );
                                }}
                              >
                                <Button disabled={busy}>移出迭代</Button>
                              </Popconfirm>
                            </Space>
                          )}
                        </article>
                      ))
                    )}
                    <Pagination
                      current={taskPage}
                      pageSize={10}
                      total={tasks.data?.total || 0}
                      showSizeChanger={false}
                      showTotal={(n) => '共 ' + n + ' 项安排'}
                      onChange={(p) =>
                        navigate({ iterationTasksPage: String(p) })
                      }
                    />
                  </Card>
                  <Card title="最近20条计划调整">
                    <div className="iteration-events">
                      {current.events.map((e) => (
                        <div key={e.id}>
                          <strong>{eventNames[e.action] || '计划调整'}</strong>{' '}
                          · {person(e.actorId)} ·{' '}
                          {new Date(e.createdAt).toLocaleString('zh-CN', {
                            timeZone: 'Asia/Shanghai',
                          })}
                          {typeof e.data.name === 'string' && (
                            <p>{e.data.name}</p>
                          )}
                          {typeof e.data.title === 'string' &&
                            typeof e.data.number === 'number' && (
                              <p>
                                CF-{String(e.data.number).padStart(3, '0')} ·{' '}
                                {e.data.title}
                              </p>
                            )}
                          {!!e.data.before &&
                            !!e.data.after &&
                            typeof e.data.before === 'object' &&
                            typeof e.data.after === 'object' &&
                            ('startDate' in e.data.before ||
                              'dueDate' in e.data.before) && (
                              <p>
                                {'startDate' in e.data.before
                                  ? '迭代日期：' +
                                    String((e.data.before as any).startDate) +
                                    ' 至 ' +
                                    String((e.data.before as any).endDate) +
                                    ' → ' +
                                    String((e.data.after as any).startDate) +
                                    ' 至 ' +
                                    String((e.data.after as any).endDate)
                                  : '里程碑：' +
                                    String((e.data.before as any).name) +
                                    '，截止 ' +
                                    String((e.data.before as any).dueDate) +
                                    ' → ' +
                                    String((e.data.after as any).dueDate)}
                              </p>
                            )}
                          {typeof e.data.ownerId === 'string' &&
                            e.data.ownerId !== e.data.previousOwnerId && (
                              <p>负责人调整为：{person(e.data.ownerId)}</p>
                            )}
                          {typeof e.data.goal === 'string' &&
                            typeof e.data.previousGoal === 'string' &&
                            e.data.goal !== e.data.previousGoal && (
                              <details>
                                <summary>查看目标调整</summary>
                                <p>原目标：{e.data.previousGoal}</p>
                                <p>新目标：{e.data.goal}</p>
                              </details>
                            )}
                          {typeof e.data.reason === 'string' && (
                            <p>排期调整原因：{e.data.reason}</p>
                          )}
                          {typeof e.data.delayNote === 'string' && (
                            <p>延期说明：{e.data.delayNote || '已清空'}</p>
                          )}
                          {Array.isArray(e.data.tasks) && (
                            <p>
                              {(
                                e.data.tasks as {
                                  number: number;
                                  title: string;
                                }[]
                              )
                                .map(
                                  (t) =>
                                    'CF-' +
                                    String(t.number).padStart(3, '0') +
                                    ' ' +
                                    t.title,
                                )
                                .join('、')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                </>
              )
            )}
          </div>
        </div>
      )}
      <Modal
        open={!!editor}
        title={
          editor?.kind === 'create'
            ? '新建迭代'
            : editor?.kind === 'iteration'
              ? '编辑迭代'
              : editor?.kind === 'arrangement'
                ? '更新需求安排'
                : editor?.milestone
                  ? '编辑里程碑'
                  : '新增里程碑'
        }
        onCancel={close}
        okText="保存计划"
        confirmLoading={busy}
        onOk={() => form.submit()}
        maskClosable={!busy}
        keyboard={!busy}
        closable={!busy}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          disabled={busy}
          clearOnDestroy
          onValuesChange={() => setDirty(true)}
          onFinish={async (values) => {
            if (!editor) return;
            let url = base,
              method = 'POST',
              payload: any = values;
            if (editor.kind !== 'create') {
              payload = { ...values, expectedVersion: editor.version };
              url = detailBase;
              method = 'PATCH';
            }
            if (editor.kind === 'milestone') {
              url =
                detailBase +
                '/milestones' +
                (editor.milestone ? '/' + editor.milestone.id : '');
              method = editor.milestone ? 'PATCH' : 'POST';
            }
            if (editor.kind === 'arrangement') {
              url = detailBase + '/tasks/' + editor.task!.taskId;
              payload = {
                ...payload,
                milestoneId: values.milestoneId || null,
                delayNote: values.delayNote || '',
              };
            }
            const response = await mutate(url, method, payload);
            if (response.ok) {
              setEditor(undefined);
              setDirty(false);
              message.success('计划已保存');
              if (editor.kind === 'create')
                navigate({
                  iteration: response.result.id,
                  iterationPage: null,
                  iterationTasksPage: null,
                  iterationFilter: null,
                });
            }
          }}
        >
          {error && (
            <Alert
              type="error"
              message={error}
              action={
                editor?.kind !== 'create' ? (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (current)
                        setEditor({ ...editor!, version: current.version });
                      setError('');
                    }}
                  >
                    核对最新计划后重试
                  </Button>
                ) : undefined
              }
            />
          )}
          {editor?.kind === 'arrangement' ? (
            <>
              <Form.Item name="milestoneId" label="安排到里程碑">
                <Select
                  allowClear
                  placeholder="未归入里程碑"
                  options={current?.milestones.map((m) => ({
                    value: m.id,
                    label: m.name,
                  }))}
                />
              </Form.Item>
              <Form.Item name="delayNote" label="延期或调整说明">
                <Input.TextArea
                  rows={4}
                  maxLength={2000}
                  placeholder="记录实际原因、当前困难与下一步安排"
                />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item
                name="name"
                label={editor?.kind === 'milestone' ? '里程碑名称' : '迭代名称'}
                rules={[
                  { required: true, whitespace: true, message: '请填写名称' },
                ]}
              >
                <Input maxLength={120} />
              </Form.Item>
              <Form.Item
                name="goal"
                label={
                  editor?.kind === 'milestone' ? '交付检查点说明' : '迭代目标'
                }
                rules={
                  editor?.kind === 'milestone'
                    ? []
                    : [
                        {
                          required: true,
                          whitespace: true,
                          message: '请填写迭代目标',
                        },
                      ]
                }
              >
                <Input.TextArea
                  rows={4}
                  maxLength={editor?.kind === 'milestone' ? 3000 : 10000}
                />
              </Form.Item>
              {editor?.kind === 'milestone' ? (
                <Form.Item
                  name="dueDate"
                  label="里程碑截止日期"
                  rules={[{ required: true, message: '请选择截止日期' }]}
                >
                  <Input
                    type="date"
                    min={current?.startDate}
                    max={current?.endDate}
                  />
                </Form.Item>
              ) : (
                <>
                  <Form.Item
                    name="ownerId"
                    label="迭代负责人"
                    rules={[{ required: true, message: '请选择项目成员' }]}
                  >
                    <Select
                      options={members.map((m) => ({
                        value: m.id,
                        label: m.name,
                      }))}
                    />
                  </Form.Item>
                  <div className="iteration-date-fields">
                    <Form.Item
                      name="startDate"
                      label="开始日期"
                      rules={[{ required: true, message: '请选择开始日期' }]}
                    >
                      <Input type="date" />
                    </Form.Item>
                    <Form.Item
                      name="endDate"
                      label="结束日期"
                      rules={[{ required: true, message: '请选择结束日期' }]}
                    >
                      <Input type="date" />
                    </Form.Item>
                  </div>
                  {editor?.kind === 'iteration' && (
                    <Form.Item name="changeReason" label="排期调整原因">
                      <Input.TextArea
                        rows={2}
                        maxLength={2000}
                        placeholder="调整起止日期时必填"
                      />
                    </Form.Item>
                  )}
                </>
              )}
            </>
          )}
        </Form>
      </Modal>
      <Modal
        open={adding}
        title="加入迭代需求"
        width={760}
        onCancel={() => {
          if (!busy) setAdding(false);
        }}
        okText={'加入所选需求（' + Object.keys(chosen).length + '）'}
        okButtonProps={{ disabled: !Object.keys(chosen).length }}
        confirmLoading={busy}
        maskClosable={!busy}
        keyboard={!busy}
        closable={!busy}
        onOk={async () => {
          const response = await mutate(detailBase + '/tasks', 'POST', {
            expectedVersion: addVersion,
            taskIds: Object.keys(chosen),
            milestoneId: target,
          });
          if (response.ok) {
            setAdding(false);
            message.success('需求已加入迭代');
          }
        }}
      >
        <p>
          同一需求只安排在一个迭代；调整到其他迭代前，请先从原迭代移出。不会改变需求的当前阶段。
        </p>
        {error && (
          <Alert
            type="error"
            message={error}
            action={
              <Button
                disabled={busy}
                onClick={() => {
                  if (current) setAddVersion(current.version);
                  setError('');
                  candidates.refetch();
                }}
              >
                核对最新计划后重试
              </Button>
            }
          />
        )}
        <Space wrap>
          <Input.Search
            aria-label="搜索可加入迭代的需求"
            placeholder="搜索需求标题或CF编号"
            maxLength={200}
            enterButton="搜索"
            disabled={busy}
            onSearch={(v) => {
              setQ(v.trim());
              setCandidatePage(1);
            }}
          />
          <Select
            aria-label="加入时的里程碑"
            value={target}
            disabled={busy}
            style={{ minWidth: 180 }}
            options={[
              { value: null, label: '未归入里程碑' },
              ...(current?.milestones || []).map((m) => ({
                value: m.id,
                label: m.name,
              })),
            ]}
            onChange={setTarget}
          />
        </Space>
        {candidates.isFetching ? (
          <Spin />
        ) : candidates.error ? (
          <Alert
            type="error"
            message="可加入需求加载失败"
            action={
              <Button onClick={() => candidates.refetch()}>重试候选需求</Button>
            }
          />
        ) : !candidates.data?.items.length ? (
          <Empty description="没有匹配需求，可先在项目中新建需求" />
        ) : (
          candidates.data.items.map((t) => (
            <div key={t.id} className="iteration-candidate">
              <Checkbox
                disabled={
                  busy ||
                  (!!t.iterationId && !chosen[t.id]) ||
                  (!chosen[t.id] && Object.keys(chosen).length >= 50)
                }
                checked={!!chosen[t.id]}
                onChange={(e) =>
                  setChosen((old) => {
                    const next = { ...old };
                    if (e.target.checked) next[t.id] = t.title;
                    else delete next[t.id];
                    return next;
                  })
                }
              >
                CF-{String(t.number).padStart(3, '0')} · {t.title}
              </Checkbox>
              <p>
                <Tag>
                  {workflowLabel({
                    status: t.status,
                    data: { workflow: t.workflow },
                  } as any)}
                </Tag>
                {t.iterationName && <Tag>已安排：{t.iterationName}</Tag>}
              </p>
            </div>
          ))
        )}
        <Pagination
          current={candidatePage}
          pageSize={10}
          total={candidates.data?.total || 0}
          showSizeChanger={false}
          disabled={busy}
          onChange={setCandidatePage}
        />
        <p>
          已选 {Object.keys(chosen).length} 项（最多50项）：
          {Object.values(chosen).join('、') || '尚未选择'}
        </p>
      </Modal>
    </div>
  );
}

import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  List,
  Modal,
  Progress,
  Select,
  Space,
  Tabs,
  Tag,
} from 'antd';
import { actionStatusLabels } from '@coflow/contracts/project-progress.js';
import { labels } from '@coflow/contracts/index.js';
import { api, client, useData } from '../../shared/api/runtime.js';
import { createClientId } from '../../shared/lib/client-id.js';
import { isOverdue } from '@coflow/contracts/deadline.js';

export function ProjectCommandCenter({
  project,
  user,
  onOpen,
  onActions,
  onIterations,
}: any) {
  const [scope, setScope] = useState('');
  const query = useData(
    ['projectGoals', project.id, scope],
    '/projects/' +
      project.id +
      '/goals' +
      (scope ? '?goalId=' + encodeURIComponent(scope) : ''),
    true,
    30000,
  );
  const data = query.data;
  const [editing, setEditing] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [criteria, setCriteria] = useState('');
  const [ownerId, setOwnerId] = useState<string>();
  const [dueDate, setDueDate] = useState('');
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [iterationIds, setIterationIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<any>(null);
  const name = (id: string) =>
    data?.members.find((m: any) => m.id === id)?.name || '成员已离开项目';
  function edit(goal: any, operation: 'CREATE' | 'EDIT' | 'LINK' | 'STATUS') {
    setEditing({ goal, operation, requestKey: createClientId() });
    setError('');
    setNote('');
    setTitle(goal?.title || '');
    setDescription(goal?.description || '');
    setCriteria(goal?.criteria.join('\n') || '');
    setOwnerId(goal?.ownerId || user.id);
    setDueDate(goal?.dueDate || '');
    setTaskIds(goal?.directTaskIds || []);
    setIterationIds(goal?.iterationIds || []);
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const fields = {
        title,
        description,
        criteria: criteria
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean),
        ownerId,
        dueDate: dueDate || null,
      };
      const op = editing.operation;
      await api(
        '/projects/' +
          project.id +
          '/goals' +
          (op === 'CREATE' ? '' : '/' + editing.goal.id + '/change'),
        'POST',
        op === 'CREATE'
          ? { ...fields, requestKey: editing.requestKey }
          : {
              operation: op,
              expectedVersion: editing.goal.version,
              requestKey: editing.requestKey,
              note,
              ...(op === 'EDIT'
                ? { fields }
                : op === 'LINK'
                  ? { taskIds, iterationIds }
                  : {
                      status:
                        editing.goal.status === 'ACTIVE'
                          ? 'ARCHIVED'
                          : 'ACTIVE',
                    }),
            },
      );
      setEditing(null);
      void client.invalidateQueries({ queryKey: ['projectGoals', project.id] });
      void client.invalidateQueries({
        queryKey: ['projectAssistant', project.id],
      });
    } catch (e: any) {
      setError(e.message || '目标操作失败，输入已保留');
      void query.refetch();
    } finally {
      setBusy(false);
    }
  }
  async function showHistory(g: any) {
    setBusy(true);
    setError('');
    try {
      setHistory(await api('/projects/' + project.id + '/goals/' + g.id));
    } catch (e: any) {
      setError(e.message || '历史读取失败');
    } finally {
      setBusy(false);
    }
  }
  const taskRows = (ids: string[]) => (
    <List
      size="small"
      dataSource={[...new Set(ids)]
        .map((id) => data.tasks.find((t: any) => t.id === id))
        .filter(Boolean)}
      locale={{ emptyText: '暂无关联需求' }}
      renderItem={(t: any) => (
        <List.Item>
          <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <Button type="link" onClick={() => onOpen(t.id)}>
              CF-{t.number} {t.title}
            </Button>
            <Tag>
              {t.deleted ? '回收站' : labels[t.status as keyof typeof labels]}
            </Tag>
            {t.blocked && !t.deleted && <Tag color="orange">有阻塞记录</Tag>}
            <p className="muted">
              当前处理人：{t.handlerIds.map(name).join('、') || '暂无处理人'}
              {t.dueAt ? ' · 截止 ' + t.dueAt.slice(0, 10) : ''}
            </p>
            {data.actions
              .filter((a: any) => a.taskId === t.id)
              .map((a: any) => (
                <p key={a.id}>
                  行动：{a.title} <Tag>{actionStatusLabels[a.status]}</Tag>{' '}
                  {a.ownerId ? name(a.ownerId) : '待认领'}
                </p>
              ))}
          </div>
        </List.Item>
      )}
    />
  );
  const queueRows = (ids: string[], kind: 'TASK' | 'ACTION') => (
    <>
      <p className="muted">
        共 {ids.length} 项，最多展示20项；同一事项可出现在不同关注分类中。
      </p>
      <List
        dataSource={ids
          .slice(0, 20)
          .map((id) =>
            (kind === 'TASK' ? data.tasks : data.actions).find(
              (x: any) => x.id === id,
            ),
          )
          .filter(Boolean)}
        locale={{ emptyText: <Empty description="当前范围暂无此类事项" /> }}
        renderItem={(item: any) => (
          <List.Item>
            <div style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
              <strong>{item.title}</strong>
              <Tag>
                {kind === 'TASK'
                  ? labels[item.status as keyof typeof labels]
                  : actionStatusLabels[item.status]}
              </Tag>
              <Button
                type="link"
                onClick={() => onOpen(kind === 'TASK' ? item.id : item.taskId)}
              >
                查看来源需求
              </Button>
            </div>
          </List.Item>
        )}
      />
    </>
  );
  const showFields = ['CREATE', 'EDIT'].includes(editing?.operation);
  const validFields = title.trim() && criteria.trim() && !!ownerId;
  return (
    <div className="project-command-center">
      {error && !editing && <Alert type="error" message={error} />}
      {query.error ? (
        <Alert
          type="error"
          message={(query.error as Error).message}
          action={<Button onClick={() => query.refetch()}>重试工作台</Button>}
        />
      ) : !data ? (
        <p>正在读取目标与工作安排…</p>
      ) : (
        <>
          <Space wrap style={{ marginBottom: 16 }}>
            <Select
              aria-label="工作台目标范围"
              value={scope}
              onChange={setScope}
              style={{ width: 'min(100%, 360px)', minWidth: 220 }}
              options={[
                { value: '', label: '全部项目工作' },
                { value: 'unlinked', label: '未关联活跃目标的工作' },
                ...data.goals.map((g: any) => ({
                  value: g.id,
                  label:
                    g.title + (g.status === 'ARCHIVED' ? '（已归档）' : ''),
                })),
              ]}
            />
            <Button onClick={() => query.refetch()}>刷新工作台</Button>
            <Button
              type="primary"
              disabled={!data.canCreate || busy}
              onClick={() => edit(null, 'CREATE')}
            >
              新建项目目标
            </Button>
          </Space>
          <Card title="当前推进重点">
            <Tabs
              items={[
                {
                  key: 'tasks',
                  label: '待我处理 ' + data.queues.myTasks.length,
                  children: queueRows(data.queues.myTasks, 'TASK'),
                },
                {
                  key: 'actions',
                  label: '我的行动 ' + data.queues.myActions.length,
                  children: queueRows(data.queues.myActions, 'ACTION'),
                },
                {
                  key: 'reviews',
                  label: '待我确认 ' + data.queues.reviews.length,
                  children: queueRows(data.queues.reviews, 'ACTION'),
                },
                {
                  key: 'blocked',
                  label: '阻塞 ' + data.queues.blocked.length,
                  children: queueRows(data.queues.blocked, 'TASK'),
                },
                {
                  key: 'overdue',
                  label:
                    '逾期 ' +
                    (data.queues.overdueTasks.length +
                      data.queues.overdueActions.length),
                  children: (
                    <>
                      {queueRows(data.queues.overdueTasks, 'TASK')}
                      {queueRows(data.queues.overdueActions, 'ACTION')}
                    </>
                  ),
                },
                {
                  key: 'waiting',
                  label: '等待他人 ' + data.queues.waiting.length,
                  children: queueRows(data.queues.waiting, 'TASK'),
                },
                {
                  key: 'unclaimed',
                  label: '待认领 ' + data.queues.unclaimed.length,
                  children: queueRows(data.queues.unclaimed, 'ACTION'),
                },
              ]}
            />
            <Space wrap>
              <Button onClick={onActions}>进入行动跟进</Button>
              <Button onClick={onIterations}>查看迭代与里程碑</Button>
            </Space>
          </Card>
          <h3 style={{ marginTop: 20 }}>目标与交付地图</h3>
          <p className="muted">
            目标关联迭代后，自动汇总其里程碑和需求；行动沿来源需求归入目标。完成率按去重后的有效需求验收数计算，取消/回收站单列，不代表目标已达成。
          </p>
          {!data.goals.length && (
            <Empty description="先建立项目目标，再关联已有迭代或需求" />
          )}
          <Collapse
            items={data.goals
              .filter((g: any) =>
                !scope || scope === 'unlinked'
                  ? scope !== 'unlinked'
                  : g.id === scope,
              )
              .map((g: any) => ({
                key: g.id,
                label: (
                  <Space wrap>
                    <strong>{g.title}</strong>
                    <Tag>{g.status === 'ARCHIVED' ? '已归档' : '推进中'}</Tag>
                    {g.dueDate && (
                      <Tag
                        color={
                          g.status === 'ACTIVE' && isOverdue(g.dueDate)
                            ? 'orange'
                            : undefined
                        }
                      >
                        {g.dueDate}
                      </Tag>
                    )}
                    <span>
                      {g.progress.accepted}/{g.progress.planned} 项需求已验收
                    </span>
                  </Space>
                ),
                children: (
                  <>
                    <p>{g.description}</p>
                    <p>
                      负责人：{name(g.ownerId)} · 版本 {g.version}
                    </p>
                    <ul>
                      {g.criteria.map((c: string, i: number) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                    <Progress percent={g.progress.percent} />
                    <p className="muted">
                      取消 {g.progress.cancelled} 项 · 回收站{' '}
                      {g.progress.deleted} 项
                      {!g.progress.planned ? ' · 暂无有效交付需求' : ''}
                    </p>
                    <Space wrap>
                      <Button
                        disabled={!g.canManage || busy}
                        onClick={() => edit(g, 'EDIT')}
                      >
                        编辑目标
                      </Button>
                      <Button
                        disabled={!g.canManage || g.status !== 'ACTIVE' || busy}
                        onClick={() => edit(g, 'LINK')}
                      >
                        关联工作
                      </Button>
                      <Button
                        disabled={!g.canManage || busy}
                        onClick={() => edit(g, 'STATUS')}
                      >
                        {g.status === 'ACTIVE' ? '归档目标' : '恢复目标'}
                      </Button>
                      <Button disabled={busy} onClick={() => showHistory(g)}>
                        目标变更历史
                      </Button>
                    </Space>
                    {g.iterationIds.map((id: string) => {
                      const iteration = data.iterations.find(
                        (i: any) => i.id === id,
                      );
                      return (
                        iteration && (
                          <div key={id}>
                            <h4>
                              {iteration.name} · {iteration.startDate} 至{' '}
                              {iteration.endDate}
                            </h4>
                            <p>{iteration.goal}</p>
                            {iteration.milestones.map((m: any) => (
                              <details key={m.id}>
                                <summary>
                                  里程碑：{m.name} · {m.dueDate} ·{' '}
                                  {m.taskIds.length} 项需求
                                </summary>
                                {taskRows(m.taskIds)}
                              </details>
                            ))}
                            {!!iteration.unassignedTaskIds.length && (
                              <details>
                                <summary>迭代内未分配里程碑的需求</summary>
                                {taskRows(iteration.unassignedTaskIds)}
                              </details>
                            )}
                          </div>
                        )
                      );
                    })}
                    {!!g.directTaskIds.length && (
                      <details>
                        <summary>直接关联需求（汇总时与迭代需求去重）</summary>
                        {taskRows(g.directTaskIds)}
                      </details>
                    )}
                  </>
                ),
              }))}
          />
          {scope === 'unlinked' && taskRows(data.uncoveredTaskIds)}
        </>
      )}
      <Modal
        title={
          editing?.operation === 'CREATE'
            ? '新建项目目标'
            : editing?.operation === 'EDIT'
              ? '编辑目标'
              : editing?.operation === 'LINK'
                ? '关联工作'
                : '调整目标状态'
        }
        open={!!editing}
        onCancel={() => !busy && setEditing(null)}
        onOk={save}
        confirmLoading={busy}
        okText="保存目标"
        cancelText="取消"
        okButtonProps={{
          disabled: showFields
            ? !validFields || (editing?.operation !== 'CREATE' && !note.trim())
            : !note.trim(),
        }}
      >
        {error && <Alert type="error" message={error} />}
        {error && editing?.goal && (
          <Button
            disabled={busy}
            onClick={async () => {
              try {
                const latest = await api(
                  '/projects/' + project.id + '/goals/' + editing.goal.id,
                );
                Modal.confirm({
                  title: '核对最新目标',
                  content: (
                    <>
                      <p>
                        版本 {latest.version}：{latest.title}
                      </p>
                      <p>{latest.description}</p>
                      <p>{latest.criteria.join('；')}</p>
                      <p>确认后保留当前输入，按此版本重新提交。</p>
                    </>
                  ),
                  okText: '已核对，保留输入',
                  cancelText: '取消',
                  onOk: () => {
                    setEditing({
                      ...editing,
                      goal: { ...editing.goal, ...latest },
                      requestKey: createClientId(),
                    });
                    setError('');
                  },
                });
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            核对最新目标，保留输入
          </Button>
        )}
        {showFields && (
          <>
            <label>
              目标名称
              <Input
                aria-label="目标名称"
                value={title}
                maxLength={160}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              目标说明
              <Input.TextArea
                aria-label="目标说明"
                value={description}
                maxLength={4000}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              达成标准（每行一项）
              <Input.TextArea
                aria-label="目标达成标准"
                rows={4}
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
              />
            </label>
            <label>
              负责人
              <Select
                aria-label="目标负责人"
                value={ownerId}
                style={{ width: '100%' }}
                onChange={setOwnerId}
                options={data?.members.map((m: any) => ({
                  value: m.id,
                  label: m.name,
                }))}
              />
            </label>
            <label>
              截止日期（北京时间）
              <Input
                aria-label="目标截止日期"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
          </>
        )}
        {editing?.operation === 'LINK' && (
          <>
            <label>
              关联迭代
              <Select
                aria-label="关联目标迭代"
                mode="multiple"
                value={iterationIds}
                onChange={setIterationIds}
                style={{ width: '100%' }}
                options={data?.iterations.map((i: any) => ({
                  value: i.id,
                  label: i.name,
                }))}
              />
            </label>
            <label>
              直接关联需求
              <Select
                aria-label="关联目标需求"
                mode="multiple"
                value={taskIds}
                onChange={setTaskIds}
                style={{ width: '100%' }}
                options={data?.tasks.map((t: any) => ({
                  value: t.id,
                  label:
                    'CF-' +
                    t.number +
                    ' ' +
                    t.title +
                    (t.deleted ? '（回收站）' : ''),
                  disabled:
                    t.deleted && !editing.goal.directTaskIds.includes(t.id),
                }))}
              />
            </label>
          </>
        )}
        {editing?.operation === 'STATUS' && (
          <p>
            {editing.goal.status === 'ACTIVE'
              ? '归档后保留全部关联与历史，不再作为未关联工作判断的活跃目标。'
              : '恢复后重新纳入活跃目标。'}
          </p>
        )}
        {editing && editing.operation !== 'CREATE' && (
          <label>
            变更原因
            <Input.TextArea
              aria-label="目标变更原因"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}
      </Modal>
      <Modal
        title="目标变更历史"
        open={!!history}
        footer={null}
        onCancel={() => setHistory(null)}
      >
        <List
          dataSource={history?.events || []}
          renderItem={(event: any) => (
            <List.Item>
              <div>
                {
                  (
                    {
                      CREATE: '新建',
                      EDIT: '修改',
                      LINK: '关联调整',
                      STATUS: '归档状态调整',
                    } as any
                  )[event.operation]
                }{' '}
                · {name(event.by)} ·{' '}
                {new Date(event.at).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })}
                <p>{event.note || '建立初始目标'}</p>
              </div>
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
}

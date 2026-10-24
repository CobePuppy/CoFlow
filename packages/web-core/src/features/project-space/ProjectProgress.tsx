import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  List,
  Modal,
  Pagination,
  Select,
  Space,
  Tabs,
  Tag,
} from 'antd';
import { actionStatusLabels } from '@coflow/contracts/project-progress.js';
import { labels } from '@coflow/contracts/index.js';
import { isOverdue } from '@coflow/contracts/deadline.js';
import { api, client, useData } from '../../shared/api/runtime.js';
import { createClientId } from '../../shared/lib/client-id.js';
const operationLabels: Record<string, string> = {
  CLAIM: '认领行动',
  ASSIGN: '分配行动',
  SUBMIT: '提交成果',
  ACCEPT: '确认完成',
  RETURN: '退回补充',
  REOPEN: '重开行动',
  RESCHEDULE: '调整截止日',
};
export function ProjectProgress({ project, user, onOpen }: any) {
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('actions');
  const [scope, setScope] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [baselineId, setBaselineId] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const params = new URLSearchParams({
    page: String(page),
    scope,
    status,
    q: search,
    ...(baselineId ? { checkpointId: baselineId } : {}),
  });
  const query = useData(
    ['projectProgress', project.id, page, scope, status, search, baselineId],
    '/projects/' + project.id + '/progress?' + params,
    true,
    30000,
  );
  const history = useData(
    ['projectCheckpoints', project.id, historyPage],
    '/projects/' + project.id + '/checkpoints?page=' + historyPage,
    tab === 'checkpoints',
    30000,
  );
  const data = query.data;
  const [selection, setSelection] = useState<any>(null);
  const [note, setNote] = useState('');
  const [ownerId, setOwnerId] = useState<string>();
  const [dueDate, setDueDate] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkpointNote, setCheckpointNote] = useState('');
  const [checkpointKey, setCheckpointKey] = useState(createClientId);
  const [taskId, setTaskId] = useState<string>();
  const name = (id: string) =>
    data?.members.find((m: any) => m.id === id)?.name || '未分配或已离开项目';
  const readOnly = !!project.archivedAt;
  function open(a: any, operation: string) {
    setSelection({ action: a, operation, requestKey: createClientId() });
    setNote('');
    setOwnerId(a.ownerId || undefined);
    setDueDate(a.dueDate || '');
    setChecked(false);
    setError('');
  }
  async function refresh() {
    await client.invalidateQueries({
      queryKey: ['projectProgress', project.id],
    });
    void client.invalidateQueries({ queryKey: ['notifications'] });
    void client.invalidateQueries({
      queryKey: ['projectCheckpoints', project.id],
    });
  }
  async function change() {
    setBusy(true);
    setError('');
    try {
      const op = selection.operation;
      await api(
        '/projects/' +
          project.id +
          '/actions/' +
          selection.action.id +
          '/change',
        'POST',
        {
          expectedVersion: selection.action.version,
          expectedTaskVersion: selection.action.taskVersion,
          operation: op,
          note,
          requestKey: selection.requestKey,
          ...(['ASSIGN', 'CLAIM', 'RESCHEDULE'].includes(op)
            ? { dueDate: dueDate || null }
            : {}),
          ...(op === 'ASSIGN' ? { ownerId } : {}),
        },
      );
      setSelection(null);
      await refresh();
    } catch (e: any) {
      setError(e.message || '操作失败');
      void refresh();
    } finally {
      setBusy(false);
    }
  }
  async function refreshSelection() {
    setBusy(true);
    setError('');
    try {
      const current = await api(
        '/projects/' + project.id + '/actions/' + selection.action.id,
      );
      setSelection({
        ...selection,
        action: current,
        requestKey: createClientId(),
        refreshed: true,
      });
      setChecked(false);
      void refresh();
    } catch (e: any) {
      setError(e.message || '刷新失败，输入已保留');
    } finally {
      setBusy(false);
    }
  }
  async function downloadBrief() {
    setBusy(true);
    setError('');
    try {
      const brief = await api(
        '/projects/' +
          project.id +
          '/progress-brief' +
          (baselineId ? '?checkpointId=' + encodeURIComponent(baselineId) : ''),
      );
      const url = URL.createObjectURL(
        new Blob([brief.content], { type: 'text/markdown;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = brief.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setError(e.message || '导出失败');
    } finally {
      setBusy(false);
    }
  }
  async function checkpoint() {
    setBusy(true);
    setError('');
    try {
      await api('/projects/' + project.id + '/checkpoints', 'POST', {
        fingerprint: data.fingerprint,
        latestId: data.latest?.id || null,
        note: checkpointNote,
        requestKey: checkpointKey,
      });
      setCheckpointNote('');
      setCheckpointKey(createClientId());
      await refresh();
    } catch (e: any) {
      setError(e.message || '记录失败');
      void refresh();
    } finally {
      setBusy(false);
    }
  }
  const selectedTask =
    data?.readiness.find((t: any) => t.id === taskId) || data?.readiness[0];
  return (
    <Card
      title="行动与交付跟进"
      className="project-progress"
      style={{ marginTop: 20 }}
    >
      {error && <Alert type="error" message={error} />}
      {query.error ? (
        <Alert
          type="error"
          message={(query.error as Error).message}
          action={<Button onClick={() => query.refetch()}>重试读取</Button>}
        />
      ) : !data ? (
        <p>正在读取项目进展…</p>
      ) : (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'actions',
              label: '行动跟进',
              children: (
                <>
                  <p className="muted">
                    从推进建议中选择“转为行动”，再认领并提交成果。须由行动负责人以外的产品负责人或团队管理员确认；行动完成不会自动关闭需求。
                  </p>
                  <Space wrap>
                    {(
                      [
                        ['ALL', '全部', data.counts.all],
                        ['MINE', '我的', data.counts.mine],
                        ['REVIEW', '待我确认', data.counts.review],
                        ['OVERDUE', '逾期', data.counts.overdue],
                      ] as const
                    ).map(([value, label, count]) => (
                      <Button
                        key={value}
                        aria-pressed={scope === value}
                        onClick={() => {
                          setScope(value);
                          setPage(1);
                        }}
                      >
                        {label} {count}
                      </Button>
                    ))}
                    <Select
                      aria-label="行动状态筛选"
                      value={status}
                      onChange={(value) => {
                        setStatus(value);
                        setPage(1);
                      }}
                      style={{ minWidth: 140 }}
                      options={[
                        { value: 'ALL', label: '全部状态' },
                        ...Object.entries(actionStatusLabels).map(
                          ([value, label]) => ({ value, label }),
                        ),
                      ]}
                    />
                    <Button
                      onClick={() => {
                        setScope('ALL');
                        setStatus('ALL');
                        setSearch('');
                        setSearchInput('');
                        setPage(1);
                      }}
                    >
                      重置筛选
                    </Button>
                  </Space>
                  <Input.Search
                    aria-label="搜索项目行动"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    maxLength={200}
                    onSearch={(value) => {
                      setSearch(value.trim());
                      setPage(1);
                    }}
                    placeholder="搜索行动、来源需求编号、负责人或验收要求"
                    enterButton={<Button type="primary">搜索行动</Button>}
                    style={{ marginTop: 12 }}
                  />
                  <p className="muted">
                    符合当前条件 {data.total} 项 / 项目共 {data.counts.all}{' '}
                    项；上方数量不受筛选影响。
                  </p>
                  <List
                    dataSource={data.actions}
                    locale={{
                      emptyText: (
                        <Empty
                          description={
                            data.counts.all
                              ? '当前筛选无匹配行动，可切回全部或调整搜索'
                              : '暂无行动，请从AI推进建议中转入'
                          }
                        />
                      ),
                    }}
                    renderItem={(a: any) => (
                      <List.Item>
                        <div
                          style={{
                            width: '100%',
                            minWidth: 0,
                            overflowWrap: 'anywhere',
                          }}
                        >
                          <Space wrap>
                            <strong>{a.title}</strong>
                            <Tag>{actionStatusLabels[a.status]}</Tag>
                            {a.dueDate && (
                              <Tag
                                color={
                                  a.status !== 'DONE' && isOverdue(a.dueDate)
                                    ? 'orange'
                                    : undefined
                                }
                              >
                                {a.dueDate}
                              </Tag>
                            )}
                          </Space>
                          <p>
                            负责人：{name(a.ownerId)}{' '}
                            <Button
                              type="link"
                              onClick={() => onOpen(a.taskId)}
                            >
                              CF-{a.taskNumber} {a.taskTitle}
                            </Button>
                          </p>
                          <p>验收要求：{a.acceptance}</p>
                          {a.outcome && (
                            <p>
                              {['SUBMITTED', 'DONE'].includes(a.status)
                                ? '提交成果'
                                : '上次提交成果（待补充）'}
                              ：{a.outcome}
                            </p>
                          )}
                          {a.sourceChanged && (
                            <Alert
                              type="warning"
                              message="来源需求已更新，操作前请查看并核对当前需求"
                            />
                          )}
                          {a.unavailable && (
                            <Alert
                              type="warning"
                              message="来源需求已不可用，请先恢复需求"
                            />
                          )}
                          <Space wrap style={{ marginTop: 8 }}>
                            {!a.unavailable && !readOnly && (
                              <>
                                {a.canReschedule && (
                                  <Button onClick={() => open(a, 'RESCHEDULE')}>
                                    调整截止日
                                  </Button>
                                )}
                                {a.status === 'OPEN' && (
                                  <Button onClick={() => open(a, 'CLAIM')}>
                                    认领行动
                                  </Button>
                                )}
                                {a.canAssign &&
                                  (['OPEN', 'DOING'].includes(a.status) ||
                                    (a.status === 'SUBMITTED' &&
                                      a.canReview)) && (
                                    <Button onClick={() => open(a, 'ASSIGN')}>
                                      分配行动
                                    </Button>
                                  )}
                                {a.ownerId === user?.id &&
                                  a.status === 'DOING' && (
                                    <Button onClick={() => open(a, 'SUBMIT')}>
                                      提交成果
                                    </Button>
                                  )}
                                {a.canReview && a.status === 'SUBMITTED' && (
                                  <>
                                    <Button
                                      disabled={a.ownerId === user?.id}
                                      onClick={() => open(a, 'ACCEPT')}
                                    >
                                      确认完成
                                    </Button>
                                    <Button onClick={() => open(a, 'RETURN')}>
                                      退回补充
                                    </Button>
                                  </>
                                )}
                                {a.canReview && a.status === 'DONE' && (
                                  <Button onClick={() => open(a, 'REOPEN')}>
                                    重开行动
                                  </Button>
                                )}
                              </>
                            )}
                          </Space>
                          <details>
                            <summary>行动历史与依据</summary>
                            <blockquote>{a.evidence}</blockquote>
                            <ol>
                              {a.events.map((e: any, i: number) => (
                                <li key={i}>
                                  {operationLabels[e.operation] || '创建行动'} ·{' '}
                                  {name(e.by)} ·{' '}
                                  {new Date(e.at).toLocaleString('zh-CN', {
                                    timeZone: 'Asia/Shanghai',
                                  })}
                                  {e.note ? ' · ' + e.note : ''}
                                  {e.operation === 'RESCHEDULE' &&
                                    ' · 截止日：' +
                                      (e.previousDueDate || '未设置') +
                                      ' → ' +
                                      (e.dueDate || '未设置')}
                                </li>
                              ))}
                            </ol>
                          </details>
                        </div>
                      </List.Item>
                    )}
                  />
                  <Pagination
                    current={page}
                    pageSize={20}
                    total={data.total}
                    onChange={setPage}
                    showSizeChanger={false}
                  />
                </>
              ),
            },
            {
              key: 'readiness',
              label: '交付准备检查',
              children: (
                <>
                  <p className="muted">
                    按当前资料逐项检查，仅辅助人工核对；全部满足也不代表已测试或已验收。
                  </p>
                  <Select
                    aria-label="选择交付检查需求"
                    value={selectedTask?.id}
                    onChange={setTaskId}
                    style={{ width: '100%' }}
                    options={data.readiness.map((t: any) => ({
                      value: t.id,
                      label: 'CF-' + t.number + ' ' + t.title,
                    }))}
                  />
                  {selectedTask ? (
                    <>
                      <Button
                        type="link"
                        onClick={() => onOpen(selectedTask.id)}
                      >
                        查看检查来源需求
                      </Button>
                      <List
                        dataSource={selectedTask.checks}
                        renderItem={(c: any) => (
                          <List.Item>
                            <div>
                              <Tag color={c.ok ? 'green' : 'orange'}>
                                {c.ok ? '规则检查满足' : '待补齐或核对'}
                              </Tag>
                              <strong>{c.label}</strong>
                              <p>{c.detail}</p>
                            </div>
                          </List.Item>
                        )}
                      />
                    </>
                  ) : (
                    <Empty description="暂无未完成需求" />
                  )}
                </>
              ),
            },
            {
              key: 'checkpoints',
              label: '推进检查点',
              children: (
                <>
                  <p className="muted">
                    记录当前需求和行动的真实阶段，可选择历史检查点对比当前状态。资料更新单独标记，不推断任务已经完成。
                  </p>
                  <Select
                    aria-label="对比检查点"
                    style={{ width: '100%' }}
                    value={baselineId || 'latest'}
                    disabled={busy}
                    onChange={(value) =>
                      setBaselineId(value === 'latest' ? '' : value)
                    }
                    options={[
                      { value: 'latest', label: '跟随最近检查点' },
                      ...[
                        ...new Map(
                          [
                            ...(history.data?.items || []),
                            ...(data.baseline ? [data.baseline] : []),
                          ].map((c: any) => [c.id, c]),
                        ).values(),
                      ].map((c: any) => ({
                        value: c.id,
                        label:
                          new Date(c.createdAt).toLocaleString('zh-CN', {
                            timeZone: 'Asia/Shanghai',
                          }) +
                          ' · ' +
                          c.note,
                      })),
                    ]}
                  />
                  {history.error && (
                    <Alert
                      type="error"
                      message="历史检查点读取失败"
                      action={
                        <Button onClick={() => history.refetch()}>
                          重试历史
                        </Button>
                      }
                    />
                  )}
                  <Pagination
                    size="small"
                    current={historyPage}
                    pageSize={20}
                    total={history.data?.total || 0}
                    onChange={setHistoryPage}
                    showSizeChanger={false}
                  />
                  {data.baseline ? (
                    <p>
                      对比基线：{data.baseline.note} ·{' '}
                      {new Date(data.baseline.createdAt).toLocaleString(
                        'zh-CN',
                        {
                          timeZone: 'Asia/Shanghai',
                        },
                      )}
                      （北京时间）
                    </p>
                  ) : (
                    <Alert type="info" message="尚无基线，请先记录首个检查点" />
                  )}
                  <List
                    dataSource={data.comparison.changes}
                    locale={{
                      emptyText: data.baseline
                        ? baselineId
                          ? '与所选检查点相比暂无变化'
                          : '与最近检查点相比暂无变化'
                        : '建立基线后展示变化',
                    }}
                    renderItem={(c: any) => (
                      <List.Item>
                        <span>
                          {c.kind === 'tasks' ? '需求' : '行动'}：{c.title} ·{' '}
                          {c.change
                            .split(' → ')
                            .map(
                              (v: string) =>
                                labels[v as keyof typeof labels] ||
                                actionStatusLabels[v] ||
                                v,
                            )
                            .join(' → ')}
                        </span>
                      </List.Item>
                    )}
                  />
                  <h4>下一步跟进建议</h4>
                  <ul>
                    {data.followUps.map((text: string) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                  <Input
                    aria-label="检查点说明"
                    value={checkpointNote}
                    maxLength={1000}
                    onChange={(e) => {
                      setCheckpointNote(e.target.value);
                      setCheckpointKey(createClientId());
                    }}
                    placeholder="记录本次推进结论或需要团队跟进的问题"
                    disabled={busy || readOnly}
                  />
                  <Space wrap style={{ marginTop: 12 }}>
                    <Button
                      type="primary"
                      onClick={checkpoint}
                      loading={busy}
                      disabled={readOnly || !checkpointNote.trim()}
                    >
                      记录当前检查点
                    </Button>
                    <Button
                      onClick={() => {
                        void query.refetch();
                        void history.refetch();
                      }}
                    >
                      刷新进展
                    </Button>
                    <Button onClick={downloadBrief} disabled={busy}>
                      导出推进简报
                    </Button>
                  </Space>
                  <details>
                    <summary>最近5个检查点</summary>
                    <ul>
                      {data.checkpoints.map((c: any) => (
                        <li key={c.id}>
                          {c.note} ·{' '}
                          {new Date(c.createdAt).toLocaleString('zh-CN', {
                            timeZone: 'Asia/Shanghai',
                          })}
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              ),
            },
          ]}
        />
      )}
      <Modal
        title={operationLabels[selection?.operation]}
        open={!!selection}
        onCancel={() => !busy && setSelection(null)}
        onOk={change}
        confirmLoading={busy}
        okText="确认操作"
        cancelText="取消"
        okButtonProps={{
          disabled:
            !note.trim() ||
            (selection?.operation === 'ASSIGN' && !ownerId) ||
            (selection?.action.sourceChanged && !checked),
        }}
      >
        {error && <Alert type="error" message={error} />}
        {error && (
          <Button disabled={busy} onClick={refreshSelection}>
            核对最新行动，保留输入
          </Button>
        )}
        {selection?.refreshed && (
          <Alert
            type="info"
            message={
              '当前行动：' +
              actionStatusLabels[selection.action.status] +
              '；输入已保留，请核对后再操作。'
            }
          />
        )}
        <p>{selection?.action.title}</p>
        {selection?.action.sourceChanged && (
          <Checkbox
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          >
            我已查看并核对当前需求
          </Checkbox>
        )}
        {selection?.operation === 'ASSIGN' && (
          <Select
            aria-label="行动负责人"
            value={ownerId}
            onChange={setOwnerId}
            style={{ width: '100%' }}
            options={data?.members.map((m: any) => ({
              value: m.id,
              label: m.name,
            }))}
          />
        )}
        {['CLAIM', 'ASSIGN', 'RESCHEDULE'].includes(selection?.operation) && (
          <label>
            截止日期（北京时间，可留空）
            <Input
              aria-label="行动截止日期"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        )}
        <label>
          成果或操作说明
          <Input.TextArea
            aria-label="成果或操作说明"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
            rows={4}
          />
        </label>
      </Modal>
    </Card>
  );
}

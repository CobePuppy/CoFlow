import { createClientId } from '../../shared/lib/client-id.js';
import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  BranchesOutlined,
  PlusOutlined,
  ReloadOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api/runtime.js';
import type { ForkRoute, ProjectFork } from '@coflow/contracts/forks.js';

const blankRoute = (name: string): ForkRoute => ({
  name,
  hypothesis: '',
  plan: '',
  hoursBudget: 8,
  costBudget: 100,
  deadline: '',
  actualHours: null,
  actualCost: null,
  outcome: '',
  artifacts: [],
  experiments: [],
});
const defaultRoutes = () => [blankRoute('路线 A'), blankRoute('路线 B')];
const statusNames = { TODO: '待开始', DOING: '进行中', DONE: '已完成' };
function routeGaps(route: ForkRoute) {
  return [
    !route.experiments.length
      ? '至少添加一项试验'
      : route.experiments.some((e) => e.status !== 'DONE')
        ? '完成全部试验'
        : '',
    route.actualHours === null || route.actualCost === null
      ? '记录实际工时和费用'
      : '',
    !route.outcome.trim() ? '填写结论与局限' : '',
  ].filter(Boolean);
}
export default function ProjectForks({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const query = useQuery<{ items: ProjectFork[]; readOnly: boolean }>({
    queryKey: ['forks', projectId],
    queryFn: () => api(`/projects/${projectId}/forks`),
    enabled: !!projectId,
  });
  const docs = useQuery({
    queryKey: ['fork-documents', projectId],
    queryFn: () => api(`/projects/${projectId}/documents?pageSize=100`),
    enabled: !!projectId,
  });
  const tasks = useQuery({
    queryKey: ['fork-tasks', projectId],
    queryFn: () => api(`/projects/${projectId}/task-options?pageSize=100`),
    enabled: !!projectId,
  });
  const members = useQuery({
    queryKey: ['fork-members', projectId],
    queryFn: () => api(`/projects/${projectId}/members`),
    enabled: !!projectId,
  });
  const [create, setCreate] = useState(false);
  const [dirty, setDirty] = useState(false);
  const selected = params.get('fork') || undefined;
  const setSelected = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('fork', id);
        return next;
      },
      { replace: true },
    );
  const [edit, setEdit] = useState<{ item: ProjectFork; index: number }>();
  const [decision, setDecision] = useState<ProjectFork>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const activeId = selected || query.data?.items[0]?.id;
  const item = query.data?.items.find((x) => x.id === activeId);
  const readOnly = !!query.data?.readOnly;
  async function save(
    url: string,
    method: string,
    body: any,
    close: () => void,
  ) {
    setBusy(true);
    setError('');
    try {
      const result = await api(url, method, body);
      close();
      setDirty(false);
      setSelected(result.id);
      await qc.invalidateQueries({ queryKey: ['forks', projectId] });
      await qc.invalidateQueries({ queryKey: ['documents', projectId] });
      message.success(
        method === 'PATCH'
          ? '路线已保存'
          : url.endsWith('/decide')
            ? '决策与成果已保存到项目文档'
            : '两条探索路线已创建',
      );
    } catch (e) {
      setError((e as Error).message);
      message.error('保存失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const begin = (fn: () => void) => {
    setError('');
    setDirty(false);
    fn();
  };
  const closeEditor = (close: () => void) => {
    if (busy) return;
    if (!dirty) {
      close();
      return;
    }
    modal.confirm({
      title: '放弃未保存的修改？',
      content: '当前输入尚未保存，继续编辑可保留这些内容。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: () => {
        setDirty(false);
        close();
      },
    });
  };
  const resultLink = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('view', 'documents');
    next.set('document', id);
    return '?' + next.toString();
  };
  if (!projectId) return <Empty description="选择项目后创建分身" />;
  if (query.isPending) return <Spin />;
  if (query.error)
    return (
      <Alert
        type="error"
        message={query.error.message}
        action={<Button onClick={() => query.refetch()}>重试</Button>}
      />
    );
  const people = Array.isArray(members.data)
    ? members.data
    : members.data?.items || [];
  return (
    <div className="fork-workspace">
      <div className={`fork-hero ${item ? 'fork-hero-compact' : ''}`}>
        <div className="fork-hero-copy">
          <span className="fork-eyebrow">
            <BranchesOutlined /> 项目分身 · 探索与决策
          </span>
          <h2>
            重大决定，
            <br />
            先试出两个未来。
          </h2>
          <p>让不同想法各走一步，用真实试做找到团队的下一步。</p>
          <div className="fork-journey">
            <span>01 分叉想法</span>
            <ArrowRightOutlined />
            <span>02 限时试做</span>
            <ArrowRightOutlined />
            <span>03 比较与选择</span>
          </div>
        </div>
        <svg
          className="fork-hero-art"
          viewBox="0 0 340 210"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            <pattern
              id="fork-dot"
              width="16"
              height="16"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1" fill="currentColor" opacity=".13" />
            </pattern>
          </defs>
          <rect width="340" height="210" fill="url(#fork-dot)" />
          <path
            d="M38 105H90C130 105 120 46 164 46H270M90 105C130 105 120 164 164 164H270"
            stroke="currentColor"
            strokeWidth="2"
            opacity=".35"
          />
          <circle
            cx="38"
            cy="105"
            r="13"
            fill="#fff"
            stroke="#168179"
            strokeWidth="3"
          />
          <rect
            x="168"
            y="20"
            width="130"
            height="52"
            rx="12"
            fill="#fff"
            stroke="#b8dbd1"
          />
          <rect
            x="168"
            y="138"
            width="130"
            height="52"
            rx="12"
            fill="#fff"
            stroke="#c6ccef"
          />
          <circle cx="191" cy="46" r="10" fill="#dcefe6" />
          <path d="m187 46 3 3 5-6" stroke="#168179" strokeWidth="2" />
          <path
            d="M214 41h60M214 51h36"
            stroke="#7d9c93"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx="191" cy="164" r="10" fill="#e9eafa" />
          <path d="M187 164h8m-4-4v8" stroke="#737ab9" strokeWidth="2" />
          <path
            d="M214 159h60M214 169h36"
            stroke="#969bbd"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx="118" cy="105" r="5" fill="#168179" />
        </svg>
      </div>
      {readOnly && (
        <Alert showIcon type="warning" message="项目已归档，仅可查看" />
      )}
      <div className="fork-toolbar">
        <div className="fork-selector">
          <span className="fork-field-label">当前探索</span>
          <Select
            showSearch
            optionFilterProp="label"
            aria-label="选择项目分身"
            placeholder="选择一次探索"
            value={activeId}
            onChange={setSelected}
            options={query.data?.items.map((x) => ({
              value: x.id,
              label: `${x.data.decision ? '已决策 · ' : ''}${x.title}`,
            }))}
          />
        </div>
        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            aria-label="刷新"
            loading={query.isFetching}
            onClick={() => query.refetch()}
          >
            刷新
          </Button>
          <Button
            icon={<PlusOutlined />}
            aria-label="创建项目分身"
            type="primary"
            disabled={readOnly}
            onClick={() => begin(() => setCreate(true))}
          >
            创建项目分身
          </Button>
        </Space>
      </div>
      <p className="fork-method-note">
        预算为团队估计，实际投入与结果据实记录；试验由成员执行。
      </p>
      {!item &&
        (selected ? (
          <Alert
            type="warning"
            message="此探索不在当前项目中，或已不可访问"
            description="请从上方选择其他探索，原链接不会自动指向其他记录。"
          />
        ) : (
          <Empty
            description={
              query.data?.items.length
                ? '选择分身，查看路线与试验结果'
                : '例如：自研模型还是调用 API？用一天试做帮助团队决定。'
            }
          />
        ))}
      {item && (
        <>
          <Card
            className="fork-context"
            title={item.title}
            extra={
              <Tag color={item.data.decision ? 'green' : 'blue'}>
                {item.data.decision ? '已决策' : '探索中'}
              </Tag>
            }
          >
            <div className="fork-context-grid">
              <p>
                <b>共同目标：</b>
                {item.goal}
              </p>
              <p>
                <b>比较标准：</b>
                {item.criterion}
              </p>
            </div>
            <details>
              <summary>分叉时的项目上下文（冻结快照）</summary>
              <p>{item.data.snapshot.description}</p>
              <p>
                创建于{' '}
                {new Date(item.data.snapshot.at).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })}
                （北京时间）
              </p>
              {item.data.snapshot.tasks.map((t) => (
                <p key={t.id}>
                  #{t.number} {t.title} · {t.status} · v{t.version}
                  {item.deletedTaskIds?.includes(t.id) && (
                    <Tag>原需求已删除</Tag>
                  )}
                </p>
              ))}
              {item.data.snapshot.documents.map((d) => (
                <details key={d.id}>
                  <summary>
                    {d.title} · v{d.version}
                  </summary>
                  <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                    {d.content}
                  </Typography.Paragraph>
                </details>
              ))}
            </details>
          </Card>
          {!item.data.decision && !readOnly && (
            <div className="fork-next-step">
              <div>
                <span className="fork-eyebrow">下一步</span>
                <h3>
                  {item.data.routes.some((r) => !routeGaps(r).length)
                    ? '已有路线准备好，可以组织决策。'
                    : '从一个最小试验开始，逐步补齐决策依据。'}
                </h3>
              </div>
              <div className="fork-next-routes">
                {item.data.routes.map((r, index) => (
                  <div key={index}>
                    <strong>{r.name}</strong>
                    <p>
                      {routeGaps(r).join(' · ') || '试验、投入与结论已齐备'}
                    </p>
                    <Button
                      size="small"
                      disabled={!routeGaps(r).length}
                      onClick={() => begin(() => setEdit({ item, index }))}
                    >
                      {routeGaps(r).length
                        ? `完善路线 ${index === 0 ? 'A' : 'B'}`
                        : '已具备决策条件'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="fork-route-grid">
            {item.data.routes.map((route, index) => {
              const over =
                (route.actualHours !== null &&
                  route.actualHours > route.hoursBudget) ||
                (route.actualCost !== null &&
                  route.actualCost > route.costBudget);
              const overdue =
                route.deadline &&
                route.deadline <
                  new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'Asia/Shanghai',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  }).format(new Date()) &&
                !item.data.decision;
              return (
                <Card
                  className={`fork-route-card fork-route-${index} ${item.data.decision?.selectedRoute === index ? 'fork-route-chosen' : ''}`}
                  key={index}
                  title={
                    <div className="fork-route-title">
                      <span className="fork-route-letter">
                        {index === 0 ? 'A' : 'B'}
                      </span>
                      <span>
                        {route.name}
                        <small>
                          {item.data.decision?.selectedRoute === index
                            ? '已采用的路线'
                            : '独立探索路线'}
                        </small>
                      </span>
                    </div>
                  }
                  extra={
                    <Button
                      disabled={readOnly || !!item.data.decision}
                      onClick={() => begin(() => setEdit({ item, index }))}
                    >
                      编辑路线 {index === 0 ? 'A' : 'B'}
                    </Button>
                  }
                >
                  {(over || overdue) && (
                    <Alert
                      type="warning"
                      message={
                        over
                          ? item.data.decision
                            ? '实际投入超出原预算，已保留在决策记录中'
                            : '已超出试验预算，请组织决策或调整预算'
                          : '已到试验截止日期，请组织决策'
                      }
                    />
                  )}
                  <div className="fork-section-label">待验证假设</div>
                  <p className="fork-hypothesis">{route.hypothesis}</p>
                  <p style={{ whiteSpace: 'pre-wrap' }}>
                    {route.plan || '尚未填写试做计划'}
                  </p>
                  <div className="fork-budget-grid">
                    <div>
                      <span>投入 · 人时</span>
                      <strong>
                        {route.actualHours ?? '—'}
                        <small> / {route.hoursBudget}</small>
                      </strong>
                      <span>实际 / 预算</span>
                    </div>
                    <div>
                      <span>费用 · 元</span>
                      <strong>
                        {route.actualCost ?? '—'}
                        <small> / {route.costBudget}</small>
                      </strong>
                      <span>实际 / 预算</span>
                    </div>
                  </div>
                  <p className="fork-deadline">
                    试做截止 · {route.deadline || '尚未设置'}
                  </p>
                  <div className="fork-progress-label">
                    <span>
                      <ExperimentOutlined /> 试验进度
                    </span>
                    <b>
                      {
                        route.experiments.filter((e) => e.status === 'DONE')
                          .length
                      }{' '}
                      / {route.experiments.length}
                    </b>
                  </div>
                  <Progress
                    percent={
                      route.experiments.length
                        ? Math.round(
                            (route.experiments.filter(
                              (e) => e.status === 'DONE',
                            ).length /
                              route.experiments.length) *
                              100,
                          )
                        : 0
                    }
                    showInfo={false}
                    strokeColor={index === 0 ? '#168179' : '#7970b8'}
                    size="small"
                  />
                  {!route.experiments.length && (
                    <div className="fork-inline-empty">
                      还没有试验任务，编辑路线开始第一次试做。
                    </div>
                  )}
                  {route.experiments.map((e) => (
                    <div key={e.id} className="fork-experiment">
                      <Tag
                        color={
                          e.status === 'DONE'
                            ? 'success'
                            : e.status === 'DOING'
                              ? 'processing'
                              : 'default'
                        }
                      >
                        {statusNames[e.status]}
                      </Tag>
                      <b>{e.title}</b>
                      <p className="muted">
                        负责人：
                        {people.find((m: any) => m.id === e.ownerId)?.name ||
                          '未分配'}
                      </p>
                      <p style={{ whiteSpace: 'pre-wrap' }}>
                        {e.result || '尚无实际结果'}
                      </p>
                    </div>
                  ))}
                  <div className="fork-outcome">
                    <div className="fork-section-label">结论与局限</div>
                    <p>{route.outcome || '尚未记录'}</p>
                  </div>
                  {route.artifacts.map((a) => (
                    <details key={a.id}>
                      <summary>
                        <FileTextOutlined /> 成果：{a.title}
                      </summary>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{a.content}</p>
                    </details>
                  ))}
                </Card>
              );
            })}
          </div>
          <Card
            className="fork-decision"
            title={
              <span>
                <BranchesOutlined /> 决策桌
              </span>
            }
            extra={
              <span className="fork-table-hint">
                比较实际结果，保留每一次取舍
              </span>
            }
          >
            <div style={{ overflowX: 'auto' }}>
              <Table
                pagination={false}
                rowKey="routeKey"
                scroll={{ x: 640 }}
                dataSource={item.data.routes.map((route, routeKey) => ({
                  ...route,
                  routeKey,
                }))}
                columns={[
                  { title: '路线', dataIndex: 'name' },
                  {
                    title: '预算 / 实际人时',
                    render: (_, r) =>
                      `${r.hoursBudget} / ${r.actualHours ?? '未记录'}`,
                  },
                  {
                    title: '预算 / 实际费用（元）',
                    render: (_, r) =>
                      `${r.costBudget} / ${r.actualCost ?? '未记录'}`,
                  },
                  {
                    title: '完成试验',
                    render: (_, r) =>
                      `${r.experiments.filter((e) => e.status === 'DONE').length}/${r.experiments.length}`,
                  },
                  {
                    title: '结论与取舍',
                    dataIndex: 'outcome',
                    render: (value) => value || '尚未记录',
                  },
                ]}
              />
            </div>
            {item.data.decision ? (
              <>
                <Alert
                  type="success"
                  message={`已选择：${item.data.routes[item.data.decision.selectedRoute].name}`}
                  description={item.data.decision.reason}
                />
                <p>
                  已生成决策记录及 {item.data.decision.retained.length}{' '}
                  份成果文档，可在“项目文档”查看。两条路线均保留为只读历史。
                </p>
                <div className="fork-result-links">
                  {item.data.decision.documentIds.map((id, index) => (
                    <Link key={id} to={resultLink(id)}>
                      <FileTextOutlined />
                      {index === item.data.decision!.documentIds.length - 1
                        ? '查看决策记录'
                        : `查看保留成果 ${index + 1}`}
                      <ArrowRightOutlined />
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                aria-label="选择路线与合并成果"
                disabled={readOnly}
                style={{ marginTop: 16 }}
                onClick={() => begin(() => setDecision(item))}
              >
                选择路线与合并成果
              </Button>
            )}
          </Card>
        </>
      )}
      <Modal
        className="fork-modal"
        open={create}
        title="创建项目分身"
        width={850}
        footer={null}
        onCancel={() => closeEditor(() => setCreate(false))}
        keyboard={!busy}
        destroyOnHidden
        closable={!busy}
        maskClosable={!busy}
      >
        <Form
          onValuesChange={() => setDirty(true)}
          scrollToFirstError={{ block: 'center' }}
          layout="vertical"
          disabled={busy}
          initialValues={{
            routes: defaultRoutes(),
            documentIds: [],
            taskIds: [],
          }}
          onFinish={(values) =>
            save(
              `/projects/${projectId}/forks`,
              'POST',
              {
                ...values,
                routes: values.routes.map((route: ForkRoute) => ({
                  ...blankRoute(route.name),
                  ...route,
                })),
              },
              () => setCreate(false),
            )
          }
        >
          {error && <Alert type="error" message={error} />}
          <div className="fork-form-intro">
            <span className="fork-eyebrow">01 / 定义一次探索</span>
            <h3>先对齐问题，再走向不同的答案。</h3>
            <p>两条路线共享目标和比较口径，分别拥有试做计划与预算。</p>
          </div>
          <Form.Item
            name="title"
            label="决策问题"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={200} placeholder="自研模型还是调用 API？" />
          </Form.Item>
          <Form.Item
            name="goal"
            label="共同目标"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea maxLength={2000} />
          </Form.Item>
          <Form.Item
            name="criterion"
            label="比较标准（明确口径与取舍）"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea
              maxLength={2000}
              placeholder="例如：同一测试集的效果、P95响应时间、每千次请求费用"
            />
          </Form.Item>
          <Form.Item
            name="documentIds"
            label="冻结参考文档（最多20份，展示前100份）"
          >
            <Select
              mode="multiple"
              maxCount={20}
              optionFilterProp="label"
              loading={docs.isPending}
              options={(Array.isArray(docs.data)
                ? docs.data.slice(0, 100)
                : []
              ).map((d: any) => ({
                value: d.id,
                label: d.title,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="taskIds"
            label="冻结参考需求（最多100项，展示前100项）"
          >
            <Select
              mode="multiple"
              maxCount={100}
              optionFilterProp="label"
              loading={tasks.isPending}
              options={(tasks.data?.items || []).map((t: any) => ({
                value: t.id,
                label: t.title,
              }))}
            />
          </Form.Item>
          {(docs.error || tasks.error) && (
            <Alert
              type="warning"
              message="部分上下文加载失败，可以关闭窗口后重试，或不选择参考资料。"
            />
          )}
          <div className="fork-form-routes">
            {[0, 1].map((index) => (
              <Card
                className={`fork-form-route fork-route-${index}`}
                key={index}
                title={`路线 ${index === 0 ? 'A' : 'B'}`}
                style={{ marginBottom: 12 }}
              >
                <RouteFields prefix={['routes', index]} />
              </Card>
            ))}
          </div>
          <div className="fork-form-actions">
            <span>创建后即可分配试验任务、记录实际结果。</span>
            <Button type="primary" htmlType="submit" loading={busy}>
              创建两条探索路线
            </Button>
          </div>
        </Form>
      </Modal>
      <Modal
        className="fork-modal"
        open={!!edit}
        title="编辑探索路线"
        width={850}
        footer={null}
        onCancel={() => closeEditor(() => setEdit(undefined))}
        keyboard={!busy}
        destroyOnHidden
        closable={!busy}
        maskClosable={!busy}
      >
        {edit && (
          <Form
            onValuesChange={() => setDirty(true)}
            scrollToFirstError={{ block: 'center' }}
            key={`${edit.item.id}-${edit.index}`}
            layout="vertical"
            disabled={busy}
            initialValues={edit.item.data.routes[edit.index]}
            onFinish={(route) =>
              save(
                `/forks/${edit.item.id}/routes/${edit.index}`,
                'PATCH',
                { expectedVersion: edit.item.version, route },
                () => setEdit(undefined),
              )
            }
          >
            {error && <Alert type="error" message={error} />}
            <div className="fork-form-intro">
              <span className="fork-eyebrow">02 / 限时试做</span>
              <h3>{edit.item.data.routes[edit.index].name}</h3>
              <p>把想法拆成最小试验，留下测量口径、运行来源和适用条件。</p>
            </div>
            <RouteFields prefix={[]} />
            <Space wrap>
              <Form.Item name="actualHours" label="实际投入（人时）">
                <InputNumber min={0} max={100000} />
              </Form.Item>
              <Form.Item name="actualCost" label="实际费用（元）">
                <InputNumber min={0} max={100000000} />
              </Form.Item>
            </Space>
            <Form.Item name="outcome" label="实际结论、适用条件与局限">
              <Input.TextArea rows={3} maxLength={10000} />
            </Form.Item>
            <Form.List name="experiments">
              {(fields, { add, remove }) => (
                <>
                  <div className="fork-form-section">
                    <ExperimentOutlined />
                    <h3>试验任务</h3>
                    <span>{fields.length} 项</span>
                  </div>
                  {!fields.length && (
                    <p className="fork-inline-empty">
                      从一个可以在预算内完成的小试验开始。
                    </p>
                  )}
                  {fields.map((field) => (
                    <Card
                      key={field.key}
                      size="small"
                      title={`试验 ${field.name + 1}`}
                      style={{ marginBottom: 12 }}
                      extra={
                        <Button danger onClick={() => remove(field.name)}>
                          删除试验
                        </Button>
                      }
                    >
                      <Form.Item name={[field.name, 'id']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'title']}
                        label="试验任务"
                        rules={[{ required: true, whitespace: true }]}
                      >
                        <Input maxLength={200} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'ownerId']} label="负责人">
                        <Select
                          options={[
                            { value: '', label: '未分配' },
                            ...people.map((m: any) => ({
                              value: m.id,
                              label: m.name,
                            })),
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name={[field.name, 'status']} label="进度">
                        <Select
                          options={Object.entries(statusNames).map(
                            ([value, label]) => ({ value, label }),
                          )}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'result']}
                        label="实际结果（完成时必填，记录测量口径和来源）"
                        dependencies={[['experiments', field.name, 'status']]}
                        rules={[
                          ({ getFieldValue }) => ({
                            validator: (_, value) =>
                              getFieldValue([
                                'experiments',
                                field.name,
                                'status',
                              ]) === 'DONE' && !value?.trim()
                                ? Promise.reject(
                                    new Error(
                                      '完成试验前，请填写实际结果与测量来源',
                                    ),
                                  )
                                : Promise.resolve(),
                          }),
                        ]}
                      >
                        <Input.TextArea rows={3} maxLength={10000} />
                      </Form.Item>
                    </Card>
                  ))}
                  <Button
                    onClick={() =>
                      add({
                        id: createClientId(),
                        title: '',
                        ownerId: '',
                        status: 'TODO',
                        result: '',
                      })
                    }
                  >
                    添加试验任务
                  </Button>
                </>
              )}
            </Form.List>
            <Form.List name="artifacts">
              {(fields, { add, remove }) => (
                <div style={{ margin: '16px 0' }}>
                  <div className="fork-form-section">
                    <FileTextOutlined />
                    <h3>可复用成果</h3>
                    <span>{fields.length} 份</span>
                  </div>
                  {!fields.length && (
                    <p className="fork-inline-empty">
                      保存原型说明、代码链接或实验记录，决策时可跨路线保留。
                    </p>
                  )}
                  {fields.map((field) => (
                    <Card
                      key={field.key}
                      size="small"
                      title="可保留的成果"
                      extra={
                        <Button danger onClick={() => remove(field.name)}>
                          删除成果
                        </Button>
                      }
                    >
                      <Form.Item name={[field.name, 'id']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'title']}
                        label="成果名称"
                        rules={[{ required: true, whitespace: true }]}
                      >
                        <Input maxLength={200} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'content']}
                        label="成果内容、代码仓库或运行结果来源"
                        rules={[{ required: true, whitespace: true }]}
                      >
                        <Input.TextArea rows={4} maxLength={100000} />
                      </Form.Item>
                    </Card>
                  ))}
                  <Button
                    onClick={() =>
                      add({ id: createClientId(), title: '', content: '' })
                    }
                  >
                    添加成果
                  </Button>
                </div>
              )}
            </Form.List>
            <div className="fork-form-actions">
              <span>尚未测量的投入请留空；0 表示实际为零。</span>
              <Button type="primary" htmlType="submit" loading={busy}>
                保存路线
              </Button>
            </div>
            {error && (
              <Button
                disabled={busy}
                onClick={() => {
                  setEdit(undefined);
                  query.refetch();
                }}
              >
                关闭并刷新（未保存输入将丢弃）
              </Button>
            )}
          </Form>
        )}
      </Modal>
      <Modal
        className="fork-modal fork-decision-modal"
        open={!!decision}
        title="选择路线与合并成果"
        footer={null}
        onCancel={() => closeEditor(() => setDecision(undefined))}
        keyboard={!busy}
        destroyOnHidden
        closable={!busy}
        maskClosable={!busy}
      >
        {decision && (
          <Form
            onValuesChange={() => setDirty(true)}
            scrollToFirstError={{ block: 'center' }}
            layout="vertical"
            disabled={busy}
            initialValues={{
              selectedRoute: Math.max(
                0,
                decision.data.routes.findIndex((r) => !routeGaps(r).length),
              ),
              artifactIds: [],
            }}
            onFinish={(values) =>
              save(
                `/forks/${decision.id}/decide`,
                'POST',
                { ...values, expectedVersion: decision.version },
                () => setDecision(undefined),
              )
            }
          >
            <div className="fork-form-intro">
              <span className="fork-eyebrow">03 / 比较与选择</span>
              <h3>留下成果，也留下选择的理由。</h3>
              <p>采用一条路线，仍可保留另一条路线中值得复用的工作。</p>
            </div>
            <div className="fork-readiness">
              {decision.data.routes.map((r, index) => (
                <div key={index}>
                  <strong>{r.name}</strong>
                  <Tag color={routeGaps(r).length ? 'default' : 'success'}>
                    {routeGaps(r).length ? '待补充' : '可决策'}
                  </Tag>
                  <p>
                    {routeGaps(r).join(' · ') ||
                      '试验已完成，实际投入与结论已记录'}
                  </p>
                </div>
              ))}
            </div>
            <Alert
              type="info"
              message="确认后两条路线冻结为历史；生成新的项目文档，保留原有文档。可同时选择另一条路线的有用成果。"
            />
            {error && <Alert type="error" message={error} />}
            <Form.Item name="selectedRoute" label="采用路线">
              <Select
                options={decision.data.routes.map((r, value) => ({
                  value,
                  label: r.name,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="reason"
              label="选择依据、放弃另一条路线的原因与重启条件"
              rules={[{ required: true, min: 10 }]}
            >
              <Input.TextArea rows={4} maxLength={10000} />
            </Form.Item>
            <Form.Item name="artifactIds" label="保留成果（可跨路线选择）">
              <Checkbox.Group
                options={decision.data.routes.flatMap((r) =>
                  r.artifacts.map((a) => ({
                    value: a.id,
                    label: `${r.name} · ${a.title}`,
                  })),
                )}
              />
            </Form.Item>
            <div className="fork-form-actions">
              <Button type="primary" htmlType="submit" loading={busy}>
                确认决策并合并成果
              </Button>
            </div>
          </Form>
        )}
      </Modal>
    </div>
  );
}
function RouteFields({ prefix }: { prefix: (string | number)[] }) {
  return (
    <>
      <Form.Item
        name={[...prefix, 'name']}
        label="路线名称"
        rules={[{ required: true, whitespace: true }]}
      >
        <Input maxLength={100} />
      </Form.Item>
      <Form.Item
        name={[...prefix, 'hypothesis']}
        label="待验证的假设"
        rules={[{ required: true, whitespace: true }]}
      >
        <Input.TextArea maxLength={2000} />
      </Form.Item>
      <Form.Item name={[...prefix, 'plan']} label="最小试做计划">
        <Input.TextArea rows={2} maxLength={10000} />
      </Form.Item>
      <Space wrap>
        <Form.Item
          name={[...prefix, 'hoursBudget']}
          label="预算（人时）"
          rules={[{ required: true }]}
        >
          <InputNumber min={0.1} max={10000} />
        </Form.Item>
        <Form.Item
          name={[...prefix, 'costBudget']}
          label="预算（元）"
          rules={[{ required: true }]}
        >
          <InputNumber min={0} max={10000000} />
        </Form.Item>
        <Form.Item name={[...prefix, 'deadline']} label="试验截止（北京时间）">
          <Input type="date" />
        </Form.Item>
      </Space>
    </>
  );
}

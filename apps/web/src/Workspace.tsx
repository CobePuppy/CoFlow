import { materialKindForAction } from '../../../packages/contracts/material-import.js';
import FileImport from './components/FileImport.js';
import {
  workflowLabel,
  workflowStatuses,
} from '../../../packages/contracts/workflow.js';
import { QuickRequirementActions } from './components/QuickRequirementActions.js';
import { DeleteRequirement } from './components/DeleteRequirement.js';
import {
  AttachmentPanel,
  stageForStatus,
} from './components/AttachmentPanel.js';
import { TeamSwitcher } from './components/TeamSwitcher.js';
import { DeliveryMaterials } from './components/DeliveryMaterials.js';
import { NextStep } from './components/NextStep.js';
import { AccountMenu } from './components/AccountMenu.js';
import { HandoffPreview } from './components/HandoffPreview.js';
import {
  forwardActions,
  requirementReadiness,
} from './transition-readiness.js';
import { createClientId } from './client-id.js';
import { RequirementContent } from './components/RequirementContent.js';
import { WorkDashboard } from './components/WorkDashboard.js';
import { EditionSwitch } from './components/EditionSwitch.js';
import { edition } from './edition.js';
import {
  filterKeys,
  readWorkspaceState,
  matchesTaskFilters,
  type TaskFilters,
} from './workspace-state.js';
import { RelatedDocuments } from './components/DocumentLinks.js';
import {
  AppstoreOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  FileTextOutlined,
  FolderOutlined,
  MenuOutlined,
  PlusOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Grid,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Timeline,
} from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  labels,
  statuses,
  getHandlerIds as taskHandlers,
  terminal,
  type Member,
  type Status,
  type Task,
} from '../../../packages/contracts/index.js';
import { ApiError } from './api-response.js';
import { BrandMark } from './components/BrandMark.js';
import { Markdown } from './components/Markdown.js';
import { ReviewSummary } from './components/ReviewSummary.js';
import { TaskEditor } from './components/TaskEditor.js';
import { TaskProperties } from './components/TaskProperties.js';
import {
  Documents,
  Management,
  Templates,
  ProjectForks,
  ProjectSettings,
  AIQuality,
} from './pages.js';
import { api, useData } from './runtime.js';
const actionLabels: Record<string, string> = {
  SUBMIT_REQUIREMENT: '提交需求',
  RETURN_REQUIREMENT: '退回需求',
  SUBMIT_SOLUTION: '提交方案',
  APPROVE_SOLUTION: '评估通过',
  REJECT_SOLUTION: '退回方案',
  START_DEVELOPMENT: '开始开发',
  COMPLETE_DEVELOPMENT: '开发完成并提测',
  START_TEST: '开始测试',
  FAIL_TEST: '测试不通过',
  PASS_TEST: '测试通过',
  ACCEPT: '验收关闭',
  REJECT_ACCEPTANCE: '验收退回',
  APPLY_REQUIREMENT_CHANGE: '确认需求变更',
  CANCEL: '取消需求',
  START_WORK: '开始处理',
  SUBMIT_ACCEPTANCE: '提交验收',
  TASK_TRASH: '移入回收站',
  TASK_RESTORE: '恢复需求',
  BLOCK: '标记阻塞',
  UNBLOCK: '解除阻塞',
  TRANSFER: '责任转交',
  UPDATE_PROPERTIES: '更新基本信息',
};
const actionFields: Record<string, [string, string, string?][]> = {
  SUBMIT_ACCEPTANCE: [['summary', '完成说明']],
  SUBMIT_SOLUTION: [
    ['body', '方案正文'],
    ['scope', '影响范围'],
    ['effort', '预计工作量（人日）', 'number'],
    ['risk', '风险说明'],
    ['start', '预计开始日期', 'date'],
    ['end', '预计结束日期', 'date'],
  ],
  COMPLETE_DEVELOPMENT: [
    ['summary', '开发说明'],
    ['selfTest', '自测结果'],
    ['releaseVersion', '交付版本'],
    ['environment', '环境地址或说明'],
    ['knownIssues', '已知问题'],
  ],
  START_TEST: [['environment', '测试环境']],
  PASS_TEST: [
    ['record', '测试执行记录'],
    ['deployment', '部署验证说明'],
  ],
  FAIL_TEST: [
    ['reason', '失败原因'],
    ['record', '测试执行记录'],
    ['deployment', '部署验证说明'],
    ['defectIds', '关联缺陷 ID（逗号分隔）'],
  ],
  REJECT_ACCEPTANCE: [
    ['reason', '退回原因'],
    ['target', '退回去向', 'target'],
  ],
  APPLY_REQUIREMENT_CHANGE: [
    ['description', '变更后的需求描述'],
    ['criteria', '变更后验收标准（每行一项）'],
    ['reason', '变更原因'],
    ['impact', '范围影响'],
  ],
};
export default function Workspace({ user }: { user: any }) {
  const qc = useQueryClient(),
    { message } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const activeTask = params.get('task');
  const detailContext = useData(
    ['task', activeTask],
    `/tasks/${activeTask}`,
    !!activeTask,
  );
  const { view, mode, filters, page } = readWorkspaceState(params);
  const [settingsProject, setSettingsProject] = useState<any>();
  const [create, setCreate] = useState(false),
    [manage, setManage] = useState('');
  const [searchText, setSearchText] = useState(filters.q || '');
  const [mobileNav, setMobileNav] = useState(false);
  const workspaces = useData(['workspaces'], '/workspaces');
  const w =
    detailContext.data?.workspaceId ||
    params.get('workspace') ||
    workspaces.data?.[0]?.id ||
    '';
  const projects = useData(['projects', w], `/workspaces/${w}/projects`, !!w);
  const p =
    detailContext.data?.projectId ||
    params.get('project') ||
    projects.data?.find((x: any) => !x.archivedAt)?.id ||
    projects.data?.[0]?.id ||
    '';
  const people = useData(['members', p], `/projects/${p}/members`, !!p);
  const project = projects.data?.find((x: any) => x.id === p);
  const isProjectView = !['dashboard', 'todos', 'notifications'].includes(view);
  const workspaceMembers = useData(
    ['workspaceMembers', w],
    '/workspaces/' + w + '/members',
    !!w,
  );
  const isAdmin = workspaceMembers.data?.some(
    (m: any) => m.id === user.id && m.role === 'ADMIN',
  );
  const listPeople = view === 'todos' ? workspaceMembers.data : people.data;
  useEffect(() => {
    setSearchText(filters.q || '');
  }, [filters.q, w, p]);
  useEffect(() => {
    if (!mobileNav) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNav(false);
    };
    const narrow = window.matchMedia('(max-width: 650px)');
    const resize = () => {
      if (!narrow.matches) setMobileNav(false);
    };
    window.addEventListener('keydown', close);
    narrow.addEventListener('change', resize);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', close);
      narrow.removeEventListener('change', resize);
    };
  }, [mobileNav]);
  const navigate = (patch: Record<string, string | null>, reset = false) => {
    const next = new URLSearchParams(reset ? {} : params);
    next.set('app', 'work');
    if (w) next.set('workspace', w);
    if (p) next.set('project', p);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };
  const setPage = (value: number) => navigate({ page: String(value) });
  const clearFilters = () => {
    navigate(
      Object.fromEntries([...filterKeys, 'page'].map((key) => [key, null])),
    );
    setSearchText('');
  };
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    page: String(page),
    pageSize: mode === 'board' ? '100' : '20',
  } as any);
  const tasks = useData(
    ['tasks', p, query.toString()],
    `/projects/${p}/tasks?${query}`,
    !!p && view === 'tasks',
  );
  const todos = useData(['todos'], '/me/todos');
  const notes = useData(
    ['notifications', w],
    '/notifications?workspace=' + encodeURIComponent(w),
    !!w,
    15000,
  );
  const teamTodoCount = (todos.data || []).filter(
    (task: Task) => task.workspaceId === w,
  ).length;
  const stats = useData(['metrics', p], `/projects/${p}/metrics`, !!p);
  async function mutate(url: string, method: string, body: any) {
    try {
      const d = await api(url, method, body);
      message.success('已保存');
      qc.invalidateQueries();
      return d;
    } catch (e) {
      message.error((e as Error).message);
      throw e;
    }
  }
  const todoRows = (todos.data || []).filter(
    (t: Task) =>
      projects.data?.some((x: any) => x.id === t.projectId) &&
      matchesTaskFilters(t, filters),
  );
  const rows: Task[] = view === 'todos' ? todoRows : tasks.data?.items || [];
  const visibleRows =
    mode === 'board' && view === 'todos'
      ? rows.slice((page - 1) * 100, page * 100)
      : rows;
  const total = view === 'todos' ? rows.length : tasks.data?.total || 0;
  const activeQuery = view === 'todos' ? todos : tasks;
  const hasFilters = Object.keys(filters).length > 0;
  const open = (id: string) => navigate({ task: id });
  const changeFilter = (key: keyof TaskFilters, value: string | undefined) =>
    navigate({ [key]: value || null, page: null });
  return (
    <div className={`shell ${mobileNav ? 'nav-open' : ''}`}>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="关闭导航遮罩"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside>
        {mobileNav && (
          <Button
            className="mobile-nav-close"
            aria-label="关闭导航"
            type="text"
            icon={<CloseOutlined />}
            onClick={() => setMobileNav(false)}
          />
        )}
        <div className="brand">
          <BrandMark />{' '}
          <span>
            {edition.id === 'student' ? '学生项目空间' : '团队协作空间'}
          </span>
        </div>
        <EditionSwitch />
        <TeamSwitcher
          teams={workspaces.data || []}
          value={w}
          loading={workspaces.isPending}
          onChange={(id) => {
            navigate(
              { workspace: id, project: null, task: null, view: 'todos' },
              true,
            );
            setMobileNav(false);
          }}
        />
        <button className="nav-item" onClick={() => setParams({})}>
          <AppstoreOutlined /> 返回首页
        </button>
        <button
          className={`nav-item ${view === 'todos' ? 'active' : ''}`}
          onClick={() => {
            navigate({ view: 'todos', task: null, page: null }, true);
            setMobileNav(false);
          }}
        >
          <CheckCircleOutlined /> 待我处理{' '}
          {teamTodoCount > 0 && (
            <span className="nav-count">
              {teamTodoCount > 99 ? '99+' : teamTodoCount}
            </span>
          )}
        </button>
        <button
          className={`nav-item ${view === 'notifications' ? 'active' : ''}`}
          onClick={() => {
            navigate({ view: 'notifications', task: null, page: null });
            setMobileNav(false);
          }}
        >
          <BellOutlined /> 站内通知{' '}
          {!!notes.data?.unreadCount && (
            <span className="nav-count">{notes.data.unreadCount}</span>
          )}
        </button>
        <div className="workspace-project-section">
          <div className="nav-caption">
            项目{' '}
            <Button
              type="text"
              size="small"
              disabled={
                workspaces.data?.find((team: any) => team.id === w)?.role !==
                'ADMIN'
              }
              aria-label="创建项目"
              icon={<PlusOutlined />}
              onClick={() => setManage('project')}
            />
          </div>
          <div className="workspace-project-list" aria-label="项目列表">
            {[...(projects.data || [])]
              .sort(
                (a: any, b: any) =>
                  Number(!!a.archivedAt) - Number(!!b.archivedAt),
              )
              .map((x: any) => (
                <button
                  key={x.id}
                  className={`nav-item ${p === x.id && view !== 'todos' && view !== 'dashboard' && view !== 'notifications' ? 'active' : ''}`}
                  onClick={() => {
                    navigate(
                      { project: x.id, view: 'tasks', task: null },
                      true,
                    );
                    setMobileNav(false);
                  }}
                >
                  <FolderOutlined />
                  <span className="nav-label" title={x.name}>
                    {x.name}
                  </span>
                  {x.archivedAt && <span className="nav-archive">归档</span>}
                </button>
              ))}
          </div>
        </div>
        <div className="sidebar-bottom">
          <AccountMenu user={user} />
        </div>
      </aside>
      <main>
        <header>
          <Button
            className="mobile-nav-button"
            aria-label="打开导航"
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setMobileNav(true)}
          />
          <span>
            {workspaces.data?.find((x: any) => x.id === w)?.name}{' '}
            <span className="muted"> / </span>{' '}
            {view === 'dashboard'
              ? '工作总览 · 当前团队'
              : view === 'todos'
                ? '待我处理 · 当前团队全部项目'
                : view === 'notifications'
                  ? '站内通知 · 当前团队'
                  : project?.name || '项目'}
          </span>
          <span className="header-date">
            {new Date().toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}{' '}
            · {user.name}
          </span>
        </header>
        <section className="content">
          <div className="page-heading">
            <div>
              <h1>
                {view === 'dashboard'
                  ? '我的工作台'
                  : view === 'todos'
                    ? '待我处理'
                    : view === 'notifications'
                      ? '站内通知'
                      : view === 'documents'
                        ? '项目文档'
                        : view === 'templates'
                          ? '需求模板中心'
                          : view === 'forks'
                            ? '项目分身'
                            : view === 'metrics'
                              ? '交付统计'
                              : mode === 'board'
                                ? '项目阶段看板'
                                : project?.name || '开始你的第一个项目'}
              </h1>
              <p className="muted">
                {view === 'dashboard'
                  ? '汇集项目、个人待办、竞赛日程与近期成果。'
                  : view === 'todos'
                    ? '查看当前团队所有项目中需要你处理的任务。'
                    : view === 'forks'
                      ? '用限时探索比较不同方案，让每个重要选择都有依据。'
                      : project?.description ||
                        '将需求转化为有迹可循的团队交付。'}
              </p>
            </div>
            <Space>
              {isProjectView && project && (
                <Button onClick={() => setSettingsProject(project)}>
                  项目设置
                </Button>
              )}
              {isProjectView && p && (
                <Button
                  aria-label="项目成员"
                  onClick={() => setManage('members')}
                  icon={<TeamOutlined />}
                >
                  项目成员
                </Button>
              )}
              {isProjectView && p && (
                <Button
                  aria-label="新建需求"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setCreate(true)}
                  disabled={!!project?.archivedAt}
                >
                  新建需求
                </Button>
              )}
            </Space>
          </div>
          {(workspaces.isPending || projects.isPending) && <Skeleton active />}
          {(workspaces.error || projects.error) && (
            <Alert
              type="error"
              message={(workspaces.error || projects.error)?.message}
              action={
                <Button onClick={() => qc.invalidateQueries()}>重试</Button>
              }
            />
          )}
          {!workspaces.isPending && !projects.isPending && !p && (
            <Empty description="暂无可访问的项目，请联系管理员分配项目，或创建团队项目" />
          )}
          {isProjectView && project?.archivedAt && (
            <Alert type="warning" showIcon message="项目已归档，业务数据只读" />
          )}
          {view === 'tasks' && (
            <div className="stats">
              <Stat
                label="进行中的需求"
                value={
                  stats.data?.filter((x: any) => !terminal(x.status)).length ||
                  0
                }
                detail="当前项目 · 不含回收站"
              />
              <Stat
                label="等待我的处理"
                value={
                  todos.data?.filter((x: any) => x.projectId === p).length || 0
                }
                detail="明确责任，及时响应"
              />
              <Stat
                label="已完成交付"
                value={
                  stats.data?.filter((x: any) => x.status === 'CLOSED')
                    .length || 0
                }
                detail="每一步都值得记录"
              />
              <Stat
                label="需要关注"
                value={stats.data?.filter((x: any) => x.overdue).length || 0}
                detail="已超过计划截止时间"
              />
            </div>
          )}
          {view === 'dashboard' ? (
            <WorkDashboard
              workspaceId={w}
              onNavigate={navigate}
              onSettings={setSettingsProject}
              onPortal={(section: string) =>
                setParams({ section, workspace: w })
              }
            />
          ) : view === 'notifications' ? (
            <Card>
              {notes.isPending ? (
                <Skeleton active />
              ) : notes.error ? (
                <Alert
                  type="error"
                  message={notes.error.message}
                  action={
                    <Button onClick={() => notes.refetch()}>
                      重试加载通知
                    </Button>
                  }
                />
              ) : notes.data?.items?.length ? (
                notes.data.items.map((n: any) => (
                  <div
                    className="notification"
                    key={n.id}
                    onClick={() => {
                      mutate(`/notifications/${n.id}/read`, 'POST', {});
                      open(n.taskId);
                    }}
                  >
                    <BellOutlined />
                    <div>
                      {n.message}
                      <small>
                        {new Date(n.createdAt).toLocaleString('zh-CN')}
                      </small>
                    </div>
                    {!n.readAt && <Tag color={edition.primary}>未读</Tag>}
                  </div>
                ))
              ) : (
                <Empty description="暂无通知" />
              )}
            </Card>
          ) : (
            <>
              {isProjectView && (
                <Tabs
                  activeKey={view === 'todos' ? 'todos' : view}
                  onChange={(value) => navigate({ view: value, page: null })}
                  tabBarExtraContent={
                    <Dropdown
                      menu={{
                        items: [
                          { key: 'templates', label: '需求模板' },
                          { key: 'forks', label: '项目分身' },
                        ],
                        onClick: ({ key }) =>
                          navigate({ view: key, page: null, task: null }),
                      }}
                    >
                      <Button>更多功能</Button>
                    </Dropdown>
                  }
                  items={[
                    {
                      key: view === 'todos' ? 'todos' : 'tasks',
                      label: '需求',
                    },
                    {
                      key: 'documents',
                      label: (
                        <>
                          <FileTextOutlined /> 项目文档
                        </>
                      ),
                    },
                    { key: 'metrics', label: '交付统计' },
                    ...(view === 'templates' || view === 'forks'
                      ? [
                          {
                            key: view,
                            label:
                              view === 'templates' ? '需求模板' : '项目分身',
                          },
                        ]
                      : []),
                  ]}
                />
              )}
              {view === 'documents' ? (
                <Documents projectId={p} readOnly={!!project?.archivedAt} />
              ) : view === 'forks' ? (
                <ProjectForks key={p} projectId={p} />
              ) : view === 'templates' ? (
                <Templates key={p} projectId={p} />
              ) : view === 'metrics' ? (
                <Card title="阶段耗时与退回统计">
                  <p className="muted">
                    自然小时；净耗时扣除阻塞区间。估算工作量在方案中单独记录。
                  </p>
                  <Table
                    rowKey="id"
                    dataSource={stats.data}
                    columns={[
                      { title: '需求', dataIndex: 'title' },
                      { title: '方案退回', dataIndex: 'solutionReturns' },
                      { title: '测试退回', dataIndex: 'testReturns' },
                      {
                        title: '交付周期（小时）',
                        dataIndex: 'deliveryHours',
                        render: (v) => v?.toFixed(2) || '—',
                      },
                      {
                        title: '阶段总 / 净耗时',
                        render: (_, x: any) =>
                          Object.entries(x.stages).map(([k, v]: any) => (
                            <div key={k}>
                              {labels[k as Status]}：{v.totalHours.toFixed(2)} /{' '}
                              {v.netHours.toFixed(2)}
                            </div>
                          )),
                      },
                    ]}
                  />
                </Card>
              ) : (
                <div className="task-panel">
                  {isProjectView && (
                    <Tabs
                      activeKey={
                        filters.scope || (filters.status ? 'all' : 'active')
                      }
                      onChange={(scope) => changeFilter('scope', scope)}
                      items={[
                        ['active', '进行中'],
                        ['handling', '待我处理'],
                        ['mine', '我参与的'],
                        ['overdue', '已逾期'],
                        ['ended', '已结束'],
                        ['all', '全部'],
                        ['trash', '回收站'],
                      ].map(([key, label]) => ({ key, label }))}
                    />
                  )}
                  {filters.scope === 'trash' && (
                    <Alert
                      type="info"
                      message="回收站保留历史、附件和引用关系；恢复后回到删除前的阶段。永久删除仅限管理员。"
                    />
                  )}
                  <div className="toolbar">
                    <Space wrap>
                      <Input.Search
                        aria-label="搜索需求"
                        value={searchText}
                        onChange={(event) => {
                          setSearchText(event.target.value);
                          if (!event.target.value) changeFilter('q', '');
                        }}
                        placeholder="搜索需求标题、内容…"
                        allowClear
                        style={{ width: 240 }}
                        onSearch={(v) => changeFilter('q', v)}
                      />
                      <Select
                        aria-label="筛选全部状态"
                        value={filters.status}
                        placeholder="全部状态"
                        allowClear
                        style={{ width: 150 }}
                        options={workflowStatuses(
                          project?.workflow === 'SIMPLE',
                        ).map((s) => ({
                          value: s,
                          label:
                            project?.workflow === 'SIMPLE'
                              ? workflowLabel({
                                  status: s,
                                  data: { workflow: 'SIMPLE' } as any,
                                })
                              : labels[s],
                        }))}
                        onChange={(v) => changeFilter('status', v)}
                      />
                      <Select
                        aria-label="筛选负责人"
                        value={filters.owner}
                        placeholder="负责人"
                        allowClear
                        style={{ width: 130 }}
                        options={listPeople?.map((m: Member) => ({
                          value: m.id,
                          label: m.name,
                        }))}
                        onChange={(v) => changeFilter('owner', v)}
                      />
                      <Select
                        aria-label="筛选优先级"
                        value={filters.priority}
                        placeholder="优先级"
                        allowClear
                        style={{ width: 110 }}
                        options={['P0', 'P1', 'P2', 'P3'].map((value) => ({
                          value,
                          label: value,
                        }))}
                        onChange={(v) => changeFilter('priority', v)}
                      />
                      <Checkbox
                        checked={filters.blocked === 'true'}
                        onChange={(e) =>
                          changeFilter(
                            'blocked',
                            e.target.checked ? 'true' : '',
                          )
                        }
                      >
                        仅阻塞
                      </Checkbox>
                      <Button
                        onClick={clearFilters}
                        disabled={!hasFilters && !searchText}
                      >
                        清空筛选
                      </Button>
                    </Space>
                    <Space.Compact>
                      <Button
                        aria-label="列表视图"
                        icon={<UnorderedListOutlined />}
                        type={mode === 'list' ? 'primary' : 'default'}
                        onClick={() => {
                          navigate({ mode: 'list', page: null });
                        }}
                      />
                      <Button
                        aria-label="看板视图"
                        icon={<AppstoreOutlined />}
                        type={mode === 'board' ? 'primary' : 'default'}
                        onClick={() => {
                          navigate({ mode: 'board', page: null });
                        }}
                      />
                    </Space.Compact>
                  </div>
                  {!activeQuery.isPending &&
                    total > 0 &&
                    page > Math.ceil(total / (mode === 'board' ? 100 : 20)) && (
                      <Alert
                        type="info"
                        message="当前页已无数据，请返回第一页"
                        action={
                          <Button onClick={() => setPage(1)}>返回第一页</Button>
                        }
                      />
                    )}
                  {activeQuery.error ? (
                    <Alert
                      type="error"
                      message={activeQuery.error.message}
                      action={
                        <Button onClick={() => activeQuery.refetch()}>
                          重试
                        </Button>
                      }
                    />
                  ) : activeQuery.isPending && !!p ? (
                    <Skeleton active />
                  ) : mode === 'board' ? (
                    <>
                      <p className="muted board-summary" role="status">
                        当前页 {visibleRows.length} 条，共 {total}{' '}
                        条；阶段数量按当前页统计
                      </p>
                      <div className="board">
                        {workflowStatuses(project?.workflow === 'SIMPLE').map(
                          (s) => (
                            <div className="board-column" key={s}>
                              <h4>
                                <Tag>
                                  {project?.workflow === 'SIMPLE'
                                    ? workflowLabel({
                                        status: s,
                                        data: { workflow: 'SIMPLE' } as any,
                                      })
                                    : labels[s]}
                                </Tag>
                                <span>
                                  {
                                    visibleRows.filter(
                                      (t: Task) => t.status === s,
                                    ).length
                                  }
                                </span>
                              </h4>
                              {visibleRows
                                .filter((t: Task) => t.status === s)
                                .map((t: Task) => (
                                  <Card
                                    key={t.id}
                                    size="small"
                                    hoverable
                                    onClick={() => open(t.id)}
                                  >
                                    <span className="muted small">
                                      CF-{String(t.number).padStart(3, '0')}
                                    </span>
                                    <h4>{t.data.title}</h4>
                                    <QuickRequirementActions
                                      task={t}
                                      userId={user.id}
                                      readOnly={!!project?.archivedAt}
                                      admin={isAdmin}
                                      members={people.data || []}
                                    />
                                    <Space>
                                      <Tag
                                        color={
                                          t.data.priority === 'P0'
                                            ? 'red'
                                            : 'blue'
                                        }
                                      >
                                        {t.data.priority}
                                      </Tag>
                                      {t.data.blocks.some((b) => !b.end) && (
                                        <Tag color="orange">阻塞</Tag>
                                      )}
                                    </Space>
                                  </Card>
                                ))}
                            </div>
                          ),
                        )}
                      </div>
                      {total === 0 && (
                        <Empty
                          description={
                            hasFilters
                              ? '没有符合筛选条件的需求'
                              : '暂无需求，创建第一条需求开始协作'
                          }
                        />
                      )}
                      <div className="board-pagination">
                        <Pagination
                          current={page}
                          pageSize={100}
                          total={total}
                          onChange={setPage}
                          showSizeChanger={false}
                          showTotal={(count) =>
                            `共 ${count} 条需求，每页最多 100 条`
                          }
                        />
                      </div>
                    </>
                  ) : (
                    <Table
                      loading={
                        !!p &&
                        (view === 'todos' ? todos.isPending : tasks.isPending)
                      }
                      rowKey="id"
                      dataSource={rows}
                      onRow={(t: any) => ({
                        onClick: () => open(t.id),
                        style: { cursor: 'pointer' },
                      })}
                      pagination={{
                        current: page,
                        pageSize: 20,
                        total,
                        onChange: setPage,
                        showSizeChanger: false,
                      }}
                      locale={{
                        emptyText: (
                          <Empty
                            description={
                              hasFilters
                                ? '没有符合筛选条件的需求'
                                : '暂无需求，创建第一条需求开始协作'
                            }
                          />
                        ),
                      }}
                      columns={[
                        {
                          title: '需求',
                          render: (_, t: Task) => (
                            <div>
                              <span className="task-number">
                                CF-{String(t.number).padStart(3, '0')}
                              </span>
                              <strong>{t.data.title}</strong>
                              {t.data.type === 'BUG' && (
                                <Tag color="red">缺陷</Tag>
                              )}
                              <div className="task-sub">
                                {view === 'todos' && (
                                  <span>
                                    {projects.data?.find(
                                      (project: any) =>
                                        project.id === t.projectId,
                                    )?.name || '所属项目'}{' '}
                                    ·{' '}
                                  </span>
                                )}
                                {t.data.goal || t.data.description.slice(0, 55)}
                              </div>
                            </div>
                          ),
                        },
                        {
                          title: '阶段',
                          dataIndex: 'status',
                          render: (_, t: Task) => <Tag>{workflowLabel(t)}</Tag>,
                        },
                        {
                          title: '优先级',
                          render: (_, t: Task) => (
                            <Tag
                              color={
                                t.data.priority === 'P0'
                                  ? 'red'
                                  : t.data.priority === 'P1'
                                    ? 'orange'
                                    : 'default'
                              }
                            >
                              {t.data.priority}
                            </Tag>
                          ),
                        },
                        {
                          title: '当前处理人',
                          render: (_, t: Task) => (
                            <span>
                              {taskHandlers(t)
                                .map(
                                  (id) =>
                                    listPeople?.find((m: Member) => m.id === id)
                                      ?.name || '未指定',
                                )
                                .join('、') || '已结束'}
                            </span>
                          ),
                        },
                        {
                          title: '计划截止',
                          render: (_, t: Task) =>
                            t.data.dueAt
                              ? new Date(t.data.dueAt).toLocaleDateString(
                                  'zh-CN',
                                )
                              : '—',
                        },
                        {
                          title: '关注',
                          render: (_, t: Task) =>
                            t.data.blocks.some((b) => !b.end) ? (
                              <Tag color="orange">阻塞中</Tag>
                            ) : (
                              <span className="muted">—</span>
                            ),
                        },
                        {
                          title: '操作',
                          render: (_, t: Task) => (
                            <QuickRequirementActions
                              task={t}
                              userId={user.id}
                              readOnly={!!project?.archivedAt}
                              admin={isAdmin}
                              members={people.data || []}
                            />
                          ),
                        },
                      ]}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </main>
      <TaskEditor
        open={create}
        members={people.data || []}
        projectId={p}
        projectName={project?.name}
        onClose={() => setCreate(false)}
        onSave={async (v: any) => {
          const created = await mutate(
            `/projects/${v.projectId || p}/tasks`,
            'POST',
            v,
          );
          setCreate(false);
          navigate(
            { project: created.projectId, view: 'tasks', task: created.id },
            true,
          );
        }}
      />
      {activeTask && (
        <TaskDetail
          id={activeTask}
          user={user}
          onClose={() => navigate({ task: null })}
        />
      )}
      {settingsProject && (
        <ProjectSettings
          project={settingsProject}
          workspaceId={w}
          onClose={(deleted: boolean) => {
            setSettingsProject(undefined);
            if (deleted)
              navigate({ view: 'dashboard', project: null, task: null }, true);
          }}
        />
      )}
      {manage && (
        <Management
          kind={manage}
          wid={w}
          pid={p}
          project={project}
          onClose={() => setManage('')}
        />
      )}
    </div>
  );
}
function Stat({ label, value, detail }: any) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>
        {value}
        <small>项</small>
      </strong>
      <p>{detail}</p>
    </div>
  );
}
function TaskDetail({ id, user, onClose }: any) {
  const qc = useQueryClient(),
    { message } = AntApp.useApp();
  const q = useData(['task', id], `/tasks/${id}`),
    t = q.data as Task & {
      attachments: any[];
      allowedActions: string[];
      handlerIds: string[];
      readOnly: boolean;
      canManage: boolean;
    };
  const screens = Grid.useBreakpoint();
  const [actionForm] = Form.useForm();
  const people = useData(
    ['members', t?.projectId],
    `/projects/${t?.projectId}/members`,
    !!t,
  );
  const [action, setAction] = useState(''),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [comment, setComment] = useState(''),
    [mentions, setMentions] = useState<string[]>([]),
    [actionError, setActionError] = useState('');
  const [requestKey, setRequestKey] = useState('');
  const [showMore, setShowMore] = useState(false);
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
      qc.invalidateQueries();
    } catch (e) {
      setActionError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setRequestKey(createClientId());
      }
      q.refetch();
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
      extra={<Button onClick={onClose}>返回需求列表</Button>}
      onClose={onClose}
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
                  tabBarExtraContent={
                    <Button type="text" onClick={() => setShowMore(!showMore)}>
                      {showMore ? '收起更多资料' : '更多资料'}
                    </Button>
                  }
                  defaultActiveKey={
                    d.workflow !== 'SIMPLE' &&
                    ['READY_FOR_TEST', 'TESTING'].includes(t.status)
                      ? 'testing'
                      : t.status === 'SOLUTION_REVIEW'
                        ? 'solution'
                        : 'requirement'
                  }
                  items={[
                    {
                      key: 'requirement',
                      label: '需求正文',
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
                    {
                      key: 'acceptance-items',
                      label: '验收项',
                      children: (
                        <Card title={`验收标准 · ${d.criteria.length} 项`}>
                          {d.criteria.length ? (
                            <ol className="requirement-criteria">
                              {d.criteria.map((c, i) => (
                                <li key={i}>{c}</li>
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
                          <AttachmentPanel
                            taskId={id}
                            stage="ACCEPTANCE"
                            readOnly={t.readOnly}
                          />
                        </Card>
                      ),
                    },
                    {
                      key: 'solution',
                      label: d.workflow === 'SIMPLE' ? '交付材料' : '开发资料',
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
                    ...(d.workflow === 'SIMPLE'
                      ? []
                      : [
                          {
                            key: 'testing',
                            label: '测试资料',
                            children: (
                              <DeliveryMaterials
                                task={t}
                                begin={begin}
                                section="testing"
                              />
                            ),
                          },
                        ]),
                    {
                      key: 'ai-quality',
                      label: 'AI评审',
                      children: <AIQuality task={t} />,
                    },
                    {
                      key: 'related-documents',
                      label: '关联文档',
                      children: <RelatedDocuments taskId={id} />,
                    },
                    {
                      key: 'activity',
                      label: '动态与附件',
                      children: (
                        <>
                          <h3>评论</h3>
                          {d.comments.map((c: any) => (
                            <Card
                              size="small"
                              key={c.id}
                              className="history-card"
                              title={`${c.name} · ${new Date(c.at).toLocaleString('zh-CN')}`}
                            >
                              <Markdown>{c.body}</Markdown>
                            </Card>
                          ))}
                          <Input.TextArea
                            disabled={t.readOnly}
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="补充说明，支持 Markdown"
                            rows={3}
                          />
                          <Space style={{ margin: '12px 0' }}>
                            <Select
                              mode="multiple"
                              style={{ minWidth: 280 }}
                              placeholder="@ 提及项目成员"
                              value={mentions}
                              onChange={setMentions}
                              options={people.data?.map((m: Member) => ({
                                value: m.id,
                                label: m.name,
                              }))}
                            />
                            <Button
                              disabled={t.readOnly || !comment.trim()}
                              loading={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await api(`/tasks/${id}/comments`, 'POST', {
                                    body: comment,
                                    mentions,
                                    expectedVersion: t.version,
                                  });
                                  setComment('');
                                  setMentions([]);
                                  qc.invalidateQueries();
                                } catch (e) {
                                  message.error((e as Error).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              发表评论
                            </Button>
                          </Space>
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
                                </>
                              ),
                            }))}
                          />
                        </>
                      ),
                    },
                  ].filter(
                    (item) =>
                      showMore ||
                      !['ai-quality', 'related-documents'].includes(item.key),
                  )}
                />
              </div>
              <aside className="detail-sidebar">
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
                    expectedVersion: t.version,
                  });
                  setEditing(false);
                  qc.invalidateQueries();
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
        <Modal
          open
          title={actionLabels[action] || '提出需求变更'}
          className="requirement-transition"
          width={720}
          onCancel={() => setAction('')}
          footer={null}
          destroyOnHidden
        >
          <HandoffPreview
            task={t}
            action={action}
            members={people.data || []}
            userId={user.id}
          />
          <AttachmentPanel
            taskId={id}
            stage={stageForStatus[t.status] || 'GENERAL'}
            readOnly={t.readOnly}
            title="本阶段附件"
            onParse={
              materialKindForAction(action) ? setImportSource : undefined
            }
          />
          <Form
            form={actionForm}
            layout="vertical"
            onFinish={async (v) => {
              const payload = { ...v };
              if (payload.defectIds)
                payload.defectIds = payload.defectIds
                  .split(',')
                  .map((x: string) => x.trim())
                  .filter(Boolean);
              if (payload.criteria)
                payload.criteria = payload.criteria.split('\n').filter(Boolean);
              if (payload.effort) payload.effort = Number(payload.effort);
              if (action === 'PROPOSE_CHANGE') {
                setBusy(true);
                try {
                  await api(`/tasks/${id}/requirement-changes`, 'POST', {
                    ...payload,
                    expectedVersion: t.version,
                  });
                  setAction('');
                  qc.invalidateQueries();
                } catch (e) {
                  setActionError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              } else await run(payload);
            }}
          >
            {materialKindForAction(action) && (
              <FileImport
                key={action}
                kind={materialKindForAction(action)!}
                source={importSource}
                buttonLabel="从文件解析填入"
                onApply={(fields) => actionForm.setFieldsValue(fields)}
              />
            )}
            {action === 'SUBMIT_REQUIREMENT' && readiness && (
              <Alert
                style={{ marginBottom: 16 }}
                type={readiness.ready ? 'success' : 'warning'}
                showIcon
                message={
                  readiness.ready
                    ? d?.workflow === 'SIMPLE'
                      ? '已具备提交条件，确认后进入待办'
                      : '已具备提交条件，确认后进入待出方案'
                    : '请先补齐提交资料'
                }
                description={
                  <div>
                    {[
                      ...readiness.content,
                      ...readiness.assignment,
                      ...(readiness.blocked ? ['请先解除当前阻塞'] : []),
                    ].map((x) => (
                      <p key={x}>{x}</p>
                    ))}
                    {!readiness.ready && (
                      <Space wrap>
                        <Button
                          onClick={() => {
                            setAction('');
                            setEditing(true);
                          }}
                        >
                          编辑并补全需求
                        </Button>
                        {actions.includes('TRANSFER') && (
                          <Button onClick={() => begin('TRANSFER')}>
                            调整责任分工
                          </Button>
                        )}
                      </Space>
                    )}
                  </div>
                }
              />
            )}
            {actionError && (
              <Alert
                type="error"
                message={actionError}
                style={{ marginBottom: 16 }}
              />
            )}
            {conflict && (
              <Space className="conflict-controls">
                <Button
                  onClick={() =>
                    navigator.clipboard
                      .writeText(
                        JSON.stringify(actionForm.getFieldsValue(), null, 2),
                      )
                      .then(() => message.success('输入已复制'))
                      .catch(() =>
                        message.error('无法访问剪贴板，请手动复制表单内容'),
                      )
                  }
                >
                  复制当前输入
                </Button>
                <Button loading={q.isFetching} onClick={() => q.refetch()}>
                  重新加载状态
                </Button>
              </Space>
            )}
            {(
              actionFields[
                action === 'PROPOSE_CHANGE'
                  ? 'APPLY_REQUIREMENT_CHANGE'
                  : action
              ] ||
              ([
                'REJECT_SOLUTION',
                'RETURN_REQUIREMENT',
                'BLOCK',
                'UNBLOCK',
                'CANCEL',
              ].includes(action)
                ? [['reason', '操作原因']]
                : [])
            )
              .filter(([k]) => !(d?.workflow === 'SIMPLE' && k === 'target'))
              .map(([k, l, type]) => (
                <Form.Item
                  key={k}
                  name={k}
                  label={l}
                  rules={[{ required: true }]}
                >
                  {type === 'target' ? (
                    <Select
                      options={[
                        { value: 'DEVELOPING', label: '开发中' },
                        { value: 'READY_FOR_TEST', label: '待测试（新轮次）' },
                      ]}
                    />
                  ) : type === 'date' || type === 'number' ? (
                    <Input type={type} />
                  ) : (
                    <Input.TextArea
                      rows={k === 'body' || k === 'description' ? 5 : 2}
                    />
                  )}
                </Form.Item>
              ))}
            {action === 'TRANSFER' && (
              <>
                {[
                  'productId',
                  'engineerId',
                  'productReviewerId',
                  'qaReviewerId',
                  'testerId',
                ].map((k, i) => (
                  <Form.Item
                    key={k}
                    name={k}
                    label={
                      [
                        '产品负责人',
                        '研发负责人',
                        '产品评估人',
                        '测试评估人',
                        '测试负责人',
                      ][i]
                    }
                  >
                    <Select
                      allowClear
                      options={people.data?.map((m: Member) => ({
                        value: m.id,
                        label: `${m.name} (${m.roles.join('/')})`,
                      }))}
                    />
                  </Form.Item>
                ))}
              </>
            )}
            {action === 'ACCEPT' && (
              <Form.Item
                name="checks"
                rules={[
                  {
                    validator: (_, v) =>
                      v?.length === d?.criteria.length && v.every(Boolean)
                        ? Promise.resolve()
                        : Promise.reject(new Error('请确认全部验收标准')),
                  },
                ]}
              >
                <CriteriaChecks criteria={d?.criteria || []} />
              </Form.Item>
            )}
            <Button
              type="primary"
              htmlType="submit"
              loading={busy}
              disabled={action === 'SUBMIT_REQUIREMENT' && !readiness?.ready}
            >
              {conflict
                ? '按最新状态重新提交'
                : '确认' + (actionLabels[action] || '提出变更')}
            </Button>
            {action === 'SUBMIT_SOLUTION' && (
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const payload = actionForm.getFieldsValue();
                    if (payload.effort) payload.effort = Number(payload.effort);
                    await api(`/tasks/${id}/solutions`, 'POST', {
                      expectedVersion: t.version,
                      payload,
                    });
                    message.success('方案草稿已保存');
                    qc.invalidateQueries();
                  } catch (e) {
                    setActionError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                保存方案草稿
              </Button>
            )}
            <p className="muted small">
              操作将记录至审计时间线。版本冲突时请保留输入并刷新。
            </p>
          </Form>
        </Modal>
      )}
    </Drawer>
  );
}
function CriteriaChecks({ criteria, value = [], onChange }: any) {
  return (
    <div>
      {criteria.map((c: string, i: number) => (
        <p key={i}>
          <Checkbox
            checked={!!value[i]}
            onChange={(e) => {
              const a = criteria.map((_: any, j: number) =>
                j === i ? e.target.checked : !!value[j],
              );
              onChange(a);
            }}
          >
            {c}
          </Checkbox>
        </p>
      ))}
    </div>
  );
}
function StatusTag({ status }: { status: Status }) {
  return (
    <Tag
      bordered={false}
      color={
        status === 'CLOSED'
          ? 'green'
          : status === 'DEVELOPING'
            ? 'blue'
            : status === 'SOLUTION_REVIEW'
              ? 'purple'
              : status === 'TESTING'
                ? 'cyan'
                : 'default'
      }
    >
      {labels[status]}
    </Tag>
  );
}

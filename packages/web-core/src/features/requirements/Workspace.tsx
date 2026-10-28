import { flushSync } from 'react-dom';
import {
  patchSearchParams,
  taskIdFromParams,
} from '../../shared/lib/navigation.js';
import { TaskDetail } from './TaskDetail.js';
import {
  ProjectSidebar,
  projectPages,
} from '../project-space/ProjectSidebar.js';
import {
  ProjectMetrics,
  ProjectOverview,
} from '../project-space/ProjectMetrics.js';
import { ProjectRepository } from '../project-space/ProjectRepository.js';
import { RequirementPreview } from '../project-space/RequirementPreview.js';
import { ProjectHeader } from '../project-space/ProjectHeader.js';
import {
  FirstLoopGuide,
  SAMPLE_REQUIREMENT,
} from '../project-space/FirstLoopGuide.js';
import '../project-space/project-space.css';

import { SavedViews } from './components/SavedViews.js';

import { NotificationCenter } from '../notifications/components/NotificationCenter.js';
import { invalidateTaskQueries } from '../../shared/api/query-invalidation.js';

import { workflowLabel, workflowStatuses } from '@coflow/contracts/workflow.js';
import { QuickRequirementActions } from './components/QuickRequirementActions.js';
import { RequirementSignal, nextWork } from './components/RequirementSignal.js';
import { compareRequirements } from '@coflow/contracts/requirement-list.js';

import { WorkDashboard } from '../portal/components/WorkDashboard.js';
import { edition } from '../../app/edition.js';
import {
  filterKeys,
  readWorkspaceState,
  matchesTaskFilters,
  type TaskFilters,
} from './model/workspace-state.js';

import {
  AppstoreOutlined,
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
  Dropdown,
  Empty,
  Input,
  Pagination,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  labels,
  getHandlerIds as taskHandlers,
  terminal,
  type Member,
  type Status,
  type Task,
} from '@coflow/contracts/index.js';

import { TaskEditor } from './components/TaskEditor.js';

import {
  Documents,
  DiscussionCenter,
  Iterations,
  Management,
  Templates,
  ProjectForks,
  ProjectSettings,
} from '../../app/pages.js';
import { api, useData } from '../../shared/api/runtime.js';
export default function Workspace({ user }: { user: any }) {
  const qc = useQueryClient(),
    { message } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const activeTask = taskIdFromParams(params);
  const returnPosition = useRef<
    { id: string; top: number; project: string } | undefined
  >(undefined);
  useEffect(() => {
    if (params.has('task') && !activeTask)
      setParams(patchSearchParams(params, { task: null }), { replace: true });
  }, [params, activeTask, setParams]);
  const detailContext = useData(
    ['task', activeTask],
    `/tasks/${activeTask}?omitComments=true`,
    !!activeTask,
  );
  const { view, mode, filters, page } = readWorkspaceState(params);
  const [settingsProject, setSettingsProject] = useState<any>();
  const [create, setCreate] = useState(false),
    [manage, setManage] = useState('');
  const [sample, setSample] = useState<any>(null);
  const [searchText, setSearchText] = useState(filters.q || '');
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileCards, setMobileCards] = useState(
    () => window.matchMedia('(max-width:650px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width:650px)');
    const change = () => setMobileCards(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const [selection, setSelection] = useState<{
    id: string;
    projectId: string;
  }>();
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
  const isProjectView = ![
    'dashboard',
    'todos',
    'notifications',
    'discussions',
  ].includes(view);
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
    const next = patchSearchParams(reset ? new URLSearchParams() : params, {
      app: 'work',
      ...(w ? { workspace: w } : {}),
      ...(p ? { project: p } : {}),
      ...patch,
    });
    setParams(next);
  };
  const setPage = (value: number) => navigate({ page: String(value) });
  const clearFilters = () => {
    navigate(
      Object.fromEntries(
        [...filterKeys.filter((key) => key !== 'sort'), 'page'].map((key) => [
          key,
          null,
        ]),
      ),
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
    `/projects/${p}/task-summaries?${query}`,
    !!p && view === 'tasks',
  );
  const overview = useData(
    ['overview', w],
    '/workspaces/' + w + '/overview-summary',
    !!w && view === 'dashboard',
    15000,
  );
  const todos = useData(['todos'], '/me/todos', view !== 'dashboard');
  const notes = useData(
    ['notifications', w],
    '/notifications?workspace=' + encodeURIComponent(w),
    !!w,
    15000,
  );
  const teamTodoCount =
    view === 'dashboard'
      ? overview.data?.todos.length || 0
      : (todos.data || []).filter((task: Task) => task.workspaceId === w)
          .length;
  const stats = useData(
    ['metrics', p],
    `/projects/${p}/metrics`,
    !!p && isProjectView,
  );
  const firstLoop = useData(
    ['first-loop', p],
    `/projects/${p}/task-summaries?scope=all&sort=updated&pageSize=100`,
    !!p && view === 'project-overview',
  );
  async function mutate(url: string, method: string, body: any) {
    try {
      const d = await api(url, method, body);
      message.success('已保存');
      if (url.startsWith('/notifications/'))
        void qc.invalidateQueries({ queryKey: ['notifications'] });
      else void invalidateTaskQueries(qc);
      return d;
    } catch (e) {
      message.error((e as Error).message);
      throw e;
    }
  }
  const todoRows = (todos.data || [])
    .filter(
      (t: Task) =>
        projects.data?.some((x: any) => x.id === t.projectId) &&
        matchesTaskFilters(t, filters),
    )
    .sort((a: Task, b: Task) =>
      compareRequirements(filters.sort || 'updated', a, b),
    );
  const rows: Task[] = view === 'todos' ? todoRows : tasks.data?.items || [];
  const visibleRows =
    mode === 'board' && view === 'todos'
      ? rows.slice((page - 1) * 100, page * 100)
      : rows;
  const total = view === 'todos' ? rows.length : tasks.data?.total || 0;
  const activeQuery = view === 'todos' ? todos : tasks;
  const hasFilters = Object.keys(filters).some((key) => key !== 'sort');
  const open = (id: string, discussion?: string) => {
    returnPosition.current = { id, top: window.scrollY, project: p };
    navigate({
      task: id,
      taskTab: discussion ? 'activity' : null,
      discussion: discussion || null,
    });
  };
  useEffect(() => {
    if (activeTask || !returnPosition.current) return;
    const position = returnPosition.current;
    returnPosition.current = undefined;
    if (position.project !== p) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-task-id="${CSS.escape(position.id)}"]`,
        )
        ?.focus({ preventScroll: true });
      window.scrollTo({ top: position.top, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTask, p]);
  const previewId =
    selection?.projectId === p && view === 'tasks' && !activeTask
      ? selection?.id
      : undefined;
  const preview = (id: string) => setSelection({ id, projectId: p });
  useEffect(() => setSelection(undefined), [p, view]);
  const projectNavigate = (next: string) => {
    navigate({ view: next, task: null, page: null }, true);
    setSelection(undefined);
    setMobileNav(false);
  };
  const changeFilter = (key: keyof TaskFilters, value: string | undefined) =>
    navigate({ [key]: value || null, page: null });
  const previewIndex = rows.findIndex((task) => task.id === previewId);
  const filterLabel = (key: string, value: string) => {
    if (key === 'q') return `搜索：${value}`;
    if (key === 'status')
      return workflowLabel({
        status: value as Status,
        data: { workflow: project?.workflow } as any,
      });
    if (key === 'owner')
      return `负责人：${listPeople?.find((m: Member) => m.id === value)?.name || '成员已不可用'}`;
    if (key === 'priority') return `优先级：${value}`;
    if (key === 'blocked') return value === 'true' ? '仅阻塞' : '未阻塞';
    return (
      (
        {
          active: '进行中',
          all: '全部',
          handling: '待我处理',
          mine: '我参与的',
          overdue: '已逾期',
          ended: '已结束',
          trash: '回收站',
        } as Record<string, string>
      )[value] || value
    );
  };
  return (
    <div className={`shell project-space ${mobileNav ? 'nav-open' : ''}`}>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="关闭导航遮罩"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside>
        <ProjectSidebar
          project={project}
          projects={projects.data || []}
          teams={workspaces.data || []}
          workspaceId={w}
          user={user}
          view={view}
          mobileNav={mobileNav}
          onCloseMobile={() => setMobileNav(false)}
          onHome={() => setParams({ section: 'home', workspace: w })}
          onNavigate={projectNavigate}
          onProject={(id: string) => {
            setSelection(undefined);
            navigate(
              {
                project: id,
                view: 'tasks',
                task: null,
                iteration: null,
                iterationPage: null,
                iterationTasksPage: null,
                iterationFilter: null,
              },
              true,
            );
            setMobileNav(false);
          }}
          onTeam={(id: string) => {
            setSelection(undefined);
            navigate(
              { workspace: id, project: null, task: null, view: 'todos' },
              true,
            );
            setMobileNav(false);
          }}
          onMembers={() => setManage('members')}
          onSettings={() => project && setSettingsProject(project)}
          todoCount={teamTodoCount}
          unreadCount={notes.data?.unreadCount || 0}
        />
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
            {view === 'dashboard' ? (
              '工作总览 · 当前团队'
            ) : view === 'todos' ? (
              '待我处理 · 当前团队全部项目'
            ) : view === 'discussions' ? (
              '澄清事项 · 当前团队'
            ) : view === 'notifications' ? (
              '站内通知 · 当前团队'
            ) : (
              <>
                {project?.name || '项目'} /{' '}
                {projectPages[view as keyof typeof projectPages]}
              </>
            )}
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
          {isProjectView ? (
            <ProjectHeader
              project={project}
              memberCount={people.data?.length}
              onMembers={() => setManage('members')}
              onCreate={() => setCreate(true)}
            />
          ) : (
            <>
              {' '}
              <div className="page-heading">
                <div>
                  <h1>
                    {view === 'dashboard'
                      ? '我的工作台'
                      : view === 'todos'
                        ? '待我处理'
                        : view === 'discussions'
                          ? '澄清事项中心'
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
            </>
          )}
          {(workspaces.isPending || projects.isPending) && <Skeleton active />}
          {(workspaces.error || projects.error) && (
            <Alert
              type="error"
              message={(workspaces.error || projects.error)?.message}
              action={
                <Button
                  onClick={() => {
                    void workspaces.refetch();
                    if (w) void projects.refetch();
                  }}
                >
                  重试
                </Button>
              }
            />
          )}
          {!workspaces.isPending && !projects.isPending && !p && (
            <Empty description="暂无可访问的项目，请联系管理员分配项目，或创建团队项目" />
          )}
          {isProjectView && project?.archivedAt && (
            <Alert type="warning" showIcon message="项目已归档，业务数据只读" />
          )}
          {isProjectView && (
            <ProjectMetrics
              query={stats}
              todos={todos}
              projectId={p}
              onScope={(scope: string) =>
                navigate({ view: 'tasks', scope, page: null }, true)
              }
            />
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
          ) : view === 'discussions' ? (
            <DiscussionCenter key={w} workspaceId={w} onOpen={open} />
          ) : view === 'notifications' ? (
            <NotificationCenter key={w} workspaceId={w} onOpen={open} />
          ) : (
            <>
              {view === 'project-overview' ? (
                <>
                  <FirstLoopGuide
                    project={project}
                    user={user}
                    members={people.data || []}
                    firstLoop={firstLoop}
                    isAdmin={isAdmin}
                    onOpenTask={open}
                    onManageMembers={() => setManage('members')}
                    onSample={() => {
                      setSample({ ...SAMPLE_REQUIREMENT });
                      setCreate(true);
                    }}
                  />
                  <ProjectOverview
                    project={project}
                    onOpen={open}
                    user={user}
                    query={stats}
                    onTasks={(scope = 'all') =>
                      navigate({ view: 'tasks', scope, page: null }, true)
                    }
                    onIterations={() => projectNavigate('iterations')}
                    onDocuments={() => projectNavigate('documents')}
                  />
                </>
              ) : view === 'github' ? (
                project ? (
                  <ProjectRepository
                    project={project}
                    admin={isAdmin}
                    onTasks={() => projectNavigate('tasks')}
                  />
                ) : (
                  <Empty description="项目不可访问" />
                )
              ) : view === 'iterations' ? (
                <Iterations
                  key={p}
                  projectId={p}
                  members={people.data || []}
                  onOpen={open}
                />
              ) : view === 'documents' ? (
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
                <div
                  className={
                    'requirement-workbench-layout ' +
                    (previewId ? 'has-preview' : '')
                  }
                >
                  <div className="task-panel">
                    {isProjectView && (
                      <h2 className="project-workbench-title">
                        {mode === 'board' ? '项目阶段看板' : '需求与交付'}
                      </h2>
                    )}
                    <div className="task-panel-controls">
                      <SavedViews
                        key={w}
                        workspaceId={w}
                        current={{
                          view: view === 'todos' ? 'todos' : 'tasks',
                          mode,
                          filters,
                          projectId: view === 'todos' ? null : p || null,
                        }}
                        onApply={(item) =>
                          navigate(
                            {
                              view: item.view,
                              mode: item.mode,
                              project: item.projectId,
                              ...Object.fromEntries(
                                filterKeys.map((key) => [
                                  key,
                                  item.filters[key] || null,
                                ]),
                              ),
                              task: null,
                              page: null,
                            },
                            true,
                          )
                        }
                      />
                      {isProjectView && (
                        <Tabs
                          className="task-scope-tabs"
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
                    </div>
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
                          placeholder="搜索编号、标题、内容…"
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
                        <Select
                          aria-label="需求排序"
                          value={filters.sort || 'updated'}
                          style={{ width: 150 }}
                          options={[
                            { value: 'updated', label: '最近更新优先' },
                            { value: 'due', label: '截止时间优先' },
                            { value: 'priority', label: '优先级从高到低' },
                          ]}
                          onChange={(value) => changeFilter('sort', value)}
                        />
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
                    <div
                      className="requirement-results"
                      aria-label="当前需求条件"
                    >
                      <span role="status">
                        {activeQuery.isPending
                          ? '正在读取需求…'
                          : activeQuery.error
                            ? '需求读取失败'
                            : `共 ${total} 条需求`}
                      </span>
                      <span className="muted">
                        {view === 'todos'
                          ? '当前团队 · 待我处理'
                          : `当前项目 · ${filterLabel('scope', filters.scope || (filters.status ? 'all' : 'active'))}`}
                      </span>
                      {Object.entries(filters)
                        .filter(([key]) => !['sort', 'scope'].includes(key))
                        .map(([key, value]) => (
                          <Tag
                            key={key}
                            closable
                            onClose={() =>
                              changeFilter(key as keyof TaskFilters, undefined)
                            }
                          >
                            {filterLabel(key, value!)}
                          </Tag>
                        ))}
                    </div>
                    {!activeQuery.isPending &&
                      total > 0 &&
                      page >
                        Math.ceil(total / (mode === 'board' ? 100 : 20)) && (
                        <Alert
                          type="info"
                          message="当前页已无数据，请返回第一页"
                          action={
                            <Button onClick={() => setPage(1)}>
                              返回第一页
                            </Button>
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
                    ) : isProjectView && mobileCards ? null : (
                      <Table
                        loading={
                          !!p &&
                          (view === 'todos' ? todos.isPending : tasks.isPending)
                        }
                        rowKey="id"
                        dataSource={rows}
                        className={
                          isProjectView ? 'project-desktop-table' : undefined
                        }
                        scroll={
                          isProjectView
                            ? { x: previewId ? 760 : 850 }
                            : undefined
                        }
                        rowClassName={(t: any) =>
                          t.id === previewId ? 'project-row-selected' : ''
                        }
                        onRow={(t: any) => ({
                          'data-task-id': t.id,
                          tabIndex: isProjectView ? 0 : undefined,
                          onKeyDown: (event) => {
                            if (
                              isProjectView &&
                              event.target === event.currentTarget &&
                              (event.key === 'Enter' || event.key === ' ')
                            ) {
                              event.preventDefault();
                              preview(t.id);
                            }
                          },
                          onClick: () =>
                            isProjectView ? preview(t.id) : open(t.id),
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
                                <button
                                  className="requirement-title-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    open(t.id);
                                  }}
                                >
                                  <strong>{t.data.title}</strong>
                                </button>
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
                                  {nextWork(t)}
                                </div>
                              </div>
                            ),
                          },
                          {
                            title: '阶段',
                            dataIndex: 'status',
                            render: (_, t: Task) => (
                              <Tag>{workflowLabel(t)}</Tag>
                            ),
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
                                {(
                                  (t as Task & { handlerIds?: string[] })
                                    .handlerIds || taskHandlers(t)
                                )
                                  .map(
                                    (id) =>
                                      listPeople?.find(
                                        (m: Member) => m.id === id,
                                      )?.name || '未指定',
                                  )
                                  .join('、') || '已结束'}
                              </span>
                            ),
                          },
                          {
                            title: '计划截止',
                            render: (_, t: Task) => (
                              <div>
                                <span>
                                  {t.data.dueAt?.slice(0, 10) || '未设置'}
                                </span>
                                <div>
                                  <RequirementSignal task={t} />
                                </div>
                              </div>
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
                    {isProjectView &&
                      mobileCards &&
                      mode === 'list' &&
                      !activeQuery.isPending &&
                      !activeQuery.error && (
                        <div className="project-mobile-cards">
                          {rows.length ? (
                            rows.map((t: Task) => (
                              <article
                                key={t.id}
                                data-task-id={t.id}
                                tabIndex={-1}
                              >
                                <span className="muted">
                                  CF-{String(t.number).padStart(3, '0')}
                                </span>
                                <button
                                  className="requirement-title-link"
                                  onClick={() => open(t.id)}
                                >
                                  <strong>{t.data.title}</strong>
                                </button>
                                <div>
                                  <Tag>{workflowLabel(t)}</Tag>
                                  <Tag>{t.data.priority}</Tag>
                                  <RequirementSignal task={t} />
                                </div>
                                <p className="task-sub">
                                  下一步：{nextWork(t)}
                                </p>
                                <p>
                                  {(
                                    (t as Task & { handlerIds?: string[] })
                                      .handlerIds || taskHandlers(t)
                                  )
                                    .map(
                                      (id: string) =>
                                        listPeople?.find(
                                          (m: Member) => m.id === id,
                                        )?.name || '未指定',
                                    )
                                    .join('、') || '已结束'}{' '}
                                  ·{' '}
                                  {t.data.dueAt
                                    ? t.data.dueAt.slice(0, 10)
                                    : '未设置截止日期'}
                                </p>
                                <Space>
                                  <Button onClick={() => preview(t.id)}>
                                    需求速览
                                  </Button>
                                  <QuickRequirementActions
                                    task={t}
                                    userId={user.id}
                                    readOnly={!!project?.archivedAt}
                                    admin={isAdmin}
                                    members={people.data || []}
                                  />
                                </Space>
                              </article>
                            ))
                          ) : (
                            <Empty description="暂无符合条件的需求" />
                          )}
                          <Pagination
                            current={page}
                            pageSize={20}
                            total={total}
                            onChange={setPage}
                            showSizeChanger={false}
                          />
                        </div>
                      )}
                  </div>
                  {previewId && (
                    <RequirementPreview
                      key={p + previewId}
                      id={previewId}
                      projectId={p}
                      members={people.data || []}
                      user={user}
                      position={
                        previewIndex < 0
                          ? '当前需求已离开筛选结果'
                          : `本页 ${previewIndex + 1} / ${rows.length}`
                      }
                      onPrevious={
                        previewIndex > 0
                          ? () => preview(rows[previewIndex - 1].id)
                          : undefined
                      }
                      onNext={
                        previewIndex >= 0 && previewIndex < rows.length - 1
                          ? () => preview(rows[previewIndex + 1].id)
                          : undefined
                      }
                      onClose={() => setSelection(undefined)}
                      onOpen={open}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </main>
      <TaskEditor
        userId={user.id}
        workspaceId={w}
        open={create}
        members={people.data || []}
        projectId={p}
        projectName={project?.name}
        sample={sample}
        onClose={() => {
          setCreate(false);
          setSample(null);
        }}
        onSave={async (v: any) => {
          const created = await mutate(
            `/projects/${v.projectId || p}/tasks`,
            'POST',
            v,
          );
          setSample(null);
          flushSync(() => setCreate(false));
          requestAnimationFrame(() =>
            navigate(
              { project: created.projectId, view: 'tasks', task: created.id },
              true,
            ),
          );
        }}
      />
      {activeTask && (
        <TaskDetail
          id={activeTask}
          user={user}
          onClose={() =>
            navigate({ task: null, taskTab: null, discussion: null })
          }
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

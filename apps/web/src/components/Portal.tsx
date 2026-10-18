import { TeamMembers } from './TeamMembers.js';
import { WorkDashboard } from './WorkDashboard.js';
import { TeamSwitcher } from './TeamSwitcher.js';
import { AccountMenu } from './AccountMenu.js';
import { Space, Checkbox, Popconfirm } from 'antd';
import { edition, editionHome } from '../edition.js';
import { EditionSwitch } from './EditionSwitch.js';
import { Competitions, StudentWriting, ProjectSettings } from '../pages.js';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Button,
  Empty,
  Input,
  Select,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  App,
} from 'antd';
import {
  TrophyOutlined,
  EditOutlined,
  AppstoreOutlined,
  HomeOutlined,
  FolderOutlined,
  TeamOutlined,
  BookOutlined,
  ArrowUpOutlined,
  StarOutlined,
  StarFilled,
  PlusOutlined,
  MenuOutlined,
  CloseOutlined,
  CheckSquareOutlined,
} from '@ant-design/icons';
import './portal.css';
import { BrandMark } from './BrandMark.js';
import { TeamAccess } from './TeamAccess.js';
import type { ProjectAttachment } from '../../../../packages/contracts/index.js';
import { QQBinding } from './QQBinding.js';

const enterpriseApps = [
  {
    id: 'work',
    name: '需求协作',
    category: '协作',
    description: '集中管理需求，协作推进开发、测试与交付。',
    icon: CheckSquareOutlined,
    color: 'blue',
  },
  {
    id: 'library',
    name: '知识库',
    category: '协作',
    description: '汇集项目文档与文件，让团队经验持续被使用。',
    icon: BookOutlined,
    color: 'teal',
  },
  {
    id: 'projects',
    name: '项目管理',
    category: '管理',
    description: '创建团队项目，明确目标、成员与交付进度。',
    icon: FolderOutlined,
    color: 'orange',
  },
  {
    id: 'members',
    name: '团队',
    category: '管理',
    description: '邀请伙伴加入团队，管理成员身份与项目角色。',
    icon: TeamOutlined,
    color: 'purple',
  },
];

export function Portal({ user, request, Documents, Management }: any) {
  const isStudent = edition.id === 'student';
  const apps = isStudent
    ? [
        {
          ...enterpriseApps[0],
          description: '记录课程、团队与创新项目需求，分工推进。',
        },
        {
          ...enterpriseApps[2],
          description: '管理课程项目、团队分工和交付进度。',
        },
        {
          id: 'competitions',
          name: '竞赛管理',
          category: '学习',
          description: '管理备赛、报名、提交、截止日期和成果记录。',
          icon: TrophyOutlined,
          color: 'orange',
        },
        {
          id: 'writing',
          name: '文书中心',
          category: '学习',
          description: '创建计划书、结题报告、答辩提纲和参赛材料草稿。',
          icon: EditOutlined,
          color: 'purple',
        },
        {
          ...enterpriseApps[1],
          description: '沉淀课程笔记、竞赛资料和项目经验。',
        },
        enterpriseApps[3],
      ]
    : enterpriseApps;
  const categories = isStudent ? ['协作', '学习', '管理'] : ['协作', '管理'];
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const requestedSection = params.get('section') || 'home';
  const section = [
    'home',
    'apps',
    'projects',
    'members',
    'library',
    ...(isStudent ? ['competitions', 'writing'] : []),
  ].includes(requestedSection)
    ? requestedSection
    : 'home';
  const favoriteKey = isStudent
    ? `huiliu-favorites-student-${user.id}`
    : `huiliu-favorites-${user.id}`;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [fileSource, setFileSource] = useState('all');
  const [showDeletedFiles, setShowDeletedFiles] = useState(false);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (!mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobile(false);
    };
    const narrow = window.matchMedia('(max-width: 760px)');
    const resize = () => {
      if (!narrow.matches) setMobile(false);
    };
    window.addEventListener('keydown', close);
    narrow.addEventListener('change', resize);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', close);
      narrow.removeEventListener('change', resize);
    };
  }, [mobile]);
  const [settingsProject, setSettingsProject] = useState<any>();
  const [manage, setManage] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(
        localStorage.getItem(favoriteKey) || '[]',
      );
      return Array.isArray(stored)
        ? [
            ...new Set(
              stored.filter(
                (id): id is string =>
                  typeof id === 'string' && apps.some((app) => app.id === id),
              ),
            ),
          ]
        : [];
    } catch {
      return [];
    }
  });
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => request('/workspaces'),
  });
  const wid = params.get('workspace') || workspaces.data?.[0]?.id || '';
  const projects = useQuery<any[]>({
    queryKey: ['projects', wid],
    queryFn: () => request(`/workspaces/${wid}/projects`),
    enabled: !!wid,
    refetchInterval: isStudent && section === 'competitions' ? 15000 : false,
  });
  const members = useQuery<any[]>({
    queryKey: ['workspaceMembers', wid],
    queryFn: () => request(`/workspaces/${wid}/members`),
    enabled: !!wid,
  });
  const project =
    projects.data?.find((p) => p.id === params.get('project')) ||
    projects.data?.find((p) => !p.archivedAt) ||
    projects.data?.[0];
  const pid = project?.id;
  const isAdmin = members.data?.some(
    (m) => m.id === user.id && m.role === 'ADMIN',
  );
  const files = useQuery<ProjectAttachment[]>({
    queryKey: ['libraryFiles', pid, showDeletedFiles],
    queryFn: () =>
      request(
        `/projects/${pid}/attachments?includeDeleted=${showDeletedFiles}`,
      ),
    enabled: !!pid && section === 'library',
  });
  const go = (next: string) => {
    setSearch('');
    setMobile(false);
    setParams({
      section: next,
      workspace: wid,
      ...(pid ? { project: pid } : {}),
    });
  };
  const openProject = (id?: string) =>
    setParams({
      app: 'work',
      workspace: wid,
      view: 'tasks',
      ...(id || pid ? { project: id || pid } : {}),
    });
  const launch = (id: string) => (id === 'work' ? openProject() : go(id));
  function favorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((x) => x !== id)
      : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem(favoriteKey, JSON.stringify(next));
    } catch {
      message.warning('收藏已更新，但浏览器无法保存，刷新后可能丢失');
    }
  }
  const title =
    (
      {
        home: '工作台',
        competitions: '竞赛管理',
        writing: '文书中心',
        apps: '应用',
        projects: '项目管理',
        members: '团队',
        library: '知识库',
      } as any
    )[section] || '工作台';
  const error = workspaces.error || projects.error || members.error;
  const visibleApps = apps.filter(
    (a) =>
      (category === '全部' || a.category === category) &&
      `${a.name}${a.description}`.includes(search),
  );
  const projectPicker = (
    <Select
      aria-label="选择项目"
      value={pid}
      style={{ minWidth: 220 }}
      options={projects.data?.map((p) => ({
        value: p.id,
        label: p.name + (p.archivedAt ? '（已归档）' : ''),
      }))}
      onChange={(id) => {
        const next = new URLSearchParams(params);
        next.set('project', id);
        next.delete('document');
        setParams(next);
      }}
    />
  );
  return (
    <div className={`portal ${mobile ? 'portal-open' : ''}`}>
      {mobile && (
        <button
          className="portal-scrim"
          aria-label="关闭导航遮罩"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className="portal-sidebar">
        <a
          className="portal-brand"
          href={editionHome}
          onClick={(e) => {
            e.preventDefault();
            go('home');
          }}
        >
          <BrandMark />
          <span>{isStudent ? '学生项目与竞赛空间' : '团队协作空间'}</span>
        </a>
        <EditionSwitch />
        <Button
          className="portal-close"
          type="text"
          aria-label="关闭导航"
          icon={<CloseOutlined />}
          onClick={() => setMobile(false)}
        />
        <TeamSwitcher
          teams={workspaces.data || []}
          value={wid}
          loading={workspaces.isPending}
          onChange={(id) => setParams({ section, workspace: id })}
        />
        <nav aria-label="首页导航">
          {[
            ['home', '工作台', HomeOutlined],
            ['projects', '项目管理', FolderOutlined],
            ['apps', '应用', AppstoreOutlined],
            ['members', '团队', TeamOutlined],
            ['library', '知识库', BookOutlined],
            ...(isStudent
              ? [
                  ['competitions', '竞赛管理', TrophyOutlined],
                  ['writing', '文书中心', EditOutlined],
                ]
              : []),
          ].map(([id, label, Icon]: any) => (
            <button
              key={id}
              aria-label={label}
              aria-current={section === id ? 'page' : undefined}
              className={section === id ? 'selected' : ''}
              onClick={() => go(id)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>
        <div className="portal-favorites">
          <small>收藏</small>
          {favorites.length === 0 ? (
            <p>收藏常用应用，快速开始协作</p>
          ) : (
            apps
              .filter((a) => favorites.includes(a.id))
              .map((a) => (
                <button key={a.id} onClick={() => launch(a.id)}>
                  {a.name}
                  <ArrowUpOutlined />
                </button>
              ))
          )}
        </div>
        <AccountMenu user={user} />
      </aside>
      <main className="portal-main" key={`${section}:${wid}`}>
        <header className="portal-header">
          <div>
            <Button
              className="portal-menu"
              aria-label="打开导航"
              icon={<MenuOutlined />}
              type="text"
              onClick={() => setMobile(true)}
            />
            <h1>{title}</h1>
          </div>
          <Input.Search
            aria-label="搜索当前页面"
            placeholder={
              section === 'writing'
                ? '搜索项目文档'
                : section === 'competitions'
                  ? '搜索竞赛名称或主办方'
                  : section === 'library'
                    ? '搜索文档或文件'
                    : section === 'members'
                      ? '搜索成员'
                      : section === 'projects'
                        ? '搜索项目'
                        : '搜索应用'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
        </header>
        {error && (
          <Alert
            type="error"
            showIcon
            message={(error as Error).message}
            action={
              <Button onClick={() => qc.invalidateQueries()}>重试</Button>
            }
          />
        )}
        {workspaces.isPending || (wid && projects.isPending) ? (
          <div className="portal-loading">
            <Spin />
          </div>
        ) : !wid ? (
          <Empty description="暂无团队，请使用邀请链接加入团队" />
        ) : (
          <>
            {(section === 'home' || section === 'apps') && (
              <>
                {section === 'home' && (
                  <section className="portal-welcome">
                    <span>
                      {isStudent
                        ? '从课程项目到竞赛成果，让成长有迹可循'
                        : '让协作发生，让成果汇流'}
                    </span>
                    <h2>{user.name}，欢迎回来。</h2>
                    <p>
                      {isStudent
                        ? '组织需求、推进项目、准备竞赛与文书，沉淀每次学习的成果。'
                        : '连接伙伴、推进项目、沉淀知识，从这里开始今天的工作。'}
                    </p>
                    <div>
                      <span>
                        <b>
                          {projects.data?.filter((p) => !p.archivedAt).length ||
                            0}
                        </b>{' '}
                        个进行中的项目
                      </span>
                      <span>
                        <b>
                          {members.isPending ? '—' : members.data?.length || 0}
                        </b>{' '}
                        位团队伙伴
                      </span>
                    </div>
                  </section>
                )}
                {section === 'home' && (
                  <WorkDashboard
                    workspaceId={wid}
                    onNavigate={(patch: any) =>
                      setParams({ app: 'work', workspace: wid, ...patch })
                    }
                    onSettings={setSettingsProject}
                    onPortal={(section: string) => go(section)}
                  />
                )}
                <section className="portal-apps">
                  <div className="portal-section-heading">
                    <h2>全部应用</h2>
                    <span>{visibleApps.length} 个应用</span>
                  </div>
                  <div
                    className="portal-tabs"
                    role="tablist"
                    aria-label="应用分类"
                  >
                    {['全部', ...categories].map((c) => (
                      <button
                        role="tab"
                        aria-selected={category === c}
                        className={category === c ? 'active' : ''}
                        key={c}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {categories.map((group) => {
                    const rows = visibleApps.filter(
                      (a) => a.category === group,
                    );
                    return (
                      rows.length > 0 && (
                        <section className="portal-app-group" key={group}>
                          <h3>{group}</h3>
                          <div className="portal-app-grid">
                            {rows.map((a) => (
                              <article key={a.id} className="portal-app-row">
                                <button
                                  className="portal-app-link"
                                  aria-label={`进入${a.name}`}
                                  onClick={() => launch(a.id)}
                                >
                                  <span
                                    className={`portal-app-icon ${a.color}`}
                                  >
                                    <a.icon />
                                  </span>
                                  <span>
                                    <strong>{a.name}</strong>
                                    <p>{a.description}</p>
                                  </span>
                                  <ArrowUpOutlined className="portal-launch-arrow" />
                                </button>
                                <button
                                  className="portal-star"
                                  aria-label={`${favorites.includes(a.id) ? '取消收藏' : '收藏'}${a.name}`}
                                  onClick={() => favorite(a.id)}
                                >
                                  {favorites.includes(a.id) ? (
                                    <StarFilled />
                                  ) : (
                                    <StarOutlined />
                                  )}
                                </button>
                              </article>
                            ))}
                          </div>
                        </section>
                      )
                    );
                  })}
                  {visibleApps.length === 0 && (
                    <Empty description="没有匹配的应用" />
                  )}
                </section>
              </>
            )}
            {section === 'projects' && (
              <section className="portal-content">
                <div className="portal-section-heading">
                  <p>围绕共同目标，管理团队的每一次交付。</p>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    aria-label="创建项目"
                    disabled={!isAdmin}
                    title={isAdmin ? undefined : '需要团队管理员权限'}
                    onClick={() => setManage('project')}
                  >
                    创建项目
                  </Button>
                </div>
                <div className="portal-project-grid">
                  {projects.data
                    ?.filter((p) =>
                      `${p.name}${p.description}`.includes(search),
                    )
                    .map((p) => (
                      <article key={p.id}>
                        <span className="portal-app-icon orange">
                          <FolderOutlined />
                        </span>
                        <Tag color={p.archivedAt ? 'default' : 'blue'}>
                          {p.archivedAt ? '已归档' : '进行中'}
                        </Tag>
                        <h2>{p.name}</h2>
                        <p>{p.description || '尚未填写项目介绍'}</p>
                        <div>
                          <Button onClick={() => openProject(p.id)}>
                            进入项目 →
                          </Button>
                          <Button
                            type="text"
                            disabled={!isAdmin}
                            onClick={() => {
                              const next = new URLSearchParams(params);
                              next.set('project', p.id);
                              next.delete('document');
                              setParams(next);
                              setSettingsProject(p);
                            }}
                          >
                            项目设置
                          </Button>
                        </div>
                      </article>
                    ))}
                </div>
                {projects.data?.filter((p) =>
                  `${p.name}${p.description}`.includes(search),
                ).length === 0 && <Empty description="暂无匹配的项目" />}
              </section>
            )}
            {section === 'members' && (
              <section className="portal-content">
                {!isStudent && (
                  <QQBinding key={wid} workspaceId={wid} request={request} />
                )}
                <div className="portal-section-heading">
                  <p>管理团队、成员与各团队独立的身份。</p>
                  <Space wrap className="team-toolbar-actions">
                    <TeamAccess
                      onSelect={(id) => {
                        setManage('');
                        setMobile(false);
                        setParams({ section: 'members', workspace: id });
                      }}
                    />
                  </Space>
                </div>
                <TeamMembers key={wid} wid={wid} search={search} />
              </section>
            )}
            {isStudent && section === 'competitions' && (
              <section className="portal-content">
                <div className="portal-section-heading">
                  <p>团队共享竞赛登记；上方选择新竞赛的所属项目。</p>
                  {projectPicker}
                </div>
                <Competitions
                  key={wid}
                  projectId={pid || ''}
                  workspaceId={wid}
                  search={search}
                />
              </section>
            )}
            {isStudent && section === 'writing' && (
              <section className="portal-content">
                <div className="portal-section-heading">
                  <p>组织材料，在真实项目成果上完成写作。</p>
                  {projectPicker}
                </div>
                {pid ? (
                  <StudentWriting
                    key={pid}
                    projectId={pid}
                    workspaceId={wid}
                    readOnly={!!project?.archivedAt}
                    search={search}
                  />
                ) : (
                  <Empty description="创建或加入项目后使用文书中心" />
                )}
              </section>
            )}
            {section === 'library' && (
              <section className="portal-content">
                <div className="portal-section-heading">
                  <p>保留方案、资料与经验，让每次协作都有迹可循。</p>
                  {projectPicker}
                </div>
                {!pid ? (
                  <Empty description="创建或加入项目后，即可使用知识库" />
                ) : (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      message={
                        project?.archivedAt
                          ? '项目已归档，文档和文件仅可查看与下载。'
                          : '资料按项目隔离；支持 TXT、Markdown 等文件上传，也可查看需求中的附件。纯文本附件请使用 UTF-8 编码。'
                      }
                    />
                    <Tabs
                      items={[
                        {
                          key: 'docs',
                          label: '项目文档',
                          children: (
                            <Documents
                              key={pid}
                              projectId={pid}
                              readOnly={!!project?.archivedAt}
                              search={search}
                            />
                          ),
                        },
                        {
                          key: 'files',
                          label: `文件库${files.data ? ` · ${files.data.length}` : ''}`,
                          children: (
                            <>
                              <Upload
                                showUploadList={false}
                                disabled={!!project?.archivedAt || uploading}
                                beforeUpload={async (file) => {
                                  setUploading(true);
                                  try {
                                    const form = new FormData();
                                    form.append('file', file);
                                    await request(
                                      `/projects/${pid}/attachments`,
                                      'POST',
                                      form,
                                    );
                                    await qc.invalidateQueries({
                                      queryKey: ['libraryFiles', pid],
                                    });
                                    setShowDeletedFiles(false);
                                    message.success('文件已上传');
                                  } catch (e) {
                                    message.error((e as Error).message);
                                  } finally {
                                    setUploading(false);
                                  }
                                  return false;
                                }}
                              >
                                <Button
                                  icon={<PlusOutlined />}
                                  loading={uploading}
                                  disabled={!!project?.archivedAt}
                                >
                                  上传文件
                                </Button>
                              </Upload>
                              <p className="muted">
                                支持图片、PDF、文本、Word、Excel 和
                                ZIP，单个文件不超过 20 MB。
                              </p>
                              {files.error && (
                                <Alert
                                  type="error"
                                  message={(files.error as Error).message}
                                  action={
                                    <Button onClick={() => files.refetch()}>
                                      重试
                                    </Button>
                                  }
                                />
                              )}
                              <Select
                                aria-label="文件来源"
                                value={fileSource}
                                onChange={setFileSource}
                                options={[
                                  { value: 'all', label: '全部文件' },
                                  { value: 'task', label: '需求附件' },
                                  { value: 'project', label: '独立文件' },
                                ]}
                                style={{ minWidth: 150, marginBottom: 16 }}
                              />
                              <Checkbox
                                checked={showDeletedFiles}
                                onChange={(e) =>
                                  setShowDeletedFiles(e.target.checked)
                                }
                                style={{ marginLeft: 12 }}
                              >
                                已删除文件
                              </Checkbox>
                              <Table
                                rowKey="id"
                                loading={files.isPending}
                                dataSource={files.data?.filter(
                                  (f) =>
                                    !!f.deletedAt === showDeletedFiles &&
                                    f.name
                                      .toLowerCase()
                                      .includes(search.toLowerCase()) &&
                                    (fileSource === 'all' ||
                                      (fileSource === 'task'
                                        ? !!f.taskId
                                        : !f.taskId)),
                                )}
                                columns={[
                                  { title: '文件名称', dataIndex: 'name' },
                                  {
                                    title: '来源',
                                    dataIndex: 'taskId',
                                    render: (id: string | null) =>
                                      id ? '需求附件' : '独立文件',
                                  },
                                  {
                                    title: '大小',
                                    dataIndex: 'size',
                                    render: (size: number) =>
                                      `${(size / 1024).toFixed(1)} KB`,
                                  },
                                  {
                                    title: '上传时间',
                                    dataIndex: 'createdAt',
                                    render: (v: string) =>
                                      new Date(v).toLocaleDateString('zh-CN'),
                                  },
                                  {
                                    title: '操作',
                                    render: (_: any, f: any) => (
                                      <>
                                        {!f.deletedAt && (
                                          <a
                                            className="action-link action-link-compact"
                                            href={`/api/v1/attachments/${f.id}/download`}
                                          >
                                            下载
                                          </a>
                                        )}
                                        {f.canDelete &&
                                          !project?.archivedAt && (
                                            <Popconfirm
                                              title={
                                                f.deletedAt
                                                  ? '恢复这个附件？'
                                                  : '删除这个附件？'
                                              }
                                              description={
                                                f.deletedAt
                                                  ? undefined
                                                  : '删除后可从已删除文件中恢复。'
                                              }
                                              okText="确认"
                                              cancelText="取消"
                                              onConfirm={async () => {
                                                try {
                                                  await request(
                                                    `/attachments/${f.id}${f.deletedAt ? '/restore' : ''}`,
                                                    f.deletedAt
                                                      ? 'POST'
                                                      : 'DELETE',
                                                    {},
                                                  );
                                                  await qc.invalidateQueries({
                                                    queryKey: [
                                                      'libraryFiles',
                                                      pid,
                                                    ],
                                                  });
                                                  await qc.invalidateQueries({
                                                    queryKey: ['attachments'],
                                                  });
                                                  message.success(
                                                    f.deletedAt
                                                      ? '附件已恢复'
                                                      : '附件已删除',
                                                  );
                                                } catch (e) {
                                                  message.error(
                                                    (e as Error).message,
                                                  );
                                                }
                                              }}
                                            >
                                              <Button
                                                size="small"
                                                danger={!f.deletedAt}
                                              >
                                                {f.deletedAt ? '恢复' : '删除'}
                                              </Button>
                                            </Popconfirm>
                                          )}
                                        {f.taskId && (
                                          <Button
                                            className="action-button"
                                            size="small"
                                            onClick={() =>
                                              setParams({
                                                task: f.taskId,
                                                workspace: wid,
                                                project: pid,
                                              })
                                            }
                                          >
                                            关联需求
                                          </Button>
                                        )}
                                      </>
                                    ),
                                  },
                                ]}
                                scroll={{ x: 560 }}
                              />
                            </>
                          ),
                        },
                      ]}
                    />
                  </>
                )}
              </section>
            )}
          </>
        )}
        <footer className="portal-footer">汇流 · 让想法成为共同的成果</footer>
      </main>
      {settingsProject && (
        <ProjectSettings
          project={settingsProject}
          workspaceId={wid}
          onClose={() => {
            setSettingsProject(undefined);
            qc.invalidateQueries();
          }}
        />
      )}
      {manage && (
        <Management
          kind={manage}
          wid={wid}
          pid={pid}
          project={project}
          onClose={() => setManage('')}
        />
      )}
    </div>
  );
}

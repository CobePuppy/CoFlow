import { useEffect, useState } from 'react';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  FileTextOutlined,
  GithubOutlined,
  BranchesOutlined,
  BarChartOutlined,
  TeamOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  BellOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { Button, Select, Tag } from 'antd';
import { BrandMark } from '../../shared/ui/BrandMark.js';
import { TeamSwitcher } from '../workspaces/components/TeamSwitcher.js';
import { AccountMenu } from '../settings/components/AccountMenu.js';
export const projectPages = {
  'project-overview': '项目概览',
  tasks: '需求与交付',
  iterations: '迭代与里程碑',
  documents: '项目文档',
  github: 'GitHub 仓库',
  forks: '项目分身',
  metrics: '交付统计',
  templates: '需求模板',
} as const;
const items = [
  ['project-overview', AppstoreOutlined],
  ['tasks', CheckCircleOutlined],
  ['iterations', BarChartOutlined],
  ['documents', FileTextOutlined],
  ['github', GithubOutlined],
  ['forks', BranchesOutlined],
  ['metrics', BarChartOutlined],
  ['templates', FileTextOutlined],
] as const;
function NavigationGroup({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(active);
  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);
  return (
    <details
      className="project-nav-group"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {label}
        <span className="project-group-indicator" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="project-nav-group-content">{children}</div>
    </details>
  );
}
export function ProjectSidebar({
  project,
  projects,
  teams,
  workspaceId,
  user,
  view,
  onNavigate,
  onProject,
  onTeam,
  onHome,
  onMembers,
  onSettings,
  todoCount,
  unreadCount,
  mobileNav,
  onCloseMobile,
}: any) {
  const resourceKeys = ['documents', 'github', 'forks', 'templates'];
  const navigationItem = ([key, Icon]: (typeof items)[number]) => (
    <button
      key={key}
      aria-label={projectPages[key]}
      className={'nav-item ' + (view === key ? 'active' : '')}
      aria-current={view === key ? 'page' : undefined}
      onClick={() => onNavigate(key)}
    >
      <Icon />
      {projectPages[key]}
    </button>
  );
  return (
    <>
      {mobileNav && (
        <Button
          className="mobile-nav-close"
          aria-label="关闭导航"
          type="text"
          icon={<CloseOutlined />}
          onClick={onCloseMobile}
        />
      )}
      <div className="project-brand">
        <BrandMark projectSpace />
      </div>
      <button
        aria-label="返回工作台"
        className="nav-item project-back"
        onClick={onHome}
      >
        <ArrowLeftOutlined />
        返回工作台
      </button>
      <div className="project-selector">
        <span>当前项目 {project?.archivedAt && <Tag>已归档</Tag>}</span>
        <Select
          aria-label="切换项目"
          value={project?.id}
          placeholder="选择项目"
          options={projects.map((p: any) => ({
            value: p.id,
            label: p.name + (p.archivedAt ? '（已归档）' : ''),
          }))}
          labelRender={() => (
            <span className="project-choice">
              <span className="project-choice-icon">
                <AppstoreOutlined />
              </span>
              <span className="project-choice-copy">
                <strong>{project?.name || '选择项目'}</strong>
                <small>
                  {project?.workflow === 'SIMPLE' ? '简易交付' : '标准交付'}
                </small>
              </span>
            </span>
          )}
          onChange={onProject}
        />
      </div>
      <nav aria-label="项目导航" className="project-navigation">
        <p className="project-nav-label">项目工作</p>
        {items
          .filter(([key]) =>
            ['project-overview', 'tasks', 'iterations'].includes(key),
          )
          .map(navigationItem)}
        <NavigationGroup label="项目资源" active={resourceKeys.includes(view)}>
          {items
            .filter(([key]) => resourceKeys.includes(key))
            .map(navigationItem)}
        </NavigationGroup>
        <NavigationGroup label="项目管理" active={view === 'metrics'}>
          {items.filter(([key]) => key === 'metrics').map(navigationItem)}
          <button
            aria-label="项目成员"
            className="nav-item"
            onClick={onMembers}
          >
            <TeamOutlined />
            项目成员
          </button>
          <button
            aria-label="项目设置"
            className="nav-item"
            onClick={onSettings}
          >
            <SettingOutlined />
            项目设置
          </button>
        </NavigationGroup>
      </nav>
      <div className="project-nav-footer">
        <div className="project-global-links">
          <p className="project-nav-label">个人事项</p>
          <button
            aria-label="澄清事项"
            className={'nav-item ' + (view === 'discussions' ? 'active' : '')}
            aria-current={view === 'discussions' ? 'page' : undefined}
            onClick={() => onNavigate('discussions')}
          >
            <CheckCircleOutlined />
            澄清事项
          </button>
          <button
            aria-label="待我处理"
            aria-current={view === 'todos' ? 'page' : undefined}
            className={'nav-item ' + (view === 'todos' ? 'active' : '')}
            onClick={() => onNavigate('todos')}
          >
            <CheckCircleOutlined />
            待我处理 <small>{todoCount}</small>
          </button>
          <button
            aria-label="站内通知"
            aria-current={view === 'notifications' ? 'page' : undefined}
            className={'nav-item ' + (view === 'notifications' ? 'active' : '')}
            onClick={() => onNavigate('notifications')}
          >
            <BellOutlined />
            站内通知 <small>{unreadCount}</small>
          </button>
        </div>
        <NavigationGroup label="切换团队" active={false}>
          <TeamSwitcher teams={teams} value={workspaceId} onChange={onTeam} />
        </NavigationGroup>
        <AccountMenu user={user} />
      </div>
    </>
  );
}

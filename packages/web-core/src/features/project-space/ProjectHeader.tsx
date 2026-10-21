import { Button, Space, Tag } from 'antd';
import { PlusOutlined, TeamOutlined } from '@ant-design/icons';
export function ProjectHeader({
  project,
  memberCount,
  onMembers,
  onCreate,
}: any) {
  return (
    <div className="page-heading project-heading">
      <div>
        <p className="project-eyebrow">
          项目空间 · {project?.workflow === 'SIMPLE' ? '简易协作' : '标准交付'}
        </p>
        <h1>{project?.name || '项目加载中'}</h1>
        {project?.archivedAt && <Tag>已归档 · 只读</Tag>}
        {project?.description && (
          <details className="project-description">
            <summary>
              {project.description.slice(0, 90)}
              {project.description.length > 90 ? '…' : ''}
            </summary>
            <p>{project.description}</p>
          </details>
        )}
      </div>
      <Space wrap>
        <Button
          aria-label="查看项目成员"
          icon={<TeamOutlined />}
          onClick={onMembers}
        >
          成员{memberCount !== undefined ? ' · ' + memberCount : ''}
        </Button>
        <Button
          type="primary"
          aria-label="新建需求"
          icon={<PlusOutlined />}
          disabled={!project || !!project.archivedAt}
          onClick={onCreate}
        >
          新建需求
        </Button>
      </Space>
    </div>
  );
}

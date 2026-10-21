import { Alert, Button, Card } from 'antd';
import { ProjectGitHubSettings } from '../github/components/GitHubDelivery.js';
export function ProjectRepository({ project, admin, onTasks }: any) {
  return (
    <Card title="GitHub 仓库">
      <p>为本项目设置默认仓库，需求可采用默认值并保存独立快照。</p>
      <ProjectGitHubSettings
        key={project.id}
        projectId={project.id}
        disabled={!admin || !!project.archivedAt}
      />
      <Alert
        type="info"
        showIcon
        message="需求中的代码与交付"
        description="文件读取、代码引用及PR检查仍按需求关联和个人GitHub权限执行。项目默认值变化不会替换已有需求的仓库快照。"
      />
      <Button style={{ marginTop: 16 }} onClick={onTasks}>
        进入需求查看代码引用与PR
      </Button>
    </Card>
  );
}

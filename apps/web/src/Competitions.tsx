import { FirstStepAgent, ProofLoop, Management } from './pages.js';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
} from 'antd';
import { api } from './runtime.js';
import {
  competitionStages,
  type Competition,
} from '../../../packages/contracts/index.js';

type SharedCompetition = Competition & {
  projectName: string;
  canAccessProject: boolean;
  readOnly: boolean;
  canManageMembers: boolean;
  archived: boolean;
};
export default function Competitions({
  projectId,
  workspaceId,
  search = '',
}: {
  projectId: string;
  workspaceId: string;
  search?: string;
}) {
  const query = useQuery<{
    items: SharedCompetition[];
    projects: { id: string; name: string; readOnly: boolean }[];
  }>({
    queryKey: ['competitions', 'workspace', workspaceId],
    queryFn: () => api(`/workspaces/${workspaceId}/competitions`),
    enabled: !!workspaceId,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [, setParams] = useSearchParams();
  const [managing, setManaging] = useState<SharedCompetition>();
  const [proof, setProof] = useState<Competition>();
  const [agent, setAgent] = useState<Competition>();
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const [edit, setEdit] = useState<SharedCompetition | 'new'>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!workspaceId) return <Empty description="加入团队后管理竞赛" />;
  if (query.isPending) return <Spin aria-label="正在加载竞赛" />;
  if (query.error)
    return (
      <Alert
        type="error"
        message={query.error.message}
        action={<Button onClick={() => query.refetch()}>重试加载竞赛</Button>}
      />
    );
  const items =
    query.data?.items
      .filter((item) => !onlyCurrent || item.projectId === projectId)
      .filter((item) =>
        `${item.name} ${item.organizer}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) || [];
  const current = query.data?.projects.find((p) => p.id === projectId);
  const canCreate = !!current && !current.readOnly;
  const modalReadOnly = edit === 'new' ? !canCreate : !!edit?.readOnly;
  return (
    <>
      <Alert
        type="info"
        showIcon
        message="竞赛登记在团队内共享，项目成果按成员权限协作"
        description="默认显示团队全部竞赛，标明所属项目；每15秒同步，也可手动刷新。登记新竞赛使用上方所选项目，项目成员可修改记录，团队管理员可维护全部竞赛登记及项目成员；访问项目材料仍需加入所属项目。"
      />
      <Button
        type="primary"
        style={{ margin: '16px 0' }}
        disabled={!canCreate}
        onClick={() => {
          setEdit('new');
          setError('');
        }}
      >
        登记竞赛
      </Button>
      <Space wrap style={{ margin: '0 12px 16px' }}>
        <Select
          aria-label="竞赛显示范围"
          value={onlyCurrent ? 'current' : 'team'}
          onChange={(v) => setOnlyCurrent(v === 'current')}
          options={[
            { value: 'team', label: '团队全部竞赛' },
            { value: 'current', label: '仅当前项目' },
          ]}
        />
        <Button
          onClick={async () => {
            await Promise.all([
              query.refetch(),
              qc.invalidateQueries({ queryKey: ['projects', workspaceId] }),
            ]);
          }}
          loading={query.isFetching}
        >
          刷新竞赛
        </Button>
      </Space>
      {!canCreate && (
        <p className="muted">
          可查看团队竞赛；加入一个未归档项目后可登记新竞赛。
        </p>
      )}
      {!items.length && (
        <Empty
          description={
            search ? '没有匹配的竞赛' : '暂无竞赛，先登记一场准备参加的比赛'
          }
        />
      )}
      <div className="document-grid competition-grid">
        {items.map((item) => (
          <Card
            key={item.id}
            title={item.name}
            extra={<Tag>{competitionStages[item.stage]}</Tag>}
          >
            <p>所属项目：{item.projectName}</p>
            {!item.canAccessProject && (
              <Tag>
                {item.canManageMembers
                  ? '管理员可维护登记 · 加入项目后访问材料'
                  : '尚未加入项目 · 竞赛登记只读'}
              </Tag>
            )}
            <p>{item.organizer || '主办方待补充'}</p>
            <p>截止日期：{item.deadline || '待确认'}（北京时间）</p>
            {item.outcome && <p>成果：{item.outcome}</p>}
            <Space wrap>
              {item.canManageMembers && (
                <Button onClick={() => setManaging(item)}>管理参赛成员</Button>
              )}
              <Button
                type="primary"
                disabled={!item.canAccessProject}
                onClick={() => setAgent(item)}
              >
                FirstStepAgent 分析竞赛
              </Button>
              <Button
                disabled={!item.canAccessProject}
                onClick={() => setProof(item)}
              >
                ProofLoop 成果验证
              </Button>
              {item.url && (
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  查看竞赛通知
                </a>
              )}
              <Button
                onClick={() => {
                  setEdit(item);
                  setError('');
                }}
              >
                {item.readOnly ? '查看竞赛' : '编辑竞赛'}
              </Button>
              <Button
                disabled={!item.canAccessProject}
                onClick={() =>
                  setParams({
                    section: 'writing',
                    workspace: workspaceId,
                    project: item.projectId,
                    competition: item.id,
                  })
                }
              >
                准备参赛材料
              </Button>
            </Space>
          </Card>
        ))}
      </div>
      {managing && (
        <Management
          kind="project-members"
          wid={workspaceId}
          pid={managing.projectId}
          project={{
            name: managing.projectName,
            archivedAt: managing.archived ? true : null,
          }}
          onClose={() => {
            setManaging(undefined);
            query.refetch();
          }}
        />
      )}
      {proof && (
        <ProofLoop competition={proof} onClose={() => setProof(undefined)} />
      )}
      {agent && (
        <FirstStepAgent
          competition={agent}
          readOnly={
            !!query.data?.items.find((item) => item.id === agent.id)?.readOnly
          }
          onClose={() => setAgent(undefined)}
        />
      )}
      {edit && (
        <Modal
          open
          title="竞赛信息"
          width={760}
          footer={null}
          destroyOnHidden
          maskClosable={!busy}
          keyboard={!busy}
          closable={!busy}
          onCancel={() => {
            if (!busy) setEdit(undefined);
          }}
        >
          <Form
            key={edit === 'new' ? 'new' : edit.id}
            layout="vertical"
            initialValues={edit === 'new' ? { stage: 'PREPARING' } : edit}
            disabled={busy || modalReadOnly}
            onFinish={async (values) => {
              setBusy(true);
              setError('');
              try {
                await api(
                  edit === 'new'
                    ? `/projects/${projectId}/competitions`
                    : `/competitions/${edit.id}`,
                  edit === 'new' ? 'POST' : 'PATCH',
                  {
                    ...values,
                    ...(edit === 'new'
                      ? {}
                      : { expectedVersion: edit.version }),
                  },
                );
                setEdit(undefined);
                await qc.invalidateQueries({
                  queryKey: ['competitions'],
                });
                message.success('竞赛记录已保存');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && <Alert type="error" message={error} />}
            <Form.Item
              name="name"
              label="竞赛名称"
              rules={[{ required: true, whitespace: true }, { max: 200 }]}
            >
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item name="organizer" label="主办方">
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item name="url" label="竞赛通知网址">
              <Input placeholder="https://..." />
            </Form.Item>
            <Form.Item name="deadline" label="提交截止日期">
              <Input type="date" />
            </Form.Item>
            <Form.Item name="stage" label="竞赛阶段">
              <Select
                aria-label="竞赛阶段"
                options={Object.entries(competitionStages).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </Form.Item>
            <Form.Item name="outcome" label="成果与获奖记录">
              <Input.TextArea maxLength={2000} rows={2} />
            </Form.Item>
            <Form.Item name="notes" label="要求与准备备注">
              <Input.TextArea maxLength={20000} rows={4} />
            </Form.Item>
            {!modalReadOnly && (
              <Button type="primary" htmlType="submit" loading={busy}>
                保存竞赛
              </Button>
            )}
          </Form>
        </Modal>
      )}
    </>
  );
}

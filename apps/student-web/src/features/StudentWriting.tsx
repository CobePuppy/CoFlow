import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Select, Space } from 'antd';
import { api } from '@coflow/web-core/shared/api/runtime';
import { studentDraft, studentDraftKinds } from './student-drafts.js';
import type { Competition } from '@coflow/contracts/index.js';
import { Documents } from '@coflow/web-core/app/pages';
export default function StudentWriting({
  projectId,
  workspaceId,
  readOnly,
  search = '',
}: {
  projectId: string;
  workspaceId: string;
  readOnly: boolean;
  search?: string;
}) {
  const [params, setParams] = useSearchParams();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [kind, setKind] = useState<keyof typeof studentDraftKinds>('proposal'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const competitions = useQuery<{ items: Competition[] }>({
    queryKey: ['competitions', projectId],
    queryFn: () => api(`/projects/${projectId}/competitions`),
    enabled: !!projectId,
  });
  const competition = competitions.data?.items.find(
    (item) => item.id === params.get('competition'),
  );
  return (
    <>
      <Alert
        type="info"
        showIcon
        message="文书中心：用结构草稿开始写作，在项目文档中协作修订"
        description={
          readOnly
            ? '项目已归档，文书仅可查看。'
            : '包含项目计划书、结题报告、答辩提纲和参赛材料说明。生成的是待填写的结构，不包含虚构结果或参考文献。'
        }
      />
      <Space wrap style={{ margin: '16px 0' }}>
        <Select
          aria-label="文书类型"
          value={kind}
          onChange={setKind}
          options={Object.entries(studentDraftKinds).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Select
          aria-label="关联竞赛背景"
          placeholder="通用项目文书"
          allowClear
          loading={competitions.isFetching}
          value={competition?.id}
          style={{ minWidth: 200 }}
          onChange={(value) => {
            const next = new URLSearchParams(params);
            if (value) next.set('competition', value);
            else next.delete('competition');
            setParams(next);
          }}
          options={competitions.data?.items.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />
        <Button
          type="primary"
          loading={busy}
          disabled={!projectId || readOnly}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const context = competition?.name || '项目';
              const document = await api(
                `/projects/${projectId}/documents`,
                'POST',
                {
                  title: `${context.slice(0, 120)} · ${studentDraftKinds[kind]}`,
                  content: studentDraft(kind, context),
                  taskIds: [],
                },
              );
              await qc.invalidateQueries({
                queryKey: ['documents', projectId],
              });
              setParams({
                section: 'writing',
                workspace: workspaceId,
                project: projectId,
                document: document.id,
                ...(competition ? { competition: competition.id } : {}),
              });
              message.success('文书结构草稿已创建，请补充真实内容');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          创建文书草稿
        </Button>
      </Space>
      {competitions.error && (
        <Alert
          type="error"
          message="竞赛背景加载失败"
          action={<Button onClick={() => competitions.refetch()}>重试</Button>}
        />
      )}
      {error && <Alert type="error" message={error} />}
      <Documents
        key={projectId}
        projectId={projectId}
        readOnly={readOnly}
        search={search}
      />
    </>
  );
}

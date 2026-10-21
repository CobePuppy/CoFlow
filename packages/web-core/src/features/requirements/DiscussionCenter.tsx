import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Pagination,
  Select,
  Space,
  Spin,
  Tag,
} from 'antd';
import { useData } from '../../shared/api/runtime.js';
import { patchSearchParams } from '../../shared/lib/navigation.js';
export default function DiscussionCenter({
  workspaceId,
  onOpen,
}: {
  workspaceId: string;
  onOpen: (id: string, discussion?: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const scope = ['mine', 'all', 'created'].includes(
    params.get('discussionScope') || '',
  )
    ? params.get('discussionScope')!
    : 'mine';
  const state = ['OPEN', 'RESOLVED', 'ALL'].includes(
    params.get('discussionState') || '',
  )
    ? params.get('discussionState')!
    : 'OPEN';
  const raw = Number(params.get('discussionPage') || 1),
    page = Number.isInteger(raw) && raw > 0 && raw <= 1000000 ? raw : 1;
  const q = params.get('discussionQ') || '',
    overdue = params.get('discussionOverdue') === 'true';
  const [search, setSearch] = useState(q);
  const query = useData(
    ['discussionCenter', workspaceId, scope, state, q, overdue, page],
    '/workspaces/' +
      workspaceId +
      '/discussions?' +
      new URLSearchParams({
        scope,
        state,
        q,
        overdue: String(overdue),
        page: String(page),
        pageSize: '20',
      }),
    !!workspaceId,
    15000,
  );
  const nav = (patch: Record<string, string | null>) =>
    setParams(patchSearchParams(params, patch));
  return (
    <section aria-label="澄清事项中心">
      <p className="muted">
        汇总当前团队可访问的未归档项目；已验收需求中的未解决问题仍保留，回收站需求不列入。
      </p>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          aria-label="澄清负责人筛选"
          value={scope}
          onChange={(v) => nav({ discussionScope: v, discussionPage: null })}
          options={[
            { value: 'mine', label: '待我跟进' },
            { value: 'created', label: '我提出的' },
            { value: 'all', label: '全部可见问题' },
          ]}
          style={{ width: 170 }}
        />
        <Select
          aria-label="问题状态筛选"
          value={state}
          onChange={(v) => nav({ discussionState: v, discussionPage: null })}
          options={[
            { value: 'OPEN', label: '未解决' },
            { value: 'RESOLVED', label: '已解决' },
            { value: 'ALL', label: '全部状态' },
          ]}
          style={{ width: 130 }}
        />
        <Select
          aria-label="问题逾期筛选"
          value={String(overdue)}
          onChange={(v) => nav({ discussionOverdue: v, discussionPage: null })}
          options={[
            { value: 'false', label: '不限截止日期' },
            { value: 'true', label: '仅逾期未解决' },
          ]}
          style={{ width: 170 }}
        />
        <Input.Search
          aria-label="搜索澄清问题"
          placeholder="搜索问题、需求标题或CF编号"
          value={search}
          maxLength={200}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(v) =>
            nav({ discussionQ: v || null, discussionPage: null })
          }
          allowClear
          style={{ width: 290, maxWidth: '100%' }}
        />
      </Space>
      {query.isPending ? (
        <Spin />
      ) : query.error ? (
        <Alert
          type="error"
          message={query.error.message}
          action={<Button onClick={() => query.refetch()}>重试加载</Button>}
        />
      ) : (
        <>
          <p>共 {query.data?.total || 0} 条问题</p>
          {query.data?.items.length ? (
            query.data.items.map((item: any) => (
              <Card
                key={item.id}
                size="small"
                style={{ marginBottom: 12 }}
                title={
                  <Space wrap>
                    <span>
                      CF-{String(item.number).padStart(3, '0')} ·{' '}
                      {item.taskTitle}
                    </span>
                    <Tag>{item.resolved ? '已解决' : '待解决'}</Tag>
                    {item.overdue && <Tag color="red">逾期</Tag>}
                    {item.needsReview && <Tag color="orange">旧版本需核对</Tag>}
                  </Space>
                }
              >
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {item.body}
                </p>
                <p className="muted">
                  {item.projectName} · 跟进人：
                  {item.assigneeId
                    ? item.assigneeActive
                      ? item.assigneeName
                      : '已移出项目，待调整'
                    : '待分配'}{' '}
                  · 截止：{item.dueAt || '未设置'} · 提出人：
                  {item.createdByName}
                </p>
                <Button onClick={() => onOpen(item.taskId, item.id)}>
                  查看并跟进
                </Button>
              </Card>
            ))
          ) : (
            <Empty description="暂无符合条件的澄清问题" />
          )}
          {page > Math.max(1, Math.ceil((query.data?.total || 0) / 20)) && (
            <Button onClick={() => nav({ discussionPage: null })}>
              返回第一页
            </Button>
          )}
          <Pagination
            current={page}
            pageSize={20}
            total={query.data?.total || 0}
            showSizeChanger={false}
            responsive
            onChange={(v) => nav({ discussionPage: String(v) })}
          />
        </>
      )}
    </section>
  );
}

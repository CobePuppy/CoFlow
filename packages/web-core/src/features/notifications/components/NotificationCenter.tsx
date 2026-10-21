import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Pagination,
  Select,
  Skeleton,
  Space,
  Tag,
} from 'antd';
import { api, useData } from '../../../shared/api/runtime.js';

type Notice = {
  id: string;
  taskId: string;
  discussionId?: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
};
export function NotificationCenter({
  workspaceId,
  onOpen,
}: {
  workspaceId: string;
  onOpen: (id: string, discussion?: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get('notificationPage') || 1);
  const page =
    Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 1000000
      ? rawPage
      : 1;
  const unread = params.get('unread') === 'true';
  const query = useData(
    ['notifications', workspaceId, page, unread],
    `/notifications?${new URLSearchParams({ workspace: workspaceId, page: String(page), pageSize: '20', unread: String(unread) })}`,
    !!workspaceId,
    15000,
  );
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const items: Notice[] = query.data?.items || [];
  function navigate(nextPage: number, onlyUnread = unread) {
    const next = new URLSearchParams(params);
    next.set('notificationPage', String(nextPage));
    next.set('unread', String(onlyUnread));
    setParams(next);
  }
  useEffect(() => setSelected([]), [workspaceId, page, unread]);
  useEffect(() => {
    if (!query.data) return;
    setSelected((old) =>
      old.filter((id) =>
        query.data.items.some((n: Notice) => n.id === id && !n.readAt),
      ),
    );
    const last = Math.max(1, Math.ceil(query.data.total / 20));
    if (page > last) navigate(last);
  }, [query.data]);
  async function mark(ids?: string[]) {
    setBusy(true);
    try {
      await api('/notifications/read', 'POST', {
        workspaceId,
        ...(ids ? { ids } : { all: true }),
      });
      setSelected([]);
      await qc.invalidateQueries({ queryKey: ['notifications', workspaceId] });
      if (!active.current) return false;
      message.success('通知已标为已读');
      return true;
    } catch (e) {
      message.error((e as Error).message);
      void query.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  }
  const unreadIds = items.filter((n) => !n.readAt).map((n) => n.id);
  return (
    <Card className="notification-center">
      <div className="notification-toolbar">
        <Space wrap>
          <Select
            aria-label="通知筛选"
            value={unread ? 'unread' : 'all'}
            disabled={busy}
            options={[
              { value: 'all', label: '全部通知' },
              { value: 'unread', label: '仅看未读' },
            ]}
            onChange={(value) => navigate(1, value === 'unread')}
          />
          <span>当前团队未读 {query.data?.unreadCount ?? '—'} 条</span>
        </Space>
        <Space wrap>
          <Button
            loading={busy}
            disabled={!selected.length}
            onClick={() => mark(selected)}
          >
            选中已读{selected.length ? `（${selected.length}）` : ''}
          </Button>
          <Button
            disabled={busy || !query.data?.unreadCount}
            onClick={() =>
              modal.confirm({
                title: '将当前团队全部通知标为已读？',
                content: '仅处理你本人仍有权限访问的通知，其他团队保持不变。',
                okText: '全部标为已读',
                cancelText: '取消',
                onOk: async () => {
                  if (!(await mark())) throw new Error('操作失败，请重试');
                },
              })
            }
          >
            当前团队全部已读
          </Button>
        </Space>
      </div>
      {query.isPending ? (
        <Skeleton active />
      ) : query.error ? (
        <Alert
          type="error"
          message={query.error.message}
          action={<Button onClick={() => query.refetch()}>重试加载通知</Button>}
        />
      ) : (
        <>
          {!!unreadIds.length && (
            <Checkbox
              checked={unreadIds.every((id) => selected.includes(id))}
              indeterminate={
                selected.length > 0 && selected.length < unreadIds.length
              }
              disabled={busy}
              onChange={(e) => setSelected(e.target.checked ? unreadIds : [])}
            >
              选择本页未读通知
            </Checkbox>
          )}
          {items.length ? (
            items.map((n) => (
              <div className="notification notice-row" key={n.id}>
                <Checkbox
                  aria-label={`选择通知：${n.message}`}
                  checked={selected.includes(n.id)}
                  disabled={busy || !!n.readAt}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, n.id]
                        : old.filter((id) => id !== n.id),
                    )
                  }
                />
                <button
                  className="notice-open"
                  disabled={busy}
                  onClick={async () => {
                    if (n.readAt || (await mark([n.id])))
                      onOpen(n.taskId, n.discussionId || undefined);
                  }}
                >
                  <span>{n.message}</span>
                  <small>
                    {new Date(n.createdAt).toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                    })}
                  </small>
                </button>
                {!n.readAt && <Tag>未读</Tag>}
              </div>
            ))
          ) : (
            <Empty
              description={unread ? '当前团队暂无未读通知' : '当前团队暂无通知'}
            />
          )}
          <Pagination
            current={page}
            pageSize={20}
            total={query.data?.total || 0}
            showSizeChanger={false}
            simple
            responsive
            onChange={(p) => navigate(p)}
            showTotal={(total) => `共 ${total} 条`}
          />
        </>
      )}
    </Card>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Tag,
} from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { api, useData } from '../../../shared/api/runtime.js';
import type {
  SavedView,
  SavedViewContent,
} from '@coflow/contracts/collaboration.js';

export function SavedViews({
  workspaceId,
  current,
  onApply,
}: {
  workspaceId: string;
  current: Omit<SavedViewContent, 'name'>;
  onApply: (item: SavedView) => void;
}) {
  const query = useData(
    ['savedViews', workspaceId],
    `/workspaces/${workspaceId}/views`,
    !!workspaceId,
  );
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<SavedView | 'new' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const items: SavedView[] = query.data?.items || [];
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ['savedViews', workspaceId] });
  const canSave =
    !!workspaceId && (current.view === 'todos' || !!current.projectId);
  async function apply(item: SavedView) {
    setBusy(true);
    try {
      // Stored preferences do not grant continued access to a project.
      if (item.projectId) {
        const project = await api(`/projects/${item.projectId}`);
        if (project.workspaceId !== workspaceId)
          throw new Error('视图项目不属于当前团队');
      }
      if (!active.current) return;
      onApply(item);
      setManage(false);
    } catch (e) {
      message.error((e as Error).message);
      void refresh();
    } finally {
      setBusy(false);
    }
  }
  async function update(item: SavedView) {
    setBusy(true);
    try {
      await api(`/workspaces/${workspaceId}/views/${item.id}`, 'PATCH', {
        name: item.name,
        ...current,
        expectedVersion: item.version,
      });
      await refresh();
      message.success('已更新为当前筛选条件');
    } catch (e) {
      message.error((e as Error).message);
      void refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="saved-views" aria-label="常用视图">
      <Space wrap>
        <Select
          aria-label="使用常用视图"
          placeholder="使用常用视图"
          value={null}
          style={{ width: 200 }}
          loading={query.isFetching}
          disabled={busy}
          options={items.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(id) => {
            const item = items.find((x) => x.id === id);
            if (item) void apply(item);
          }}
        />
        <Button
          disabled={busy || !canSave}
          onClick={() => {
            setEditing('new');
            setName('');
            setError('');
          }}
        >
          保存当前视图
        </Button>
        <Button disabled={busy || !workspaceId} onClick={() => setManage(true)}>
          管理视图
        </Button>
        <span className="muted">仅自己可见，按团队保存</span>
      </Space>
      {query.error && (
        <Alert
          type="error"
          message="常用视图加载失败"
          action={<Button onClick={() => query.refetch()}>重试</Button>}
        />
      )}
      <Modal
        open={manage}
        title="管理常用视图"
        footer={null}
        onCancel={() => !busy && setManage(false)}
      >
        {query.isPending ? (
          <Skeleton active />
        ) : query.error ? (
          <Alert
            type="error"
            message="常用视图加载失败"
            action={<Button onClick={() => query.refetch()}>重试</Button>}
          />
        ) : items.length ? (
          items.map((item) => (
            <div className="saved-view-row" key={item.id}>
              <Space wrap>
                <strong>{item.name}</strong>
                <Tag>{item.view === 'todos' ? '团队待办' : '项目需求'}</Tag>
                <Tag>{item.mode === 'board' ? '看板' : '列表'}</Tag>
              </Space>
              <Space wrap>
                <Button disabled={busy} onClick={() => apply(item)}>
                  使用
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setEditing(item);
                    setName(item.name);
                    setError('');
                  }}
                >
                  重命名
                </Button>
                <Button
                  disabled={busy || !canSave}
                  onClick={() =>
                    modal.confirm({
                      title: `更新“${item.name}”的条件？`,
                      content:
                        '使用当前页面的项目、筛选条件和列表/看板方式替换，名称保持不变。',
                      onOk: () => update(item),
                    })
                  }
                >
                  更新条件
                </Button>
                <Button
                  danger
                  aria-label={`删除视图：${item.name}`}
                  disabled={busy}
                  onClick={() =>
                    modal.confirm({
                      title: `删除视图“${item.name}”？`,
                      content: '只删除个人视图，不影响任何需求。',
                      onOk: async () => {
                        setBusy(true);
                        try {
                          await api(
                            `/workspaces/${workspaceId}/views/${item.id}`,
                            'DELETE',
                            { expectedVersion: item.version },
                          );
                          await refresh();
                          message.success('视图已删除');
                        } catch (e) {
                          message.error((e as Error).message);
                          void refresh();
                          throw e;
                        } finally {
                          setBusy(false);
                        }
                      },
                    })
                  }
                >
                  删除
                </Button>
              </Space>
            </div>
          ))
        ) : (
          <Empty description="尚未保存常用视图" />
        )}
      </Modal>
      <Modal
        open={!!editing}
        title={editing === 'new' ? '保存当前视图' : '重命名视图'}
        okText="保存视图"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => !busy && setEditing(null)}
        onOk={async () => {
          if (!name.trim()) {
            setError('请输入视图名称');
            return;
          }
          if (!editing) return;
          setBusy(true);
          setError('');
          try {
            const content =
              editing === 'new'
                ? current
                : {
                    view: editing.view,
                    mode: editing.mode,
                    projectId: editing.projectId,
                    filters: editing.filters,
                  };
            await api(
              `/workspaces/${workspaceId}/views${editing === 'new' ? '' : '/' + editing.id}`,
              editing === 'new' ? 'POST' : 'PATCH',
              {
                ...content,
                name: name.trim(),
                ...(editing === 'new'
                  ? {}
                  : { expectedVersion: editing.version }),
              },
            );
            await refresh();
            setEditing(null);
            message.success('常用视图已保存');
          } catch (e) {
            setError((e as Error).message);
            if ((e as any).status === 409 && editing !== 'new') {
              const latest = await query.refetch();
              const item = latest.data?.items?.find(
                (v: SavedView) => v.id === editing.id,
              );
              if (item) {
                setEditing(item);
                setError(
                  '视图已被更新，已载入最新条件；名称输入已保留，请核对后重新保存。',
                );
              }
            } else void refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="saved-view-name">视图名称</label>
        <Input
          id="saved-view-name"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="muted">保存筛选和显示方式，不保存页码或需求内容。</p>
        {error && <Alert type="error" message={error} />}
      </Modal>
    </section>
  );
}

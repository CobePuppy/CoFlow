import { withEditionPath } from '../../../app/edition.js';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
} from 'antd';
import { api } from '../../../shared/api/runtime.js';
import { invalidateTaskQueries } from '../../../shared/api/query-invalidation.js';
import { documentUrl } from './DocumentLinks.js';
type Candidate = {
  id: string;
  name: string;
  version: number;
  scope: string;
  kind: string;
  contentVersion?: number;
};
type Resource = {
  kind: string;
  fileVersion: number | null;
  canChangeFileMode?: boolean;
  latestContentVersion?: number;
  latestSourceVersion?: number;
  id: string;
  title: string;
  currentTitle: string | null;
  sourceVersion: number;
  currentVersion: number | null;
  status: string;
  scope: string;
  canManage: boolean;
  documentId?: string;
};
const scopes: Record<string, string> = {
  TEAM: '团队文件',
  PERSONAL: '个人文件（已授权本项目）',
  PROJECT: '项目资料',
  DOCUMENT: '项目文档',
  ATTACHMENT: '项目文件',
};
export function TaskResources({ task }: { task: any }) {
  const qc = useQueryClient(),
    { message } = App.useApp();
  const [open, setOpen] = useState(false),
    [scope, setScope] = useState('TEAM'),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Candidate>(),
    [share, setShare] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const refs = useQuery<Resource[]>({
    queryKey: ['taskResources', task.id],
    queryFn: () => api('/tasks/' + task.id + '/resources'),
  });
  const candidates = useQuery<{ items: Candidate[]; total: number }>({
    queryKey: ['resourceCandidates', task.id, scope, q, page],
    enabled: open,
    queryFn: ({ signal }) =>
      api(
        '/tasks/' +
          task.id +
          '/resources/candidates?' +
          new URLSearchParams({ scope, q, page: String(page), pageSize: '10' }),
        'GET',
        undefined,
        undefined,
        signal,
      ),
  });
  const [pinMode, setPinMode] = useState('LATEST'),
    [pinNumber, setPinNumber] = useState(1),
    [modeRef, setModeRef] = useState<Resource>();
  const [openedVersion, setOpenedVersion] = useState(task.version);
  const readOnly = task.readOnly || task.deletedAt;
  async function mutate(path: string, method: string, data: any) {
    setBusy(true);
    setError('');
    try {
      await api(path, method, data);
      await invalidateTaskQueries(qc);
      return true;
    } catch (e) {
      setError((e as Error).message);
      await qc.invalidateQueries({ queryKey: ['task', task.id] });
      await refs.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      title="引用资料"
      size="small"
      extra={
        !readOnly && (
          <Button
            onClick={() => {
              setOpen(true);
              setOpenedVersion(task.version);
              setSelected(undefined);
              setShare(false);
              setError('');
            }}
          >
            引用已有资料
          </Button>
        )
      }
    >
      <p className="muted">
        引用保留原资料归属；显示引用时版本，资料更新后需核对并确认。
      </p>
      {error && !open && <Alert type="error" message={error} />}{' '}
      {refs.isPending ? (
        <Spin />
      ) : refs.error ? (
        <Alert
          type="error"
          message="引用资料加载失败"
          action={<Button onClick={() => refs.refetch()}>重试</Button>}
        />
      ) : !refs.data?.length ? (
        <Empty description="尚未引用资料" />
      ) : (
        refs.data.map((ref) => (
          <article
            key={ref.id}
            style={{
              padding: '12px 0',
              borderBottom: '1px solid #eee',
              overflowWrap: 'anywhere',
            }}
          >
            <strong>{ref.title}</strong>
            <p>
              <Tag>{scopes[ref.scope]}</Tag>
              <span>引用版本 v{ref.sourceVersion}</span>
              {ref.kind === 'FILE' && (
                <Tag>
                  {ref.fileVersion
                    ? '固定内容 V' + ref.fileVersion
                    : '跟随最新版 · 内容 V' + (ref.latestContentVersion || '—')}
                </Tag>
              )}{' '}
              <Tag
                color={
                  ref.status === 'UPDATED'
                    ? 'orange'
                    : ref.status === 'UNAVAILABLE'
                      ? 'red'
                      : 'default'
                }
              >
                {ref.status === 'UPDATED'
                  ? '资料有更新'
                  : ref.status === 'UNAVAILABLE'
                    ? '资料已失效'
                    : '版本一致'}
              </Tag>
            </p>
            {ref.status === 'UPDATED' && (
              <p>
                当前：{ref.currentTitle} · v{ref.currentVersion}
                ，请先查看并核对。
              </p>
            )}
            <Space wrap>
              {ref.status !== 'UNAVAILABLE' &&
                (ref.documentId ? (
                  <Button
                    href={withEditionPath(
                      documentUrl({
                        id: ref.documentId,
                        projectId: task.projectId,
                        workspaceId: task.workspaceId,
                      }),
                    )}
                  >
                    查看文档
                  </Button>
                ) : (
                  <Button
                    href={
                      '/api/v1/tasks/' +
                      task.id +
                      '/resources/' +
                      ref.id +
                      '/download'
                    }
                  >
                    {ref.fileVersion ? '下载固定版本' : '下载当前文件'}
                  </Button>
                ))}
              {ref.canManage && !readOnly && (
                <>
                  {ref.kind === 'FILE' &&
                    ref.canChangeFileMode &&
                    ref.status !== 'UNAVAILABLE' && (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setModeRef(ref);
                          setOpenedVersion(task.version);
                          setPinMode(ref.fileVersion ? 'FIXED' : 'LATEST');
                          setPinNumber(
                            ref.fileVersion || ref.latestContentVersion || 1,
                          );
                          setError('');
                        }}
                      >
                        调整引用方式
                      </Button>
                    )}
                  {ref.status === 'UPDATED' && (
                    <Popconfirm
                      title="已核对当前资料，更新引用版本？"
                      okText="确认更新引用"
                      onConfirm={async () => {
                        await mutate(
                          '/tasks/' +
                            task.id +
                            '/resources/' +
                            ref.id +
                            '/refresh',
                          'POST',
                          {
                            expectedVersion: task.version,
                            sourceVersion: ref.currentVersion,
                          },
                        );
                      }}
                    >
                      <Button disabled={busy}>确认使用当前版本</Button>
                    </Popconfirm>
                  )}
                  <Popconfirm
                    title="解除资料引用？"
                    okText="确认解除引用"
                    description="原资料保留；个人文件通过本需求授予的访问将停止。"
                    onConfirm={async () => {
                      await mutate(
                        '/tasks/' + task.id + '/resources/' + ref.id,
                        'DELETE',
                        {
                          expectedVersion: task.version,
                        },
                      );
                    }}
                  >
                    <Button disabled={busy}>解除引用</Button>
                  </Popconfirm>
                </>
              )}
            </Space>
          </article>
        ))
      )}
      <Modal
        open={open}
        title="引用已有资料"
        width={760}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        maskClosable={!busy}
        keyboard={!busy}
        closable={!busy}
        okText="确认引用"
        confirmLoading={busy}
        okButtonProps={{
          disabled: !selected || (scope === 'PERSONAL' && !share),
        }}
        onOk={async () => {
          if (!selected) return;
          if (
            await mutate('/tasks/' + task.id + '/resources', 'POST', {
              expectedVersion: openedVersion,
              kind: selected.kind,
              sourceId: selected.id,
              sourceVersion: selected.version,
              sharePersonal: scope === 'PERSONAL' && share,
              ...(selected.kind === 'FILE'
                ? { fileVersion: pinMode === 'FIXED' ? pinNumber : null }
                : {}),
            })
          ) {
            setOpen(false);
            message.success('资料已引用');
          }
        }}
      >
        <Space wrap>
          <Select
            aria-label="引用资料来源"
            value={scope}
            disabled={busy}
            onChange={(v) => {
              setScope(v);
              setPage(1);
              setSelected(undefined);
              setShare(false);
              setError('');
            }}
            options={[
              { value: 'TEAM', label: '团队文件' },
              { value: 'PERSONAL', label: '我的个人文件' },
              { value: 'DOCUMENT', label: '本项目文档' },
              { value: 'ATTACHMENT', label: '本项目文件' },
            ]}
          />
          <Input.Search
            aria-label="搜索可引用资料"
            placeholder="按资料名称搜索"
            allowClear
            enterButton="搜索"
            disabled={busy}
            onSearch={(v) => {
              setQ(v.trim());
              setPage(1);
              setSelected(undefined);
            }}
          />
        </Space>
        {scope === 'PERSONAL' && (
          <Alert
            style={{ margin: '12px 0' }}
            type="warning"
            message="引用个人文件需要共享授权"
            description="确认后，本需求所在项目的当前及后续成员可通过此需求下载该文件。个人空间其他文件保持私有。你可在个人文件空间的引用授权中随时撤销，包括退出项目后。"
          />
        )}
        {error && (
          <Alert
            type="error"
            message={error}
            action={
              <Button
                disabled={busy}
                onClick={() => {
                  setOpenedVersion(task.version);
                  setSelected(undefined);
                  setShare(false);
                  setError('');
                  candidates.refetch();
                }}
              >
                核对最新状态后重新选择
              </Button>
            }
          />
        )}{' '}
        {candidates.isFetching ? (
          <Spin />
        ) : candidates.error ? (
          <Alert
            type="error"
            message="资料加载失败"
            action={
              <Button onClick={() => candidates.refetch()}>重试加载资料</Button>
            }
          />
        ) : !candidates.data?.items.length ? (
          <Empty description="没有匹配的可引用资料" />
        ) : (
          candidates.data.items.map((item) => (
            <div key={item.id} style={{ margin: '12px 0' }}>
              <Button
                block
                style={{
                  height: 'auto',
                  whiteSpace: 'normal',
                  textAlign: 'left',
                  overflowWrap: 'anywhere',
                }}
                disabled={busy}
                type={selected?.id === item.id ? 'primary' : 'default'}
                onClick={() => {
                  setSelected(item);
                  setPinMode('LATEST');
                  setPinNumber(item.contentVersion || 1);
                  setShare(false);
                }}
              >
                {item.name} · v{item.version}
                {selected?.id === item.id ? ' · 已选择' : ''}
              </Button>
            </div>
          ))
        )}
        {selected?.kind === 'FILE' && (
          <Space wrap style={{ margin: '12px 0' }}>
            <Select
              aria-label="新引用版本方式"
              value={pinMode}
              onChange={setPinMode}
              options={[
                { value: 'LATEST', label: '跟随最新版（更新后核对）' },
                { value: 'FIXED', label: '固定内容版本' },
              ]}
              style={{ width: 260 }}
            />
            {pinMode === 'FIXED' && (
              <InputNumber
                aria-label="固定内容版本号"
                min={1}
                max={selected.contentVersion || 1}
                value={pinNumber}
                onChange={(v) => setPinNumber(v || 1)}
              />
            )}
          </Space>
        )}
        <Pagination
          current={page}
          pageSize={10}
          total={candidates.data?.total || 0}
          showSizeChanger={false}
          disabled={busy}
          onChange={(v) => {
            setPage(v);
            setSelected(undefined);
          }}
        />
        {selected && (
          <p>
            已选择：{selected.name} · v{selected.version}
          </p>
        )}
        {scope === 'PERSONAL' && selected && (
          <Checkbox
            checked={share}
            disabled={busy}
            onChange={(e) => setShare(e.target.checked)}
          >
            我同意向本需求所在项目成员共享所选个人文件
          </Checkbox>
        )}
      </Modal>
      <Modal
        open={!!modeRef}
        title="调整引用方式"
        okText="保存引用方式"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ 'aria-label': '保存引用方式', disabled: busy }}
        onCancel={() => !busy && setModeRef(undefined)}
        onOk={async () => {
          if (!modeRef) return;
          if (
            await mutate(
              '/tasks/' + task.id + '/resources/' + modeRef.id + '/refresh',
              'POST',
              {
                expectedVersion: openedVersion,
                sourceVersion: modeRef.latestSourceVersion,
                fileVersion: pinMode === 'FIXED' ? pinNumber : null,
              },
            )
          )
            setModeRef(undefined);
        }}
      >
        <p>
          跟随最新版会在文件更新后提示核对；固定版本始终下载选定内容。删除原文件或撤销个人授权后，两种引用均停止下载。
        </p>
        <Space wrap>
          <Select
            aria-label="已有引用版本方式"
            value={pinMode}
            onChange={setPinMode}
            options={[
              { value: 'LATEST', label: '跟随最新版' },
              { value: 'FIXED', label: '固定内容版本' },
            ]}
            style={{ width: 200 }}
          />
          {pinMode === 'FIXED' && (
            <InputNumber
              aria-label="固定内容版本号"
              min={1}
              max={modeRef?.latestContentVersion || 1}
              value={pinNumber}
              onChange={(v) => setPinNumber(v || 1)}
            />
          )}
        </Space>
        {error && (
          <Alert
            type="error"
            message={error + '；请关闭窗口并核对最新资料后重新打开。'}
          />
        )}
      </Modal>
    </Card>
  );
}

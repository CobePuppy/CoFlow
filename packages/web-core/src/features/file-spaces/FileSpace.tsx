import { FileVersions } from './FileVersions.js';
import {
  fileTypes,
  fileSorts,
  fileSpaceState,
} from '@coflow/contracts/file-space.js';
import { PersonalFileGrants } from './PersonalFileGrants.js';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Upload,
} from 'antd';
import { CloudUploadOutlined, FileOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api/runtime.js';
import { ApiError } from '../../shared/api/api-response.js';
import { patchSearchParams } from '../../shared/lib/navigation.js';
import './file-space.css';
type FileItem = {
  id: string;
  name: string;
  size: number;
  mime: string;
  version: number;
  contentVersion: number;
  createdAt: string;
  deletedAt: string | null;
  canManage: boolean;
};
export function FileSpace({
  scope,
  workspaceId,
  workspaceName,
  search,
}: {
  scope: 'personal' | 'team';
  workspaceId: string;
  workspaceName?: string;
  search: string;
}) {
  const [versions, setVersions] = useState<string>();
  const [grants, setGrants] = useState<FileItem>();
  const [params, setParams] = useSearchParams();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const deleted = params.get('fileDeleted') === 'true';
  const filters = fileSpaceState(params);
  const rawPage = Number(params.get('filePage') || 1);
  const page =
    Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 1000000
      ? rawPage
      : 1;
  const qc = useQueryClient(),
    { message } = App.useApp();
  const [uploading, setUploading] = useState(false),
    [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<FileItem>(),
    [name, setName] = useState(''),
    [error, setError] = useState('');
  const endpoint =
    scope === 'personal'
      ? '/me/files'
      : '/workspaces/' + workspaceId + '/files';
  const query = useQuery<{ items: FileItem[]; total: number }>({
    queryKey: [
      'spaceFiles',
      scope,
      scope === 'team' ? workspaceId : '',
      search,
      deleted,
      filters,
      page,
    ],
    queryFn: ({ signal }) =>
      api(
        endpoint +
          '?' +
          new URLSearchParams({
            q: search,
            type: filters.type,
            sort: filters.sort,
            uploader: filters.uploader,
            deleted: String(deleted),
            page: String(page),
            pageSize: '20',
          }),
        'GET',
        undefined,
        undefined,
        signal,
      ),
    enabled: scope === 'personal' || !!workspaceId,
  });
  const navigate = (patch: Record<string, string | null>) =>
    setParams(patchSearchParams(params, patch));
  const refresh = () => qc.invalidateQueries({ queryKey: ['spaceFiles'] });
  async function change(file: FileItem, restore: boolean) {
    setBusy(true);
    try {
      await api(
        '/space-files/' + file.id + (restore ? '/restore' : ''),
        restore ? 'POST' : 'DELETE',
        { expectedVersion: file.version },
      );
      await refresh();
      message.success(restore ? '文件已恢复' : '文件已移入已删除文件');
    } catch (e) {
      message.error((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  if (scope === 'team' && !workspaceId)
    return (
      <Empty description="加入团队后可使用团队文件空间，个人文件空间仍可使用" />
    );
  return (
    <section
      className="file-space"
      aria-label={scope === 'personal' ? '个人文件空间' : '团队文件空间'}
    >
      <div className="file-space-heading">
        <div>
          <h2>
            {scope === 'personal'
              ? '个人文件空间'
              : (workspaceName || '当前团队') + ' · 文件空间'}
          </h2>
          <p>
            {scope === 'personal'
              ? '默认仅自己可见。可在需求中授权项目成员访问选定文件，并在引用授权中撤销。'
              : '团队成员共享。开发规范、公共模板和入职资料无需绑定项目；上传者及团队管理员可维护。'}
          </p>
        </div>
        <Upload
          multiple={false}
          showUploadList={false}
          disabled={uploading || busy}
          beforeUpload={async (file) => {
            setUploading(true);
            try {
              const body = new FormData();
              body.append('file', file);
              await api(endpoint, 'POST', body);
              const current = new URLSearchParams(window.location.search);
              const activeSpace =
                current.get('fileSpace') ||
                (current.has('project') ? 'project' : 'personal');
              if (
                mounted.current &&
                activeSpace === scope &&
                (scope === 'personal' ||
                  !current.get('workspace') ||
                  current.get('workspace') === workspaceId)
              )
                setParams(
                  patchSearchParams(current, {
                    fileDeleted: null,
                    filePage: null,
                    fileQ: null,
                    fileType: null,
                    fileUploader: null,
                    fileSort: null,
                  }),
                );
              await refresh();
              message.success(
                scope === 'personal'
                  ? '已上传至个人文件空间'
                  : '已上传至' + (workspaceName || '当前团队') + '文件空间',
              );
            } catch (e) {
              message.error((e as Error).message);
            } finally {
              if (mounted.current) setUploading(false);
            }
            return false;
          }}
        >
          <Button
            type="primary"
            loading={uploading}
            disabled={busy}
            icon={<CloudUploadOutlined />}
          >
            上传文件
          </Button>
        </Upload>
      </div>
      <div className="file-space-controls">
        <Space wrap>
          <Button
            type={!deleted ? 'primary' : 'default'}
            onClick={() => navigate({ fileDeleted: null, filePage: null })}
          >
            全部文件
          </Button>
          <Button
            type={deleted ? 'primary' : 'default'}
            onClick={() => navigate({ fileDeleted: 'true', filePage: null })}
          >
            已删除文件
          </Button>
          <span className="muted">
            {query.data ? '共 ' + query.data.total + ' 个文件' : ''}
          </span>
        </Space>
        <span className="muted">
          单个文件最多20 MB · 支持图片、PDF、文本、Word、Excel、ZIP
        </span>
      </div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          aria-label="文件类型"
          value={filters.type}
          style={{ width: 160 }}
          onChange={(value) =>
            navigate({
              fileType: value === 'ALL' ? null : value,
              filePage: null,
            })
          }
          options={fileTypes.map(({ value, label }) => ({ value, label }))}
        />
        {scope === 'team' && (
          <Select
            aria-label="上传者筛选"
            value={filters.uploader}
            style={{ width: 160 }}
            onChange={(value) =>
              navigate({
                fileUploader: value === 'ALL' ? null : value,
                filePage: null,
              })
            }
            options={[
              { value: 'ALL', label: '全部上传者' },
              { value: 'MINE', label: '仅我上传' },
            ]}
          />
        )}
        <Select
          aria-label="文件排序"
          value={filters.sort}
          style={{ width: 170 }}
          onChange={(value) =>
            navigate({
              fileSort: value === 'newest' ? null : value,
              filePage: null,
            })
          }
          options={fileSorts}
        />
        {(filters.type !== 'ALL' ||
          filters.sort !== 'newest' ||
          filters.uploader !== 'ALL' ||
          search) && (
          <Button
            onClick={() =>
              navigate({
                fileType: null,
                fileSort: null,
                fileUploader: null,
                fileQ: null,
                filePage: null,
              })
            }
          >
            清除查找条件
          </Button>
        )}
      </Space>
      {deleted && (
        <Alert
          type="info"
          showIcon
          message={
            scope === 'team'
              ? '团队管理员可查看全部已删除文件，其他成员仅查看和恢复自己上传的文件。'
              : '已删除文件停止提供下载，可在这里恢复。'
          }
        />
      )}
      {query.error ? (
        <Alert
          type="error"
          message="文件读取失败或已无权限"
          action={<Button onClick={() => query.refetch()}>重试</Button>}
        />
      ) : query.isPending ? (
        <Spin />
      ) : (
        <>
          {query.data?.items.length ? (
            <div className="space-file-list">
              {query.data.items.map((file) => (
                <article key={file.id} className="space-file-row">
                  <div className="space-file-icon">
                    <FileOutlined />
                  </div>
                  <div className="space-file-copy">
                    <strong>{file.name}</strong>
                    <p>
                      {file.size < 1024
                        ? file.size + ' B'
                        : file.size < 1048576
                          ? (file.size / 1024).toFixed(1) + ' KB'
                          : (file.size / 1048576).toFixed(1) + ' MB'}{' '}
                      · 内容 V{file.contentVersion} ·{' '}
                      {new Date(file.createdAt).toLocaleDateString('zh-CN')}{' '}
                      {file.deletedAt && <Tag>已删除</Tag>}
                    </p>
                  </div>
                  <Space wrap className="space-file-actions">
                    <Button onClick={() => setVersions(file.id)}>
                      内容版本
                    </Button>
                    {scope === 'personal' && (
                      <Button onClick={() => setGrants(file)}>引用授权</Button>
                    )}
                    {!file.deletedAt && (
                      <Button
                        aria-label="下载"
                        href={'/api/v1/space-files/' + file.id + '/download'}
                      >
                        下载
                      </Button>
                    )}
                    {file.canManage && !file.deletedAt && (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setRenaming(file);
                          setName(file.name);
                          setError('');
                        }}
                      >
                        重命名
                      </Button>
                    )}
                    {file.canManage && (
                      <Popconfirm
                        title={
                          file.deletedAt
                            ? '恢复这个文件？'
                            : '将文件移入已删除文件？'
                        }
                        description={
                          file.deletedAt
                            ? undefined
                            : '其他成员将无法继续下载，可恢复。'
                        }
                        okText="确认"
                        okButtonProps={{ 'aria-label': '确认文件操作' }}
                        cancelText="取消"
                        onConfirm={() => change(file, !!file.deletedAt)}
                      >
                        <Button
                          aria-label={file.deletedAt ? '恢复' : '删除'}
                          disabled={busy}
                          danger={!file.deletedAt}
                        >
                          {file.deletedAt ? '恢复' : '删除'}
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              description={
                search || filters.type !== 'ALL' || filters.uploader !== 'ALL'
                  ? '没有找到匹配的文件，可清除查找条件或切换文件空间'
                  : deleted
                    ? '暂无已删除文件'
                    : scope === 'personal'
                      ? '上传第一份个人文件，无需创建项目'
                      : '上传开发规范或公共模板，让团队随时查阅'
              }
            />
          )}
          {page > Math.max(1, Math.ceil((query.data?.total || 0) / 20)) && (
            <Button onClick={() => navigate({ filePage: '1' })}>
              返回第一页
            </Button>
          )}
          <Pagination
            current={page}
            pageSize={20}
            total={query.data?.total || 0}
            showSizeChanger={false}
            onChange={(value) => navigate({ filePage: String(value) })}
          />
        </>
      )}
      {versions && (
        <FileVersions
          key={versions}
          fileId={versions}
          onClose={() => setVersions(undefined)}
        />
      )}
      {grants && (
        <PersonalFileGrants
          key={grants.id}
          file={grants}
          onClose={() => setGrants(undefined)}
        />
      )}
      <Modal
        open={!!renaming}
        title="重命名文件"
        okText="保存名称"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => !busy && setRenaming(undefined)}
        onOk={async () => {
          if (!renaming) return;
          setBusy(true);
          setError('');
          try {
            await api('/space-files/' + renaming.id, 'PATCH', {
              expectedVersion: renaming.version,
              name: name.trim(),
            });
            setRenaming(undefined);
            await refresh();
            message.success('文件名称已更新');
          } catch (e) {
            setError((e as Error).message);
            if (e instanceof ApiError && e.status === 409) {
              try {
                const latest = await api('/space-files/' + renaming.id);
                setRenaming(latest);
                setError(
                  '文件已被更新，名称输入已保留；已载入最新版本，请核对后再次保存。',
                );
              } catch {
                setError('文件已不可访问，请关闭窗口后刷新文件空间。');
              }
            }
            await refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="space-file-name">文件名称（保留扩展名）</label>
        <Input
          id="space-file-name"
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
        />
        {error && <Alert type="error" message={error} />}
      </Modal>
    </section>
  );
}

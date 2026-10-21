import { useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Modal,
  Pagination,
  Space,
  Spin,
  Tag,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/runtime.js';
import { invalidateTaskQueries } from '../../shared/api/query-invalidation.js';
import { useUnsavedChanges } from '../../shared/lib/unsaved.js';
export function FileVersions({
  fileId,
  onClose,
}: {
  fileId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient(),
    { message, modal } = App.useApp();
  const [page, setPage] = useState(1),
    [file, setFile] = useState<File>(),
    [summary, setSummary] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [restore, setRestore] = useState<number>(),
    [restoreReason, setRestoreReason] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const query = useQuery<any>({
    queryKey: ['spaceFileVersions', fileId, page],
    queryFn: () =>
      api(`/space-files/${fileId}/revisions?page=${page}&pageSize=20`),
  });
  useUnsavedChanges(!!file || !!summary || !!restoreReason);
  async function changed() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['spaceFiles'] }),
      qc.invalidateQueries({ queryKey: ['spaceFileVersions', fileId] }),
      invalidateTaskQueries(qc),
    ]);
  }
  const current = query.data?.file,
    manage = current?.canManage && !current?.deletedAt;
  return (
    <Modal
      open
      title={'文件内容版本' + (current ? ' · ' + current.name : '')}
      width={760}
      footer={null}
      onCancel={() => {
        if (busy) return;
        if (file || summary.trim() || restoreReason.trim())
          modal.confirm({
            title: '离开未完成的文件更新？',
            content: '尚未上传的文件与更新说明会丢失，请先保存或复制。',
            okText: '离开文件版本',
            cancelText: '继续编辑',
            onOk: onClose,
          });
        else onClose();
      }}
    >
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
          <p>
            当前内容 V{current.contentVersion} ·
            历史内容保留；恢复操作会追加一个新版本。
          </p>
          {current.deletedAt && (
            <Alert
              type="warning"
              message="文件已删除，所有版本停止下载；请先在文件空间恢复文件。"
            />
          )}
          {manage && (
            <Card size="small" title="上传新版本">
              <input
                ref={input}
                aria-label="选择新版本文件"
                type="file"
                disabled={busy}
                onChange={(e) => setFile(e.target.files?.[0])}
              />
              <p>须保留原文件类型，单个文件最多20 MB；文件名称沿用当前名称。</p>
              <Input.TextArea
                aria-label="文件更新说明"
                rows={3}
                maxLength={2000}
                value={summary}
                disabled={busy}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="说明本次内容变化"
              />
              <Button
                style={{ marginTop: 12 }}
                aria-label="保存文件新版本"
                disabled={!file || !summary.trim() || busy}
                loading={busy}
                onClick={async () => {
                  if (!file) return;
                  setBusy(true);
                  setError('');
                  try {
                    const body = new FormData();
                    body.append('file', file);
                    body.append('expectedVersion', String(current.version));
                    body.append('summary', summary);
                    await api(`/space-files/${fileId}/revisions`, 'POST', body);
                    setFile(undefined);
                    setSummary('');
                    if (input.current) input.current.value = '';
                    setPage(1);
                    await changed();
                    message.success('新内容版本已保存');
                  } catch (e) {
                    setError(
                      (e as Error).message +
                        '；输入已保留，请核对最新版本后重试。',
                    );
                    await query.refetch();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                保存文件新版本
              </Button>
            </Card>
          )}
          {error && <Alert type="error" message={error} />}
          {query.data.items.map((r: any) => (
            <Card
              data-file-version={r.number}
              size="small"
              key={r.number}
              style={{ marginTop: 12 }}
              title={
                <Space wrap>
                  <span>内容 V{r.number}</span>
                  {r.number === current.contentVersion && <Tag>当前版本</Tag>}
                </Space>
              }
            >
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {r.summary}
              </p>
              <p className="muted">
                {r.name} · {r.size} B · {r.createdByName} ·{' '}
                {new Date(r.createdAt).toLocaleString('zh-CN')}
              </p>
              <Space wrap>
                <Button
                  disabled={!!current.deletedAt}
                  href={`/api/v1/space-files/${fileId}/revisions/${r.number}/download`}
                >
                  下载此版本
                </Button>
                {manage && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setRestore(r.number);
                      setRestoreReason('');
                    }}
                  >
                    恢复为新版本
                  </Button>
                )}
              </Space>
            </Card>
          ))}
          <Pagination
            current={page}
            pageSize={20}
            total={query.data.total}
            showSizeChanger={false}
            responsive
            onChange={setPage}
            style={{ marginTop: 16 }}
          />
        </>
      )}
      <Modal
        open={restore !== undefined}
        title={'将V' + restore + '恢复为新版本'}
        okText="确认恢复内容"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{
          disabled: !restoreReason.trim() || busy,
          'aria-label': '确认恢复内容',
        }}
        onCancel={() => !busy && setRestore(undefined)}
        onOk={async () => {
          setBusy(true);
          setError('');
          try {
            await api(
              `/space-files/${fileId}/revisions/${restore}/restore`,
              'POST',
              { expectedVersion: current.version, summary: restoreReason },
            );
            setRestore(undefined);
            setRestoreReason('');
            setPage(1);
            await changed();
            message.success('已追加恢复版本');
          } catch (e) {
            setError((e as Error).message);
            await query.refetch();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input.TextArea
          aria-label="恢复内容原因"
          value={restoreReason}
          maxLength={2000}
          onChange={(e) => setRestoreReason(e.target.value)}
          rows={3}
        />
        {error && <Alert type="error" message={error} />}
      </Modal>
    </Modal>
  );
}

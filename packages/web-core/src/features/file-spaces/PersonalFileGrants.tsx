import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Empty,
  Modal,
  Pagination,
  Popconfirm,
  Spin,
} from 'antd';
import { api } from '../../shared/api/runtime.js';
export function PersonalFileGrants({
  file,
  onClose,
}: {
  file: { id: string; name: string };
  onClose: () => void;
}) {
  const [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const qc = useQueryClient(),
    { message } = App.useApp();
  const query = useQuery<{
    items: { id: string; taskTitle: string; createdAt: string }[];
    total: number;
  }>({
    queryKey: ['fileGrants', file.id, page],
    queryFn: () => api('/space-files/' + file.id + '/references?page=' + page),
  });
  return (
    <Modal
      open
      title={'个人文件引用授权 · ' + file.name}
      onCancel={() => {
        if (!busy) onClose();
      }}
      footer={null}
      closable={!busy}
      maskClosable={!busy}
    >
      <p>
        撤销后，项目成员将无法通过该引用下载个人文件。已下载的副本无法收回。以下需求名称为授权时记录。
      </p>
      {error && <Alert type="error" message={error} />}{' '}
      {query.isPending ? (
        <Spin />
      ) : query.error ? (
        <Alert
          type="error"
          message="授权加载失败"
          action={<Button onClick={() => query.refetch()}>重试</Button>}
        />
      ) : !query.data?.items.length ? (
        <Empty description="当前没有引用授权" />
      ) : (
        query.data.items.map((item) => (
          <div
            key={item.id}
            style={{ margin: '16px 0', overflowWrap: 'anywhere' }}
          >
            <p>{item.taskTitle}</p>
            <Popconfirm
              title="撤销此需求的文件访问授权？"
              okText="确认撤销授权"
              onConfirm={async () => {
                setBusy(true);
                setError('');
                try {
                  await api(
                    '/space-files/' + file.id + '/references/' + item.id,
                    'DELETE',
                  );
                  await qc.invalidateQueries({
                    queryKey: ['fileGrants', file.id],
                  });
                  await qc.invalidateQueries({ queryKey: ['taskResources'] });
                  message.success('引用授权已撤销');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Button disabled={busy}>撤销授权</Button>
            </Popconfirm>
          </div>
        ))
      )}
      <Pagination
        current={page}
        pageSize={20}
        total={query.data?.total || 0}
        disabled={busy}
        showSizeChanger={false}
        onChange={setPage}
      />
    </Modal>
  );
}

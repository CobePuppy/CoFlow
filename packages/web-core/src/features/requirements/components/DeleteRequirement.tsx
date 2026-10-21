import { invalidateTaskQueries } from '../../../shared/api/query-invalidation.js';
import { App, Button, Input, Space } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/runtime.js';
import { canDeleteRequirement } from '@coflow/contracts/task-deletion.js';

export function DeleteRequirement({
  task,
  userId,
  readOnly,
  admin = false,
  onDeleted,
}: any) {
  const { modal, message } = App.useApp();
  const qc = useQueryClient();
  const canManage =
    !readOnly &&
    (admin || task.data.productId === userId || task.data.createdBy === userId);
  async function change(
    method: string,
    suffix: string,
    body: any,
    notice: string,
  ) {
    try {
      await api(`/tasks/${task.id}${suffix}`, method, {
        expectedVersion: task.version,
        ...body,
      });
      onDeleted?.();
      await invalidateTaskQueries(qc);
      message.success(notice);
    } catch (error) {
      message.error((error as Error).message);
      await invalidateTaskQueries(qc);
      throw error;
    }
  }
  if (task.deletedAt)
    return canManage ? (
      <Space onClick={(e) => e.stopPropagation()}>
        <Button
          onClick={() =>
            modal.confirm({
              title: '恢复需求？',
              content: '恢复后回到删除前的阶段，保留历史和附件。',
              okText: '恢复需求',
              cancelText: '取消',
              onOk: () => change('POST', '/restore', {}, '需求已恢复'),
            })
          }
        >
          恢复需求
        </Button>
        {admin && (
          <Button
            danger
            onClick={() => {
              let confirmTitle = '';
              modal.confirm({
                title: '永久删除需求',
                content: (
                  <>
                    <p>
                      此操作不可恢复。请输入完整标题「{task.data.title}
                      」。仍有引用时不能永久删除。
                    </p>
                    <Input
                      aria-label="确认永久删除的需求标题"
                      onChange={(e) => {
                        confirmTitle = e.target.value;
                      }}
                    />
                  </>
                ),
                okText: '永久删除',
                cancelText: '保留记录',
                okButtonProps: { danger: true },
                onOk: () => {
                  if (confirmTitle !== task.data.title) {
                    message.error('请输入完整需求标题');
                    return Promise.reject(new Error('标题不匹配'));
                  }
                  return change(
                    'DELETE',
                    '/permanent',
                    { confirmTitle },
                    '需求已永久删除',
                  );
                },
              });
            }}
          >
            永久删除
          </Button>
        )}
      </Space>
    ) : null;
  if (!canDeleteRequirement(task, userId, readOnly, admin)) return null;
  return (
    <Button
      danger
      onClick={(event) => {
        event.stopPropagation();
        modal.confirm({
          title: '移入回收站？',
          content: `“${task.data.title}”将从日常列表和待办中移除，历史、附件及关联保留，可随时恢复。`,
          okText: '移入回收站',
          cancelText: '保留需求',
          okButtonProps: { danger: true },
          async onOk() {
            await change('DELETE', '', {}, '需求已移入回收站');
          },
        });
      }}
    >
      删除需求
    </Button>
  );
}

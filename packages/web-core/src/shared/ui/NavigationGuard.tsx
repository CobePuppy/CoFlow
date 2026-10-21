import { useSyncExternalStore } from 'react';
import { useBlocker, useLocation } from 'react-router-dom';
import { Modal } from 'antd';
import { hasUnsavedChanges, subscribeUnsavedChanges } from '../lib/unsaved.js';
import { leavesEditingContext } from '../lib/navigation-guard.js';
export function NavigationGuard() {
  const location = useLocation();
  const leaveLabel = new URLSearchParams(location.search).get('task')
    ? '离开详情'
    : '离开当前页面';
  const dirty = useSyncExternalStore(
    subscribeUnsavedChanges,
    hasUnsavedChanges,
    () => false,
  );
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges() &&
      leavesEditingContext(currentLocation, nextLocation),
  );
  return (
    <Modal
      open={blocker.state === 'blocked'}
      title="离开未完成的编辑？"
      okText={leaveLabel}
      cancelText="继续编辑"
      okButtonProps={{ 'aria-label': leaveLabel }}
      onCancel={() => blocker.state === 'blocked' && blocker.reset()}
      onOk={() => blocker.state === 'blocked' && blocker.proceed()}
    >
      <p>
        当前输入尚未保存到服务端。继续编辑可保留当前输入；离开会保留已经成功写入浏览器的工作副本，上传文件或未保存副本的字段需先保存或复制。
      </p>
    </Modal>
  );
}

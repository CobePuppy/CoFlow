import { useState } from 'react';
import {
  App,
  Button,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tooltip,
} from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { DeleteRequirement } from './DeleteRequirement.js';
import { api } from '../runtime.js';
import { createClientId } from '../client-id.js';

export function QuickRequirementActions({
  task,
  userId,
  admin,
  readOnly,
  members,
}: any) {
  const [field, setField] = useState('');
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const editable =
    !readOnly &&
    !task.deletedAt &&
    !['CLOSED', 'CANCELLED'].includes(task.status) &&
    (admin || task.data.productId === userId);
  return (
    <Space wrap onClick={(e) => e.stopPropagation()}>
      {editable && (
        <Dropdown
          menu={{
            items: [
              { key: 'priority', label: '修改优先级' },
              { key: 'dueAt', label: '修改截止日期' },
              {
                key: 'transfer',
                label: admin ? '转交 / 管理员接管' : '调整负责人',
              },
            ],
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              form.resetFields();
              if (key !== 'transfer')
                form.setFieldsValue({
                  priority: task.data.priority,
                  dueAt: task.data.dueAt?.slice(0, 10),
                });
              setField(key);
            },
          }}
        >
          <Button>更多操作</Button>
        </Dropdown>
      )}
      {!editable && !task.deletedAt && (
        <Tooltip
          title={
            readOnly
              ? '项目已归档，恢复项目后可继续编辑'
              : ['CLOSED', 'CANCELLED'].includes(task.status)
                ? '需求已结束，可查看历史或移入回收站'
                : '请联系需求负责人或团队管理员调整'
          }
        >
          <span>
            <Button disabled>只读</Button>
          </span>
        </Tooltip>
      )}
      <DeleteRequirement
        task={task}
        userId={userId}
        admin={admin}
        readOnly={readOnly}
      />
      <Modal
        open={!!field}
        title={
          field === 'transfer'
            ? '调整负责人'
            : field === 'priority'
              ? '修改优先级'
              : '修改截止日期'
        }
        onCancel={() => !busy && setField('')}
        onOk={() => form.submit()}
        confirmLoading={busy}
        okText="保存"
        okButtonProps={{ 'aria-label': '保存' }}
        cancelText="取消"
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setBusy(true);
            try {
              if (field === 'transfer') {
                if (!Object.values(values).some(Boolean)) {
                  message.error('请至少选择一位负责人');
                  return;
                }
                await api(
                  `/tasks/${task.id}/actions`,
                  'POST',
                  {
                    action: 'TRANSFER',
                    expectedVersion: task.version,
                    payload: values,
                  },
                  createClientId(),
                );
              } else
                await api(`/tasks/${task.id}/properties`, 'PATCH', {
                  expectedVersion: task.version,
                  [field]:
                    field === 'dueAt'
                      ? values.dueAt
                        ? new Date(values.dueAt).toISOString()
                        : null
                      : values.priority,
                });
              setField('');
              await qc.invalidateQueries();
              message.success('已更新');
            } catch (error) {
              message.error((error as Error).message);
              await qc.invalidateQueries();
            } finally {
              setBusy(false);
            }
          }}
        >
          {field === 'priority' && (
            <Form.Item
              name="priority"
              label="优先级"
              rules={[{ required: true }]}
            >
              <Select
                options={['P0', 'P1', 'P2', 'P3'].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Form.Item>
          )}
          {field === 'dueAt' && (
            <Form.Item name="dueAt" label="计划截止（留空清除）">
              <Input type="date" />
            </Form.Item>
          )}
          {field === 'transfer' && (
            <>
              <p>
                只有需求负责人或团队管理员可转交；管理操作将记入历史。标准流程评估期间不能更换评估人。
              </p>
              {(task.data.workflow === 'SIMPLE'
                ? [
                    ['productId', '需求负责人'],
                    ['engineerId', '执行人'],
                  ]
                : [
                    ['productId', '需求负责人'],
                    ['engineerId', '研发负责人'],
                    ['testerId', '测试负责人'],
                    ['productReviewerId', '产品评估人'],
                    ['qaReviewerId', '测试评估人'],
                  ]
              ).map(([key, label]) => (
                <Form.Item key={key} name={key} label={label}>
                  <Select
                    allowClear
                    options={members.map((m: any) => ({
                      value: m.id,
                      label: m.name,
                    }))}
                  />
                </Form.Item>
              ))}
            </>
          )}
        </Form>
      </Modal>
    </Space>
  );
}

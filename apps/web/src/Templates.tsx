import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './runtime.js';
import { templateContent, templateFormValues } from './template-content.js';
import type {
  RequirementTemplate,
  TemplateList,
} from '../../../packages/contracts/index.js';

export default function Templates({ projectId }: { projectId: string }) {
  const query = useQuery<TemplateList>({
    queryKey: ['templates', projectId],
    queryFn: () => api(`/projects/${projectId}/templates`),
    enabled: !!projectId,
  });
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [edit, setEdit] = useState<RequirementTemplate | 'new'>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [search, setSearch] = useState('');
  const canWrite = !!query.data?.canManage && !query.data.readOnly;
  if (!projectId) return <Empty description="选择项目后使用需求模板" />;
  if (query.isPending) return <Spin aria-label="正在加载需求模板" />;
  if (query.error)
    return (
      <Alert
        type="error"
        message={query.error.message}
        action={<Button onClick={() => query.refetch()}>重试</Button>}
      />
    );
  const items =
    query.data?.items.filter((item) =>
      item.name.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  return (
    <>
      <Alert
        type="info"
        showIcon
        message="将常见需求和验收清单保存为项目模板，创建需求时一键套用。"
        description={
          query.data?.readOnly
            ? '项目已归档，模板仅可查看。'
            : '管理员和项目产品成员可管理模板，项目成员可使用已启用模板。'
        }
      />
      <Space wrap style={{ margin: '16px 0' }}>
        <Button
          type="primary"
          disabled={!canWrite}
          onClick={() => {
            setEdit('new');
            setError('');
          }}
        >
          新建需求模板
        </Button>
        <Input.Search
          aria-label="搜索需求模板"
          placeholder="搜索模板名称"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
      </Space>
      {!items.length && (
        <Empty
          description={
            search
              ? '没有符合搜索条件的模板'
              : '暂无需求模板，可从空白模板开始，或在需求草稿中保存为模板'
          }
        />
      )}
      <div className="document-grid">
        {items.map((item) => (
          <Card
            key={item.id}
            title={item.name}
            extra={
              <Tag color={item.active ? 'green' : 'default'}>
                {item.active ? '已启用' : '已停用'}
              </Tag>
            }
          >
            <p>{item.content.goal || item.content.title || '通用需求模板'}</p>
            <p className="muted">
              {item.content.criteria.length} 项验收标准 · 版本 {item.version}
            </p>
            <Button
              onClick={() => {
                setEdit(item);
                setError('');
              }}
            >
              {canWrite ? '查看 / 编辑模板' : '查看模板'}
            </Button>
          </Card>
        ))}
      </div>
      {edit && (
        <Modal
          open
          title="需求模板"
          width={800}
          footer={null}
          onCancel={() => {
            if (!busy) setEdit(undefined);
          }}
          maskClosable={!busy}
          keyboard={!busy}
          closable={!busy}
          destroyOnHidden
        >
          <Form
            key={edit === 'new' ? 'new' : edit.id}
            layout="vertical"
            initialValues={
              edit === 'new'
                ? { priority: 'P2', active: true }
                : {
                    ...templateFormValues(edit.content),
                    name: edit.name,
                    active: edit.active,
                  }
            }
            disabled={!canWrite || busy}
            onFinish={async (values) => {
              setBusy(true);
              setError('');
              try {
                await api(
                  edit === 'new'
                    ? `/projects/${projectId}/templates`
                    : `/templates/${edit.id}`,
                  edit === 'new' ? 'POST' : 'PATCH',
                  {
                    name: values.name,
                    content: templateContent(values),
                    active: values.active,
                    ...(edit === 'new'
                      ? {}
                      : { expectedVersion: edit.version }),
                  },
                );
                setEdit(undefined);
                await qc.invalidateQueries({
                  queryKey: ['templates', projectId],
                });
                message.success('需求模板已保存');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && <Alert type="error" message={error} />}
            <Form.Item
              name="name"
              label="模板名称"
              rules={[{ required: true, whitespace: true }, { max: 80 }]}
            >
              <Input maxLength={80} />
            </Form.Item>
            <Form.Item name="title" label="预填需求标题">
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item name="priority" label="模板优先级">
              <Select
                options={['P0', 'P1', 'P2', 'P3'].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Form.Item>
            <Form.Item name="background" label="模板背景">
              <Input.TextArea rows={2} maxLength={10000} />
            </Form.Item>
            <Form.Item name="goal" label="模板目标">
              <Input.TextArea rows={2} maxLength={10000} />
            </Form.Item>
            <Form.Item name="description" label="模板需求描述">
              <Input.TextArea rows={4} maxLength={100000} />
            </Form.Item>
            <Form.Item name="criteria" label="模板验收标准（每行一项）">
              <Input.TextArea rows={4} />
            </Form.Item>
            <Form.Item name="active" label="启用模板" valuePropName="checked">
              <Switch />
            </Form.Item>
            {canWrite && (
              <Button type="primary" htmlType="submit" loading={busy}>
                保存需求模板
              </Button>
            )}
          </Form>
          {error && (
            <Button
              disabled={busy}
              onClick={() => {
                setEdit(undefined);
                query.refetch();
              }}
            >
              关闭并刷新列表
            </Button>
          )}
        </Modal>
      )}
    </>
  );
}

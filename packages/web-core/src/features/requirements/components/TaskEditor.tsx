import { useBrowserDraft } from '../../../shared/lib/useBrowserDraft.js';
import { DraftRecovery } from '../../../shared/ui/DraftRecovery.js';
import { FileImport } from '../../../app/pages.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { requirementReadiness } from '../model/transition-readiness.js';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Checkbox,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, useData } from '../../../shared/api/runtime.js';
import { reviewCriteria } from '@coflow/contracts/criteria-review.js';
import {
  templateContent,
  templateFormValues,
} from '../model/template-content.js';
import type { TemplateContent, TemplateList } from '@coflow/contracts/index.js';
import { DownOutlined, UpOutlined, TeamOutlined } from '@ant-design/icons';
import type { Member } from '@coflow/contracts/index.js';
import './requirements.css';
import { useUnsavedChanges } from '../../../shared/lib/unsaved.js';

// 严格模式下管理员放行弹窗打开时静默中止保存，不向前端展示为错误。
const SILENT_ABORT = Symbol('criteria-override');

export function TaskEditor({
  open,
  members: originalMembers,
  projectId: originalProjectId,
  projectName,
  onClose,
  onSave,
  initial,
  sample,
  userId,
  workspaceId,
  resourceId,
  baseVersion,
}: any) {
  const [form] = Form.useForm();
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(open && dirty);
  const [projectId, setProjectId] = useState(originalProjectId);
  const submitIntent = useRef(false);
  const browserDraft = useBrowserDraft(
    [
      userId || '',
      workspaceId || '',
      projectId || '',
      initial ? 'edit' : 'create',
      resourceId || 'new',
    ],
    !!open && !!userId && !!workspaceId,
    baseVersion ?? null,
    [
      'title',
      'background',
      'goal',
      'description',
      'criteria',
      'priority',
      'type',
      'productId',
      'engineerId',
      'testerId',
      'productReviewerId',
      'qaReviewerId',
      'dueAt',
      'severity',
      'parentId',
      'parentRound',
    ],
  );
  const editVersion = useRef(baseVersion);
  useEffect(() => {
    if (open) editVersion.current = baseVersion;
  }, [open]);
  const [issues, setIssues] = useState<{ field: string; message: string }[]>(
    [],
  );
  const [preview, setPreview] = useState<TemplateContent>();
  const [templateFields, setTemplateFields] = useState<string[]>([]);
  const templateLabels: Record<string, string> = {
    title: '标题',
    background: '背景',
    goal: '目标',
    description: '需求描述',
    criteria: '验收标准',
    priority: '优先级',
  };
  function persist() {
    setDirty(true);
    browserDraft.save(form.getFieldsValue(true));
  }
  function locate(field: string) {
    setExpanded(true);
    setTimeout(() => {
      form.scrollToField(field, { block: 'center' });
      form.getFieldInstance(field)?.focus?.();
    }, 50);
  }
  useEffect(() => {
    if (open) setProjectId(originalProjectId);
    else setDirty(false);
  }, [open, originalProjectId]);
  const context = useQuery({
    queryKey: ['project', originalProjectId],
    queryFn: () => api('/projects/' + originalProjectId),
    enabled: !!open && !!originalProjectId,
  });
  const choices = useQuery({
    queryKey: ['projects', context.data?.workspaceId],
    queryFn: () => api('/workspaces/' + context.data.workspaceId + '/projects'),
    enabled: !!open && !!context.data?.workspaceId,
  });
  const targetMembers = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => api('/projects/' + projectId + '/members'),
    enabled: !!open && !!projectId,
  });
  const members =
    projectId === originalProjectId
      ? targetMembers.data || originalMembers
      : targetMembers.data || [];

  const currentProject =
    choices.data?.find((p: any) => p.id === projectId) || context.data;
  const simple = (initial?.workflow || currentProject?.workflow) === 'SIMPLE';
  const compact =
    !simple &&
    (initial?.roleMode || currentProject?.roleMode) === 'COMPACT';
  const { modal, message } = App.useApp();
  const qc = useQueryClient();
  const templates = useQuery<TemplateList>({
    queryKey: ['templates', projectId],
    queryFn: () => api(`/projects/${projectId}/templates`),
    enabled: !!projectId && !!open,
  });
  const [selectedTemplate, setSelectedTemplate] = useState<string>();
  const [snapshot, setSnapshot] = useState<TemplateContent>();
  const [templateName, setTemplateName] = useState(''),
    [templateError, setTemplateError] = useState(''),
    [savingTemplate, setSavingTemplate] = useState(false);
  useEffect(() => {
    if (!open) {
      setSelectedTemplate(undefined);
      setSnapshot(undefined);
      setTemplateName('');
      setTemplateError('');
    }
  }, [open, projectId]);
  const availableTemplates =
    templates.data?.items.filter((item) => item.active) || [];
  const applyTemplate = () => {
    const selected = availableTemplates.find(
      (item) => item.id === selectedTemplate,
    );
    if (!selected) return;
    setPreview(selected.content);
    setTemplateFields(Object.keys(templateLabels));
  };

  const type = Form.useWatch('type', form);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  // CF-003 验收标准质量检查：实时提醒 + 严格模式拦截 + AI 改写。
  const criteriaText = Form.useWatch('criteria', form);
  const descriptionText = Form.useWatch('description', form);
  const strictProject = currentProject?.qualityGate === 'STRICT';
  const settings = useData(['settings'], '/settings', !!open);
  const workspacePeople = useData(
    ['workspaceMembers', workspaceId],
    `/workspaces/${workspaceId}/members`,
    !!workspaceId,
  );
  const isAdmin =
    workspacePeople.data?.some(
      (m: any) => m.id === userId && m.role === 'ADMIN',
    ) || false;
  const aiReady = !!settings.data?.hasKey;
  const criteriaLines = (criteriaText || '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean);
  const criteriaWarnings = useMemo(
    () =>
      criteriaLines.length
        ? reviewCriteria(criteriaLines, {
            type,
            description: descriptionText,
          })
        : [],
    [criteriaText, type, descriptionText],
  );
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideText, setOverrideText] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const rewriteCriteria = async () => {
    setRewriting(true);
    setError('');
    try {
      const result = await api('/ai/rewrite-criteria', 'POST', {
        criteria: criteriaLines,
        description: descriptionText || '',
        type: type || 'REQUIREMENT',
        consent: true,
      });
      form.setFieldsValue({ criteria: result.criteria.join('\n') });
      persist();
      message.success('已按 AI 建议改写验收标准，请核对');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRewriting(false);
    }
  };
  const owner = (roles: string[]) =>
    (roles.includes('PRODUCT') &&
    members.some(
      (m: Member) => m.id === (qc.getQueryData(['me']) as any)?.user?.id,
    )
      ? (qc.getQueryData(['me']) as any)?.user?.id
      : members.find((m: Member) => m.roles.some((r) => roles.includes(r)))
          ?.id) || (simple ? members[0]?.id : undefined);
  useEffect(() => {
    if (!open || initial || !members.length) return;
    const defaults = {
      productId: owner(['PRODUCT']),
      engineerId: owner(['ENGINEER']),
      testerId: owner(['QA', 'OPS']),
      ...(compact
        ? {}
        : {
            productReviewerId: owner(['PRODUCT']),
            qaReviewerId: owner(['QA']),
          }),
    };
    const missing = Object.fromEntries(
      Object.entries(defaults).filter(
        ([key, id]) => id && !form.getFieldValue(key),
      ),
    );
    if (Object.keys(missing).length) form.setFieldsValue(missing);
  }, [open, members, initial, form, simple, compact]);
  // 新项目引导的示例需求：创建态打开时预填可修改的内容字段（角色沿用默认值）。
  useEffect(() => {
    if (!open || initial || !sample) return;
    form.setFieldsValue({
      ...sample,
      criteria: Array.isArray(sample.criteria)
        ? sample.criteria.join('\n')
        : sample.criteria,
    });
  }, [open, initial, sample, form]);
  return (
    <>
      <Modal
        open={open}
        className="requirement-editor"
        width={1040}
        style={{ top: 24 }}
        title={
          <div className="requirement-editor-title">
            <h2>{initial ? '编辑需求草稿' : '创建需求'}</h2>
            <p>
              {simple
                ? '明确需求、执行人和验收标准即可推进，允许一人兼任。'
                : '保存草稿继续完善，或填写完整后直接提交。'}
            </p>
          </div>
        }
        onCancel={onClose}
        destroyOnHidden
        maskClosable={!busy}
        keyboard={!busy}
        closable={!busy}
        afterOpenChange={(visible) => {
          if (!visible) {
            setExpanded(false);
            setError('');
          }
        }}
        footer={
          <div className="requirement-editor-footer">
            <span>草稿仅需标题，正式提交后才会通知接手人。</span>
            <div>
              <Button disabled={busy} onClick={onClose}>
                取消
              </Button>
              <Button
                type={initial ? 'primary' : 'default'}
                loading={busy}
                onClick={() => {
                  submitIntent.current = false;
                  form.submit();
                }}
              >
                {initial ? '保存修改' : '保存草稿'}
              </Button>
            </div>
            {!initial && (
              <Button
                type="primary"
                loading={busy}
                onClick={() => {
                  submitIntent.current = true;
                  setExpanded(true);
                  form.submit();
                }}
              >
                创建并提交
              </Button>
            )}
          </div>
        }
      >
        {templates.error && (
          <Alert
            type="error"
            message="需求模板加载失败，仍可手动填写需求"
            action={
              <Button onClick={() => templates.refetch()}>重试加载模板</Button>
            }
          />
        )}
        {type !== 'BUG' && (
          <Space wrap style={{ marginBottom: 16 }}>
            {!initial && (
              <>
                <Select
                  aria-label="选择需求模板"
                  placeholder="从项目模板创建"
                  loading={templates.isFetching}
                  value={selectedTemplate}
                  onChange={setSelectedTemplate}
                  allowClear
                  style={{ minWidth: 220 }}
                  options={availableTemplates.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
                <Button
                  disabled={
                    !selectedTemplate || busy || !!templates.data?.readOnly
                  }
                  onClick={applyTemplate}
                >
                  应用需求模板
                </Button>
              </>
            )}
            {templates.data?.canManage && !templates.data.readOnly && (
              <Button
                disabled={busy}
                onClick={() => {
                  setSnapshot(templateContent(form.getFieldsValue(true)));
                  setTemplateName('');
                  setTemplateError('');
                }}
              >
                将当前内容保存为模板
              </Button>
            )}
          </Space>
        )}
        <DraftRecovery
          draft={browserDraft}
          disabled={busy}
          onRestore={(values) => {
            form.setFieldsValue(values);
            setExpanded(true);
            setDirty(true);
          }}
        />
        <Form
          form={form}
          disabled={busy}
          onValuesChange={persist}
          layout="vertical"
          clearOnDestroy
          scrollToFirstError
          initialValues={
            initial
              ? {
                  ...initial,
                  dueAt: initial.dueAt?.slice(0, 10),
                  criteria: initial.criteria.join('\n'),
                }
              : {
                  type: 'REQUIREMENT',
                  priority: 'P2',
                  productId: owner(['PRODUCT']),
                  productReviewerId: owner(['PRODUCT']),
                  engineerId: owner(['ENGINEER']),
                  qaReviewerId: owner(['QA']),
                  testerId: owner(['QA', 'OPS']),
                }
          }
          onFinish={async (values) => {
            setError('');
            setIssues([]);
            setBusy(true);
            try {
              const { dueAt, parentRound, ...rest } = values;
              if (submitIntent.current && !initial) {
                const criteria = (values.criteria || '')
                  .split('\n')
                  .map((s: string) => s.trim())
                  .filter(Boolean);
                const readiness = requirementReadiness(
                  {
                    data: {
                      ...values,
                      criteria,
                      workflow: simple ? 'SIMPLE' : 'STANDARD',
                      roleMode: compact ? 'COMPACT' : 'STANDARD',
                      blocks: [],
                    },
                  } as any,
                  members.map((m: Member) => m.id),
                );
                if (!readiness.ready) {
                  setIssues(readiness.issues);
                  locate(readiness.issues[0]?.field || 'title');
                  throw new Error(
                    '提交前请补齐：' +
                      [...readiness.content, ...readiness.assignment].join(
                        '、',
                      ),
                  );
                }
                // CF-003 严格模式：存在质量提醒时拒绝提交，管理员可填理由放行。
                if (criteriaWarnings.length && strictProject) {
                  if (!isAdmin) {
                    locate('criteria');
                    throw new Error(
                      '项目为严格模式：请先按质量提醒修改验收标准，或联系团队管理员强制放行',
                    );
                  }
                  if (
                    String(values.criteriaOverrideReason || '').trim().length <
                    10
                  ) {
                    setOverrideText('');
                    setOverrideOpen(true);
                    throw SILENT_ABORT;
                  }
                }
              }
              await onSave({
                ...rest,
                ...(initial ? { expectedVersion: editVersion.current } : {}),
                ...(!initial ? { submit: submitIntent.current } : {}),
                ...Object.fromEntries(
                  [
                    'engineerId',
                    'testerId',
                    'productReviewerId',
                    'qaReviewerId',
                  ].map((key) => [
                    key,
                    compact &&
                    (key === 'productReviewerId' || key === 'qaReviewerId')
                      ? ''
                      : values[key] || '',
                  ]),
                ),
                projectId,
                criteria: (values.criteria || '')
                  .split('\n')
                  .map((s: string) => s.trim())
                  .filter(Boolean),
                ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
                ...(parentRound ? { parentRound: Number(parentRound) } : {}),
              });
              browserDraft.clear();
              setDirty(false);
            } catch (e) {
              if (e !== SILENT_ABORT) setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FileImport
            kind="requirement"
            onApply={(fields: any) => {
              form.setFieldsValue({
                ...fields,
                criteria:
                  fields.criteria?.join('\n') || form.getFieldValue('criteria'),
              });
              setExpanded(true);
              persist();
            }}
          />
          <div className="requirement-quick">
            <div>
              <strong>快速创建</strong>
              <p>
                先记录标题、项目和产品负责人，研发与测试分工可在提交前完善。
              </p>
            </div>
            <Button
              aria-expanded={expanded}
              aria-controls="requirement-more"
              icon={expanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起补充信息' : '完善更多信息'}
            </Button>
          </div>
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              className="requirement-form-error"
            />
          )}
          {issues.length > 0 && (
            <Space wrap>
              {issues.map((issue) => (
                <Button
                  type="link"
                  key={issue.field + issue.message}
                  onClick={() => locate(issue.field)}
                >
                  {issue.message}
                </Button>
              ))}
            </Space>
          )}
          <section className="requirement-section">
            <header>
              <span>01 · 需求定义</span>
              <h3>说明要解决的问题与完成标准</h3>
            </header>
            <div className="requirement-definition-grid">
              <Form.Item
                name="title"
                label="需求标题"
                rules={[
                  {
                    required: true,
                    whitespace: true,
                    message: '请填写需求标题',
                  },
                  { max: 200, message: '标题不能超过 200 字' },
                ]}
              >
                <Input
                  placeholder="用一句话说明用户问题与预期结果"
                  maxLength={200}
                />
              </Form.Item>
              <Form.Item name="type" label="需求类型">
                <Select
                  disabled={!!initial}
                  options={[
                    { value: 'REQUIREMENT', label: '产品需求' },
                    { value: 'BUG', label: '缺陷修复' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="priority" label="优先级">
                <Select
                  options={['P0', 'P1', 'P2', 'P3'].map((value, i) => ({
                    value,
                    label: `${value} · ${['紧急', '高', '中', '低'][i]}`,
                  }))}
                />
              </Form.Item>
            </div>
            {type === 'BUG' && (
              <div className="requirement-owner-grid">
                <Form.Item
                  name="severity"
                  label="缺陷严重程度"
                  rules={[{ required: true }]}
                >
                  <Select
                    disabled={!!initial}
                    options={['BLOCKER', 'MAJOR', 'MINOR'].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Form.Item>
                <Form.Item
                  name="parentId"
                  label="缺陷父任务 ID"
                  rules={[{ required: true }]}
                >
                  <Input disabled={!!initial} />
                </Form.Item>
                <Form.Item
                  name="parentRound"
                  label="父任务测试轮次"
                  rules={[{ required: true }]}
                >
                  <Input type="number" min={1} disabled={!!initial} />
                </Form.Item>
              </div>
            )}
          </section>
          <section className="requirement-section">
            <header>
              <span>02 · 规划与范围</span>
              <h3>明确归属、排期与交付边界</h3>
            </header>
            <div className="requirement-scope-grid">
              <Form.Item label="所属项目">
                <Select
                  aria-label="所属项目"
                  value={projectId}
                  disabled={
                    busy ||
                    dirty ||
                    !!browserDraft.candidate ||
                    type === 'BUG' ||
                    !!initial?.requirements?.length
                  }
                  onChange={(id) => {
                    setProjectId(id);
                    setSelectedTemplate(undefined);
                    form.setFieldsValue(
                      Object.fromEntries(
                        [
                          'productId',
                          'engineerId',
                          'testerId',
                          'productReviewerId',
                          'qaReviewerId',
                        ].map((k) => [k, undefined]),
                      ),
                    );
                  }}
                  options={(
                    choices.data || [
                      {
                        id: originalProjectId,
                        name: projectName || '当前项目',
                      },
                    ]
                  )
                    .filter((p: any) => !p.archivedAt)
                    .map((p: any) => ({ value: p.id, label: p.name }))}
                />
              </Form.Item>
              <Form.Item name="dueAt" label="计划截止">
                <Input type="date" />
              </Form.Item>
            </div>
          </section>
          <p className="muted">
            切换项目后请重新选择负责人。仅未提交且无关联材料的普通草稿可调整归属，缺陷与已提交需求保留原项目。
          </p>
          <section className="requirement-section">
            <header>
              <span>03 · 协作成员</span>
              <h3>
                <TeamOutlined /> 分配各阶段的直接责任人
              </h3>
              <p>
                {simple
                  ? '只需指定需求负责人和执行人，可以由同一人承担。'
                  : compact
                    ? '紧凑模式：只需指定需求负责人、执行人与验收人，方案评估默认由需求负责人兼任。'
                    : '可分配阶段职责；方案需两位独立评估人确认。'}
              </p>
            </header>
            {compact && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="紧凑模式：产品评估人与测试评估人默认由需求负责人兼任（同一人兼任两项评估）"
              />
            )}
            <div className="requirement-owner-grid">
              {[
                ['productId', '产品负责人'],
                ['engineerId', '研发负责人'],
                ['testerId', '测试负责人'],
                ['productReviewerId', '产品评估人'],
                ['qaReviewerId', '测试评估人'],
              ]
                .map(([key, base]) => [
                  key as string,
                  (simple && key === 'engineerId'
                    ? '执行人'
                    : simple && key === 'productId'
                      ? '需求负责人'
                      : compact && key === 'productId'
                        ? '需求负责人'
                        : compact && key === 'engineerId'
                          ? '执行人'
                          : compact && key === 'testerId'
                            ? '验收人'
                            : base) as string,
                ])
                .map(([key, label]) => (
                  <Form.Item
                    key={key}
                    name={key}
                    label={label}
                    hidden={
                      simple
                        ? !['productId', 'engineerId'].includes(key)
                        : compact
                          ? !['productId', 'engineerId', 'testerId'].includes(
                              key,
                            )
                          : key !== 'productId' && !expanded
                    }
                    rules={[
                      {
                        required: false,
                        message: `请选择${label}`,
                      },
                    ]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder={`选择${label}`}
                      options={members.map((m: Member) => ({
                        value: m.id,
                        label: m.name,
                      }))}
                    />
                  </Form.Item>
                ))}
            </div>
          </section>
          <section
            id="requirement-more"
            hidden={!expanded}
            className="requirement-section"
          >
            <header>
              <span>04 · 补充信息</span>
              <h3>完善背景、方案上下文与验收标准</h3>
            </header>
            <div className="form-grid">
              <Form.Item name="background" label="背景">
                <Input.TextArea rows={3} placeholder="当前遇到了什么问题？" />
              </Form.Item>
              <Form.Item name="goal" label="目标">
                <Input.TextArea rows={3} placeholder="希望实现什么结果？" />
              </Form.Item>
            </div>
            <Form.Item name="description" label="需求描述（Markdown）">
              <Input.TextArea
                rows={5}
                placeholder="说明需求范围、使用场景与边界条件"
              />
            </Form.Item>
            <Form.Item name="criteria" label="验收标准（每行一项）">
              <Input.TextArea
                rows={4}
                placeholder="写下可验证的完成标准，每行一项"
              />
            </Form.Item>
            <Form.Item name="criteriaOverrideReason" hidden>
              <Input />
            </Form.Item>
            {criteriaWarnings.length > 0 && (
              <div className="criteria-warnings" role="alert">
                <div className="criteria-warnings-head">
                  <span>
                    验收标准质量提醒 · {criteriaWarnings.length} 条
                    <span className="criteria-warnings-note">
                      （点击提醒定位到验收标准；
                      {strictProject
                        ? '严格模式：提交将被拒绝，团队管理员可填理由强制放行'
                        : '提醒不阻断提交，忽略会记录到时间线'}
                      ）
                    </span>
                  </span>
                  {aiReady && (
                    <Popconfirm
                      title="发送至 DeepSeek 改写"
                      description="将当前验收标准与需求说明发送至 DeepSeek（使用个人 Key，可能产生费用），改写结果会先填入表单供核对。"
                      okText="同意并改写"
                      cancelText="取消"
                      onConfirm={rewriteCriteria}
                      disabled={rewriting}
                    >
                      <Button size="small" loading={rewriting}>
                        帮我改写
                      </Button>
                    </Popconfirm>
                  )}
                </div>
                {criteriaWarnings.map((w, i) => (
                  <button
                    key={i}
                    type="button"
                    className="criteria-warning"
                    onClick={() => locate('criteria')}
                  >
                    {w.message}
                  </button>
                ))}
              </div>
            )}
          </section>
        </Form>
      </Modal>
      <Modal
        open={!!preview}
        title="应用需求模板"
        okText="填入所选字段"
        okButtonProps={{ disabled: !templateFields.length }}
        onCancel={() => setPreview(undefined)}
        onOk={() => {
          const values = templateFormValues(preview!);
          form.setFieldsValue(
            Object.fromEntries(
              templateFields.map((k) => [k, values[k as keyof typeof values]]),
            ),
          );
          setExpanded(true);
          setPreview(undefined);
          persist();
          message.success('所选字段已填入，请核对后保存');
        }}
      >
        <p>
          勾选需要填入的字段；已填写内容会被所选字段替换。负责人和日期保持当前值。
        </p>
        <Checkbox.Group
          value={templateFields}
          onChange={(v) => setTemplateFields(v as string[])}
        >
          <Space direction="vertical">
            {Object.entries(templateLabels).map(([key, label]) => (
              <div key={key}>
                <Checkbox value={key}>{label}</Checkbox>
                <p className="muted">
                  当前：
                  {String(form.getFieldValue(key) || '未填写').slice(0, 160)}
                </p>
                <p>
                  模板：
                  {String(
                    preview
                      ? templateFormValues(preview)[
                          key as keyof ReturnType<typeof templateFormValues>
                        ]
                      : '',
                  ).slice(0, 300)}
                </p>
              </div>
            ))}
          </Space>
        </Checkbox.Group>
      </Modal>
      <Modal
        open={overrideOpen}
        title="严格模式：管理员强制放行"
        okText="强制放行并提交"
        okButtonProps={{ disabled: overrideText.trim().length < 10 }}
        onCancel={() => setOverrideOpen(false)}
        onOk={() => {
          form.setFieldsValue({
            criteriaOverrideReason: overrideText.trim(),
          });
          setOverrideOpen(false);
          submitIntent.current = true;
          form.submit();
        }}
      >
        <p className="muted">
          当前存在 {criteriaWarnings.length} 条验收标准质量提醒。填写不少于
          10 字的放行理由后继续提交；理由与提醒将记录到需求时间线。
        </p>
        <Input.TextArea
          rows={3}
          value={overrideText}
          onChange={(e) => setOverrideText(e.target.value)}
          placeholder="说明为何在存在提醒的情况下仍然放行（不少于 10 字）"
        />
      </Modal>
      {snapshot && (
        <Modal
          open
          title="保存为需求模板"
          onCancel={() => {
            if (!savingTemplate) setSnapshot(undefined);
          }}
          footer={null}
          maskClosable={!savingTemplate}
          keyboard={!savingTemplate}
          closable={!savingTemplate}
        >
          <p>
            保存当前需求的标题、背景、目标、说明、验收标准和优先级，供本项目复用。
          </p>
          <Input
            aria-label="保存模板名称"
            placeholder="例如：接口对接需求"
            maxLength={80}
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            disabled={savingTemplate}
          />
          {templateError && <Alert type="error" message={templateError} />}
          <Button
            type="primary"
            style={{ marginTop: 16 }}
            disabled={!templateName.trim()}
            loading={savingTemplate}
            onClick={async () => {
              setSavingTemplate(true);
              setTemplateError('');
              try {
                await api(`/projects/${projectId}/templates`, 'POST', {
                  name: templateName.trim(),
                  content: snapshot,
                  active: true,
                });
                await qc.invalidateQueries({
                  queryKey: ['templates', projectId],
                });
                setSnapshot(undefined);
                message.success('需求模板已保存');
              } catch (e) {
                setTemplateError((e as Error).message);
              } finally {
                setSavingTemplate(false);
              }
            }}
          >
            确认保存模板
          </Button>
        </Modal>
      )}
    </>
  );
}

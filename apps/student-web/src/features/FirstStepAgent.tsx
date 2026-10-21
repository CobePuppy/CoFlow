import { createClientId } from '@coflow/web-core/shared/lib/client-id';
import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Steps,
  Tabs,
} from 'antd';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, useData } from '@coflow/web-core/shared/api/runtime';
import { Markdown } from '@coflow/web-core/shared/ui/Markdown';
import type { Competition } from '@coflow/contracts/index.js';
import {
  firstStepSections,
  type FirstStepBrief,
  type FirstStepBundle,
} from '@coflow/contracts/firststep.js';

type Result = {
  bundle: FirstStepBundle;
  model: string;
  competitionVersion: number;
  generatedAt: string;
  usage: { promptTokens: number; completionTokens: number };
};
function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/markdown;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function FirstStepAgent({
  competition,
  readOnly,
  onClose,
}: {
  competition: Competition;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp(),
    qc = useQueryClient();
  const settings = useData(['settings'], '/settings');
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (settings.data && !initialized) {
      setModel(settings.data.model);
      setBrief((v) => ({
        ...v,
        slides: settings.data.slides,
        minutes: settings.data.minutes,
      }));
      setInitialized(true);
    }
  }, [settings.data, initialized]);
  const [brief, setBrief] = useState<FirstStepBrief>({
    problem: '',
    team: '',
    constraints: '',
    slides: 12,
    minutes: 8,
  });
  const [model, setModel] = useState('deepseek-flash'),
    [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'verify' | 'run' | 'save' | ''>(
      '',
    ),
    [error, setError] = useState(''),
    [preview, setPreview] = useState(''),
    [result, setResult] = useState<Result>();
  const [saveKey, setSaveKey] = useState(''),
    [saved, setSaved] = useState<{ id: string; title: string }[]>();
  const set = (key: keyof FirstStepBrief, value: string | number) =>
    setBrief((previous) => ({ ...previous, [key]: value }));
  const validateBrief = () => {
    if (brief.problem.trim().length < 40) {
      setError(
        '请先粘贴至少40字的赛题原文、评分要求或交付要求。只有名称和网址不足以进行可靠分析。',
      );
      return false;
    }
    return true;
  };
  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => message.success('已复制'))
      .catch(() => message.error('复制失败，可直接选中内容复制'));
  const pack = result
    ? `# ${competition.name} · FirstStepAgent\n\n> 模型：${result.model}；生成时间：${result.generatedAt}。AI草稿，待人工核对。\n\n` +
      Object.entries(firstStepSections)
        .map(
          ([key, label]) =>
            `# ${label}\n\n${result.bundle[key as keyof typeof firstStepSections]}\n`,
        )
        .join('\n') +
      '\n## 待确认问题\n' +
      result.bundle.questions.map((q) => '- ' + q).join('\n')
    : '';
  return (
    <Modal
      open
      title="FirstStepAgent · 竞赛启动助手"
      width={1120}
      style={{ top: 20 }}
      footer={null}
      destroyOnHidden
      keyboard={!busy}
      maskClosable={!busy}
      closable={!busy}
      onCancel={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <Steps
        size="small"
        current={
          busy === 'run'
            ? 2
            : result
              ? 3
              : brief.problem.trim().length >= 40
                ? 1
                : 0
        }
        items={[
          { title: '提供赛题' },
          { title: '读取个人配置' },
          { title: '分析与生成' },
          { title: '核对与使用' },
        ]}
      />
      <Alert
        style={{ margin: '16px 0' }}
        type="info"
        showIcon
        message={`围绕“${competition.name}”生成6份启动成果`}
        description="包含竞赛分析、开发提示词、技术栈文档、PPT生成提示词、分工里程碑和提交检查清单。缺失信息会列为待确认；通知网址不会被自动读取。"
      />
      {readOnly && (
        <Alert
          type="warning"
          message="项目已归档，可预览本地提示词；生成和保存已禁用。"
        />
      )}
      <Card size="small" title="1 · 赛题与团队资料">
        <label htmlFor="firststep-problem">
          赛题原文、评分与交付要求（必填）
        </label>
        <Input.TextArea
          id="firststep-problem"
          value={brief.problem}
          onChange={(e) => set('problem', e.target.value)}
          maxLength={30000}
          showCount
          rows={6}
          placeholder="粘贴题目、官方要求或已确认资料；未明确的规则请写“待确认”。不要填写密码、API Key或不应发送的资料。"
          disabled={!!busy}
        />
        <div className="form-grid" style={{ marginTop: 20 }}>
          <div>
            <label htmlFor="firststep-team">团队能力与分工</label>
            <Input.TextArea
              id="firststep-team"
              value={brief.team}
              onChange={(e) => set('team', e.target.value)}
              maxLength={4000}
              rows={3}
              placeholder="人数、技能、经验、每周可用时间"
              disabled={!!busy}
            />
          </div>
          <div>
            <label htmlFor="firststep-constraints">限制与已有成果</label>
            <Input.TextArea
              id="firststep-constraints"
              value={brief.constraints}
              onChange={(e) => set('constraints', e.target.value)}
              maxLength={4000}
              rows={3}
              placeholder="时间、预算、平台、数据、现有原型和需要遵守的要求"
              disabled={!!busy}
            />
          </div>
        </div>
        <Space wrap style={{ marginTop: 16 }}>
          <label htmlFor="firststep-slides">PPT页数</label>
          <InputNumber
            id="firststep-slides"
            min={5}
            max={30}
            value={brief.slides}
            onChange={(v) => set('slides', v || 12)}
            disabled={!!busy}
          />
          <label htmlFor="firststep-minutes">答辩时长（分钟）</label>
          <InputNumber
            id="firststep-minutes"
            min={3}
            max={30}
            value={brief.minutes}
            onChange={(v) => set('minutes', v || 8)}
            disabled={!!busy}
          />
        </Space>
      </Card>
      <Card
        size="small"
        title="2 · 使用自己的API Key"
        style={{ marginTop: 16 }}
      >
        <Alert
          type={settings.data?.hasKey ? 'success' : 'info'}
          message={
            settings.data?.hasKey
              ? '使用个人设置中保存的Key：' + settings.data.keyHint
              : '请先在个人设置中配置API Key'
          }
          description="配置一次，所有竞赛复用。默认模型和PPT参数也从个人设置读取。"
        />
        {settings.error && (
          <Alert type="error" message={settings.error.message} />
        )}
        <Link to="/?section=settings">前往个人设置 · 管理API Key</Link>
        <Select
          aria-label="FirstStep模型"
          value={model}
          onChange={setModel}
          disabled={!!busy}
          options={[
            { value: 'deepseek-flash', label: 'DeepSeek Flash' },
            { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
          ]}
          style={{ minWidth: 230, margin: 16 }}
        />
        <p className="muted">
          点击生成后，赛题、团队与限制输入，以及当前竞赛名称、主办方、日期、备注和通知网址，将经CoFlow服务器发送给DeepSeek。生成结果仅在你点击保存后写入项目文档。
          <a
            href="https://api-docs.deepseek.com/quick_start/pricing/"
            target="_blank"
            rel="noopener noreferrer"
          >
            查看官方计费说明
          </a>
        </p>
        <Checkbox
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={!!busy}
        >
          我已核对发送资料，确认使用自己的Key调用DeepSeek，并了解可能产生费用
        </Checkbox>
      </Card>
      {error && (
        <Alert
          style={{ marginTop: 16 }}
          type="error"
          showIcon
          message={error}
        />
      )}
      <Space wrap style={{ margin: '16px 0' }}>
        <Button
          loading={busy === 'preview'}
          disabled={!!busy}
          onClick={async () => {
            if (!validateBrief()) return;
            setBusy('preview');
            setError('');
            try {
              const data = await api(
                `/competitions/${competition.id}/firststep/preview`,
                'POST',
                { brief },
              );
              setPreview(
                data.messages
                  .map(
                    (item: { role: string; content: string }) =>
                      `## ${item.role}\n\n${item.content}`,
                  )
                  .join('\n\n'),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy('');
            }
          }}
        >
          预览提示词（无需Key）
        </Button>
        <Button
          type="primary"
          loading={busy === 'run'}
          disabled={
            !!busy ||
            !settings.data?.hasKey ||
            !settings.data?.encryptionReady ||
            !consent ||
            readOnly
          }
          onClick={async () => {
            if (!validateBrief()) return;
            setBusy('run');
            setError('');
            try {
              const next = await api(
                `/competitions/${competition.id}/firststep/run`,
                'POST',
                {
                  brief,
                  model,
                  expectedVersion: competition.version,
                  consent: true,
                },
              );
              setResult(next);
              setSaved(undefined);
              setSaveKey(createClientId());
              message.success('6份成果已生成，请先核对再使用');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy('');
            }
          }}
        >
          使用我的Key生成6份成果
        </Button>
        {busy === 'run' && (
          <span role="status">
            正在生成，最长约2分钟；不会自动重试或重复调用。
          </span>
        )}
      </Space>
      {preview && (
        <details>
          <summary>查看实际发送的提示词与资料</summary>
          <Button onClick={() => copy(preview)}>复制完整提示词</Button>
          <pre
            style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}
          >
            {preview}
          </pre>
        </details>
      )}
      {result && (
        <section aria-label="FirstStepAgent成果">
          <Alert
            type="warning"
            showIcon
            message="AI生成草稿，尚未人工核对"
            description={`请核对官方规则、技术可行性、证据和引用。模型：${result.model}；输入Token ${result.usage.promptTokens}，输出Token ${result.usage.completionTokens}。PPT部分是提示词，不是PPTX文件。`}
          />
          {!!result.bundle.questions.length && (
            <Card size="small" title="优先确认的问题" style={{ marginTop: 16 }}>
              <ul>
                {result.bundle.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </Card>
          )}
          <Tabs
            items={Object.entries(firstStepSections).map(([key, label]) => ({
              key,
              label,
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button
                      onClick={() =>
                        copy(
                          result.bundle[key as keyof typeof firstStepSections],
                        )
                      }
                    >
                      复制本节
                    </Button>
                    <Button
                      onClick={() =>
                        download(
                          result.bundle[key as keyof typeof firstStepSections],
                          competition.name + '-' + label,
                        )
                      }
                    >
                      下载本节Markdown
                    </Button>
                  </Space>
                  <Markdown>
                    {result.bundle[key as keyof typeof firstStepSections]}
                  </Markdown>
                </>
              ),
            }))}
          />
          <Space wrap>
            <Button
              onClick={() =>
                download(pack, competition.name + '-FirstStepAgent')
              }
            >
              下载全部Markdown
            </Button>
            <Button
              type="primary"
              disabled={!!busy || !!saved || readOnly}
              loading={busy === 'save'}
              onClick={async () => {
                setBusy('save');
                setError('');
                try {
                  const response = await api(
                    `/competitions/${competition.id}/firststep/save`,
                    'POST',
                    {
                      bundle: result.bundle,
                      expectedVersion: result.competitionVersion,
                      requestKey: saveKey,
                    },
                  );
                  setSaved(response.documents);
                  await qc.invalidateQueries({
                    queryKey: ['documents', competition.projectId],
                  });
                  message.success('6份草稿已保存到项目文书与知识库');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy('');
                }
              }}
            >
              保存6份草稿到文书中心
            </Button>
          </Space>
          {saved && (
            <Card
              size="small"
              title="已保存的项目文档"
              style={{ marginTop: 16 }}
            >
              <ul>
                {saved.map((doc) => (
                  <li key={doc.id}>
                    <Link
                      to={
                        '/?' +
                        new URLSearchParams({
                          section: 'writing',
                          workspace: competition.workspaceId,
                          project: competition.projectId,
                          document: doc.id,
                        })
                      }
                      onClick={onClose}
                    >
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}
    </Modal>
  );
}

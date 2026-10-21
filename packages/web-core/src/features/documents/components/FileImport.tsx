import { useEffect, useState } from 'react';
import {
  materialImports,
  materialFieldsFromText,
  type ImportKind,
  type MaterialKind,
} from '@coflow/contracts/material-import.js';
import { Alert, Button, Checkbox, Input, Modal, Space, App } from 'antd';
import { Link } from 'react-router-dom';
import { api, useData } from '../../../shared/api/runtime.js';
import { editionHome } from '../../../app/edition.js';
import { parseImportFile } from '../import/file-import.js';

export default function FileImport({
  kind,
  onApply,
  source,
  buttonLabel,
}: {
  kind: ImportKind;
  source?: { id: string; name: string };
  buttonLabel?: string;
  onApply: (fields: any) => void;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(''),
    [name, setName] = useState(''),
    [warning, setWarning] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false);
  const [fields, setFields] = useState<any>();
  const settings = useData(['settings'], '/settings', open);
  const { message } = App.useApp();
  const material = materialImports[kind as MaterialKind];
  const cleanFields = (value: any) =>
    material
      ? Object.fromEntries(
          Object.entries(value).filter(
            ([key, v]) =>
              key in material.fields &&
              v !== '' &&
              v !== undefined &&
              v !== null,
          ),
        )
      : value;
  const tooLong =
    fields &&
    Object.entries(fields).some(
      ([key, value]) =>
        typeof value === 'string' &&
        value.length >
          (material?.fields[key]?.max ||
            (kind === 'project' && key === 'description' ? 10000 : 60000)),
    );
  useEffect(() => {
    if (!source) return;
    let active = true;
    const controller = new AbortController();
    setOpen(true);
    setBusy(true);
    setError('');
    setText('');
    setName('');
    setFields(undefined);
    setConsent(false);
    setWarning('');
    (async () => {
      try {
        const response = await fetch(
          '/api/v1/attachments/' + encodeURIComponent(source.id) + '/download',
          { credentials: 'same-origin', signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? '附件不存在或已删除'
              : response.status === 401
                ? '登录已失效，请重新登录'
                : '没有权限读取附件或附件读取失败',
          );
        if (Number(response.headers.get('Content-Length')) > 8 * 1024 * 1024)
          throw new Error('解析支持8MB以内的文件，请拆分后导入');
        const file = new File([await response.blob()], source.name);
        const parsed = await parseImportFile(file);
        if (active) {
          setText(parsed.text);
          setName(file.name);
          setWarning(parsed.warning);
        }
      } catch (error) {
        if (active) setError((error as Error).message);
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [source]);
  const localFields = () =>
    material
      ? materialFieldsFromText(kind as MaterialKind, text)
      : kind === 'project'
        ? {
            name: name.replace(/\.[^.]+$/, '').slice(0, 200),
            description: text,
          }
        : {
            title: name.replace(/\.[^.]+$/, '').slice(0, 200),
            description: text,
          };
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        {buttonLabel || '从文件导入信息'}
      </Button>
      <Modal
        open={open}
        title="文件解析与填入"
        width={760}
        footer={null}
        onCancel={() => !busy && setOpen(false)}
        destroyOnHidden
      >
        {material && (
          <Alert
            type="info"
            message={
              material.title +
              '文件解析：仅填入资料字段，不自动保存、提交、改变负责人或推进状态；测试结果由处理人确认。'
            }
          />
        )}
        {source && <p>来源附件：{source.name}</p>}
        <p>
          支持TXT、Markdown、DOCX、文字型PDF，最大8MB、6万字符。文件在浏览器本地解析；已上传附件通过鉴权读取，选择本地文件不会自动上传原件。
        </p>
        <input
          type="file"
          aria-label="选择信息文件"
          accept=".txt,.md,.docx,.pdf"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBusy(true);
            setError('');
            setFields(undefined);
            setConsent(false);
            setText('');
            setName('');
            setWarning('');
            try {
              const parsed = await parseImportFile(file);
              setText(parsed.text);
              setWarning(parsed.warning);
              setName(file.name);
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
        {busy && <p role="status">正在处理，请稍候…</p>}
        {error && <Alert type="error" message={error} />}
        {warning && <Alert type="info" message={warning} />}
        {text && (
          <>
            <p>
              {name} · {text.length}{' '}
              字符。请检查正文，删除不希望发送或导入的内容。
            </p>
            <Input.TextArea
              aria-label="解析正文预览"
              rows={9}
              maxLength={60000}
              value={text}
              disabled={busy}
              onChange={(e) => {
                setText(e.target.value);
                setFields(undefined);
                setConsent(false);
              }}
            />
            {!settings.data?.hasKey && (
              <Alert
                type="info"
                message={
                  <span>
                    本地导入无需API Key。AI整理需先到
                    <Link to={editionHome + '?section=settings&settingsTab=ai'}>
                      个人AI设置
                    </Link>
                    保存Key。
                  </span>
                }
              />
            )}
            <Checkbox
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            >
              同意将预览正文发送至个人设置的DeepSeek模型，可能产生API费用
            </Checkbox>
            <Space wrap style={{ margin: '12px 0' }}>
              <Button
                loading={busy}
                disabled={!consent || !settings.data?.hasKey || !text.trim()}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const result = await api('/ai/import', 'POST', {
                      kind,
                      text,
                      consent: true,
                    });
                    setFields(cleanFields(result.fields));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                AI整理字段
              </Button>
              <Button disabled={busy} onClick={() => setFields(localFields())}>
                {material ? '按原文提取字段' : '按正文填入说明'}
              </Button>
            </Space>
            {fields && (
              <>
                <Alert
                  type="warning"
                  message="确认后覆盖下列字段，其他表单信息保留。请核对AI提取内容，缺失字段需自行补充。"
                />
                {Object.entries(fields).map(([key, value]) => (
                  <div key={key}>
                    <strong>
                      {material?.fields[key]?.label ||
                        {
                          name: '项目名称',
                          title: '需求标题',
                          description: '说明',
                          background: '背景',
                          goal: '目标',
                          criteria: '验收标准',
                        }[key] ||
                        key}
                    </strong>
                    <p
                      style={{
                        whiteSpace: 'pre-wrap',
                        maxHeight: 180,
                        overflow: 'auto',
                      }}
                    >
                      {Array.isArray(value) ? value.join('\n') : String(value)}
                    </p>
                  </div>
                ))}
                <Button
                  type="primary"
                  disabled={busy || tooLong}
                  onClick={() => {
                    onApply(cleanFields(fields));
                    setOpen(false);
                    message.success('已填入表单，请核对后保存');
                  }}
                >
                  确认填入表单
                </Button>
                {tooLong && (
                  <Alert
                    type="warning"
                    message="字段超过表单长度限制，请精简预览正文后重新整理"
                  />
                )}
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

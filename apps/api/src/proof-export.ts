import { createHash } from 'node:crypto';
import { proofStateLabels } from '../../../packages/contracts/proofloop.js';

export function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return '[' + value.map(canonicalJson).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k]))
      .join(',') +
    '}'
  );
}
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const quote = (value: unknown) =>
  String(value ?? '')
    .split(/\r?\n/)
    .map((line) => '> ' + line)
    .join('\n');
export function createProofExport(
  competition: any,
  project: any,
  view: any,
  at = new Date().toISOString(),
) {
  const referenced = new Set<string>([
    ...view.data.claims.flatMap((c: any) =>
      c.evidence.map((e: any) => e.documentId),
    ),
    ...view.data.findings.flatMap((f: any) =>
      f.sources.map((s: any) => s.documentId),
    ),
    ...Object.keys(view.data.checked?.documentVersions || {}),
  ]);
  const documents = view.documents
    .filter((d: any) => referenced.has(d.id))
    .map((d: any) => ({ ...d, contentSha256: digest(d.content) }));
  const missingSourceIds = [...referenced].filter(
    (id) => !documents.some((d: any) => d.id === id),
  );
  const unresolved = view.data.claims
    .filter((c: any) => view.states[c.id] !== 'VERIFIED')
    .map((c: any) => ({
      claimId: c.id,
      statement: c.statement,
      state: view.states[c.id],
    }));
  const payload = {
    format: 'coflow-proofloop/v1',
    generatedAt: at,
    project: { id: project.id, name: project.name },
    competition: {
      id: competition.id,
      name: competition.name,
      version: competition.version,
    },
    boardVersion: view.version,
    claims: view.data.claims,
    states: view.states,
    findings: view.data.findings,
    check: view.data.checked || null,
    checkOutdated: view.checkOutdated,
    tasks: view.tasks,
    documents,
    missingSourceIds,
    unresolved,
    notice:
      '团队自述与人工核对记录，仅供复查；内容摘要用于文件完整性比对，不是时间戳存证、第三方认证或事实真实性证明。导出包含所关联文书正文，请自行控制分享范围。',
  };
  const hash = digest(canonicalJson(payload));
  const markdown = [
    '# CoFlow ProofLoop 成果证据包',
    quote(competition.name),
    '- 导出时间：' + at,
    '- 记录版本：' + view.version,
    '- SHA-256：' + hash,
    quote(payload.notice),
    '## 提交前待处理',
    unresolved.length
      ? unresolved
          .map(
            (c: any) =>
              '- ' +
              (proofStateLabels[c.state as keyof typeof proofStateLabels] ||
                c.state) +
              '：' +
              c.statement.replace(/\r?\n/g, ' '),
          )
          .join('\n')
      : '当前登记主张均显示人工核对支持；仍需自行检查赛题覆盖、原始数据及验证方法。',
    view.checkOutdated ? '⚠ 最近一次跨文书检查已过期，请重新检查。' : '',
    !view.data.checked
      ? '尚未执行跨文书检查。'
      : '检查只覆盖当次所选文书；未发现疑点不代表没有问题。',
    missingSourceIds.length
      ? '⚠ 有无法读取的来源：' + missingSourceIds.join(', ')
      : '',
    '## 主张、证据与核对记录',
    ...view.data.claims.map((c: any) =>
      [
        '### 主张 ' + c.id,
        quote(c.statement),
        '状态：' +
          (proofStateLabels[
            view.states[c.id] as keyof typeof proofStateLabels
          ] || view.states[c.id]),
        '验证条件：\n' + quote(c.criterion || '待补充'),
        '团队重要度：' +
          (c.importance || 3) +
          '；预计补证工时：' +
          (c.effortHours || 2),
        ...c.evidence.map(
          (e: any) =>
            '文书 ' +
            e.documentId +
            ' · 引用版本v' +
            e.version +
            '\n' +
            quote(e.quote) +
            '\n验证说明：\n' +
            quote(e.note),
        ),
        ...(c.reviews || []).map(
          (r: any) =>
            '历史核对（仅适用于当时版本）：' +
            r.outcome +
            ' · ' +
            r.by +
            ' · ' +
            r.at +
            '\n' +
            quote(r.note),
        ),
        c.taskId
          ? '补证任务：' +
            c.taskId +
            ' · 状态 ' +
            (view.tasks[c.taskId]?.status || '不可读取')
          : '尚无补证任务',
      ].join('\n\n'),
    ),
    '## AI疑点（待人工核对）',
    ...view.data.findings.map((f: any) =>
      [
        quote(f.reason),
        '建议：\n' + quote(f.suggestion),
        ...f.sources.map(
          (s: any) => '文书 ' + s.documentId + '\n' + quote(s.quote),
        ),
        f.taskId ? '任务：' + f.taskId : '尚无补证任务',
      ].join('\n\n'),
    ),
    '## 关联文书清单',
    ...documents.map(
      (d: any) =>
        quote(d.title) +
        '\nID：' +
        d.id +
        '；当前版本v' +
        d.version +
        '；正文SHA-256：' +
        d.contentSha256,
    ),
    '完整正文、机器可读状态及摘要验证所需数据保存在同次导出的JSON证据包中。',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { digestAlgorithm: 'SHA-256', digest: hash, payload, markdown };
}

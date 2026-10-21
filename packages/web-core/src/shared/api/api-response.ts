export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function readApiResponse(r: Response) {
  const text = await r.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Proxies may return HTML; never expose their contents in error messages.
  }
  if (!r.ok) {
    if (!data || typeof data !== 'object') data = {};
    const names: Record<string, string> = {
      body: '方案正文',
      scope: '影响范围',
      effort: '工作量',
      risk: '风险说明',
      start: '开始日期',
      end: '结束日期',
      summary: '开发说明',
      selfTest: '自测结果',
      releaseVersion: '交付版本',
      environment: '环境',
      knownIssues: '已知问题',
      record: '测试记录',
      deployment: '部署验证',
      reason: '原因',
      checks: '验收标准',
      criteria: '验收标准',
      description: '需求描述',
    };
    const fieldErrors = data.fieldErrors?.fieldErrors;
    const explanation = fieldErrors
      ? Object.keys(fieldErrors)
          .map((k) => `${names[k] || k}填写不完整或格式有误`)
          .join('；')
      : typeof data.message === 'string'
        ? data.message
        : `请求失败（HTTP ${r.status}），请稍后重试`;
    throw new ApiError(
      `${explanation}${r.status === 409 ? '（输入已保留，请核对最新状态）' : ''}`,
      r.status,
    );
  }
  if (
    data === undefined ||
    (text === '' && r.status !== 204 && r.status !== 205)
  ) {
    throw new ApiError('服务器响应格式异常，请稍后重试', r.status);
  }
  return data;
}

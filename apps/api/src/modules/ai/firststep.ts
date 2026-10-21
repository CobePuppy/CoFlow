import {
  firstStepMessages,
  type FirstStepBrief,
  type FirstStepBundle,
} from '@coflow/contracts/firststep.js';
import { z } from 'zod';
import { BusinessError } from '../requirements/domain.js';

export const firstStepBriefSchema = z
  .object({
    problem: z
      .string()
      .trim()
      .min(40, '请提供至少40字的赛题原文或要求')
      .max(30000),
    team: z.string().max(4000).default(''),
    constraints: z.string().max(4000).default(''),
    slides: z.number().int().min(5).max(30).default(12),
    minutes: z.number().int().min(3).max(30).default(8),
  })
  .strict();
export const firstStepBundleSchema = z
  .object({
    analysis: z.string().min(40).max(20000),
    developmentPrompt: z.string().min(40).max(20000),
    techStack: z.string().min(40).max(20000),
    pptPrompt: z.string().min(40).max(20000),
    executionPlan: z.string().min(40).max(20000),
    submissionChecklist: z.string().min(40).max(20000),
    questions: z.array(z.string().max(1000)).max(15),
  })
  .strict();
export const firstStepCredentials = z.object({
  apiKey: z
    .string()
    .trim()
    .min(8, '请填写有效API Key')
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/, 'API Key格式不正确'),
  model: z
    .enum(['deepseek-flash', 'deepseek-v4-pro'])
    .default('deepseek-flash'),
});
export const firstStepRunSchema = firstStepCredentials
  .omit({ apiKey: true })
  .extend({
    brief: firstStepBriefSchema,
    expectedVersion: z.number().int().positive(),
    consent: z.literal(true, { error: '请先确认发送资料及计费说明' }),
  })
  .strict();
const endpoint = 'https://api.deepseek.com';
function upstreamFailure(status: number): never {
  if (status === 401 || status === 403)
    throw new BusinessError(
      422,
      'DeepSeek Key无效或无权限，请到平台检查；CoFlow登录状态未受影响',
      'AI_KEY_INVALID',
    );
  if (status === 402)
    throw new BusinessError(
      422,
      'DeepSeek余额不足，请检查充值和额度',
      'AI_BALANCE',
    );
  if (status === 429)
    throw new BusinessError(
      429,
      'DeepSeek请求受限，请稍后手动重试；本次不会自动重发',
      'AI_RATE_LIMIT',
    );
  throw new BusinessError(
    502,
    'DeepSeek暂时不可用，请稍后手动重试；本次不会自动重发',
    'AI_UPSTREAM',
  );
}
async function readLimited(response: Response) {
  if (!response.body)
    throw new BusinessError(502, '模型返回空响应，请稍后重试', 'AI_EMPTY');
  const reader = response.body.getReader();
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 512000) {
        await reader.cancel();
        throw new BusinessError(
          502,
          '模型响应过大，请减少资料后重试',
          'AI_OUTPUT_SIZE',
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError(502, '模型响应格式异常，请稍后重试', 'AI_FORMAT');
  } finally {
    reader.releaseLock();
  }
}
export async function deepSeekRequest(
  path: string,
  apiKey: string,
  body: unknown,
  fetcher: typeof fetch = fetch,
) {
  try {
    const response = await fetcher(endpoint + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(body === undefined ? 20000 : 120000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      upstreamFailure(response.status);
    }
    return await readLimited(response);
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError(
      502,
      'DeepSeek连接失败或超时，请检查网络后手动重试',
      'AI_CONNECTION',
    );
  }
}
export async function verifyFirstStepKey(
  apiKey: string,
  model: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await deepSeekRequest('/models', apiKey, undefined, fetcher);
  if (
    !Array.isArray(response?.data) ||
    !response.data.some((item: any) => item?.id === model)
  )
    throw new BusinessError(
      422,
      'Key可连接，但当前模型不可用，请检查所选模型',
      'AI_MODEL',
    );
  return { ok: true, model };
}
export async function generateFirstStep(
  competition: Parameters<typeof firstStepMessages>[0],
  brief: FirstStepBrief,
  apiKey: string,
  model: string,
  fetcher: typeof fetch = fetch,
): Promise<{
  bundle: FirstStepBundle;
  usage: { promptTokens: number; completionTokens: number };
}> {
  const response = await deepSeekRequest(
    '/chat/completions',
    apiKey,
    {
      model,
      messages: firstStepMessages(competition, brief).map((message) => ({
        ...message,
        content: message.content.replaceAll(apiKey, '[API Key已隐藏]'),
      })),
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      max_tokens: 10000,
      stream: false,
    },
    fetcher,
  );
  const choice = response?.choices?.[0];
  if (choice?.finish_reason !== 'stop')
    throw new BusinessError(
      502,
      '模型输出未完整结束，未保存不完整成果；请减少资料后手动重试',
      'AI_INCOMPLETE',
    );
  let parsed: unknown;
  try {
    if (
      typeof choice.message?.content !== 'string' ||
      !choice.message.content.trim()
    )
      throw new Error();
    parsed = JSON.parse(choice.message.content);
  } catch {
    throw new BusinessError(
      502,
      '模型未返回有效JSON成果，未保存；可减少资料后手动重试',
      'AI_FORMAT',
    );
  }
  const result = firstStepBundleSchema.safeParse(parsed);
  if (!result.success)
    throw new BusinessError(
      502,
      '模型成果缺少必要章节或超过长度限制，未保存，请手动重试',
      'AI_VALIDATION',
    );
  const token = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
  return {
    bundle: Object.fromEntries(
      Object.entries(result.data).map(([field, value]) => [
        field,
        Array.isArray(value)
          ? value.map((item) => item.replaceAll(apiKey, '[API Key已隐藏]'))
          : value.replaceAll(apiKey, '[API Key已隐藏]'),
      ]),
    ) as unknown as FirstStepBundle,
    usage: {
      promptTokens: token(response.usage?.prompt_tokens),
      completionTokens: token(response.usage?.completion_tokens),
    },
  };
}
const active = new Set<string>();
const recent = new Map<string, number[]>();
export async function withFirstStepLimit<T>(
  userId: string,
  run: () => Promise<T>,
) {
  const now = Date.now();
  for (const [key, times] of recent)
    if (!times.some((time) => now - time < 600000)) recent.delete(key);
  const times = (recent.get(userId) || []).filter(
    (time) => now - time < 600000,
  );
  if (active.has(userId) || times.length >= 6)
    throw new BusinessError(
      429,
      '当前已有AI请求或调用过于频繁，请等待后手动重试',
      'AI_LOCAL_LIMIT',
    );
  active.add(userId);
  recent.set(userId, [...times, now]);
  try {
    return await run();
  } finally {
    active.delete(userId);
  }
}

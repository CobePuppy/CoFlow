import { z } from 'zod';
export const pushTimesSchema = z
  .string()
  .trim()
  .regex(
    /^(?:[01]\d|2[0-3]):[0-5]\d(?:,(?:[01]\d|2[0-3]):[0-5]\d){0,5}$/,
    '提醒时刻使用北京时间HH:mm，逗号分隔，最多6个',
  )
  .transform((v) => [...new Set(v.split(','))].sort().join(','));
export const qqSettingsSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    enabled: z.boolean(),
    pushEnabled: z.boolean(),
    pushTimes: pushTimesSchema,
    webUrl: z
      .string()
      .url()
      .max(500)
      .refine((v) => {
        const u = new URL(v);
        return (
          ['http:', 'https:'].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          [
            '/',
            '/student',
            '/student/',
            '/enterprise',
            '/enterprise/',
          ].includes(u.pathname)
        );
      }, '平台链接应为网站首页或/student/、/enterprise/，不能包含凭据、查询或锚点'),
    accessToken: z
      .string()
      .min(32)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export function qqTaskUrl(
  base: string,
  taskId: string,
  workspaceId: string,
  projectId: string,
  edition?: string,
) {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  if (edition === 'student' || edition === 'enterprise')
    url.pathname = '/' + edition + '/';
  url.searchParams.set('task', taskId);
  url.searchParams.set('workspace', workspaceId);
  url.searchParams.set('project', projectId);
  return url.href;
}

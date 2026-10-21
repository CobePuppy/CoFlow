import { z } from 'zod';

export const githubReferenceInput = z
  .object({
    version: z.number().int().min(0),
    path: z.string().min(1).max(1024),
    remove: z.boolean().default(false),
    keepSnapshot: z.boolean().default(false),
    startLine: z.number().int().min(1).max(1000000).optional(),
    endLine: z.number().int().min(1).max(1000000).optional(),
    note: z.string().trim().max(1000).default(''),
    criterion: z
      .object({ index: z.number().int().min(0), text: z.string().max(10000) })
      .nullable()
      .default(null),
  })
  .refine(
    (x) =>
      (x.startLine === undefined && x.endLine === undefined) ||
      (x.startLine !== undefined &&
        x.endLine !== undefined &&
        x.startLine <= x.endLine),
    '起止行号须同时填写，且结束行不小于起始行',
  );

export function referenceLineCount(text: string) {
  return text.length
    ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    : 0;
}

export function pullNumber(value: string, repository: string) {
  const simple = value.trim().match(/^#?([1-9]\d{0,8})$/);
  if (simple) return Number(simple[1]);
  const url = value
    .trim()
    .match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d{0,8})\/?$/i);
  if (!url || url[1].toLowerCase() !== repository.toLowerCase())
    throw new Error('请输入当前仓库的 PR 编号或完整 GitHub PR 地址');
  return Number(url[2]);
}

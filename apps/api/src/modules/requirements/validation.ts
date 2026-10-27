import type { Action } from '@coflow/contracts/index.js';
import { z } from 'zod';
const text = (max = 10000) => z.string().trim().min(1).max(max);
const reason = z.object({ reason: text() });
const solution = z.object({
  body: text(100000),
  scope: text(),
  effort: z.number().positive().max(36500),
  risk: text(),
  start: text(40),
  end: text(40),
});
const test = z.object({ record: text(100000), deployment: text() });
const schemas: Record<Action, z.ZodType> = {
  START_WORK: z.object({}),
  SUBMIT_ACCEPTANCE: z.object({ summary: text(10000) }),
  SUBMIT_REQUIREMENT: z.object({
    criteriaOverrideReason: z.string().trim().max(2000).optional().default(''),
  }),
  RETURN_REQUIREMENT: reason,
  SUBMIT_SOLUTION: solution,
  APPROVE_SOLUTION: z.object({ reason: z.string().max(10000).optional() }),
  REJECT_SOLUTION: reason,
  START_DEVELOPMENT: z.object({}),
  COMPLETE_DEVELOPMENT: z.object({
    summary: text(100000),
    selfTest: text(100000),
    releaseVersion: text(200),
    environment: text(),
    knownIssues: text(),
  }),
  START_TEST: z.object({ environment: text() }),
  FAIL_TEST: test.extend({
    reason: text(),
    defectIds: z.array(z.string().min(1)).min(1).max(100),
  }),
  PASS_TEST: test,
  ACCEPT: z.object({
    checks: z.array(z.boolean()).min(1).max(100),
    opinion: z.string().max(10000).optional(),
  }),
  REJECT_ACCEPTANCE: reason.extend({
    target: z.enum(['DEVELOPING', 'READY_FOR_TEST']),
  }),
  APPLY_REQUIREMENT_CHANGE: z.object({
    description: text(100000),
    criteria: z.array(text(2000)).min(1).max(100),
    reason: text(),
    impact: text(),
  }),
  BLOCK: reason,
  UNBLOCK: reason,
  TRANSFER: reason.extend({
    reason: text().optional().default('调整需求责任分工'),
    productId: z.string().min(1).optional(),
    engineerId: z.string().min(1).optional(),
    productReviewerId: z.string().min(1).optional(),
    qaReviewerId: z.string().min(1).optional(),
    testerId: z.string().min(1).optional(),
  }),
  CANCEL: reason,
};
export const parsePayload = (action: Action, payload: unknown): any =>
  schemas[action].parse(payload);

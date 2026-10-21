import 'dotenv/config';
import 'reflect-metadata';

import { z } from 'zod';
import { assert } from '../requirements/domain.js';

import { db, type AuthRequest } from '../../shared/access.js';
async function documentInput(r: AuthRequest, projectId: string) {
  const input = z
    .object({
      title: z.string().min(1).max(200),
      content: z.string().max(200000),
      taskIds: z.array(z.string()).max(100).default([]),
    })
    .parse(r.body);
  assert(
    (await db.task.count({
      where: { projectId, id: { in: input.taskIds } },
    })) === new Set(input.taskIds).size,
    '关联任务不属于本项目',
  );
  return input;
}
export { documentInput };

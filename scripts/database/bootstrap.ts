import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { z } from 'zod';
const input = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    workspace: z.string().min(1),
  })
  .parse({
    email: process.env.BOOTSTRAP_EMAIL,
    password: process.env.BOOTSTRAP_PASSWORD,
    name: process.env.BOOTSTRAP_NAME || '管理员',
    workspace: process.env.BOOTSTRAP_WORKSPACE || '汇流团队',
  });
const db = new PrismaClient();
try {
  const password = await argon2.hash(input.password, { type: argon2.argon2id });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(172023716)`;
    if ((await tx.user.count()) || (await tx.workspace.count()))
      throw new Error('初始化仅允许空数据库；不会覆盖现有账号或团队');
    const user = await tx.user.create({
      data: { email: input.email.toLowerCase(), name: input.name, password },
    });
    const workspace = await tx.workspace.create({
      data: { name: input.workspace },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: 'ADMIN' },
    });
  });
  console.log('管理员与空白团队已创建；未创建演示账号、项目或测试数据。');
} finally {
  await db.$disconnect();
}

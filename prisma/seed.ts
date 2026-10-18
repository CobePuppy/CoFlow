import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { execute, handlers } from '../apps/api/src/domain.js';
import type { Task, Member } from '../packages/contracts/index.js';
const db = new PrismaClient();
const titles = [
  '支持项目维度的交付进度概览',
  '优化移动端需求详情体验',
  '新增任务筛选与搜索能力',
  '实现站内消息通知中心',
  '统一文件附件的权限校验',
  '完善团队成员邀请流程',
  '项目文档支持历史版本',
  '增加交付周期统计报表',
  '完成首轮交付闭环验证',
  '取消旧版导航改造需求',
  '测试退回与缺陷跟踪',
  '需求变更后重新评估',
  '等待联调环境准备',
];
const solutions = {
  body: '采用模块化服务与统一权限校验，按纵向切片交付。',
  scope: 'Web / API / 数据库',
  effort: 3,
  risk: '兼容性需要回归验证',
  start: '2026-10-16',
  end: '2026-10-20',
};
const development = {
  summary: '完成核心模块实现',
  selfTest: '验收项 1–3 已验证',
  releaseVersion: 'demo-0.1',
  environment: '本地开发环境',
  knownIssues: '无',
};
export async function seed(client = db) {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12)
    throw new Error('请设置至少 12 位的 SEED_PASSWORD');
  if (process.env.NODE_ENV === 'production') throw new Error('禁止生产种子');
  const digest = await argon2.hash(password, { type: argon2.argon2id });
  for (let team = 0; team < 2; team++) {
    const wid = `00000000-0000-4000-8000-00000000000${team + 1}`,
      pid = `10000000-0000-4000-8000-00000000000${team + 1}`;
    await client.$transaction(
      async (tx) => {
        const people: Member[] = [];
        for (const [i, role] of [
          'PRODUCT',
          'ENGINEER',
          'QA',
          'OPS',
        ].entries()) {
          const account = ['product', 'engineer', 'qa', 'ops'][i],
            email =
              (team ? (i === 0 ? 'other' : `other-${account}`) : account) +
              '@coflow.local';
          const u = await tx.user.upsert({
            where: { email },
            create: {
              email,
              name:
                (team ? '隔离团队' : '') + ['林悦', '陈宇', '苏宁', '周远'][i],
              password: digest,
            },
            update: {},
          });
          people.push({
            id: u.id,
            email: u.email,
            name: u.name,
            roles: [role as any],
          });
        }
        await tx.workspace.upsert({
          where: { id: wid },
          create: { id: wid, name: team ? '独立演示团队' : '汇流 产品团队' },
          update: {},
        });
        for (const [i, u] of people.entries())
          await tx.workspaceMember.upsert({
            where: { workspaceId_userId: { workspaceId: wid, userId: u.id } },
            create: {
              workspaceId: wid,
              userId: u.id,
              role: i === 0 ? 'ADMIN' : 'MEMBER',
            },
            update: {},
          });
        const project = await tx.project.upsert({
          where: { id: pid },
          create: {
            id: pid,
            workspaceId: wid,
            name: team ? '隔离测试项目' : '汇流 协作平台',
            description: '让产品、研发与测试紧密协作，共同交付更好的产品。',
          },
          update: {},
        });
        if (project.archivedAt) return;
        for (const u of people)
          await tx.projectMember.upsert({
            where: { projectId_userId: { projectId: pid, userId: u.id } },
            create: { projectId: pid, userId: u.id, roles: u.roles },
            update: {},
          });
        for (let i = 0; i < (team ? 1 : titles.length); i++) {
          const title = team ? '外部团队私有任务' : titles[i];
          if (
            await tx.task.findFirst({
              where: {
                projectId: pid,
                data: { path: ['title'], equals: title },
              },
            })
          )
            continue;
          const p = await tx.project.update({
              where: { id: pid },
              data: { sequence: { increment: 1 } },
            }),
            start = Date.now() - 86400000 * (15 - i),
            at = new Date(start).toISOString(),
            bugId = randomUUID();
          const draft: any = {
            title,
            background: '团队需要更清晰地协同需求交付。',
            goal: '减少信息差，让每个角色明确下一步。',
            description:
              '## 需求说明\n提供清晰、可靠的协作体验，并保留完整的操作记录。',
            criteria: [
              '角色权限校验正确',
              '操作后刷新数据保持一致',
              '空态及错误提示明确',
            ],
            priority: ['P1', 'P2', 'P0', 'P2'][i % 4],
            productId: people[0].id,
            engineerId: people[1].id,
            productReviewerId: people[0].id,
            qaReviewerId: people[2].id,
            testerId: people[2].id,
            dueAt: new Date(Date.now() + (i - 2) * 86400000).toISOString(),
            type: 'REQUIREMENT',
            requirementVersion: 0,
            requirements: [],
            solutions: [],
            reviews: [],
            development: [],
            tests: [],
            acceptances: [],
            changes: [],
            blocks: [],
            comments: [],
            history: [],
          };
          let t: Task = {
              id: randomUUID(),
              workspaceId: wid,
              projectId: pid,
              number: p.sequence,
              status: 'DRAFT',
              version: 1,
              createdAt: at,
              updatedAt: at,
              data: structuredClone(draft),
            },
            tick = 0;
          const act = (action: string, payload: any = {}, person = 0) => {
            t = execute(
              t,
              action,
              payload,
              people[person],
              people,
              new Date(start + 3600000 * ++tick).toISOString(),
            );
          };
          if (!team && i > 0) {
            act('SUBMIT_REQUIREMENT');
            if (i === 9)
              act('CANCEL', { reason: '旧版方案被新的导航方案替代' });
            else if (i > 1) {
              act('SUBMIT_SOLUTION', solutions, 1);
              if (i === 2) {
                act('REJECT_SOLUTION', { reason: '请补充迁移风险' }, 2);
                act(
                  'SUBMIT_SOLUTION',
                  { ...solutions, risk: '迁移前备份并验证回滚' },
                  1,
                );
              }
              if (i > 2) {
                act('APPROVE_SOLUTION');
                act('APPROVE_SOLUTION', {}, 2);
                if (i > 3) {
                  act('START_DEVELOPMENT', {}, 1);
                  if (i === 12) act('BLOCK', { reason: '等待联调环境准备' }, 1);
                  else if (i > 4) {
                    act('COMPLETE_DEVELOPMENT', development, 1);
                    if (i > 5) {
                      act('START_TEST', { environment: '本地演示环境' }, 2);
                      if (i === 10)
                        act(
                          'FAIL_TEST',
                          {
                            reason: '权限回归失败',
                            record: '发现越权展示问题',
                            deployment: '环境正常',
                            defectIds: [bugId],
                          },
                          2,
                        );
                      else if (i === 11)
                        act('APPLY_REQUIREMENT_CHANGE', {
                          description: '补充跨项目权限边界',
                          criteria: draft.criteria,
                          reason: '需求范围调整',
                          impact: '新增权限回归场景',
                        });
                      else if (i > 6) {
                        act(
                          'PASS_TEST',
                          {
                            record: '全部验收项验证通过',
                            deployment: '环境检查通过',
                          },
                          2,
                        );
                        if (i === 8)
                          act('ACCEPT', { checks: [true, true, true] });
                      }
                    }
                  }
                }
              }
            }
          }
          await tx.task.create({
            data: {
              id: t.id,
              workspaceId: wid,
              projectId: pid,
              number: t.number,
              status: t.status,
              version: t.version,
              data: t.data as any,
              createdAt: new Date(t.createdAt),
              updatedAt: new Date(t.updatedAt),
            },
          });
          for (const h of t.data.history)
            await tx.auditEvent.create({
              data: {
                workspaceId: wid,
                resourceId: t.id,
                actorId: h.actor,
                action: h.action,
                createdAt: new Date(h.at),
              },
            });
          for (const recipientId of handlers(t))
            await tx.notification.create({
              data: {
                recipientId,
                workspaceId: wid,
                projectId: pid,
                taskId: t.id,
                message: `演示任务待处理：${title}`,
                dedupe: `seed:${t.id}:${recipientId}`,
              },
            });
          if (i === 10 && !team) {
            const bp = await tx.project.update({
              where: { id: pid },
              data: { sequence: { increment: 1 } },
            });
            await tx.task.create({
              data: {
                id: bugId,
                workspaceId: wid,
                projectId: pid,
                number: bp.sequence,
                data: {
                  ...draft,
                  title: '修复权限回归缺陷',
                  type: 'BUG',
                  severity: 'MAJOR',
                  parentId: t.id,
                  parentRound: 1,
                },
              },
            });
          }
        }
        if (
          !(await tx.document.findFirst({
            where: { projectId: pid, title: '团队协作指南' },
          }))
        ) {
          const content =
            '# 欢迎使用 汇流\n\n产品提交需求，研发给出方案，产品与测试分别评估。\n\n双人评估通过后开始开发，完成后提测，测试通过后由产品验收。';
          await tx.document.create({
            data: {
              workspaceId: wid,
              projectId: pid,
              title: '团队协作指南',
              content,
              taskIds: [],
              revisions: [
                {
                  version: 1,
                  title: '团队协作指南',
                  content,
                  taskIds: [],
                  by: people[0].id,
                  at: new Date().toISOString(),
                },
              ],
            },
          });
        }
      },
      { timeout: 30000 },
    );
  }
}
if (!process.env.COFLOW_IMPORT_ONLY)
  seed()
    .then(() => console.log('演示数据已就绪；重复执行保留已有业务数据和密码'))
    .finally(() => db.$disconnect());

import { installFileRevisionRoutes } from './modules/file-spaces/revisions.js';
import { installDiscussionQueries } from './modules/requirements/discussion-queries.js';
import { installDiscussionRoutes } from './modules/requirements/discussions.js';
import { installIterationRoutes } from './modules/iterations/routes.js';
import { installTaskResourceRoutes } from './modules/documents/task-resources.js';
import { installFileSpaceRoutes } from './modules/file-spaces/routes.js';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'dotenv/config';
import express, { type NextFunction, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import 'reflect-metadata';
import { z } from 'zod';
import { serveFrontends } from './infrastructure/http/frontends.js';
import { installRequirementQueries } from './modules/requirements/queries.js';
import { installAiRoutes } from './modules/ai/installAiRoutes.js';
import { installQualityRoutes } from './modules/ai/quality.js';
import { installAttachmentsRoutes } from './modules/attachments/installAttachmentsRoutes.js';
import { installAttachmentRoutes } from './modules/attachments/routes.js';
import { installAccountRoutes } from './modules/auth/installAccountRoutes.js';
import { installAuthRoutes } from './modules/auth/installAuthRoutes.js';
import { installPublicRoutes } from './modules/auth/installPublicRoutes.js';
import { installNotificationReadRoutes } from './modules/collaboration/installCollaborationRoutes.js';
import { installCollaborationRoutes } from './modules/collaboration/routes.js';
import { installCompetitionsRoutes } from './modules/competitions/installCompetitionsRoutes.js';
import { installDocumentsRoutes } from './modules/documents/installDocumentsRoutes.js';
import { installForkRoutes } from './modules/forks/routes.js';
import { installGitHubRoutes } from './modules/github/routes.js';
import { installOverviewRoutes } from './modules/overview/installOverviewRoutes.js';
import { installProjectsRoutes } from './modules/projects/installProjectsRoutes.js';
import { installProofRoutes } from './modules/proofloop/routes.js';
import { BusinessError } from './modules/requirements/domain.js';
import { installRequirementsRoutes } from './modules/requirements/installRequirementsRoutes.js';
import { installSettingsRoutes } from './modules/settings/installSettingsRoutes.js';
import { installTemplatesRoutes } from './modules/templates/installTemplatesRoutes.js';
import { installWorkspacesRoutes } from './modules/workspaces/installWorkspacesRoutes.js';
import {
  db,
  draftSchema,
  installSession,
  page,
  project,
  projectWrite,
  qqRoutes,
  record,
  savedCredentials,
  task,
  validateDraftOwners,
  wrap,
  type AuthRequest,
} from './shared/context.js';
const router = express.Router();
installPublicRoutes(router);
router.use('/integrations/qq', qqRoutes.bot);
installSession(router);
installRequirementQueries(router);
installIterationRoutes(router);
installAccountRoutes(router);
installAuthRoutes(router);
installSettingsRoutes(router);
installWorkspacesRoutes(router);
installProjectsRoutes(router);
installOverviewRoutes(router);
installAiRoutes(router);
installCompetitionsRoutes(router);
installTemplatesRoutes(router);
installRequirementsRoutes(router);
installDiscussionRoutes(router);
installDiscussionQueries(router);
installNotificationReadRoutes(router);
installAttachmentsRoutes(router);
installFileSpaceRoutes(router);
installFileRevisionRoutes(router);
installDocumentsRoutes(router);
installTaskResourceRoutes(router);
installGitHubRoutes(router, { db, wrap, task, project, projectWrite, record });
installQualityRoutes(router, {
  db,
  wrap,
  task,
  project,
  projectWrite,
  record,
  savedCredentials,
});
installForkRoutes(router, { db, wrap, project, projectWrite, record });
installProofRoutes(router, {
  db,
  wrap,
  project,
  projectWrite,
  record,
  savedCredentials,
  draftSchema,
  validateDraftOwners,
});
installCollaborationRoutes(router, { db, wrap, page });
installAttachmentRoutes(router, {
  db,
  wrap,
  task,
  project,
  projectWrite,
  record,
});
@Module({})
class AppModule {}
export async function start() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use((r: AuthRequest, s: Response, n: NextFunction) => {
    r.requestId = randomUUID();
    s.setHeader('X-Request-ID', r.requestId);
    s.setHeader('X-Content-Type-Options', 'nosniff');
    n();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1', router);
  if (process.env.SERVE_WEB === 'true') serveFrontends(app);
  app.use((r: AuthRequest, s: Response) =>
    s.status(404).json({
      code: 'NOT_FOUND',
      message: '接口不存在',
      requestId: r.requestId,
    }),
  );
  app.use((e: any, r: AuthRequest, s: Response, _n: NextFunction) => {
    const status =
      e instanceof BusinessError
        ? e.status
        : e instanceof z.ZodError
          ? 422
          : e.code === 'LIMIT_FILE_SIZE'
            ? 413
            : e.type === 'entity.too.large'
              ? 413
              : e.type === 'entity.parse.failed'
                ? 400
                : ['P2002', 'P2034'].includes(e.code)
                  ? 409
                  : e.code === 'P2025'
                    ? 404
                    : ['P2003', 'P2004'].includes(e.code)
                      ? 422
                      : 500;
    console.error(
      JSON.stringify({
        requestId: r.requestId,
        code: e.code || 'ERROR',
        status,
      }),
    );
    s.status(status).json({
      code: status === 409 ? 'CONFLICT' : e.code || 'ERROR',
      message:
        status === 500
          ? '服务暂时不可用'
          : e instanceof BusinessError || e instanceof z.ZodError
            ? e.message
            : status === 409
              ? '数据冲突，请刷新后重试'
              : status === 413
                ? '请求内容超过大小限制'
                : status === 404
                  ? '资源不存在'
                  : status === 400
                    ? '请求 JSON 格式错误'
                    : '数据校验失败',
      fieldErrors: e instanceof z.ZodError ? e.flatten() : undefined,
      requestId: r.requestId,
    });
  });
  await app.listen(
    Number(process.env.PORT || 3001),
    process.env.HOST || '127.0.0.1',
  );
}

import {
  firstStepMessages,
  firstStepSections,
} from '@coflow/contracts/firststep.js';
import 'dotenv/config';
import express from 'express';
import 'reflect-metadata';
import { z } from 'zod';
import {
  db,
  hash,
  project,
  projectWrite,
  record,
  savedCredentials,
  wrap,
} from '../../shared/context.js';
import { assert } from '../requirements/domain.js';
import {
  firstStepBriefSchema,
  firstStepBundleSchema,
  firstStepRunSchema,
  generateFirstStep,
  withFirstStepLimit,
} from './firststep.js';
export function installAiRoutes(router: express.Router) {
  router.post(
    '/competitions/:id/firststep/preview',
    wrap(async (r, s) => {
      const item = await db.competition.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(item, '资源不存在', 404);
      await project(r, item.projectId);
      const brief = firstStepBriefSchema.parse(r.body.brief);
      s.setHeader('Cache-Control', 'no-store');
      s.json({
        messages: firstStepMessages(item, brief),
        sections: firstStepSections,
      });
    }),
  );

  router.post(
    '/competitions/:id/firststep/run',
    wrap(async (r, s) => {
      const item = await db.competition.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(item, '资源不存在', 404);
      await project(r, item.projectId, true);
      const input = firstStepRunSchema.parse(r.body);
      const credentials = await savedCredentials(r.user.id);
      assert(
        item.version === input.expectedVersion,
        '竞赛信息已变化，请重新打开FirstStepAgent',
        409,
      );
      s.setHeader('Cache-Control', 'no-store');
      const result = await withFirstStepLimit(r.user.id, () =>
        generateFirstStep(item, input.brief, credentials.apiKey, input.model),
      );
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, item.projectId);
        const latest = await tx.competition.findUnique({
          where: { id: item.id },
        });
        assert(
          latest?.version === item.version,
          '竞赛信息已变化，生成结果未保存，请核对后重新生成',
          409,
        );
        await record(tx, r, item.workspaceId, item.id, 'FIRSTSTEP_GENERATE');
      });
      s.json({
        ...result,
        model: input.model,
        competitionVersion: item.version,
        generatedAt: new Date().toISOString(),
      });
    }),
  );

  router.post(
    '/competitions/:id/firststep/save',
    wrap(async (r, s) => {
      const item = await db.competition.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(item, '资源不存在', 404);
      await project(r, item.projectId, true);
      const input = z
        .object({
          bundle: firstStepBundleSchema,
          expectedVersion: z.number().int().positive(),
          requestKey: z.uuid(),
        })
        .strict()
        .parse(r.body);
      const digest = hash(JSON.stringify(input));
      const saved = await db.$transaction(async (tx) => {
        await projectWrite(tx, r, item.projectId);
        const latest = await tx.competition.findUnique({
          where: { id: item.id },
        });
        assert(
          latest?.version === input.expectedVersion,
          '竞赛信息已变化，请核对后再保存',
          409,
        );
        const key = 'firststep-save:' + item.id + ':' + input.requestKey;
        const existing = await tx.idempotencyRecord.findUnique({
          where: { userId_key: { userId: r.user.id, key } },
        });
        if (existing) {
          assert(
            existing.digest === digest,
            '保存请求标识已被使用，请重新生成保存请求',
            409,
          );
          return existing.result;
        }
        const documents = [];
        for (const [section, label] of Object.entries(firstStepSections)) {
          let content = input.bundle[section as keyof typeof firstStepSections];
          if (section === 'analysis' && input.bundle.questions.length)
            content +=
              '\n\n## 待确认问题\n' +
              input.bundle.questions
                .map((question) => '- ' + question)
                .join('\n');
          content = '> FirstStepAgent生成草稿，尚未人工核对。\n\n' + content;
          const title = item.name.slice(0, 110) + ' · FirstStep · ' + label;
          const document = await tx.document.create({
            data: {
              projectId: item.projectId,
              workspaceId: item.workspaceId,
              title,
              content,
              taskIds: [],
              revisions: [
                {
                  title,
                  content,
                  taskIds: [],
                  version: 1,
                  by: r.user.id,
                  at: new Date().toISOString(),
                },
              ],
            },
          });
          await record(tx, r, item.workspaceId, document.id, 'DOCUMENT_CREATE');
          documents.push({ id: document.id, title });
        }
        await record(tx, r, item.workspaceId, item.id, 'FIRSTSTEP_SAVE');
        const result = { documents };
        await tx.idempotencyRecord.create({
          data: {
            userId: r.user.id,
            key,
            digest,
            result,
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        return result;
      });
      s.json(saved);
    }),
  );
}

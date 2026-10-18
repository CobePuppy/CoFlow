import {
  reviewSources,
  reviewFingerprint,
} from '../../apps/api/src/ai-quality.js';
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const url = process.env.TEST_DATABASE_URL;
assert(
  url && new URL(url).pathname.endsWith('/coflow_test'),
  '测试必须显式指定独立 coflow_test 数据库',
);
assert(url !== process.env.DATABASE_URL, '禁止测试开发数据库');
process.env.DATABASE_URL = url;
process.env.COFLOW_IMPORT_ONLY = '1';
process.env.SEED_PASSWORD =
  process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!';
const db = new PrismaClient({ datasources: { db: { url } } });
const origin = 'http://localhost:5173',
  base = 'http://127.0.0.1:3101/api/v1';
test('隔离 PostgreSQL：业务闭环、权限、并发幂等、历史、冲突与事务回滚', async () => {
  const { seed } = await import('../../prisma/seed.js');
  await seed(db);
  const seededCount = await db.task.count();
  await seed(db);
  assert.equal(
    await db.task.count(),
    seededCount,
    '种子重复执行不能新增重复任务',
  );
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        COFLOW_IMPORT_ONLY: '',
        PORT: '3101',
        SERVE_WEB: 'true',
        STORAGE_DIR: './storage-test',
        DATABASE_URL: url,
        SETTINGS_ENCRYPTION_KEY: '1'.repeat(64),
      },
      stdio: 'pipe',
    },
  );
  let output = '';
  child.stderr.on('data', (d) => (output += d.toString()));
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + '/health')).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
      if (i === 99) throw new Error(output);
    }
    for (const route of [
      '/enterprise/',
      '/student/',
      '/student/?section=writing',
    ]) {
      const response = await fetch('http://127.0.0.1:3101' + route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /text\/html/);
      const html = await response.text();
      const asset = html.match(/src="(\/assets\/[^"]+\.js)"/);
      assert(asset, '生产页面应使用根路径静态资源');
      assert.equal(
        (await fetch('http://127.0.0.1:3101' + asset[1])).status,
        200,
      );
    }
    async function login(email: string, password = process.env.SEED_PASSWORD) {
      const r = await fetch(base + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({
          email: email + '@coflow.local',
          password,
        }),
      });
      const b: any = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      const cookie = r.headers.get('set-cookie')!.split(';')[0];
      return {
        user: b.user,
        csrf: b.csrf,
        cookie,
        async request(path: string, method = 'GET', body?: any, key?: string) {
          const resp = await fetch(base + path, {
            method,
            headers: {
              Cookie: cookie,
              Origin: origin,
              'X-CSRF-Token': b.csrf,
              'Content-Type': 'application/json',
              ...(key ? { 'Idempotency-Key': key } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          });
          const data = await resp.json();
          return { status: resp.status, data };
        },
      };
    }
    const registrationId = 'register-' + Date.now();
    async function register(body: any, requestOrigin = origin) {
      const response = await fetch(base + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: requestOrigin },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: (await response.json()) as any };
    }
    const creatorInput = {
      kind: 'creator',
      email: registrationId + '@coflow.local',
      name: '团队创建者',
      password: '12345678',
      teamName: '自助注册测试团队',
    };
    assert.equal(
      (await register({ ...creatorInput, password: '1234567' })).status,
      422,
    );
    assert.equal(
      (await register(creatorInput, 'https://invalid.example')).status,
      403,
    );
    const created = await register(creatorInput);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.match(created.data.teamCode, /^[A-F0-9]{12}$/);
    assert.equal((await register(creatorInput)).status, 409);
    const creator = await login(registrationId, '12345678');
    const team = created.data.workspaceId;
    assert.equal(
      (await creator.request(`/workspaces/${team}/team-code`)).data.teamCode,
      created.data.teamCode,
    );
    const memberInput = {
      kind: 'member',
      email: registrationId + '-member@coflow.local',
      name: '团队队员',
      password: '12345678',
      teamCode: '000000000000',
    };
    assert.equal((await register(memberInput)).status, 422);
    assert.equal(
      await db.user.findUnique({ where: { email: memberInput.email } }),
      null,
      '无效团队码不得遗留账号',
    );
    assert.equal(
      (
        await register({
          ...memberInput,
          teamCode: created.data.teamCode.toLowerCase(),
        })
      ).status,
      201,
    );
    const teammate = await login(registrationId + '-member', '12345678');
    assert.equal(
      (await teammate.request(`/workspaces/${team}/team-code`)).status,
      403,
    );
    assert.equal((await teammate.request('/workspaces')).data.length, 1);
    assert.equal(
      (await teammate.request(`/workspaces/${team}/projects`)).data.length,
      0,
    );
    assert.equal(
      (
        await db.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: team, userId: teammate.user.id },
          },
        })
      )?.role,
      'MEMBER',
    );
    const p = await login('product'),
      e = await login('engineer'),
      q = await login('qa'),
      other = await login('other');
    const qqTeam = (
      await p.request('/workspaces', 'POST', {
        name: 'QQ配置专项-' + Date.now(),
      })
    ).data;
    const qqPath = '/workspaces/' + qqTeam.id + '/qq-integration';
    let qqConfig = (await p.request(qqPath)).data;
    assert.equal(qqConfig.canManage, true);
    assert.equal(qqConfig.configured, false);
    const qqToken = 'Q'.repeat(64),
      qqValues = {
        enabled: true,
        pushEnabled: true,
        pushTimes: '18:00,09:00,09:00',
        webUrl: 'https://coflow.example/student/',
      };
    assert.equal(
      (
        await p.request(qqPath, 'PATCH', {
          ...qqValues,
          expectedVersion: 0,
          accessToken: qqToken,
        })
      ).status,
      200,
    );
    qqConfig = (await p.request(qqPath)).data;
    assert.equal(qqConfig.pushTimes, '09:00,18:00');
    assert(!JSON.stringify(qqConfig).includes(qqToken));
    assert(!JSON.stringify(qqConfig).includes('tokenHash'));
    assert.equal(
      (
        await db.qQIntegration.findUniqueOrThrow({
          where: { workspaceId: qqTeam.id },
        })
      ).tokenHash,
      createHash('sha256').update(qqToken).digest('hex'),
    );
    const qqBot = async (path: string, token = qqToken) => {
      const r = await fetch(base + '/integrations/qq' + path, {
        headers: {
          Authorization: 'Bearer ' + token,
          'X-CoFlow-Workspace': qqTeam.id,
        },
      });
      return { status: r.status, data: await r.json() };
    };
    assert.equal((await qqBot('/policy')).data.pushTimes, '09:00,18:00');
    assert.equal((await qqBot('/policy', 'invalid')).status, 401);
    await db.workspaceMember.create({
      data: { workspaceId: qqTeam.id, userId: e.user.id, role: 'MEMBER' },
    });
    assert.equal(
      (await e.request(qqPath, 'PATCH', { ...qqValues, expectedVersion: 1 }))
        .status,
      403,
    );
    assert.equal(
      (await p.request(qqPath, 'PATCH', { ...qqValues, expectedVersion: 0 }))
        .status,
      409,
    );
    const qqTeam2 = (
      await p.request('/workspaces', 'POST', {
        name: 'QQ团队隔离-' + Date.now(),
      })
    ).data;
    const secondToken = 'R'.repeat(64);
    assert.equal(
      (
        await p.request(
          '/workspaces/' + qqTeam2.id + '/qq-integration',
          'PATCH',
          {
            ...qqValues,
            pushTimes: '11:00',
            expectedVersion: 0,
            accessToken: secondToken,
          },
        )
      ).status,
      200,
    );
    const policies = await Promise.all([
      qqBot('/policy'),
      fetch(base + '/integrations/qq/policy', {
        headers: {
          Authorization: 'Bearer ' + secondToken,
          'X-CoFlow-Workspace': qqTeam2.id,
        },
      }).then(async (r) => ({ status: r.status, data: await r.json() })),
    ]);
    assert.equal(policies[0].data.pushTimes, '09:00,18:00');
    assert.equal(policies[1].data.pushTimes, '11:00');
    const qqBindingPath = '/workspaces/' + qqTeam.id + '/qq-binding';
    const qqCode = await p.request(qqBindingPath + '/code', 'POST', {});
    assert.equal(qqCode.status, 200);
    const bind = await fetch(base + '/integrations/qq/bind', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + qqToken,
        'X-CoFlow-Workspace': qqTeam.id,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ qq: '123456789', code: qqCode.data.code }),
    });
    assert.equal(bind.status, 200);
    const rotatedToken = 'Z'.repeat(64);
    assert.equal(
      (
        await p.request(qqPath, 'PATCH', {
          ...qqValues,
          expectedVersion: 1,
          accessToken: rotatedToken,
        })
      ).status,
      200,
    );
    assert.equal((await qqBot('/policy')).status, 401);
    assert.equal((await qqBot('/policy', rotatedToken)).status, 200);
    assert.equal(
      (
        await p.request(qqPath, 'PATCH', {
          ...qqValues,
          enabled: false,
          expectedVersion: 2,
        })
      ).status,
      200,
    );
    assert.equal((await p.request(qqBindingPath)).data.qq, '123456789');
    assert.equal((await qqBot('/policy')).status, 503);
    assert.equal((await p.request(qqBindingPath, 'DELETE')).status, 200);
    assert.equal(
      (await p.request(qqBindingPath + '/code', 'POST', {})).status,
      422,
    );
    const securityId = 'settings-security-' + Date.now();
    const argon2 = await import('argon2');
    await db.user.create({
      data: {
        email: securityId + '@coflow.local',
        name: '安全测试',
        password: await argon2.hash('old-password-test'),
      },
    });
    const securityA = await login(securityId, 'old-password-test'),
      securityB = await login(securityId, 'old-password-test');
    assert.equal(
      (
        await securityA.request('/settings/password', 'POST', {
          currentPassword: 'old-password-test',
          newPassword: 'new-password-test-long',
        })
      ).status,
      200,
    );
    assert.equal((await securityA.request('/auth/me')).status, 200);
    assert.equal((await securityB.request('/auth/me')).status, 401);
    await login(securityId, 'new-password-test-long');
    const originalSettings = (await p.request('/settings')).data;
    const prefs = {
      name: p.user.name,
      model: 'deepseek-flash',
      slides: 16,
      minutes: 10,
      preferredEdition: 'student',
    };
    const key = 'sk-integration-settings-secret';
    const savedSettings = await p.request('/settings', 'PATCH', {
      ...prefs,
      expectedVersion: originalSettings.version,
      apiKey: key,
    });
    assert.equal(savedSettings.status, 200);
    assert.equal(savedSettings.data.hasKey, true);
    assert(!JSON.stringify(savedSettings.data).includes(key));
    const encrypted = await db.userSettings.findUniqueOrThrow({
      where: { userId: p.user.id },
    });
    assert(encrypted.encryptedKey && !encrypted.encryptedKey.includes(key));
    assert.equal((await other.request('/settings')).data.hasKey, false);
    assert.equal(
      (
        await p.request('/settings', 'PATCH', {
          ...prefs,
          expectedVersion: originalSettings.version,
        })
      ).status,
      409,
    );
    const kept = await p.request('/settings', 'PATCH', {
      ...prefs,
      expectedVersion: savedSettings.data.version,
    });
    assert.equal(kept.data.hasKey, true);
    assert.equal(kept.data.slides, 16);
    assert.equal(
      (
        await db.userSettings.findUniqueOrThrow({
          where: { userId: p.user.id },
        })
      ).encryptedKey,
      encrypted.encryptedKey,
    );
    const clearedSettings = await p.request('/settings', 'PATCH', {
      ...prefs,
      expectedVersion: kept.data.version,
      removeKey: true,
    });
    assert.equal(clearedSettings.data.hasKey, false);
    assert.equal(
      (await p.request('/settings/ai/verify', 'POST', {})).status,
      422,
    );
    assert.equal(
      (
        await p.request('/settings/password', 'POST', {
          currentPassword: 'wrong-password',
          newPassword: 'test-valid-new-password',
        })
      ).status,
      422,
    );
    const pid = '10000000-0000-4000-8000-000000000001';
    const templateInput = {
      name: '模板集成-' + Date.now(),
      content: {
        title: '接口对接',
        description: '边界和协议',
        criteria: ['接口可用'],
        priority: 'P1',
      },
      active: true,
    };
    assert.equal(
      (await e.request(`/projects/${pid}/templates`, 'POST', templateInput))
        .status,
      403,
    );
    assert.equal(
      (await other.request(`/projects/${pid}/templates`)).status,
      404,
    );
    const template = await p.request(
      `/projects/${pid}/templates`,
      'POST',
      templateInput,
    );
    assert.equal(template.status, 200);
    assert.equal(template.data.version, 1);
    assert.equal(
      (await p.request(`/projects/${pid}/templates`, 'POST', templateInput))
        .status,
      409,
    );
    assert.equal(
      (
        await other.request(`/templates/${template.data.id}`, 'PATCH', {
          ...templateInput,
          expectedVersion: 1,
        })
      ).status,
      404,
    );
    const parallelTemplates = await Promise.all([
      p.request(`/templates/${template.data.id}`, 'PATCH', {
        ...templateInput,
        expectedVersion: 1,
      }),
      p.request(`/templates/${template.data.id}`, 'PATCH', {
        ...templateInput,
        expectedVersion: 1,
      }),
    ]);
    assert.deepEqual(parallelTemplates.map((x) => x.status).sort(), [200, 409]);
    assert.equal(
      (
        await p.request(`/templates/${template.data.id}`, 'PATCH', {
          ...templateInput,
          active: false,
          expectedVersion: 2,
        })
      ).status,
      200,
    );
    const memberTemplates = await e.request(`/projects/${pid}/templates`);
    assert.equal(memberTemplates.data.canManage, false);
    assert(
      !memberTemplates.data.items.some((x: any) => x.id === template.data.id),
    );
    assert(
      (await p.request(`/projects/${pid}/templates`)).data.items.some(
        (x: any) => x.id === template.data.id && !x.active,
      ),
    );
    assert.equal(
      await db.auditEvent.count({ where: { resourceId: template.data.id } }),
      3,
    );
    const competitionPayload = {
      name: '学生竞赛-' + Date.now(),
      organizer: '测试组织',
      deadline: '2026-12-01',
      stage: 'PREPARING',
      url: 'https://example.com/competition',
      notes: '准备项目材料',
    };
    const competition = await p.request(
      `/projects/${pid}/competitions`,
      'POST',
      competitionPayload,
    );
    assert.equal(competition.status, 200);
    assert.equal(
      (await other.request(`/projects/${pid}/competitions`)).status,
      404,
    );
    assert.equal(
      (
        await other.request(`/competitions/${competition.data.id}`, 'PATCH', {
          ...competitionPayload,
          expectedVersion: 1,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await p.request(`/projects/${pid}/competitions`, 'POST', {
          ...competitionPayload,
          url: 'javascript:alert(1)',
        })
      ).status,
      422,
    );
    const competitionWrites = await Promise.all([
      p.request(`/competitions/${competition.data.id}`, 'PATCH', {
        ...competitionPayload,
        stage: 'REGISTERED',
        expectedVersion: 1,
      }),
      e.request(`/competitions/${competition.data.id}`, 'PATCH', {
        ...competitionPayload,
        stage: 'REGISTERED',
        expectedVersion: 1,
      }),
    ]);
    assert.deepEqual(competitionWrites.map((x) => x.status).sort(), [200, 409]);
    assert(
      (await p.request(`/projects/${pid}/competitions`)).data.items.some(
        (x: any) => x.id === competition.data.id && x.stage === 'REGISTERED',
      ),
    );
    assert.equal(
      await db.auditEvent.count({ where: { resourceId: competition.data.id } }),
      2,
    );
    const competitionTeam = '00000000-0000-4000-8000-000000000001';
    const sharedPath = '/workspaces/' + competitionTeam + '/competitions';
    const peerList = await e.request(sharedPath);
    assert.equal(peerList.status, 200);
    assert(
      peerList.data.items.some(
        (x: any) => x.id === competition.data.id && x.canAccessProject,
      ),
    );
    const workspaceOnlyId = 'competition-workspace-only-' + Date.now();
    const sourceUser = await db.user.findUniqueOrThrow({
      where: { id: p.user.id },
    });
    const workspaceOnlyUser = await db.user.create({
      data: {
        email: workspaceOnlyId + '@coflow.local',
        name: '竞赛团队成员',
        password: sourceUser.password,
      },
    });
    await db.workspaceMember.create({
      data: {
        workspaceId: competitionTeam,
        userId: workspaceOnlyUser.id,
        role: 'MEMBER',
      },
    });
    const viewer = await login(workspaceOnlyId);
    const sharedList = await viewer.request(sharedPath);
    assert.equal(sharedList.status, 200);
    const sharedItem = sharedList.data.items.find(
      (x: any) => x.id === competition.data.id,
    );
    assert(sharedItem);
    assert.equal(sharedItem.canAccessProject, false);
    assert.equal(sharedItem.readOnly, true);
    assert(sharedItem.projectName);
    assert.equal(
      (await viewer.request('/projects/' + pid + '/competitions')).status,
      403,
    );
    assert.equal(
      (
        await viewer.request('/competitions/' + competition.data.id, 'PATCH', {
          ...competitionPayload,
          expectedVersion: 2,
        })
      ).status,
      403,
    );
    assert.equal((await other.request(sharedPath)).status, 404);
    await db.projectMember.create({
      data: {
        projectId: pid,
        userId: workspaceOnlyUser.id,
        roles: ['ENGINEER'],
      },
    });
    assert.equal(
      (await viewer.request(sharedPath)).data.items.find(
        (x: any) => x.id === competition.data.id,
      ).canAccessProject,
      true,
    );
    const proofBase = '/competitions/' + competition.data.id + '/proof';
    const proofDoc = await p.request(
      '/projects/' + pid + '/documents',
      'POST',
      {
        title: 'Proof证据',
        content: '在指定测试集上准确率达到95%，使用固定划分和基准模型。',
        taskIds: [],
      },
    );
    assert.equal(proofDoc.status, 200);
    const initialProof = await p.request(proofBase);
    assert.equal(initialProof.data.version, 0);
    assert.equal((await other.request(proofBase)).status, 404);
    const proofClaim = {
      statement: '在指定测试集上准确率达到95%',
      importance: 5,
      effortHours: 4,
      criterion: '有效性：固定测试集和基准模型',
      evidence: [
        { documentId: proofDoc.data.id, version: 1, quote: '准确率达到95%' },
      ],
    };
    assert.equal(
      (
        await p.request(proofBase + '/claims', 'POST', {
          expectedVersion: 0,
          claim: proofClaim,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await p.request(proofBase + '/claims', 'POST', {
          expectedVersion: 0,
          claim: proofClaim,
        })
      ).status,
      409,
    );
    let proof = (await p.request(proofBase)).data;
    const claimId = proof.data.claims[0].id;
    assert.equal(proof.states[claimId], 'RECORDED');
    assert.equal(proof.data.claims[0].importance, 5);
    assert.equal(proof.data.claims[0].effortHours, 4);
    assert.equal(
      (
        await p.request(proofBase + '/claims', 'POST', {
          expectedVersion: proof.version,
          claim: {
            ...proofClaim,
            evidence: [
              { ...proofClaim.evidence[0], quote: '完全不存在的证据原文' },
            ],
          },
        })
      ).status,
      409,
    );
    const proofReview = await p.request(proofBase + '/review', 'POST', {
      claimId,
      expectedVersion: proof.version,
      outcome: 'SUPPORTED',
      note: '已经核对原始实验条件和测试集范围，仅在该测试集和当前模型版本中支持该结论。',
    });
    assert.equal(proofReview.status, 200);
    proof = (await p.request(proofBase)).data;
    assert.equal(proof.states[claimId], 'VERIFIED');
    assert.equal(proof.data.claims[0].reviews[0].by, p.user.id);
    const changedProofDoc = await p.request(
      '/documents/' + proofDoc.data.id,
      'PATCH',
      {
        title: 'Proof证据修订',
        content: '在指定测试集上准确率为89%，此前结论已修正。',
        taskIds: [],
        expectedVersion: 1,
      },
    );
    assert.equal(changedProofDoc.status, 200);
    proof = (await p.request(proofBase)).data;
    assert.equal(proof.states[claimId], 'OUTDATED');
    assert.equal(
      (
        await p.request(proofBase + '/review', 'POST', {
          claimId,
          expectedVersion: proof.version,
          outcome: 'SUPPORTED',
          note: '源文书已经换版，不能沿用旧版本证据进行当前核对，应该被系统拒绝。',
        })
      ).status,
      409,
    );
    const proofOwners = {
      productId: p.user.id,
      engineerId: e.user.id,
      productReviewerId: p.user.id,
      qaReviewerId: q.user.id,
      testerId: q.user.id,
    };
    const proofTask = await p.request(proofBase + '/task', 'POST', {
      itemId: claimId,
      kind: 'CLAIM',
      expectedVersion: proof.version,
      owners: proofOwners,
    });
    assert.equal(proofTask.status, 200);
    const proofTaskAgain = await p.request(proofBase + '/task', 'POST', {
      itemId: claimId,
      kind: 'CLAIM',
      expectedVersion: proof.version,
      owners: proofOwners,
    });
    assert.equal(proofTaskAgain.data.taskId, proofTask.data.taskId);
    assert.equal(
      (await p.request('/tasks/' + proofTask.data.taskId)).data.status,
      'DRAFT',
    );
    assert.equal(
      (
        await p.request(proofBase + '/check', 'POST', {
          expectedVersion: 2,
          documentIds: [proofDoc.data.id],
          consent: true,
        })
      ).status,
      422,
    );
    const secondProofDoc = await p.request(
      '/projects/' + pid + '/documents',
      'POST',
      {
        title: 'Proof第二份证据',
        content: '同一实验记录中的准确率为95%，需要重新核对。',
        taskIds: [],
      },
    );
    assert.equal(secondProofDoc.status, 200);
    proof = (await p.request(proofBase)).data;
    const findingA = {
      id: crypto.randomUUID(),
      reason: '两份记录中同一实验准确率不同，需要核对',
      suggestion: '按相同实验条件重新评估并核对数据集',
      sources: [
        { documentId: proofDoc.data.id, quote: '准确率为89%' },
        { documentId: secondProofDoc.data.id, quote: '准确率为95%' },
      ],
    };
    const findingB = { ...findingA, id: crypto.randomUUID() };
    const { claimsDigest } = await import('../../apps/api/src/proofloop.js');
    await db.proofBoard.update({
      where: { competitionId: competition.data.id },
      data: {
        data: {
          ...proof.data,
          findings: [findingA, findingB],
          checked: {
            claimsDigest: claimsDigest(proof.data.claims),
            documentVersions: {
              [proofDoc.data.id]: 2,
              [secondProofDoc.data.id]: 1,
            },
            at: new Date().toISOString(),
            model: 'test-fixture',
          },
        },
      },
    });
    assert.equal((await p.request(proofBase)).data.checkOutdated, false);
    const findingTask = await p.request(proofBase + '/task', 'POST', {
      itemId: findingA.id,
      kind: 'FINDING',
      expectedVersion: proof.version,
      owners: proofOwners,
    });
    assert.equal(findingTask.status, 200);
    assert.equal(
      (
        await p.request('/documents/' + secondProofDoc.data.id, 'PATCH', {
          title: 'Proof第二份证据',
          content: '更新后的实验记录内容，需重新核对。',
          taskIds: [],
          expectedVersion: 1,
        })
      ).status,
      200,
    );
    proof = (await p.request(proofBase)).data;
    assert.equal(proof.checkOutdated, true);
    assert.equal(
      (
        await p.request(proofBase + '/task', 'POST', {
          itemId: findingB.id,
          kind: 'FINDING',
          expectedVersion: proof.version,
          owners: proofOwners,
        })
      ).status,
      409,
    );
    const exportedProof = await p.request(proofBase + '/export');
    assert.equal(exportedProof.status, 200);
    assert.equal(exportedProof.data.payload.boardVersion, proof.version);
    assert.equal(exportedProof.data.payload.checkOutdated, true);
    assert.equal(exportedProof.data.payload.unresolved.length, 1);
    assert.match(exportedProof.data.markdown, /证据已过期/);
    const { canonicalJson } = await import(
      '../../apps/api/src/proof-export.js'
    );
    assert.equal(
      exportedProof.data.digest,
      createHash('sha256')
        .update(canonicalJson(exportedProof.data.payload))
        .digest('hex'),
    );
    assert.deepEqual(
      exportedProof.data.payload.documents.map((d: any) => d.id).sort(),
      [proofDoc.data.id, secondProofDoc.data.id].sort(),
    );
    assert.equal((await other.request(proofBase + '/export')).status, 404);
    const firstStepBrief = {
      problem:
        '为校园创新竞赛提供需求分析、可实现方案、技术架构和答辩材料。请依据真实题目要求组织内容，保留待确认问题。',
      team: '三人团队',
      constraints: '两周',
      slides: 12,
      minutes: 8,
    };
    const preview = await p.request(
      `/competitions/${competition.data.id}/firststep/preview`,
      'POST',
      { brief: firstStepBrief },
    );
    assert.equal(preview.status, 200);
    assert(preview.data.messages[0].content.includes('FirstStepAgent'));
    assert.equal(
      (
        await other.request(
          `/competitions/${competition.data.id}/firststep/preview`,
          'POST',
          { brief: firstStepBrief },
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await p.request(
          `/competitions/${competition.data.id}/firststep/run`,
          'POST',
          {
            brief: firstStepBrief,
            apiKey: 'sk-test-no-network',
            model: 'deepseek-flash',
            expectedVersion: 2,
            consent: false,
          },
        )
      ).status,
      422,
    );
    assert.equal((await p.request('/auth/me')).status, 200);
    const firstStepBundle = {
      analysis: '分析内容和官方要求应核对。'.repeat(8),
      developmentPrompt: '开发提示词包含需求和验收。'.repeat(8),
      techStack: '技术栈建议及选择依据。'.repeat(8),
      pptPrompt: 'PPT逐页标题、证据及备注。'.repeat(8),
      executionPlan: '按阶段完成工作并核对交付。'.repeat(8),
      submissionChecklist: '依据官方要求核对提交资料。'.repeat(8),
      questions: ['评分标准待核对'],
    };
    const firstStepSave = {
      bundle: firstStepBundle,
      expectedVersion: 2,
      requestKey: globalThis.crypto.randomUUID(),
    };
    const firstSaved = await p.request(
      `/competitions/${competition.data.id}/firststep/save`,
      'POST',
      firstStepSave,
    );
    assert.equal(firstSaved.status, 200);
    assert.equal(firstSaved.data.documents.length, 6);
    const secondSaved = await p.request(
      `/competitions/${competition.data.id}/firststep/save`,
      'POST',
      firstStepSave,
    );
    assert.deepEqual(secondSaved.data, firstSaved.data);
    assert.equal(
      await db.document.count({
        where: { id: { in: firstSaved.data.documents.map((d: any) => d.id) } },
      }),
      6,
    );
    assert.equal(
      (
        await p.request(
          `/competitions/${competition.data.id}/firststep/save`,
          'POST',
          {
            ...firstStepSave,
            bundle: {
              ...firstStepBundle,
              analysis: firstStepBundle.analysis + '修改',
            },
          },
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await other.request(
          `/competitions/${competition.data.id}/firststep/save`,
          'POST',
          firstStepSave,
        )
      ).status,
      404,
    );
    assert.equal((await other.request(`/projects/${pid}/metrics`)).status, 404);
    assert.equal((await other.request(`/projects/${pid}/tasks`)).status, 404);
    assert.equal(
      (
        await e.request(
          '/workspaces/00000000-0000-4000-8000-000000000001/members',
          'PATCH',
          { userId: e.user.id, role: 'ADMIN' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await p.request(
          '/workspaces/00000000-0000-4000-8000-000000000001/members',
          'PATCH',
          { userId: p.user.id, role: 'MEMBER' },
        )
      ).status,
      422,
    );
    const draft = {
      title: '集成验证 ' + Date.now(),
      background: '背景',
      goal: '目标',
      description: '需求',
      criteria: ['标准'],
      priority: 'P1',
      productId: p.user.id,
      engineerId: e.user.id,
      productReviewerId: p.user.id,
      qaReviewerId: q.user.id,
      testerId: q.user.id,
    };

    const settingsTeam = (
      await db.project.findUniqueOrThrow({ where: { id: pid } })
    ).workspaceId;
    const emptyProject = await p.request(
      '/workspaces/' + settingsTeam + '/projects',
      'POST',
      { name: '可删除空项目' },
    );
    assert.equal(emptyProject.status, 200);
    assert.equal(
      (
        await e.request('/projects/' + emptyProject.data.id, 'DELETE', {
          confirmName: '可删除空项目',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await p.request('/projects/' + emptyProject.data.id, 'DELETE', {
          confirmName: '错误名称',
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await p.request('/projects/' + emptyProject.data.id, 'PATCH', {
          name: '空项目新名称',
          description: '可编辑介绍',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await p.request('/projects/' + emptyProject.data.id, 'DELETE', {
          confirmName: '空项目新名称',
        })
      ).status,
      200,
    );
    const destination = (
      await p.request('/workspaces/' + settingsTeam + '/projects', 'POST', {
        name: '需求转移目标',
      })
    ).data;
    for (const [user, roles] of [
      [p.user, ['PRODUCT']],
      [e.user, ['ENGINEER']],
      [q.user, ['QA']],
    ] as const) {
      assert.equal(
        (
          await p.request('/projects/' + destination.id + '/members', 'POST', {
            userId: user.id,
            roles,
          })
        ).status,
        200,
      );
    }
    const moveDraft = (
      await p.request('/projects/' + pid + '/tasks', 'POST', {
        ...draft,
        title: '归属调整草稿',
      })
    ).data;
    assert.equal(
      (
        await other.request('/tasks/' + moveDraft.id, 'PATCH', {
          ...draft,
          projectId: destination.id,
          expectedVersion: moveDraft.version,
        })
      ).status,
      404,
    );
    const moved = await p.request('/tasks/' + moveDraft.id, 'PATCH', {
      ...draft,
      title: '已调整所属项目',
      projectId: destination.id,
      expectedVersion: moveDraft.version,
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    assert.equal(moved.data.projectId, destination.id);
    assert.equal(moved.data.version, moveDraft.version + 1);
    const reviewPath = '/tasks/' + moveDraft.id + '/ai-reviews';
    assert.equal((await other.request(reviewPath)).status, 404);
    assert.equal(
      (
        await p.request(reviewPath, 'POST', {
          kind: 'REQUIREMENT',
          documentIds: [],
          expectedVersion: moved.data.version,
          consent: false,
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await p.request(reviewPath, 'POST', {
          kind: 'TEST',
          documentIds: [],
          expectedVersion: 1,
          consent: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await p.request('/ai/import', 'POST', {
          kind: 'project',
          text: '足够长的测试项目文档内容',
          consent: false,
        })
      ).status,
      422,
    );
    const reviewTask = await db.task.findUniqueOrThrow({
      where: { id: moveDraft.id },
    });
    const reviewRecord = {
      id: 'integration-review',
      kind: 'REQUIREMENT',
      documentIds: [],
      taskVersion: reviewTask.version,
      model: 'deepseek-flash',
      by: p.user.id,
      at: new Date().toISOString(),
      fingerprint: reviewFingerprint(
        'REQUIREMENT',
        reviewSources(reviewTask, []),
      ),
      result: {
        outcome: 'INSUFFICIENT',
        summary: '集成测试中的评审记录',
        checks: [],
      },
    };
    await db.task.update({
      where: { id: moveDraft.id },
      data: {
        data: { ...(reviewTask.data as any), aiReviews: [reviewRecord] },
        version: { increment: 1 },
      },
    });
    assert.equal((await p.request(reviewPath)).data.items[0].stale, false);
    const changed = await db.task.findUniqueOrThrow({
      where: { id: moveDraft.id },
    });
    await db.task.update({
      where: { id: moveDraft.id },
      data: {
        data: { ...(changed.data as any), goal: '已修改的目标' },
        version: { increment: 1 },
      },
    });
    assert.equal((await p.request(reviewPath)).data.items[0].stale, true);
    assert.equal(
      (await db.task.findUniqueOrThrow({ where: { id: moveDraft.id } })).status,
      'DRAFT',
    );

    assert.equal(
      (
        await p.request('/tasks/' + moveDraft.id, 'PATCH', {
          ...draft,
          projectId: pid,
          expectedVersion: moveDraft.version,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await p.request('/projects/' + destination.id, 'DELETE', {
          confirmName: '需求转移目标',
        })
      ).status,
      409,
    );
    const overview = await p.request(
      '/workspaces/' + settingsTeam + '/overview',
    );
    assert.equal(overview.status, 200);
    assert(overview.data.projects.some((x: any) => x.id === destination.id));
    assert(overview.data.todos.some((x: any) => x.id === moveDraft.id));
    assert.equal(
      (await other.request('/workspaces/' + settingsTeam + '/overview')).status,
      404,
    );
    let result = await p.request(`/projects/${pid}/tasks`, 'POST', draft);
    assert.equal(result.status, 200);
    let t = result.data;
    // Editable sidebar properties keep status, snapshots and concurrent writes protected.
    const meta = (
      await p.request(`/projects/${pid}/tasks`, 'POST', {
        ...draft,
        title: draft.title + ' 基本信息',
      })
    ).data;
    assert.equal(
      (
        await e.request(`/tasks/${meta.id}/properties`, 'PATCH', {
          expectedVersion: meta.version,
          priority: 'P0',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await other.request(`/tasks/${meta.id}/properties`, 'PATCH', {
          expectedVersion: meta.version,
          priority: 'P0',
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await p.request(`/tasks/${meta.id}/properties`, 'PATCH', {
          expectedVersion: meta.version,
          status: 'CLOSED',
        })
      ).status,
      422,
    );
    const metadataWrites = await Promise.all(
      ['P0', 'P3'].map((priority) =>
        p.request(`/tasks/${meta.id}/properties`, 'PATCH', {
          expectedVersion: meta.version,
          priority,
        }),
      ),
    );
    assert.deepEqual(metadataWrites.map((x) => x.status).sort(), [200, 409]);
    let metaFresh = (await p.request(`/tasks/${meta.id}`)).data;
    assert.equal(
      metaFresh.data.history.filter(
        (h: any) => h.action === 'UPDATE_PROPERTIES',
      ).length,
      1,
    );
    assert.equal(
      await db.auditEvent.count({
        where: { resourceId: meta.id, action: 'UPDATE_PROPERTIES' },
      }),
      1,
    );
    assert.equal(
      await db.notification.count({ where: { taskId: meta.id } }),
      2,
    );
    const dated = await p.request(`/tasks/${meta.id}/properties`, 'PATCH', {
      expectedVersion: metaFresh.version,
      dueAt: '2026-12-01T00:00:00.000Z',
    });
    assert.equal(dated.status, 200);
    assert.equal(dated.data.data.dueAt, '2026-12-01T00:00:00.000Z');
    const cleared = await p.request(`/tasks/${meta.id}/properties`, 'PATCH', {
      expectedVersion: dated.data.version,
      dueAt: null,
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.data.dueAt, undefined);
    const cancelled = await p.request(
      `/tasks/${meta.id}/actions`,
      'POST',
      {
        action: 'CANCEL',
        expectedVersion: cleared.data.version,
        payload: { reason: '结束基本信息验证' },
      },
      'metadata-cancel-' + Date.now(),
    );
    assert.equal(cancelled.status, 200);
    assert.equal(
      (
        await p.request(`/tasks/${meta.id}/properties`, 'PATCH', {
          expectedVersion: cancelled.data.version,
          priority: 'P0',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await p.request(`/projects/${pid}/tasks`, 'POST', {
          ...draft,
          productId: other.user.id,
        })
      ).status,
      422,
      '草稿不能引用其他团队负责人',
    );
    assert.equal(
      (
        await p.request(`/tasks/${t.id}`, 'PATCH', {
          status: 'CLOSED',
          expectedVersion: t.version,
        })
      ).status,
      422,
      '不能通用修改状态',
    );
    assert(
      (await p.request(`/tasks/${t.id}`)).data.allowedActions.includes(
        'SUBMIT_REQUIREMENT',
      ),
    );
    assert.equal((await other.request(`/tasks/${t.id}`)).status, 404);
    assert.equal(
      (
        await e.request(`/tasks/${t.id}`, 'PATCH', {
          ...draft,
          expectedVersion: 1,
        })
      ).status,
      403,
    );
    const raw = await fetch(base + `/tasks/${t.id}/actions`, {
      method: 'POST',
      headers: {
        Cookie: p.cookie,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'SUBMIT_REQUIREMENT',
        expectedVersion: 1,
      }),
    });
    assert.equal(raw.status, 403);
    async function act(
      who: any,
      action: string,
      payload: any = {},
      expect = 200,
      key = crypto.randomUUID(),
    ) {
      const r = await who.request(
        `/tasks/${t.id}/actions`,
        'POST',
        { action, expectedVersion: t.version, payload },
        key,
      );
      assert.equal(r.status, expect, JSON.stringify(r.data));
      if (expect === 200) t = r.data;
      return r;
    }
    const replayKey = crypto.randomUUID(),
      replayBody = {
        action: 'SUBMIT_REQUIREMENT',
        expectedVersion: t.version,
        payload: {},
      };
    await act(p, 'SUBMIT_REQUIREMENT', {}, 200, replayKey);
    const replay = await p.request(
      `/tasks/${t.id}/actions`,
      'POST',
      replayBody,
      replayKey,
    );
    assert.equal(replay.data.version, t.version);
    assert.equal(
      (
        await p.request(
          `/tasks/${t.id}/actions`,
          'POST',
          { ...replayBody, payload: { reason: 'different' } },
          replayKey,
        )
      ).status,
      409,
    );
    const solution = {
      body: '方案',
      scope: 'API',
      effort: 1,
      risk: '无',
      start: '2026-10-16',
      end: '2026-10-17',
    };
    await act(e, 'SUBMIT_SOLUTION', solution);
    await act(e, 'APPROVE_SOLUTION', {}, 403);
    const v = t.version;
    const concurrent = await Promise.all(
      [p, q].map((w) =>
        w.request(
          `/tasks/${t.id}/actions`,
          'POST',
          { action: 'APPROVE_SOLUTION', expectedVersion: v, payload: {} },
          crypto.randomUUID(),
        ),
      ),
    );
    assert.deepEqual(concurrent.map((x) => x.status).sort(), [200, 409]);
    t = (await p.request(`/tasks/${t.id}`)).data;
    assert.equal(t.status, 'SOLUTION_REVIEW');
    await act(e, 'START_DEVELOPMENT', {}, 409);
    await act(concurrent[0].status === 409 ? p : q, 'APPROVE_SOLUTION');
    assert.equal(t.status, 'READY_FOR_DEV');
    await act(e, 'START_DEVELOPMENT');
    await act(p, 'BLOCK', { reason: '依赖等待' });
    await act(
      e,
      'COMPLETE_DEVELOPMENT',
      {
        summary: '实现',
        selfTest: '通过',
        releaseVersion: '1',
        environment: 'local',
        knownIssues: '无',
      },
      409,
    );
    await act(p, 'UNBLOCK', { reason: '已就绪' });
    const dev = {
      summary: '开发完成',
      selfTest: '已验证',
      releaseVersion: '1.0',
      environment: '本地',
      knownIssues: '无',
    };
    await act(e, 'COMPLETE_DEVELOPMENT', dev);
    await act(q, 'START_TEST', { environment: 'local' });
    await act(
      q,
      'FAIL_TEST',
      { record: '失败', deployment: 'local', reason: '失败' },
      422,
    );
    const bug = await q.request(`/projects/${pid}/tasks`, 'POST', {
      ...draft,
      title: '回归缺陷',
      type: 'BUG',
      severity: 'BLOCKER',
      parentId: t.id,
      parentRound: 1,
    });
    assert.equal(bug.status, 200);
    await act(q, 'FAIL_TEST', {
      record: '失败',
      deployment: 'local',
      reason: '失败',
      defectIds: [bug.data.id],
    });
    await act(e, 'COMPLETE_DEVELOPMENT', dev);
    assert.equal(t.data.tests.length, 2);
    await act(q, 'START_TEST', { environment: 'local' });
    await act(
      q,
      'PASS_TEST',
      { record: '准备通过', deployment: '环境正常' },
      422,
    );
    const parentTask = t;
    t = bug.data;
    await act(p, 'SUBMIT_REQUIREMENT');
    await act(e, 'SUBMIT_SOLUTION', solution);
    await act(p, 'APPROVE_SOLUTION');
    await act(q, 'APPROVE_SOLUTION');
    await act(e, 'START_DEVELOPMENT');
    await act(e, 'COMPLETE_DEVELOPMENT', dev);
    await act(q, 'START_TEST', { environment: '缺陷修复验证' });
    await act(q, 'PASS_TEST', { record: '缺陷已修复', deployment: '环境正常' });
    await act(p, 'ACCEPT', { checks: [true] });
    t = parentTask;
    await act(q, 'PASS_TEST', { record: '通过', deployment: '通过' });
    await act(p, 'ACCEPT', { checks: [true] });
    assert.equal(t.status, 'CLOSED');
    assert.equal(
      (await p.request(`/tasks/${t.id}`)).data.data.history.length,
      t.data.history.length,
    );
    const doc = await p.request(`/projects/${pid}/documents`, 'POST', {
      title: '冲突验证',
      content: 'v1',
      taskIds: [t.id],
    });
    assert.equal(doc.status, 200);
    const relatedDocs = await p.request(`/tasks/${t.id}/documents`);
    assert.equal(relatedDocs.status, 200);
    assert(relatedDocs.data.some((d: any) => d.id === doc.data.id));
    assert(
      relatedDocs.data.every(
        (d: any) => !('content' in d) && !('revisions' in d),
      ),
    );
    const linkedTasks = await p.request(`/documents/${doc.data.id}/tasks`);
    assert.equal(linkedTasks.status, 200);
    assert.deepEqual(
      linkedTasks.data.map((x: any) => x.id),
      [t.id],
    );
    assert.equal(linkedTasks.data[0].status, 'CLOSED');
    assert.equal((await other.request(`/tasks/${t.id}/documents`)).status, 404);
    assert.equal(
      (await other.request(`/documents/${doc.data.id}/tasks`)).status,
      404,
    );
    assert.equal(
      (await other.request(`/documents/${doc.data.id}`)).status,
      404,
    );
    assert.equal(
      (
        await p.request(`/documents/${doc.data.id}`, 'PATCH', {
          title: '冲突验证',
          content: 'v2',
          expectedVersion: 1,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await e.request(`/documents/${doc.data.id}`, 'PATCH', {
          title: '冲突验证',
          content: 'v3',
          expectedVersion: 1,
        })
      ).status,
      409,
    );
    assert.deepEqual((await p.request(`/tasks/${t.id}/documents`)).data, []);
    assert.deepEqual(
      (await p.request(`/documents/${doc.data.id}/tasks`)).data,
      [],
    );
    const newTask = await p.request(`/projects/${pid}/tasks`, 'POST', {
      ...draft,
      title: '回滚验证',
    });
    t = newTask.data;
    const before = {
      task: await db.task.findUnique({ where: { id: t.id } }),
      audit: await db.auditEvent.count(),
      notes: await db.notification.count(),
    };
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION coflow_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated test failure'; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER coflow_test_abort BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION coflow_test_fail_audit()`,
    );
    try {
      await act(p, 'SUBMIT_REQUIREMENT', {}, 500);
      assert.deepEqual(
        await db.task.findUnique({ where: { id: t.id } }),
        before.task,
      );
      assert.equal(await db.auditEvent.count(), before.audit);
      assert.equal(await db.notification.count(), before.notes);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER coflow_test_abort ON "AuditEvent"',
      );
      await db.$executeRawUnsafe('DROP FUNCTION coflow_test_fail_audit()');
    }
    await act(p, 'SUBMIT_REQUIREMENT');
    const savedDraft = await e.request(`/tasks/${t.id}/solutions`, 'POST', {
      expectedVersion: t.version,
      payload: { body: '未提交方案草稿' },
    });
    assert.equal(savedDraft.status, 200);
    t = savedDraft.data;
    assert.equal(t.status, 'SOLUTION_PENDING');
    assert.equal(t.data.solutions.length, 0);
    const solutionResult = await e.request(
      `/tasks/${t.id}/solutions`,
      'POST',
      { submit: true, expectedVersion: t.version, payload: solution },
      crypto.randomUUID(),
    );
    assert.equal(solutionResult.status, 200);
    t = solutionResult.data;
    assert.equal(t.data.solutionDraft, undefined);
    assert.equal(
      (
        await e.request(`/tasks/${t.id}/solutions`, 'POST', {
          expectedVersion: t.version,
          payload: { body: '不允许覆盖评估中方案' },
        })
      ).status,
      409,
    );
    await act(p, 'APPROVE_SOLUTION');
    await act(q, 'REJECT_SOLUTION', { reason: '补充风险' });
    await act(e, 'SUBMIT_SOLUTION', solution);
    await act(q, 'APPROVE_SOLUTION');
    assert.equal(t.status, 'SOLUTION_REVIEW');
    await act(e, 'START_DEVELOPMENT', {}, 409);
    await act(p, 'APPROVE_SOLUTION');
    await act(e, 'START_DEVELOPMENT');
    await act(p, 'APPLY_REQUIREMENT_CHANGE', {
      description: '变更后的需求',
      criteria: ['新标准'],
      reason: '目标调整',
      impact: '增加接口',
    });
    assert.equal(t.status, 'SOLUTION_PENDING');
    assert.equal(t.data.requirementVersion, 2);
    assert.equal(t.data.reviewSnapshot, undefined);
    assert.equal(t.data.requirements[0].description, '需求');
    await act(e, 'START_DEVELOPMENT', {}, 409);
    const corrupted = structuredClone(t.data);
    corrupted.requirements[0].description = '非法覆盖';
    await assert.rejects(
      () => db.task.update({ where: { id: t.id }, data: { data: corrupted } }),
      '数据库必须拒绝覆盖需求历史',
    );
    const block = await p.request(
      `/tasks/${t.id}/blocks`,
      'POST',
      { expectedVersion: t.version, reason: '等待依赖' },
      crypto.randomUUID(),
    );
    assert.equal(block.status, 200);
    t = block.data;
    const resolved = await p.request(
      `/tasks/${t.id}/blocks/${t.data.blocks.at(-1).id}/resolve`,
      'POST',
      { expectedVersion: t.version, reason: '依赖已就绪' },
      crypto.randomUUID(),
    );
    assert.equal(resolved.status, 200);
    t = resolved.data;
    const invalidComment = await p.request(`/tasks/${t.id}/comments`, 'POST', {
      body: '跨团队提及',
      mentions: [other.user.id],
      expectedVersion: t.version,
    });
    assert.equal(invalidComment.status, 422);
    const comment = await p.request(`/tasks/${t.id}/comments`, 'POST', {
      body: '请 @测试 复核',
      mentions: [q.user.id],
      expectedVersion: t.version,
    });
    assert.equal(comment.status, 200);
    t = (await p.request(`/tasks/${t.id}`)).data;
    assert(Array.isArray((await p.request(`/tasks/${t.id}/comments`)).data));
    const notes = await q.request('/notifications');
    assert(notes.data.items.some((n: any) => n.message.includes('提及你')));
    const form = new FormData();
    form.append(
      'file',
      new Blob(['coflow attachment'], { type: 'text/plain' }),
      'verification.txt',
    );
    const uploaded = await fetch(base + `/tasks/${t.id}/attachments`, {
      method: 'POST',
      headers: { Cookie: p.cookie, Origin: origin, 'X-CSRF-Token': p.csrf },
      body: form,
    });
    assert.equal(uploaded.status, 200);
    const attachment: any = await uploaded.json();
    const download = await fetch(
      base + `/attachments/${attachment.id}/download`,
      { headers: { Cookie: p.cookie } },
    );
    assert.equal(download.status, 200);
    assert.equal(await download.text(), 'coflow attachment');
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert(download.headers.get('content-disposition')?.includes('attachment'));
    assert.equal(
      (await other.request(`/attachments/${attachment.id}/download`)).status,
      404,
    );
    const forged = new FormData();
    forged.append(
      'file',
      new Blob(['not a PNG'], { type: 'image/png' }),
      'forged.png',
    );
    assert.equal(
      (
        await fetch(base + `/tasks/${t.id}/attachments`, {
          method: 'POST',
          headers: { Cookie: p.cookie, Origin: origin, 'X-CSRF-Token': p.csrf },
          body: forged,
        })
      ).status,
      422,
    );
    const timeline = (await p.request(`/tasks/${t.id}/timeline`)).data;
    assert(timeline.some((x: any) => x.type === 'COMMENT'));
    assert(timeline.some((x: any) => x.type === 'ATTACHMENT'));
    const emailPrefix = 'invited-' + Date.now();
    const invitation = await p.request(
      '/workspaces/00000000-0000-4000-8000-000000000001/invitations',
      'POST',
      { email: emailPrefix + '@coflow.local' },
    );
    assert.equal(invitation.status, 200);
    const token = new URL(invitation.data.url).searchParams.get('invite');
    assert.equal(
      (await fetch(base + `/invitations/${token}/preview`)).status,
      200,
    );
    const registration = await fetch(base + '/auth/register-invitation', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        name: '受邀用户',
        password: process.env.SEED_PASSWORD,
      }),
    });
    assert.equal(registration.status, 200);
    assert.equal(
      (await p.request('/invitations/accept', 'POST', { token })).status,
      422,
    );
    const invited = await login(emailPrefix);
    assert.equal(
      (await invited.request(`/tasks/${t.id}`)).status,
      403,
      '同团队非项目成员应为 403',
    );
    await p.request(`/projects/${pid}/members`, 'POST', {
      userId: invited.user.id,
      roles: ['ENGINEER'],
    });
    await act(p, 'TRANSFER', {
      engineerId: invited.user.id,
      reason: '交接新研发',
    });
    await act(e, 'SUBMIT_SOLUTION', solution, 403);
    const transferTodo = await invited.request('/me/todos');
    assert(transferTodo.data.some((x: any) => x.id === t.id));
    await act(p, 'CANCEL', { reason: '验证完成' });
    const sessionHash = createHash('sha256')
      .update(other.cookie.slice('coflow='.length))
      .digest('hex');
    await db.session.update({
      where: { hash: sessionHash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal((await other.request('/auth/me')).status, 401);
    assert.equal(
      (await p.request(`/projects/${pid}/members/${e.user.id}`, 'DELETE', {}))
        .status,
      422,
    );
    // Archive a dedicated project so seeded scenarios remain usable on repeated test runs.
    const archived = await p.request(
      '/workspaces/00000000-0000-4000-8000-000000000001/projects',
      'POST',
      { name: '归档验证 ' + Date.now() },
    );
    const archivedDoc = await p.request(
      `/projects/${archived.data.id}/documents`,
      'POST',
      { title: '归档资料', content: '可读', taskIds: [] },
    );
    assert.equal(archivedDoc.status, 200);
    const archivedTemplate = await p.request(
      `/projects/${archived.data.id}/templates`,
      'POST',
      { ...templateInput, name: '归档模板' },
    );
    assert.equal(archivedTemplate.status, 200);
    const archivedCompetition = await p.request(
      `/projects/${archived.data.id}/competitions`,
      'POST',
      competitionPayload,
    );
    assert.equal(archivedCompetition.status, 200);
    await p.request(`/projects/${archived.data.id}`, 'PATCH', {
      archived: true,
    });
    assert.equal(
      (
        await p.request(`/projects/${archived.data.id}/documents`, 'POST', {
          title: '禁止写入',
          content: 'x',
        })
      ).status,
      409,
    );
    assert.equal(
      (await p.request(`/documents/${archivedDoc.data.id}/tasks`)).status,
      200,
    );
    assert.equal(
      (await p.request(`/documents/${archivedDoc.data.id}`)).status,
      200,
    );
    assert.equal(
      (await p.request(`/projects/${archived.data.id}/templates`)).data
        .readOnly,
      true,
    );
    assert.equal(
      (
        await p.request(`/templates/${archivedTemplate.data.id}`, 'PATCH', {
          ...templateInput,
          expectedVersion: 1,
        })
      ).status,
      409,
    );
    await assert.rejects(() =>
      db.requirementTemplate.update({
        where: { id: archivedTemplate.data.id },
        data: { name: '禁止绕过归档' },
      }),
    );
    assert.equal(
      (await p.request(`/projects/${archived.data.id}/competitions`)).data
        .readOnly,
      true,
    );
    assert.equal(
      (
        await p.request(
          `/competitions/${archivedCompetition.data.id}`,
          'PATCH',
          { ...competitionPayload, expectedVersion: 1 },
        )
      ).status,
      409,
    );
    await assert.rejects(() =>
      db.competition.update({
        where: { id: archivedCompetition.data.id },
        data: { name: '禁止绕过归档' },
      }),
    );
    assert.equal(
      (
        await p.request(
          '/competitions/' + archivedCompetition.data.id + '/proof',
        )
      ).data.readOnly,
      true,
    );
    assert.equal(
      (
        await p.request(
          '/competitions/' + archivedCompetition.data.id + '/proof/claims',
          'POST',
          { claim: { statement: '归档项目不能修改主张' }, expectedVersion: 0 },
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await p.request(
          '/competitions/' + archivedCompetition.data.id + '/proof/export',
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await p.request(
          `/competitions/${archivedCompetition.data.id}/firststep/save`,
          'POST',
          { ...firstStepSave, expectedVersion: 1 },
        )
      ).status,
      409,
    );
    await assert.rejects(() =>
      db.document.create({
        data: {
          workspaceId: '00000000-0000-4000-8000-000000000001',
          projectId: archived.data.id,
          title: '直接写入也必须拒绝',
          content: 'x',
          taskIds: [],
          revisions: [],
        },
      }),
    );
    await assert.rejects(() =>
      db.document.update({
        where: { id: doc.data.id },
        data: { content: '非法覆盖', version: 3, revisions: [] },
      }),
    );
    await p.request('/auth/logout', 'POST', {});
    assert.equal((await p.request('/auth/me')).status, 401);
    assert.equal(
      (await p.request(`/documents/${doc.data.id}/tasks`)).status,
      401,
    );
    assert.equal((await p.request(`/tasks/${t.id}/documents`)).status, 401);
  } finally {
    child.kill();
    await db.$disconnect();
  }
});

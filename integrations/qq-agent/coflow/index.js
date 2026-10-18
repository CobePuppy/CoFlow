import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { DATA_DIR } from '../../src/config.js';

let policyCache;
let api,
  cfg = () => ({}),
  generation = 0,
  active = false,
  ticking = false;
const busy = new Set();
const stateFile = path.join(DATA_DIR, 'plugins', 'coflow', 'reminders.json');
export function setup(value) {
  api = value;
  cfg = value.config;
}
export function activate() {
  active = true;
  generation++;
}
export function deactivate() {
  active = false;
  generation++;
}
export function dispose() {
  deactivate();
}
function same(version, config) {
  const c = cfg();
  return (
    active &&
    generation === version &&
    c.apiBase === config.apiBase &&
    c.accessToken === config.accessToken &&
    c.workspaceId === config.workspaceId
  );
}
export function endpoint(config, route) {
  const base = new URL(String(config.apiBase || '').replace(/\/+$/, '') + '/');
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !base.pathname.endsWith('/api/v1/integrations/qq/')
  )
    throw new Error('接口配置错误');
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback))
    throw new Error('跨机器连接必须使用 HTTPS');
  if (String(config.accessToken || '').length < 32)
    throw new Error('机器人令牌尚未配置');
  return new URL(route, base);
}
// Only the administrator-configured origin is contacted. No redirects or message-provided URLs.
export function request(config, route, method = 'GET', body) {
  const url = endpoint(config, route);
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          ...(config.workspaceId
            ? { 'X-CoFlow-Workspace': config.workspaceId }
            : {}),
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 512 * 1024) {
            res.destroy();
            reject(new Error('响应过大'));
          } else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const errors = {
                401: '机器人凭据失效，请联系管理员',
                403: '当前账号无团队访问权限',
                404: '尚未绑定，请在汇流个人设置中生成绑定码',
                409: '账号已绑定，请先在平台解绑',
                422: '绑定码无效或已过期',
                429: '请求频繁，请稍后重试',
                503: '汇流 QQ 集成尚未配置',
              };
              throw new Error(errors[res.statusCode] || '汇流接口暂时不可用');
            }
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    const deadline = setTimeout(
      () => req.destroy(new Error('汇流接口请求超时')),
      10000,
    );
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.end(data);
  });
}
const clean = (v, max = 140) =>
  String(v || '')
    .replace(/[\r\n\u0000-\u001f]/g, ' ')
    .replace(/\[CQ:/gi, '［CQ:')
    .slice(0, max);
export function formatWork(data, reminder = false) {
  if (!data.total) return '当前没有待处理工作。';
  if (!data.items.length)
    return `页码超出范围：共 ${data.total} 项，${Math.ceil(data.total / data.pageSize)} 页。发送 /工作 帮助 查看分页指令。`;
  const rows = data.items.map(
    (t) =>
      `${t.overdue ? '【逾期】' : ''}${t.blocked ? '【阻塞】' : ''}#${t.number} ${clean(t.title)}\n${clean(t.project, 50)} · ${clean(t.status, 20)} · ${clean(t.priority, 4)}\n${t.dueAt ? '截止：' + new Date(t.dueAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未设置截止时间'}\n${t.url}`,
  );
  return `${reminder ? '汇流工作提醒' : '汇流工作清单'}：共 ${data.total} 项\n${rows.join('\n\n')}\n第 ${data.page}/${Math.ceil(data.total / data.pageSize)} 页${data.total > data.pageSize ? '；私信 /工作 [全部|逾期] 页码 查看更多' : ''}`;
}
const help =
  '/工作 [页码]\n/工作 全部 [页码]\n/工作 逾期 [页码]\n/工作 绑定 <绑定码>（仅私信）\n绑定状态和解绑请前往汇流 → 成员管理。';
export function slotKey(now, times) {
  const local = new Date(now + 8 * 3600000).toISOString();
  const values = String(times || '')
    .split(/[,，\s]+/)
    .filter((s) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s));
  return values.includes(local.slice(11, 16)) ? local.slice(0, 16) : null;
}
export const providers = {
  'message.command': (ctx) => {
    const text = ctx.text.trim();
    if (!/^\/工作(?:\s|$)/.test(text)) return null;
    const version = generation,
      config = { ...cfg() },
      qq = String(ctx.senderId);
    const reply = (value) =>
      same(version, config)
        ? ctx.sender.sendTextBatch(`private:${qq}`, [value])
        : Promise.resolve();
    const done = (async () => {
      if (!/^[1-9]\d{4,14}$/.test(qq)) return;
      if (busy.has(qq) || busy.size >= 10) {
        await reply('正在查询，请稍候再试。');
        return;
      }
      busy.add(qq);
      try {
        const parts = text.split(/\s+/).slice(1);
        if (parts[0] === '绑定') {
          if (ctx.kind !== 'private') {
            await reply(
              '绑定码仅可通过私信提交；如果已发到群中，请在平台撤销并重新生成。',
            );
          } else if (parts.length !== 2 || !/^[a-f0-9]{32}$/.test(parts[1]))
            await reply('请从汇流成员管理复制完整绑定指令。');
          else {
            await request(config, 'bind', 'POST', { qq, code: parts[1] });
            await reply('绑定成功。发送 /工作 查询待办。');
          }
        } else if (parts[0] === '帮助') await reply(help);
        else {
          const mode =
            parts[0] === '全部'
              ? 'all'
              : parts[0] === '逾期'
                ? 'overdue'
                : 'current';
          if (mode !== 'current') parts.shift();
          if (
            parts.length > 1 ||
            (parts.length && !/^[1-9]\d{0,4}$/.test(parts[0]))
          )
            await reply(help);
          else {
            const data = await request(
              config,
              `work?qq=${qq}&mode=${mode}&page=${parts[0] || 1}`,
            );
            await reply(formatWork(data));
          }
        }
        if (ctx.kind === 'group' && same(version, config))
          await ctx.sender.sendTextBatch(
            `group:${ctx.chatId}`,
            ['工作助手的回复已私信发送。'],
            { replyToMessageId: ctx.messageId },
          );
      } catch (e) {
        api.warn('工作查询或私信发送失败，请检查网络、绑定和好友关系。');
        try {
          await reply(clean(e.message, 180));
        } catch {
          /* Logged above; never leak private details into a group. */
        }
      } finally {
        busy.delete(qq);
      }
    })();
    return { handled: true, done };
  },
  'schedule.tick': async ({ sender, now }) => {
    if (ticking || !active) return;
    const config = { ...cfg() },
      version = generation;
    if (!config.pushEnabled) return;
    ticking = true;
    try {
      let times = config.pushTimes;
      if (config.syncPolicy) {
        const key = createHash('sha256')
          .update(
            String(config.apiBase) +
              '|' +
              String(config.workspaceId || '') +
              '|' +
              String(config.accessToken),
          )
          .digest('hex');
        if (
          !policyCache ||
          policyCache.key !== key ||
          policyCache.expires < Date.now()
        )
          policyCache = {
            key,
            expires: Date.now() + 30000,
            ...(await request(config, 'policy')),
          };
        if (!policyCache.pushEnabled) return;
        times = policyCache.pushTimes;
      }
      const slot = slotKey(now, times);
      if (!slot) return;
      let state = {};
      if (fs.existsSync(stateFile))
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (!state || typeof state !== 'object' || Array.isArray(state))
        throw new Error('提醒记录格式错误');
      for (const value of Object.values(state)) {
        if (
          !value ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value.day) ||
          !['sending', 'sent', 'failed'].includes(value.status) ||
          !Number.isInteger(value.attempts) ||
          value.attempts < 1
        )
          throw new Error('提醒记录格式错误');
      }
      for (const [key, value] of Object.entries(state))
        if (value.day < slot.slice(0, 10)) delete state[key];
      const save = () => {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state), {
          mode: 0o600,
        });
        fs.renameSync(stateFile + '.tmp', stateFile);
      };
      const scope = createHash('sha256')
        .update(
          String(config.apiBase) +
            (config.workspaceId ? '|' + String(config.workspaceId) : ''),
        )
        .digest('hex')
        .slice(0, 16);
      let cursor = '';
      do {
        if (!same(version, config) || !cfg().pushEnabled) return;
        const recipients = await request(
          config,
          `recipients?cursor=${encodeURIComponent(cursor)}`,
        );
        for (const { qq } of recipients.items) {
          if (!same(version, config) || !cfg().pushEnabled) return;
          if (!/^[1-9]\d{4,14}$/.test(qq)) continue;
          const key = `${scope}:${slot}:${qq}`,
            old = state[key];
          if (
            old?.status === 'sent' ||
            old?.status === 'sending' ||
            old?.attempts >= 3
          )
            continue;
          try {
            const work = await request(config, `work?qq=${qq}`);
            if (!same(version, config) || !cfg().pushEnabled) return;
            if (!work.total) continue;
            state[key] = {
              day: slot.slice(0, 10),
              status: 'sending',
              attempts: (old?.attempts || 0) + 1,
            };
            save();
            // A durable reservation prevents duplicate messages after an uncertain crash.
            await sender.sendTextBatch(`private:${qq}`, [
              formatWork(work, true),
            ]);
            state[key].status = 'sent';
            save();
          } catch {
            if (state[key] && state[key].status !== 'sent') {
              state[key].status = 'failed';
              save();
            }
            api.warn('待办提醒失败，将在当前提醒分钟内有限重试。');
          }
        }
        cursor = recipients.nextCursor || '';
      } while (cursor);
    } catch {
      api.warn('汇流定时提醒不可用，请检查接口配置、网络与提醒记录文件。');
    } finally {
      ticking = false;
    }
  },
};

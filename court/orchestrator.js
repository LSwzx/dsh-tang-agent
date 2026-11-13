/**
 * dsh-tang-agent · 按需朝议编排器
 *
 * 钦天监本地探测；中书按需起草；门下先跑本地规则，再按需调用弱模型；
 * 尚书派发/汇总由代码完成；工兵刑派生真实子 Agent，户礼吏直接跑本地 JS 工具。
 */

import { randomUUID } from 'node:crypto';
import { createRunParent, runSubagent, defaultModelOptions } from './agent-runner.js';
import { loadPrompts } from './prompts.js';
import { createMinistryTools, MINISTRY_TOOL_NAMES } from './tools.js';
import { probeCapabilities } from './probe.js';
import { localReview } from './local-review.js';
import { MINISTRIES, MINISTRY_ORDER, ROLE_LABELS } from './meta.js';

const MAX_EDICT_LENGTH = 4000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
// 这三部只做确定性读取/统计/分派，不再启动 LLM。
const DETERMINISTIC_ROLES = new Set(['rites', 'revenue', 'personnel']);

function now() {
  return new Date().toISOString();
}

function resolveWorkspace(ctx) {
  try {
    const registry = ctx.get ? ctx.get('workspaceRegistry') : undefined;
    const list = registry && typeof registry.list === 'function' ? registry.list() : [];
    const preferred = list.find((item) => /dshprogram/i.test(String(item.path || item.directory || ''))) || list[0];
    const path = preferred && (preferred.path || preferred.directory || preferred.root);
    if (path) return String(path);
  } catch {
    /* fall through */
  }
  return ctx.workingDirectory?.defaultDirectory || process.cwd();
}

function textOf(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function parseJson(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function ministryKey(order) {
  if (!order || typeof order !== 'object') return '';
  if (MINISTRY_ORDER.includes(order.ministry)) return order.ministry;
  const found = MINISTRY_ORDER.find(
    (key) =>
      order.ministry === MINISTRIES[key].name ||
      order.name === MINISTRIES[key].name ||
      order.ministry_name === MINISTRIES[key].name,
  );
  return found || '';
}

function normalizeOrder(key, found) {
  const meta = MINISTRIES[key];
  return {
    ministry: key,
    name: meta.name,
    objective: String(found?.objective || found?.order || ''),
    deliverable: String(found?.deliverable || ''),
    tools: meta.toolLabel ? [meta.toolLabel] : [],
    deadline: String(found?.deadline || '旬日'),
    args: found && found.args && typeof found.args === 'object' && !Array.isArray(found.args) ? found.args : {},
    wave: key === 'works' ? 1 : 2,
  };
}

function mergeOrder(previous, incoming) {
  const next = { ...previous };
  for (const key of ['objective', 'deliverable', 'deadline']) {
    if (String(incoming[key] || '').trim()) next[key] = incoming[key];
  }
  if (incoming.args && Object.keys(incoming.args).length) next.args = { ...previous.args, ...incoming.args };
  if (incoming.name) next.name = incoming.name;
  if (Array.isArray(incoming.tools) && incoming.tools.length) next.tools = incoming.tools;
  next.wave = incoming.wave;
  return next;
}

function normalizeDraft(raw, edict, revision, previous) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const sourceOrders = Array.isArray(payload.orders) ? payload.orders : [];
  const incoming = [];
  const seen = new Set();
  for (const found of sourceOrders) {
    const key = ministryKey(found);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    incoming.push(normalizeOrder(key, found));
  }

  let orders;
  if (previous) {
    const merged = new Map((previous.orders || []).map((order) => [order.ministry, order]));
    for (const order of incoming) {
      const old = merged.get(order.ministry);
      merged.set(order.ministry, old ? mergeOrder(old, order) : order);
    }
    orders = MINISTRY_ORDER.map((key) => merged.get(key)).filter(Boolean);
  } else {
    orders = incoming;
  }

  const summary = String(payload.summary || payload.plan || (previous && previous.summary) || '').slice(0, 1200);
  const risks = asArray(payload.risks);
  const acceptance = asArray(payload.acceptance);
  return {
    revision,
    summary,
    orders,
    risks: risks.length
      ? risks
      : (previous && previous.risks && previous.risks.length ? previous.risks : ['未列风险：按最低限度保留工期、预算与安全风险。']),
    acceptance: acceptance.length
      ? acceptance
      : (previous && previous.acceptance && previous.acceptance.length ? previous.acceptance : ['验收：交付物存在且可回读。']),
    notes: previous ? `依门下省驳议增量修订（第 ${previous.revision} 稿）。` : '中书省初拟。',
  };
}

function normalizeReview(text, raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const approved =
    payload.approved === true ||
    (payload.approved === undefined && /准奏/.test(text) && !/驳回|封驳/.test(text));
  return {
    approved,
    comment: String(payload.comment || (approved ? '准奏。' : '驳回。')).slice(0, 800),
    issues: asArray(payload.issues).length
      ? asArray(payload.issues)
      : approved
        ? []
        : [String(payload.comment || text || '门下省未给出具体驳议').slice(0, 300)],
  };
}

function normalizeMinistryResult(role, text, raw) {
  const meta = MINISTRIES[role];
  const payload = raw && typeof raw === 'object' ? raw : {};
  const artifacts = asArray(payload.artifacts);
  const metrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : {};
  return {
    ministry: role,
    name: meta.name,
    status: payload.status === 'blocked' || payload.status === 'failed' ? payload.status : 'done',
    summary: String(payload.summary || text || '未返回覆命').slice(0, 1600),
    artifacts: artifacts.length ? artifacts : (text ? [text.slice(0, 300)] : []),
    metrics,
  };
}

export class CourtOrchestrator {
  constructor(ctx, store, options = {}) {
    this.ctx = ctx;
    this.store = store;
    this.options = options;
    this.models = options.models && typeof options.models === 'object' ? options.models : {};
    this.runs = new Map();
    this.controllers = new Map();
    this.parents = new Map();
    this.parentHandles = new Map();
    this.subscribers = new Map();
    this.saveTimers = new Map();
    this.agentRuns = new Map();
    this.pendingApprovals = new Map();
    this.disposeApproval = ctx.on
      ? ctx.on('approval/request', (request, next) => this.handleApproval(request, next))
      : undefined;
    this.ready = store.init();
  }

  /**
   * 用 DSH 原生 approval/request waterfall 承接插件自己的审批：
   * 请求进入 pending 队列，侧边栏弹出“允许/拒绝”，用户点击后 resolve。
   */
  async handleApproval(request, next) {
    const runId = this.agentRuns.get(request.agent?.id);
    const run = runId ? this.runs.get(runId) : undefined;
    if (!run || !request.toolName?.startsWith('tang_')) return next();
    const decision = await this.requestApproval(run, {
      toolName: request.toolName,
      reason: request.reason || '',
      displayReason: request.displayReason || {},
      signal: request.signal,
      actor: request.agent?.id,
    });
    return decision === 'allow' ? 'allowed-once' : 'rejected';
  }

  async requestApproval(run, request) {
    const id = `approval-${randomUUID()}`;
    const entry = {
      id,
      runId: run.id,
      actor: request.actor || '',
      toolName: request.toolName,
      reason: request.reason || '',
      displayReason: request.displayReason || {},
      status: 'pending',
      createdAt: now(),
    };
    run.approvals = run.approvals || [];
    run.approvals.push(entry);
    this.touch(run, true);

    const decision = await new Promise((resolve) => {
      const settle = (value) => {
        if (pending.timer) clearTimeout(pending.timer);
        this.pendingApprovals.delete(id);
        resolve(value);
      };
      const pending = { settle, runId: run.id };
      this.pendingApprovals.set(id, pending);
      pending.timer = setTimeout(() => settle('timeout'), 5 * 60 * 1000);
      request.signal?.addEventListener('abort', () => settle('cancel'), { once: true });
    });
    entry.status = decision === 'allow' ? 'allowed' : decision === 'timeout' ? 'timeout' : decision === 'cancel' ? 'cancelled' : 'rejected';
    entry.decidedAt = now();
    const action = decision === 'allow' ? '批准' : decision === 'timeout' ? '超时' : decision === 'cancel' ? '取消' : '驳回';
    this.log(run, '皇帝', action, `${entry.toolName}：${entry.reason}`, decision === 'allow' ? 'ok' : 'bad');
    this.touch(run, true);
    return decision;
  }

  decideApproval(id, decision) {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return false;
    pending.settle(decision === 'allow' ? 'allow' : 'deny');
    return true;
  }

  roleLabel(role) {
    return ROLE_LABELS[role] || role;
  }

  touch(run, save = false) {
    run.updatedAt = now();
    run.rev = (run.rev || 0) + 1;
    this.broadcast(run);
    if (save) this.saveSoon(run);
  }

  saveSoon(run) {
    const existing = this.saveTimers.get(run.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.saveTimers.delete(run.id);
      void this.store.save(run);
    }, 250);
    this.saveTimers.set(run.id, timer);
  }

  log(run, actor, action, detail, tone = 'neutral') {
    run.history.push({
      seq: run.history.length + 1,
      actor,
      action,
      detail: String(detail || ''),
      tone,
      at: now(),
    });
    if (run.history.length > 400) run.history.splice(0, run.history.length - 400);
  }

  broadcast(run) {
    const set = this.subscribers.get(run.id);
    if (!set) return;
    const payload = JSON.stringify(run);
    for (const write of set) {
      try {
        write(payload);
      } catch {
        /* 断开的 SSE 由 close 清理 */
      }
    }
  }

  subscribe(runId, write) {
    let set = this.subscribers.get(runId);
    if (!set) {
      set = new Set();
      this.subscribers.set(runId, set);
    }
    set.add(write);
    return () => {
      set.delete(write);
      if (set.size === 0) this.subscribers.delete(runId);
    };
  }

  get(id) {
    return this.runs.get(id) || this.store.get(id);
  }

  async wait(id, signal) {
    const run = this.get(id);
    if (!run) throw new Error(`run 不存在：${id}`);
    while (run.status === 'running') {
      if (signal?.aborted) {
        this.cancel(id);
        throw new Error('朝议已取消。');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return run;
  }

  async dispose() {
    for (const controller of this.controllers.values()) {
      try {
        controller.abort(new Error('插件卸载'));
      } catch {
        /* ignore */
      }
    }
    for (const handle of new Set(this.parentHandles.values())) {
      try {
        await handle.dispose();
      } catch {
        /* ignore */
      }
    }
    this.parentHandles.clear();
    for (const pending of this.pendingApprovals.values()) {
      try {
        pending.settle('deny');
      } catch {
        /* ignore */
      }
    }
    if (this.disposeApproval) {
      try {
        this.disposeApproval();
      } catch {
        /* ignore */
      }
    }
    for (const timer of this.saveTimers.values()) clearTimeout(timer);
    this.saveTimers.clear();
    await this.store.close();
  }

  list() {
    const live = [...this.runs.values()];
    const known = new Set(live.map((run) => run.id));
    return [...live, ...this.store.list().filter((run) => !known.has(run.id))].sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    );
  }

  async start(edict, opts = {}) {
    await this.ready;
    const text = String(edict || '').trim();
    if (!text) throw new Error('圣旨不可为空。');
    if (text.length > MAX_EDICT_LENGTH) throw new Error(`圣旨过长：上限 ${MAX_EDICT_LENGTH} 字。`);

    const continueFrom = typeof opts.continueFrom === 'string' ? opts.continueFrom : '';
    let previous;
    if (continueFrom) {
      previous = this.runs.get(continueFrom) || this.store.get(continueFrom);
      if (!previous) throw new Error(`续旨失败：找不到上一案 ${continueFrom}`);
      if (previous.status === 'running') throw new Error('续旨失败：上一案仍在运行，请等它完成或先中止。');
    }

    const mode = ['full', 'single', 'quick'].includes(opts.mode) ? opts.mode : 'full';
    const maxRejections = Math.max(1, Math.min(Number(opts.maxRejections) || 3, 5));
    const run = {
      id: `tang-${randomUUID()}`,
      edict: text,
      mode,
      strictReview: Boolean(opts.strictReview),
      continueFrom: previous ? previous.id : '',
      threadId: '',
      previous: previous
        ? {
            id: previous.id,
            edict: previous.edict,
            status: previous.status,
            summary: previous.summary || '',
            review: previous.review || null,
            results: (previous.results || []).map((result) => ({
              ministry: result.ministry,
              name: result.name,
              status: result.status,
              summary: result.summary,
              artifacts: result.artifacts || [],
              metrics: result.metrics || {},
            })),
          }
        : null,
      phase: mode === 'quick' ? 'quick' : mode === 'single' ? 'single' : 'drafting',
      status: 'running',
      maxRejections,
      rejections: 0,
      revision: 0,
      ministry: opts.ministry || 'works',
      cwd: opts.cwd || this.options.workspace || resolveWorkspace(this.ctx),
      orders: [],
      draft: null,
      feasibility: null,
      review: null,
      dispatch: null,
      results: [],
      summary: '',
      agents: {},
      agentHistory: [],
      agentCount: 0,
      approvals: [],
      wave: 0,
      spawns: [],
      history: [],
      createdAt: Date.now(),
      updatedAt: now(),
      finishedAt: null,
      error: '',
      rev: 0,
    };
    this.runs.set(run.id, run);
    run.threadId = (previous && previous.threadId) || (previous && previous.id) || run.id;
    run.requestApproval = (request) => this.requestApproval(run, request);
    this.controllers.set(run.id, new AbortController());
    this.log(run, '皇帝', previous ? '续旨' : '下旨', text, 'neutral');
    if (previous) {
      this.log(run, '尚书省', '接续', `同案第 ${previous.threadId || previous.id} 号；上一案：${previous.summary || previous.status}`, 'ok');
    }
    this.log(run, '尚书省', '接旨', `模式：${mode === 'full' ? '完整朝议' : mode === 'single' ? '单部直调' : '快速问答'}；驳回上限：${maxRejections}`, 'ok');
    this.touch(run, true);
    void this.execute(run).catch((error) => this.fail(run, error));
    return run.id;
  }

  cancel(id) {
    const controller = this.controllers.get(id);
    const run = this.runs.get(id);
    if (controller) controller.abort(new Error('用户取消'));
    if (run && run.status === 'running') {
      run.status = 'cancelled';
      run.phase = 'cancelled';
      run.finishedAt = now();
      this.log(run, '皇帝', '中止', '圣旨被皇帝中止，相关子 Agent 已收到取消信号。', 'bad');
      this.touch(run, true);
    }
    return run;
  }

  fail(run, error) {
    if (run.status === 'cancelled') return;
    run.status = 'failed';
    run.phase = 'failed';
    run.error = String(error?.message || error);
    run.finishedAt = now();
    this.log(run, '尚书省', '差错', run.error, 'bad');
    this.touch(run, true);
  }

  modelOptions(tier = 'strong') {
    const base = defaultModelOptions(this.ctx) || {};
    const configured = this.models[tier];
    if (!configured) return Object.keys(base).length ? base : undefined;
    if (typeof configured === 'string') return { ...base, model: configured };
    if (configured && typeof configured === 'object') return { ...base, ...configured };
    return Object.keys(base).length ? base : undefined;
  }

  async callRole(run, role, task, signal, tier = 'strong') {
    const prompts = await loadPrompts();
    const prompt = prompts[role];
    if (!prompt) throw new Error(`prompts.js 缺少角色：${role}`);
    const label = this.roleLabel(role);
    const tools = createMinistryTools(this.ctx, run, role);
    const parent = this.parents.get(run.id);
    if (!parent) throw new Error('朝议父 Agent 不存在。');
    const agentOptions = this.modelOptions(tier);

    if (run.agents[role]) {
      run.agentHistory = run.agentHistory || [];
      run.agentHistory.push(run.agents[role]);
    }
    run.agents[role] = {
      role,
      name: label,
      status: 'running',
      model: agentOptions?.model || 'default',
      sessionId: '',
      stream: '',
      text: '',
      toolCalls: [],
      error: '',
      startedAt: now(),
      finishedAt: null,
    };
    run.agentCount += 1;
    run.spawns.push({ role, at: now() });
    this.log(run, label, '奉派', `子 Agent 已派生（第 ${run.agentCount} 个）`, 'neutral');
    this.touch(run, true);

    try {
      const result = await runSubagent(this.ctx, {
        role,
        label,
        prompt,
        task,
        tools,
        agentOptions,
        cwd: run.cwd,
        parent,
        signal,
        onEvent: (roleId, event) => this.recordEvent(run, roleId, event),
        onCreated: (childId, agent) => {
          this.agentRuns.set(childId, run.id);
          if (run.agents[role]) run.agents[role].sessionId = childId;
          // approval/request 是 agent-scoped 事件，必须挂在子 Agent 的 ctx 上才会收到。
          agent.ctx.on('approval/request', (request, next) => this.handleApproval(request, next));
        },
      });
      const agent = run.agents[role];
      agent.sessionId = result.childId;
      agent.text = result.output;
      agent.result = JSON.stringify({ stopReason: result.stopReason, diagnostic: result.diagnostic || '', output: result.output }).slice(0, 2000);
      agent.status = result.stopReason === 'completed' ? 'done' : result.stopReason;
      agent.finishedAt = now();
      if (result.stopReason !== 'completed') {
        agent.status = 'failed';
        agent.error = result.diagnostic || `子 Agent 未完成：${result.stopReason}`;
        this.log(run, label, '失败', agent.error, 'bad');
        this.touch(run, true);
        throw new Error(agent.error);
      }
      this.log(run, label, '覆命', result.output.slice(0, 600) || '（无文本输出）', 'ok');
      this.touch(run, true);
      return result.output;
    } catch (error) {
      const agent = run.agents[role];
      if (agent) {
        agent.status = 'failed';
        agent.error = String(error?.message || error);
        agent.finishedAt = now();
      }
      this.log(run, label, '失败', String(error?.message || error), 'bad');
      this.touch(run, true);
      throw error;
    }
  }

  markLocalAgent(run, role, { summary = '', toolName = '', args = {}, result = undefined, status = 'done' } = {}) {
    const label = this.roleLabel(role);
    run.agents[role] = {
      role,
      name: label,
      status,
      model: 'local-js',
      sessionId: '',
      local: true,
      stream: summary,
      text: summary,
      toolCalls: toolName
        ? [{ name: toolName, args, result: String(typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 1200), finished: true }]
        : [],
      error: '',
      startedAt: now(),
      finishedAt: now(),
    };
    this.touch(run);
  }

  localMetrics(role, result) {
    if (role === 'revenue') {
      return {
        source: result.source,
        chars: result.chars,
        cjk: result.cjk,
        latin_words: result.latin_words,
        words: result.words,
        lines: result.lines,
        approx_tokens: result.approx_tokens,
      };
    }
    if (role === 'rites') {
      return {
        path: result.path,
        lines: result.lines,
        headings: (result.headings || []).length,
        truncated: Boolean(result.truncated),
      };
    }
    if (role === 'personnel') return { count: result.count };
    return {};
  }

  async runLocalRole(run, order, signal) {
    const role = order.ministry;
    const label = this.roleLabel(role);
    const tools = createMinistryTools(this.ctx, run, role);
    const tool = tools.find((item) => item.name === MINISTRY_TOOL_NAMES[role]?.[0]) || tools[0];
    if (!tool) throw new Error(`${label}没有可用的本地工具。`);
    const args = { ...(order.args || {}) };
    if (role === 'rites' && !args.path) args.path = 'README.md';
    if (role === 'revenue' && !args.text && !args.path) args.text = run.edict;
    const exec = { agent: this.parents.get(run.id), signal, callId: `local-${randomUUID()}` };
    try {
      const result = await tool.execute(args, exec);
      const summary =
        role === 'revenue'
          ? `户部本地统计：字符 ${result.chars}，近似 Token ${result.approx_tokens}，行数 ${result.lines}`
          : role === 'rites'
            ? `礼部本地读取：${result.path}，${result.lines} 行，标题 ${result.headings?.length || 0} 个`
            : role === 'personnel'
              ? `吏部本地分派：${result.count} 个角色`
              : `${label}本地执行完成。`;
      const artifacts = role === 'rites' && result.path ? [result.path] : [];
      const metrics = this.localMetrics(role, result);
      this.markLocalAgent(run, role, { summary, toolName: tool.name, args, result: metrics });
      this.log(run, label, '本地工具', `${tool.name} → ${summary}`, 'ok');
      return {
        ministry: role,
        name: MINISTRIES[role].name,
        status: 'done',
        summary,
        artifacts,
        metrics,
      };
    } catch (error) {
      const message = String(error?.message || error);
      this.markLocalAgent(run, role, { summary: message, toolName: tool.name, args, result: message, status: 'blocked' });
      this.log(run, label, '本地受阻', message, 'bad');
      return {
        ministry: role,
        name: MINISTRIES[role].name,
        status: 'blocked',
        summary: message,
        artifacts: [],
        metrics: {},
      };
    }
  }

  recordEvent(run, role, event) {
    const agent = run.agents[role];
    if (!agent || !event) return;
    if (event.type === 'assistant/attempt') {
      const stream = Array.isArray(event.data?.stream) ? event.data.stream : [];
      const text = stream
        .filter((record) => record && record.type === 'text-chunks')
        .flatMap((record) => record.texts || [])
        .join('');
      if (text) agent.stream = text.slice(-4000);
      this.touch(run);
      return;
    }
    if (event.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content);
      if (text) {
        agent.text = text;
        agent.stream = text;
      }
      this.touch(run);
      return;
    }
    if (event.type === 'tool/call') {
      let args = event.data?.arguments;
      try {
        args = typeof args === 'string' ? JSON.parse(args) : args;
      } catch {
        /* 保留原始字符串 */
      }
      agent.toolCalls.push({
        name: event.data?.name || 'unknown',
        args,
        at: now(),
        result: '',
        error: '',
      });
      this.log(run, agent.name, '调用工具', event.data?.name || 'unknown', 'neutral');
      this.touch(run);
      return;
    }
    if (event.type === 'tool/result') {
      const last = [...agent.toolCalls].reverse().find((call) => !call.finished);
      const content = textOf(event.data?.message?.content);
      if (last) {
        last.finished = true;
        last.result = content.slice(0, 1200);
        last.error = event.data?.error ? String(event.data.error.reason || event.data.error.code || '') : '';
      }
      this.log(run, agent.name, event.data?.error ? '工具失败' : '工具结果', (content || '').slice(0, 300), event.data?.error ? 'bad' : 'ok');
      this.touch(run);
      return;
    }
    if (event.type === 'turn/end') {
      agent.events = agent.events || [];
      agent.events.push({ type: event.type, reason: event.data?.reason });
      if (agent.events.length > 30) agent.events.shift();
      if (agent.status === 'running') agent.status = 'idle';
      this.touch(run);
    }
  }

  async execute(run) {
    const controller = this.controllers.get(run.id);
    const signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(new Error('朝议超时')), this.options.timeoutMs || DEFAULT_TIMEOUT_MS);
    let parentHandle;
    try {
      // 续旨优先复用上一案的父会话；若插件重启/句柄已释放，则新建父会话并通过 run.previous 保留上下文。
      const previousHandle = run.continueFrom ? this.parentHandles.get(run.continueFrom) : undefined;
      let parent;
      if (previousHandle) {
        parent = { agent: previousHandle.agent, handle: previousHandle, owned: false };
      } else {
        parent = await createRunParent(this.ctx, { cwd: run.cwd, signal });
      }
      parentHandle = parent.handle;
      if (parentHandle) this.parentHandles.set(run.id, parentHandle);
      this.parents.set(run.id, parent.agent);
      run.parentSessionId = parent.agent.id;

      if (run.mode === 'quick') {
        const answer = await this.callRole(
          run,
          'zhongshu',
          `【快速问答】\n皇帝问：${run.edict}\n\n请直接回答，不要走朝议，不要编造工具结果。`,
          signal,
          'strong',
        );
        run.summary = answer;
      } else if (run.mode === 'single') {
        const role = MINISTRY_ORDER.includes(run.ministry) ? run.ministry : 'works';
        const meta = MINISTRIES[role];
        const order = {
          ministry: role,
          name: meta.name,
          objective: run.edict,
          deliverable: `${meta.name}交付物`,
          tools: [meta.toolLabel],
          deadline: '旬日',
          args: {},
          wave: role === 'works' ? 1 : 2,
        };
        run.orders = [order];
        if (DETERMINISTIC_ROLES.has(role)) {
          const result = await this.runLocalRole(run, order, signal);
          run.results = [result];
          run.summary = result.summary;
          if (result.status === 'blocked') {
            run.status = 'failed';
            run.phase = 'failed';
            run.error = result.summary;
            run.finishedAt = now();
            this.log(run, '尚书省', '本地受阻', result.summary, 'bad');
            this.touch(run, true);
          }
        } else {
          const output = await this.callRole(run, role, this.ministryTask(run, order), signal, 'strong');
          const parsed = parseJson(output);
          run.results = [normalizeMinistryResult(role, output, parsed)];
          run.summary = run.results[0].summary;
        }
      } else {
        await this.runFullCourt(run, signal);
      }

      if (run.status === 'escalated') {
        this.touch(run, true);
      } else if (run.status === 'running') {
        run.status = 'completed';
        run.phase = 'completed';
        run.finishedAt = now();
        this.log(run, '尚书省', '汇总覆命', run.summary || '六部办结，恭呈御览。', 'ok');
        this.touch(run, true);
      }
    } catch (error) {
      if (run.status === 'cancelled') return;
      this.fail(run, error);
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(run.id);
      this.parents.delete(run.id);
      // 父会话保留为新的 DSH 对话；插件卸载时才统一释放，避免 run 结束后对话立刻消失。
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'escalated' || run.status === 'cancelled') {
        run.finishedAt = run.finishedAt || now();
        await this.store.save(run);
      }
    }
  }

  async runFullCourt(run, signal) {
    // 钦天监改为本地 JS 探测：不启动 LLM，只把能力面作为中书起草的上下文。
    run.phase = 'feasibility';
    this.touch(run, true);
    run.feasibility = probeCapabilities(this.ctx, run);
    this.markLocalAgent(run, 'qintianjian', {
      summary: `钦天监本地探测：services=${Object.entries(run.feasibility.services).filter(([, ok]) => ok).map(([name]) => name).join('、')}`,
      toolName: 'local-probe',
      result: run.feasibility,
    });
    this.log(run, '钦天监', '本地勘验', `缺口 ${run.feasibility.gaps.length} 项；不调用模型。`, run.feasibility.feasible ? 'ok' : 'bad');
    this.touch(run, true);
    if (!run.feasibility.feasible) {
      run.status = 'failed';
      run.phase = 'failed';
      run.error = `钦天监勘验不通过：${run.feasibility.gaps.join('；') || '当前能力面不足'}`;
      run.summary = run.error;
      run.finishedAt = now();
      this.log(run, '钦天监', '封还', run.error, 'bad');
      this.touch(run, true);
      return;
    }

    run.phase = 'drafting';
    this.touch(run, true);
    let draft = normalizeDraft(
      parseJson(await this.callRole(run, 'zhongshu', this.draftTask(run), signal, 'strong')),
      run.edict,
      1,
      null,
    );
    run.draft = draft;
    run.revision = 1;
    this.touch(run, true);

    for (let attempt = 1; attempt <= run.maxRejections + 1; attempt += 1) {
      const local = localReview(draft, run.edict);
      run.localReview = local;
      let review;
      if ((!local.approved && !run.strictReview) || (local.hard && local.hard.length)) {
        review = { ...local, comment: `本地规则驳回：${local.issues[0] || '草案不合格。'}` };
        this.markLocalAgent(run, 'menxia', {
          summary: review.comment,
          toolName: 'local-review',
          result: local,
          status: 'blocked',
        });
        this.log(run, '门下省', '本地驳回', review.comment, 'bad');
      } else {
        run.phase = 'reviewing';
        this.touch(run, true);
        const reviewText = await this.callRole(run, 'menxia', this.reviewTask(run, draft), signal, 'weak');
        review = { ...normalizeReview(reviewText, parseJson(reviewText)), source: 'llm' };
      }
      run.review = review;
      this.touch(run, true);
      if (review.approved) break;

      run.rejections += 1;
      if (run.rejections >= run.maxRejections) {
        run.phase = 'escalated';
        run.status = 'escalated';
        run.finishedAt = now();
        run.summary = `门下省连驳 ${run.rejections} 次，封还圣旨，直呈御前。`;
        this.log(run, '门下省', '封还', run.summary, 'bad');
        this.touch(run, true);
        return;
      }

      run.phase = 'revising';
      this.touch(run, true);
      const revisedText = await this.callRole(run, 'zhongshu', this.draftTask(run, draft, review), signal, 'strong');
      draft = normalizeDraft(parseJson(revisedText), run.edict, attempt + 1, draft);
      run.draft = draft;
      run.revision = attempt + 1;
      this.touch(run, true);
    }

    if (!run.review || !run.review.approved) throw new Error('门下省未准奏，朝议停止。');
    if (draft.orders.length === 0) throw new Error('中书省未派任何部门，朝议停止。');

    run.phase = 'dispatching';
    run.dispatch = this.buildDispatch(draft);
    this.markLocalAgent(run, 'shangshu', {
      summary: run.dispatch.note,
      toolName: 'local-dispatch',
      result: run.dispatch,
    });
    this.log(run, '尚书省', '本地派发', run.dispatch.note, 'ok');
    this.touch(run, true);

    run.phase = 'executing';
    this.touch(run, true);
    const executeOrder = async (order) => {
      if (DETERMINISTIC_ROLES.has(order.ministry)) return this.runLocalRole(run, order, signal);
      const output = await this.callRole(run, order.ministry, this.ministryTask(run, order), signal, 'strong');
      return normalizeMinistryResult(order.ministry, output, parseJson(output));
    };
    const toResult = (order, item) =>
      item && item.status === 'fulfilled'
        ? item.value
        : {
            ministry: order.ministry,
            name: MINISTRIES[order.ministry].name,
            status: 'failed',
            summary: String(item?.reason?.message || item?.reason || '未执行'),
            artifacts: [],
            metrics: {},
          };

    const wave1 = draft.orders.filter((order) => order.wave === 1);
    const wave2 = draft.orders.filter((order) => order.wave !== 1);
    if (wave1.length) {
      run.wave = 1;
      this.touch(run, true);
      this.log(run, '尚书省', '第一波', `按需派发 ${wave1.map((order) => order.name).join('、')}。`, 'ok');
      const settled = await Promise.allSettled(wave1.map(executeOrder));
      const results = wave1.map((order, index) => toResult(order, settled[index]));
      run.results = results;
      const error = results.find((result) => result.status !== 'done');
      if (error) {
        run.status = 'failed';
        run.phase = 'failed';
        run.error = `熔断：第一波 ${error.name} 未完成（${error.status}）：${error.summary}`;
        run.summary = run.error;
        run.finishedAt = now();
        this.log(run, '尚书省', '熔断', run.error + '；不再派第二波，直接呈报皇帝。', 'bad');
        this.touch(run, true);
        return;
      }
    }

    run.wave = 2;
    this.touch(run, true);
    if (wave2.length) this.log(run, '尚书省', '第二波', `按需派发 ${wave2.map((order) => order.name).join('、')}。`, 'ok');
    const settled2 = await Promise.allSettled(wave2.map(executeOrder));
    const results2 = wave2.map((order, index) => toResult(order, settled2[index]));
    const byRole = new Map([...(run.results || []), ...results2].map((result) => [result.ministry, result]));
    run.results = MINISTRY_ORDER.map((role) => byRole.get(role)).filter(Boolean);
    const error = run.results.find((result) => result.status === 'failed');
    if (error) {
      run.status = 'failed';
      run.phase = 'failed';
      run.error = `熔断：第二波 ${error.name} 严重报错：${error.summary}`;
      run.summary = run.error;
      run.finishedAt = now();
      this.log(run, '尚书省', '熔断', run.error + '；不强行汇总，直接呈报皇帝。', 'bad');
      this.touch(run, true);
      return;
    }

    run.phase = 'aggregating';
    run.summary = this.aggregateResults(run);
    const shangshu = run.agents.shangshu;
    if (shangshu) {
      shangshu.text = run.summary;
      shangshu.stream = run.summary;
      shangshu.finishedAt = now();
    }
    this.log(run, '尚书省', '本地汇总', run.summary, 'ok');
    this.touch(run, true);
  }

  buildDispatch(draft) {
    const assignments = draft.orders.map((order) => ({
      ministry: order.ministry,
      name: order.name,
      order: order.objective,
      deliverable: order.deliverable,
      deadline: order.deadline,
      wave: order.wave,
      executor: DETERMINISTIC_ROLES.has(order.ministry) ? 'local-js' : 'llm',
    }));
    return {
      note: `按需派发 ${assignments.length} 部：${assignments.map((item) => `${item.name}(${item.executor})`).join('、')}`,
      assignments,
    };
  }

  aggregateResults(run) {
    const results = run.results || [];
    const done = results.filter((result) => result.status === 'done');
    const evidence = done.map((result) => `${result.name}：${result.summary}`).join('\n') || '无部门交付。';
    const artifacts = [...new Set(results.flatMap((result) => result.artifacts || []))];
    const manual = results
      .filter((result) => result.status !== 'done')
      .map((result) => `${result.name}：${result.summary}`)
      .join('；') || '无';
    return [
      `结论：${done.length}/${results.length} 部办结；按需派发，未派部门不占预算。`,
      `证据：\n${evidence}`,
      `需皇帝手动：${manual}`,
      `交付物：${artifacts.length ? artifacts.join('、') : '无'}`,
      `风险：${(run.draft?.risks || []).join('；') || '无新增风险'}`,
    ].join('\n');
  }


  previousContext(run) {
    const previous = run.previous;
    if (!previous) return '';
    const results = (previous.results || [])
      .map((result) => `${result.name}（${result.status}）：${result.summary || ''} 交付：${(result.artifacts || []).join('、')}`)
      .join('\n');
    return [
      '【同一任务的前情】',
      `上一道圣旨：${previous.edict}`,
      `上一案结局：${previous.summary || previous.status}`,
      `上一案六部：\n${results}`,
      '本次是续旨：只做增量，不要重复上一案已完成的交付；如需修改旧文件，请明确覆盖范围。',
    ].join('\n');
  }

  draftTask(run, previous, review) {
    const feedback =
      previous && review
        ? `\n【门下省驳议】\n${JSON.stringify({ comment: review.comment, issues: review.issues }, null, 2)}\n只重写被驳回部门的条陈，未涉及的部门不要重复输出。`
        : '';
    const existing = previous
      ? `\n【现有条陈】\n${JSON.stringify(
          previous.orders.map((order) => ({
            ministry: order.ministry,
            objective: order.objective,
            deliverable: order.deliverable,
            args: order.args,
          })),
        )}`
      : '';
    const capability = JSON.stringify({
      feasible: run.feasibility?.feasible,
      gaps: run.feasibility?.gaps || [],
      services: run.feasibility?.services || {},
      planned_tools: run.feasibility?.planned_tools || {},
    });
    return [
      '【圣旨】',
      run.edict,
      this.previousContext(run),
      '【能力勘验】',
      capability,
      existing,
      feedback,
      '【六部 id】',
      MINISTRY_ORDER.map((key) => `${key}=${MINISTRIES[key].name}`).join('，'),
      '【按需派发】只为真正需要的部门出条陈；工/兵/刑由 LLM 执行，户/礼/吏由本地 JS 工具执行；不要为凑数派部。',
      '礼部条陈必须给 args.path；户部可给 args.text 或 args.path；吏部无需 args。',
      '若当前 risks 或 acceptance 为空，必须在本次回复补齐，修订时也不能省略。',
      '【输出】只输出 JSON：{"summary":"...","orders":[{"ministry":"works","objective":"...","deliverable":"...","args":{},"deadline":"..."}],"risks":["..."],"acceptance":["..."]}',
      '修订时只输出被驳回部门的 orders；risks 与 acceptance 若未变化可省略。',
    ].join('\n');
  }

  reviewTask(run, draft) {
    return [
      '【中书省草案】',
      JSON.stringify(draft, null, 2),
      '【本地规则审核】',
      JSON.stringify(run.localReview || {}, null, 2),
      '【能力勘验】',
      JSON.stringify({ feasible: run.feasibility?.feasible, gaps: run.feasibility?.gaps || [] }),
      '【任务】审目标、分职、交付、风险、验收；只输出 JSON：{"approved":true,"comment":"...","issues":[]}。',
      '若本地规则列出的问题仍未解决，或草案要求当前能力面做不到的能力，必须驳回。',
    ].join('\n');
  }

  ministryTask(run, order) {
    const toolNames = (MINISTRY_TOOL_NAMES[order.ministry] || []).join(' / ');
    return [
      `【圣旨摘要】\n${run.edict.slice(0, 300)}`,
      `【本部条陈】\n${JSON.stringify(order, null, 2)}`,
      `【必须使用的工具】\n${toolNames}。至少调用一次真实工具，拿到结果后再覆命。`,
      '【边界】写入/命令会进入侧边栏审批；拒绝或超时即打回。',
      '【输出】只输出 JSON：{"ministry":"' + order.ministry + '","status":"done|blocked","summary":"...","artifacts":["..."],"metrics":{}}',
      '不得编造工具结果；工具失败就在 summary 中写明原因。',
    ].join('\n');
  }
}

export function renderRunReport(run) {
  const lines = [];
  lines.push('# 三省六部工作流 · dsh-tang-agent');
  lines.push('');
  lines.push(`圣旨：${run.edict}`);
  lines.push(`模式：${run.mode}；结局：${run.summary || run.status}；子 Agent：${run.agentCount} 个`);
  lines.push('');
  lines.push('## 起居注');
  for (const entry of run.history || []) {
    lines.push(`- [${String(entry.seq).padStart(2, '0')}] ${entry.actor} · ${entry.action}：${entry.detail}`);
  }
  if (run.draft) {
    lines.push('');
    lines.push(`## 中书省第 ${run.draft.revision} 稿`);
    lines.push(run.draft.summary);
    for (const order of run.draft.orders) lines.push(`- ${order.name}（${order.deadline}）：${order.deliverable}`);
  }
  if (run.feasibility) {
    lines.push('');
    lines.push('## 钦天监勘验');
    lines.push(`可行：${run.feasibility.feasible ? '是' : '否'}`);
    for (const gap of run.feasibility.gaps) lines.push(`- 缺口：${gap}`);
  }
  if (run.localReview) {
    lines.push('');
    lines.push('## 门下省本地规则');
    lines.push(`通过：${run.localReview.approved ? '是' : '否'}（${run.localReview.source || 'local'}）`);
    for (const issue of run.localReview.issues || []) lines.push(`- ${issue}`);
  }
  if (run.review) {
    lines.push('');
    lines.push('## 门下省朱批');
    lines.push((run.review.approved ? '【准奏】' : '【驳回】') + run.review.comment);
    for (const issue of run.review.issues) lines.push(`- 驳议：${issue}`);
  }
  lines.push('');
  lines.push('## 六部覆命');
  for (const result of run.results || []) {
    lines.push(`### ${result.name}（${result.status}）`);
    lines.push(result.summary);
    lines.push('交付：' + (result.artifacts || []).join('、'));
    const metrics = Object.keys(result.metrics || {})
      .map((key) => `${key}=${result.metrics[key]}`)
      .join('，');
    if (metrics) lines.push('度支：' + metrics);
  }
  lines.push('');
  lines.push('## 真实工具调用');
  const allAgents = [...(run.agentHistory || []), ...Object.values(run.agents || {})];
  for (const agent of allAgents) {
    if (!agent.toolCalls || agent.toolCalls.length === 0) continue;
    lines.push(`### ${agent.name}（${agent.sessionId}）`);
    for (const call of agent.toolCalls) {
      lines.push(`- ${call.name}(${JSON.stringify(call.args)}) → ${call.error || call.result || '（无结果）'}`);
    }
  }
  return lines.join('\n');
}

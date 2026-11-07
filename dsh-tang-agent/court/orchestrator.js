/**
 * dsh-tang-agent · 真实朝议编排器
 *
 * 每个角色都是真正由 `ctx.subagents.startActivation({ provider: 'spawn' })`
 * 派生的独立 Agent；六部并发，三省串行。所有 Prompt 来自 prompts.py；
 * 所有工具调用、流式文本、审批结果都进入 run 状态并推给 UI。
 */

import { randomUUID } from 'node:crypto';
import { createRunParent, runSubagent, defaultModelOptions } from './agent-runner.js';
import { loadPrompts } from './prompts.js';
import { createMinistryTools } from './tools.js';
import { MINISTRIES, MINISTRY_ORDER, ROLE_LABELS, STAGE_LABELS } from './meta.js';

const MAX_EDICT_LENGTH = 4000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

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

function normalizeDraft(raw, edict, revision, previous) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const sourceOrders = Array.isArray(payload.orders) ? payload.orders : [];
  const orders = MINISTRY_ORDER.map((key) => {
    const meta = MINISTRIES[key];
    const found = sourceOrders.find(
      (order) => order && (order.ministry === key || order.name === meta.name || order.ministry_name === meta.name),
    );
    return {
      ministry: key,
      name: meta.name,
      objective: String(found?.objective || found?.order || `${meta.duty}：${edict.slice(0, 40)}`),
      deliverable: String(found?.deliverable || `${meta.name}交付物`),
      tools: meta.toolLabel ? [meta.toolLabel] : [],
      deadline: String(found?.deadline || '旬日'),
    };
  });
  const summary = String(payload.summary || payload.plan || `中书省奉旨草拟：${edict}`).slice(0, 1200);
  return {
    revision,
    summary,
    orders,
    risks: asArray(payload.risks).length ? asArray(payload.risks) : ['风险：模型未列，按最低限度保留工期与预算风险。'],
    acceptance: asArray(payload.acceptance).length ? asArray(payload.acceptance) : ['验收：六部交付物齐备并经尚书省核验。'],
    notes: previous ? `依门下省驳议修订（第 ${previous.revision} 稿）。` : '中书省初拟。',
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

function normalizeFeasibility(text, raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  return {
    feasible: payload.feasible !== false,
    gaps: asArray(payload.gaps),
    required_tools: asArray(payload.required_tools),
    fallback: String(payload.fallback || ''),
    evidence: asArray(payload.evidence),
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
    this.runs = new Map();
    this.controllers = new Map();
    this.parents = new Map();
    this.subscribers = new Map();
    this.saveTimers = new Map();
    this.ready = store.init();
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

  async start(edict, opts = {}) {    await this.ready;
    const text = String(edict || '').trim();
    if (!text) throw new Error('圣旨不可为空。');
    if (text.length > MAX_EDICT_LENGTH) throw new Error(`圣旨过长：上限 ${MAX_EDICT_LENGTH} 字。`);

    const mode = ['full', 'single', 'quick'].includes(opts.mode) ? opts.mode : 'full';
    const maxRejections = Math.max(1, Math.min(Number(opts.maxRejections) || 3, 5));
    const run = {
      id: `tang-${randomUUID()}`,
      edict: text,
      mode,
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
      spawns: [],
      history: [],
      createdAt: Date.now(),
      updatedAt: now(),
      finishedAt: null,
      error: '',
      rev: 0,
    };
    this.runs.set(run.id, run);
    this.controllers.set(run.id, new AbortController());
    this.log(run, '皇帝', '下旨', text, 'neutral');
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

  async callRole(run, role, task, signal) {
    const prompts = await loadPrompts();
    const prompt = prompts[role];
    if (!prompt) throw new Error(`prompts.py 缺少角色：${role}`);
    const label = this.roleLabel(role);
    const tools = createMinistryTools(this.ctx, run, role);
    const parent = this.parents.get(run.id);
    if (!parent) throw new Error('朝议父 Agent 不存在。');

    if (run.agents[role]) {
      run.agentHistory = run.agentHistory || [];
      run.agentHistory.push(run.agents[role]);
    }
    run.agents[role] = {
      role,
      name: label,
      status: 'running',
      model: defaultModelOptions(this.ctx)?.model || 'default',
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
        cwd: run.cwd,
        parent,
        signal,
        onEvent: (roleId, event) => this.recordEvent(run, roleId, event),
      });
      const agent = run.agents[role];
      agent.sessionId = result.childId;
      agent.text = result.output;
      agent.status = result.stopReason === 'completed' ? 'done' : result.stopReason;
      agent.finishedAt = now();
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
      const parent = await createRunParent(this.ctx, { cwd: run.cwd, signal });
      parentHandle = parent.handle;
      this.parents.set(run.id, parent.agent);
      run.parentSessionId = parent.agent.id;

      if (run.mode === 'quick') {
        const answer = await this.callRole(
          run,
          'zhongshu',
          `【快速问答】\n皇帝问：${run.edict}\n\n请直接回答，不要走朝议，不要编造工具结果。`,
          signal,
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
        };
        run.orders = [order];
        const output = await this.callRole(run, role, this.ministryTask(run, order), signal);
        const parsed = parseJson(output);
        run.results = [normalizeMinistryResult(role, output, parsed)];
        run.summary = run.results[0].summary;
      } else {
        await this.runFullCourt(run, signal);
      }

      if (run.status === 'escalated') {
        this.touch(run, true);
      } else if (run.status !== 'cancelled') {
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
      if (parentHandle) {
        try {
          await parentHandle.dispose();
        } catch {
          /* ignore */
        }
      }
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'escalated' || run.status === 'cancelled') {
        run.finishedAt = run.finishedAt || now();
        await this.store.save(run);
      }
    }
  }

  async runFullCourt(run, signal) {
    const prompts = await loadPrompts();
    run.phase = 'drafting';
    let draft = normalizeDraft(
      parseJson(
        await this.callRole(
          run,
          'zhongshu',
          this.draftTask(run),
          signal,
        ),
      ),
      run.edict,
      1,
      null,
    );
    run.draft = draft;
    run.revision = 1;
    this.touch(run, true);

    for (let attempt = 1; attempt <= run.maxRejections + 1; attempt += 1) {
      run.phase = 'feasibility';
      this.touch(run, true);
      const feasibilityText = await this.callRole(run, 'qintianjian', this.feasibilityTask(run, draft), signal);
      run.feasibility = normalizeFeasibility(feasibilityText, parseJson(feasibilityText));
      this.touch(run, true);

      run.phase = 'reviewing';
      this.touch(run, true);
      const reviewText = await this.callRole(run, 'menxia', this.reviewTask(run, draft), signal);
      run.review = normalizeReview(reviewText, parseJson(reviewText));
      this.touch(run, true);

      if (run.review.approved) break;

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
      const revisedText = await this.callRole(
        run,
        'zhongshu',
        this.draftTask(run, draft, run.review),
        signal,
      );
      draft = normalizeDraft(parseJson(revisedText), run.edict, attempt + 1, draft);
      run.draft = draft;
      run.revision = attempt + 1;
      this.touch(run, true);
    }

    if (!run.review || !run.review.approved) throw new Error('门下省未准奏，朝议停止。');

    run.phase = 'dispatching';
    this.touch(run, true);
    const dispatchText = await this.callRole(run, 'shangshu', this.dispatchTask(run, draft), signal);
    run.dispatch = { text: dispatchText, plan: parseJson(dispatchText) };

    run.phase = 'executing';
    this.touch(run, true);
    const settled = await Promise.allSettled(
      MINISTRY_ORDER.map(async (role) => {
        const order = draft.orders.find((item) => item.ministry === role);
        const output = await this.callRole(run, role, this.ministryTask(run, order), signal);
        return normalizeMinistryResult(role, output, parseJson(output));
      }),
    );
    run.results = settled.map((item, index) =>
      item.status === 'fulfilled'
        ? item.value
        : {
            ministry: MINISTRY_ORDER[index],
            name: MINISTRIES[MINISTRY_ORDER[index]].name,
            status: 'failed',
            summary: String(item.reason?.message || item.reason),
            artifacts: [],
            metrics: {},
          },
    );
    this.touch(run, true);

    run.phase = 'aggregating';
    this.touch(run, true);
    const summary = await this.callRole(run, 'shangshu', this.aggregateTask(run), signal);
    run.summary = summary;
    this.touch(run, true);
  }

  draftTask(run, previous, review) {
    const feedback =
      previous && review
        ? `\n【门下省驳议】\n${JSON.stringify({ comment: review.comment, issues: review.issues }, null, 2)}\n请只修改被驳部分，输出完整新稿。`
        : '';
    return [
      '【圣旨】',
      run.edict,
      feedback,
      '【六部 id】',
      MINISTRY_ORDER.map((key) => `${key}=${MINISTRIES[key].name}`).join('，'),
      '【输出】只输出 JSON：{"summary":"...","orders":[{"ministry":"works","objective":"...","deliverable":"...","deadline":"..."}],"risks":["..."],"acceptance":["..."]}',
      '六部都要有条陈；risks 与 acceptance 至少各两条。',
    ].join('\n');
  }

  feasibilityTask(run, draft) {
    return [
      '【草案】',
      JSON.stringify(draft, null, 2),
      '【任务】调用 tang_qintian_probe 探测当前 Host 的工具与服务，然后核对草案所需能力。',
      '【重要】六部工具是 scoped 工具，只有对应部子 Agent 可见；你看到的 tools 只代表你自己的工具面。',
      '请用 probe 返回的 planned_tools 与本草案核对：planned_tools 中列出即视为该部工具已设计；再核对 services 是否可用。',
      '只输出 JSON：{"feasible":true,"gaps":[],"required_tools":[],"fallback":"","evidence":[]}',
    ].join('\n');
  }

  reviewTask(run, draft) {
    return [
      '【中书省草案】',
      JSON.stringify(draft, null, 2),
      '【钦天监勘验】',
      JSON.stringify(run.feasibility || {}, null, 2),
      '【任务】按六条审核：目标、分职、交付、风险、验收、虚实。',
      '【工具面说明】六部 tang_* 工具是 scoped 工具，只有对应部子 Agent 可见；',
      '你只看到 read 是正常的，不要因为自己看不到六部工具就驳回。请依据草案、钦天监 planned_tools 与 Host services 判断。',
      '只输出 JSON：{"approved":true,"comment":"...","issues":[]}',
      '若钦天监 feasible=false，或草案要求当前工具面做不到的能力，必须驳回。',
    ].join('\n');
  }

  dispatchTask(run, draft) {
    return [
      '【准奏草案】',
      JSON.stringify(draft, null, 2),
      '【任务】按六部条陈下发，标明依赖与并行关系。',
      '只输出 JSON：{"dispatch_note":"...","assignments":[{"ministry":"works","order":"...","deadline":"..."}]}',
    ].join('\n');
  }

  ministryTask(run, order) {
    const meta = MINISTRIES[order.ministry];
    return [
      `【圣旨】\n${run.edict}`,
      `【本部条陈】\n${JSON.stringify(order, null, 2)}`,
      `【必须使用的工具】\n${meta.name}可用工具：${meta.toolLabel}。请至少调用一次真实工具，拿到结果后再覆命。`,
      '【边界】tang-artifacts/ 是本次朝议的沙箱，可直接写入；业务路径的写入/命令会触发 DSH 审批。',
      '【输出】只输出 JSON：{"ministry":"' + order.ministry + '","status":"done|blocked","summary":"...","artifacts":["..."],"metrics":{}}',
      '不得编造工具结果；工具失败就在 summary 中写明失败原因。',
    ].join('\n');
  }

  aggregateTask(run) {
    return [
      '【六部覆命】',
      JSON.stringify(
        run.results.map((result) => ({
          ministry: result.ministry,
          name: result.name,
          status: result.status,
          summary: result.summary,
          artifacts: result.artifacts,
          metrics: result.metrics,
        })),
        null,
        2,
      ),
      '【任务】核验交付物，按“结论 / 证据 / 需皇帝手动 / 风险”四段汇总。',
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

/**
 * dsh-tang-agent · 三省六部状态机（JS 共享引擎）
 *
 * 同一份引擎有三个消费者：
 *   1. Host 工具 `tang_court`（index.js 直接 import）；
 *   2. 侧边栏 UI（scripts/build-client.mjs 去掉 export 后内联进 client.js）；
 *   3. Node 冒烟测试（scripts/smoke.mjs 直接 import）。
 *
 * 阶段、字段与 Python 参考实现 graph.py 保持一致：
 *   idle → drafting → reviewing ──准奏──→ dispatching → executing → completed
 *                          │
 *                          └─驳回（≤3）→ revising → reviewing
 *                               连驳 3 次 → escalated（封还御前）
 *
 * 本引擎不访问网络、不读取文件、不依赖大模型：它是一套确定性的
 * “宫廷沙盘”。真实 LLM 适配器只需替换 draft / review / execute 三个函数。
 */

export const STAGE_LABELS = {
  idle: '静候圣旨',
  drafting: '中书起草',
  reviewing: '门下朱批',
  revising: '封还重拟',
  dispatching: '尚书下发',
  executing: '六部奉行',
  completed: '六部覆命',
  escalated: '封还御前',
};

export const MINISTRY_ORDER = ['works', 'justice', 'war', 'rites', 'revenue', 'personnel'];

export const MINISTRIES = {
  works: {
    id: 'works',
    name: '工部',
    en: 'Works',
    duty: '营造、工程、器物、代码与交付物',
    tools: ['draw_blueprint', 'estimate_works'],
    focus: '将圣旨落为可交付之物：图样、工序、验收节点，一件不可缺。',
    deliverable: '营造图样、工序分解、可验收交付件',
  },
  justice: {
    id: 'justice',
    name: '刑部',
    en: 'Justice',
    duty: '律令、合规、风险审查与争端处置',
    tools: ['check_statutes', 'assess_risk'],
    focus: '为圣旨划定律令红线：合规审查、风险分级、处置预案。',
    deliverable: '合规意见书、风险清单、红线处置建议',
  },
  war: {
    id: 'war',
    name: '兵部',
    en: 'War',
    duty: '调度、排期、人手、应急与执行保障',
    tools: ['muster_route', 'schedule_guard'],
    focus: '把差事排成可执行的次序：关键路径、人手调度、应急后备。',
    deliverable: '调度图、里程碑、应急预案',
  },
  rites: {
    id: 'rites',
    name: '礼部',
    en: 'Rites',
    duty: '文告、仪注、对外沟通与教化',
    tools: ['draft_notice', 'arrange_rites'],
    focus: '把朝廷决定写成得体文字：告示口径、仪注、对外辞令。',
    deliverable: '告示文稿、仪注单、对外口径',
  },
  revenue: {
    id: 'revenue',
    name: '户部',
    en: 'Revenue',
    duty: '钱粮、预算、成本与账目',
    tools: ['budget_ledger', 'audit_grain'],
    focus: '核算钱粮用度：预算科目、拨付次序、缺口与节流之法。',
    deliverable: '预算表、拨付次序、节流方案',
  },
  personnel: {
    id: 'personnel',
    name: '吏部',
    en: 'Personnel',
    duty: '人事、差遣、考成与激励',
    tools: ['assign_officials', 'appraise_merit'],
    focus: '为差事配人：主事、协办、复核、考成与赏罚。',
    deliverable: '差遣表、考成法、复核名单',
  },
};

const DEADLINES = ['三日', '五日', '旬日', '半月', '不拘'];

/** 稳定哈希：同一道圣旨永远得到同一套数字，便于截图与测试复现。 */
export function hashSeed(text) {
  let hash = 5381;
  const value = String(text || '');
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

function excerpt(text, limit = 60) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length <= limit ? clean : clean.slice(0, limit) + '……';
}

function nowIso() {
  return new Date().toISOString();
}

export function stageLabel(phase) {
  return STAGE_LABELS[phase] || phase;
}

export function createState(options = {}) {
  return {
    edict: '',
    phase: 'idle',
    revision: 0,
    rejections: 0,
    maxRejections: options.maxRejections || 3,
    draft: null,
    review: null,
    results: [],
    history: [],
    escalationReason: '',
    runId: '',
    forceReject: false,
    startedAt: null,
    finishedAt: null,
  };
}

function pushHistory(state, actor, action, detail, tone) {
  const entry = {
    seq: state.history.length + 1,
    actor,
    action,
    detail,
    tone: tone || 'neutral',
    at: nowIso(),
  };
  return state.history.concat([entry]);
}

/** 皇帝下旨：重置沙盘，进入“中书起草”。 */
export function begin(edict, options = {}) {
  const text = String(edict || '').trim();
  if (!text) throw new Error('圣旨不可为空');
  const state = createState(options);
  return {
    ...state,
    edict: text,
    phase: 'drafting',
    runId: 'tang-' + hashSeed(text).toString(16),
    forceReject: Boolean(options.forceReject),
    startedAt: nowIso(),
    history: pushHistory(state, '皇帝', '下旨', text, 'neutral'),
  };
}

/** 中书省草拟 / 修订。第一稿刻意缺风险与验收，用来演示门下封驳。 */
export function makeDraft(edict, revision, previous) {
  const seed = hashSeed(edict);
  const revised = revision >= 2;
  const orders = MINISTRY_ORDER.map((key, index) => {
    const meta = MINISTRIES[key];
    return {
      ministry: key,
      name: meta.name,
      objective: `${meta.focus} 圣旨要点：${excerpt(edict, 48)}`,
      deliverable: meta.deliverable,
      tools: meta.tools.slice(),
      deadline: DEADLINES[(seed + index) % DEADLINES.length],
    };
  });

  const summary = `奉天承运皇帝诏曰：${excerpt(edict, 80)}。臣中书省谨拟六部条陈：工部营造、刑部法度、兵部调度、礼部文告、户部钱粮、吏部考成，各专其职，并行而不相害。${
    revised ? '风险与验收已备，恭请圣裁。' : ''
  }`;

  const draft = {
    revision,
    summary,
    orders,
    risks: revised
      ? [
          '工期风险：关键路径若遇料具不齐，工期顺延；工部预设三日缓冲。',
          '钱粮风险：预算若超支一成，户部即启节流与分期拨付。',
          '协同风险：六部并行若令出多门，尚书省按里程碑统一督办。',
        ]
      : [],
    acceptance: revised
      ? [
          '六部交付物齐备，且经门下省抽验关键节点。',
          '预算、工期、风险三项与草案一致，偏差须书面说明。',
          '圣旨目标可逐条对应到条陈，无遗漏、无越权。',
        ]
      : [],
    notes: revised
      ? `依门下省驳议修订：补风险预案与验收标准，余条不变。${
          previous ? `（据第 ${previous.revision} 稿）` : ''
        }`
      : '初拟，恭候门下省朱批。',
  };
  return draft;
}

/** 门下省六条审核；forceReject 用于“连驳演练”。 */
export function reviewDraft(draft, forceReject = false) {
  const issues = [];
  if (!draft || draft.orders.length !== MINISTRY_ORDER.length) {
    issues.push('分职不备：应有六部条陈，今仅 ' + (draft ? draft.orders.length : 0) + ' 部。');
  }
  if (!draft || !draft.risks || draft.risks.length === 0) {
    issues.push('未列风险预案：须写明触发条件与应对之策。');
  }
  if (!draft || !draft.acceptance || draft.acceptance.length === 0) {
    issues.push('未列验收标准：交付物无从检验。');
  }
  if (draft) {
    for (const order of draft.orders) {
      if (!order.deliverable || !order.deliverable.trim()) {
        issues.push(`${order.name}条陈无交付物。`);
      }
    }
    if (!draft.summary || draft.summary.trim().length < 10) {
      issues.push('草案主旨含混，不足以服众。');
    }
  }
  if (forceReject) {
    issues.push('门下省加驳：此本与圣旨本意仍有出入，着即重拟。');
  }
  const approved = issues.length === 0;
  return {
    approved,
    comment: approved
      ? '准奏。六部条陈齐备，风险有备，验收有据，可付尚书省施行。'
      : `驳回。${issues[0]} 其余各条，着中书省一并修订。`,
    issues,
    revision: draft ? draft.revision : 0,
  };
}

function ministryMetrics(key, seed) {
  switch (key) {
    case 'works':
      return [
        { artifact: '《工部营造图样》', metrics: { 工序: `${4 + (seed % 5)} 道` } },
        {
          artifact: `工期与料具估算表（${5 + (seed % 20)} 日）`,
          metrics: { 工期: `${5 + (seed % 20)} 日`, 料具: '按图支给' },
        },
      ];
    case 'justice':
      return [
        { artifact: '《律令合规意见书》', metrics: { 红线: `${2 + (seed % 3)} 条` } },
        { artifact: '风险清单与处置建议', metrics: { 风险项: `${3 + (seed % 4)} 项` } },
      ];
    case 'war':
      return [
        { artifact: '并行调度图与关键路径', metrics: { 役夫: `${12 + (seed % 30)} 人` } },
        { artifact: '里程碑表与应急预案', metrics: { 缓冲: `${1 + (seed % 3)} 日` } },
      ];
    case 'rites':
      return [
        { artifact: '《告示》与对外口径', metrics: { 仪注: `${3 + (seed % 3)} 条` } },
        { artifact: '仪注单与称谓表', metrics: { 口径: '已统一' } },
      ];
    case 'revenue':
      return [
        { artifact: '预算表与拨付次序', metrics: { 预算: `${80 + (seed % 120)} 贯` } },
        { artifact: '账目复核节点', metrics: { 缺口: `${seed % 20} 贯` } },
      ];
    default:
      return [
        { artifact: '差遣表（主事/协办/复核）', metrics: { 差遣: `${3 + (seed % 4)} 员` } },
        { artifact: '考成法与赏罚尺度', metrics: { 考成: '三档九等' } },
      ];
  }
}

/** 六部执行：每部只调自己的工具，产出结构化覆命。 */
export function executeOrder(order, edict) {
  const meta = MINISTRIES[order.ministry];
  const seed = hashSeed(String(edict) + order.ministry);
  const artifacts = [];
  const metrics = {};
  for (const tool of ministryMetrics(order.ministry, seed)) {
    artifacts.push(tool.artifact);
    Object.assign(metrics, tool.metrics);
  }
  return {
    ministry: order.ministry,
    name: meta.name,
    status: 'done',
    summary: `${meta.name}奉旨办差：${order.deliverable}已成，限期${order.deadline}，恭候验收。`,
    artifacts,
    metrics,
  };
}

/** 单步推进：返回新的 state；终态返回原对象，React 因此不会空转。 */
export function step(state) {
  switch (state.phase) {
    case 'drafting': {
      const draft = makeDraft(state.edict, state.revision + 1, state.draft);
      const next = {
        ...state,
        revision: draft.revision,
        draft,
        phase: 'reviewing',
        history: pushHistory(
          state,
          '中书省',
          draft.revision === 1 ? '草拟' : '修订',
          `第 ${draft.revision} 稿：${draft.summary}`,
          'neutral',
        ),
      };
      return next;
    }
    case 'reviewing': {
      const review = reviewDraft(state.draft, state.forceReject);
      if (review.approved) {
        return {
          ...state,
          review,
          phase: 'dispatching',
          history: pushHistory(state, '门下省', '准奏', review.comment, 'ok'),
        };
      }
      const rejections = state.rejections + 1;
      let history = pushHistory(
        state,
        '门下省',
        '驳回',
        review.comment + '　驳议：' + review.issues.join('；'),
        'warn',
      );
      if (rejections >= state.maxRejections) {
        const reason = `门下省连驳 ${rejections} 次，依制封还圣旨，直呈御前，着皇帝圣裁后再行。`;
        history = history.concat([
          {
            seq: history.length + 1,
            actor: '门下省',
            action: '封还',
            detail: reason,
            tone: 'bad',
            at: nowIso(),
          },
        ]);
        return {
          ...state,
          review,
          rejections,
          phase: 'escalated',
          escalationReason: reason,
          history,
          finishedAt: nowIso(),
        };
      }
      history = history.concat([
        {
          seq: history.length + 1,
          actor: '门下省',
          action: '封还重拟',
          detail: `第 ${rejections} 次驳回，限中书省修订后复奏。`,
          tone: 'warn',
          at: nowIso(),
        },
      ]);
      return { ...state, review, rejections, phase: 'revising', history };
    }
    case 'revising': {
      const draft = makeDraft(state.edict, state.revision + 1, state.draft);
      return {
        ...state,
        revision: draft.revision,
        draft,
        phase: 'reviewing',
        history: pushHistory(
          state,
          '中书省',
          '修订',
          `第 ${draft.revision} 稿：${draft.notes}`,
          'neutral',
        ),
      };
    }
    case 'dispatching': {
      return {
        ...state,
        phase: 'executing',
        history: pushHistory(
          state,
          '尚书省',
          '接旨',
          '奉门下省放行文书，六部条陈即日下发：' + state.draft.orders.map((o) => o.name).join('、'),
          'ok',
        ),
      };
    }
    case 'executing': {
      if (state.results.length >= state.draft.orders.length) {
        return {
          ...state,
          phase: 'completed',
          finishedAt: nowIso(),
          history: pushHistory(
            state,
            '尚书省',
            '汇总覆命',
            `六部办结，交付物共 ${state.results.reduce((n, r) => n + r.artifacts.length, 0)} 件，恭呈御览。`,
            'ok',
          ),
        };
      }
      const order = state.draft.orders[state.results.length];
      const result = executeOrder(order, state.edict);
      const results = state.results.concat([result]);
      const history = pushHistory(
        state,
        order.name,
        '覆命',
        `${result.summary}　交付：${result.artifacts.join('、')}`,
        'ok',
      );
      if (results.length >= state.draft.orders.length) {
        return {
          ...state,
          results,
          phase: 'completed',
          finishedAt: nowIso(),
          history: history.concat([
            {
              seq: history.length + 1,
              actor: '尚书省',
              action: '汇总覆命',
              detail: `六部办结，交付物共 ${results.reduce((n, r) => n + r.artifacts.length, 0)} 件，恭呈御览。`,
              tone: 'ok',
              at: nowIso(),
            },
          ]),
        };
      }
      return { ...state, results, history };
    }
    default:
      return state;
  }
}

/** 门下省手动朱批（亲批模式）。 */
export function submitReview(state, approved, comment) {
  if (state.phase !== 'reviewing') return state;
  const base = reviewDraft(state.draft, false);
  if (approved) {
    const review = {
      ...base,
      approved: true,
      issues: [],
      comment: comment && comment.trim() ? comment.trim() : '准奏。着尚书省即日施行。',
    };
    return {
      ...state,
      review,
      phase: 'dispatching',
      history: pushHistory(state, '门下省', '准奏', review.comment, 'ok'),
    };
  }
  const rejections = state.rejections + 1;
  const issues =
    comment && comment.trim()
      ? [comment.trim()]
      : base.issues.length
        ? base.issues
        : ['着中书省酌改后再奏。'];
  const review = {
    ...base,
    approved: false,
    issues,
    comment: `驳回。${issues[0]}`,
  };
  let history = pushHistory(
    state,
    '门下省',
    '驳回',
    review.comment + '　驳议：' + issues.join('；'),
    'warn',
  );
  if (rejections >= state.maxRejections) {
    const reason = `门下省连驳 ${rejections} 次，依制封还圣旨，直呈御前，着皇帝圣裁后再行。`;
    history = history.concat([
      {
        seq: history.length + 1,
        actor: '门下省',
        action: '封还',
        detail: reason,
        tone: 'bad',
        at: nowIso(),
      },
    ]);
    return {
      ...state,
      review,
      rejections,
      phase: 'escalated',
      escalationReason: reason,
      history,
      finishedAt: nowIso(),
    };
  }
  history = history.concat([
    {
      seq: history.length + 1,
      actor: '门下省',
      action: '封还重拟',
      detail: `第 ${rejections} 次驳回，限中书省修订后复奏。`,
      tone: 'warn',
      at: nowIso(),
    },
  ]);
  return { ...state, review, rejections, phase: 'revising', history };
}

/** 全自动跑完一道圣旨（Host 工具与测试使用）。 */
export function runAll(edict, options = {}) {
  let state = begin(edict, options);
  for (let guard = 0; guard < 200; guard += 1) {
    if (state.phase === 'completed' || state.phase === 'escalated') break;
    state = step(state);
  }
  return state;
}

export function summary(state) {
  if (state.phase === 'escalated') {
    return `门下省连驳 ${state.rejections} 次，封还圣旨，直呈御前。`;
  }
  if (state.phase === 'completed') {
    return `六部覆命：${state.results.length} 部办结，圣旨已毕。`;
  }
  if (state.phase === 'idle') return '静候圣旨。';
  return `圣旨流转中：${stageLabel(state.phase)}（第 ${Math.max(state.revision, 1)} 稿）。`;
}

/** 渲染给模型看的纯文本轨迹（Host 工具返回值）。 */
export function renderReport(state) {
  const lines = [];
  lines.push('# 三省六部工作流 · dsh-tang-agent');
  lines.push('');
  lines.push('圣旨：' + state.edict);
  lines.push('结局：' + summary(state));
  lines.push('');
  lines.push('## 起居注');
  for (const entry of state.history) {
    lines.push(`- [${String(entry.seq).padStart(2, '0')}] ${entry.actor} · ${entry.action}：${entry.detail}`);
  }
  if (state.draft) {
    lines.push('');
    lines.push(`## 中书省第 ${state.draft.revision} 稿`);
    lines.push(state.draft.summary);
    for (const order of state.draft.orders) {
      lines.push(`- ${order.name}（${order.deadline}）：${order.deliverable}`);
    }
  }
  if (state.review) {
    lines.push('');
    lines.push('## 门下省朱批');
    lines.push((state.review.approved ? '【准奏】' : '【驳回】') + state.review.comment);
    if (state.review.issues.length) {
      for (const issue of state.review.issues) lines.push('- 驳议：' + issue);
    }
  }
  if (state.results.length) {
    lines.push('');
    lines.push('## 六部覆命');
    for (const result of state.results) {
      lines.push(`### ${result.name}`);
      lines.push(result.summary);
      lines.push('交付：' + result.artifacts.join('、'));
      const metrics = Object.keys(result.metrics)
        .map((key) => `${key}=${result.metrics[key]}`)
        .join('，');
      if (metrics) lines.push('度支：' + metrics);
    }
  }
  return lines.join('\n');
}

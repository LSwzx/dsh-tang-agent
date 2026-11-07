/**
 * dsh-tang-agent · 真实多智能体面板
 *
 * 侧边栏只做展示与操作：下旨、取消、看阶段、看每个子 Agent 的模型 / 会话 /
 * 流式文本 / 工具调用 / 审批结果。所有编排都在 Host 的
 * CourtOrchestrator 中完成，浏览器不跑任何状态机。
 */

const h = React.createElement;
let tangCtx = null;

const TEXT = {
  zh: {
    title: '三省六部工作流',
    subtitle: 'dsh-tang-agent · 真实多智能体',
    real: '真实子 Agent',
    edict: '皇帝 · 下旨',
    placeholder: '写下要办的事；六部会真实派生独立 Agent，并调用文件、终端、扫描、统计等真实工具。',
    start: '传旨',
    cancel: '中止',
    reset: '清空',
    mode: '模式',
    full: '完整朝议',
    single: '单部直调',
    quick: '快速问答',
    ministry: '直调部门',
    rejectLimit: '连驳上限',
    stage: '当前',
    agentCount: '子 Agent',
    idleTitle: '丹墀静候，圣旨未下',
    idleBody: '下旨后会真实派生中书、钦天监、门下、尚书与六部 Agent；每个子 Agent 有独立模型会话、独立工具面和真实事件流。',
    drafting: '中书起草',
    feasibility: '钦天监勘验',
    review: '门下朱批',
    dispatch: '尚书下发',
    executing: '六部奉行',
    aggregate: '尚书汇总',
    agents: '子 Agent 实况',
    agentEmpty: '尚未派生',
    model: '模型',
    session: '会话',
    stream: '流式输出',
    tools: '真实工具调用',
    noTools: '未调用工具',
    draft: '中书省草案',
    risks: '风险预案',
    acceptance: '验收标准',
    feasibilityTitle: '钦天监勘验',
    feasible: '可行',
    infeasible: '不可行',
    gaps: '缺口',
    evidence: '证据',
    reviewTitle: '门下省朱批',
    approve: '准奏',
    reject: '驳回',
    issues: '驳议',
    results: '六部覆命',
    noResults: '尚未覆命',
    audit: '起居注',
    noAudit: '尚无记事。',
    completed: '六部覆命，圣旨已毕',
    escalated: '连驳达到上限，封还御前',
    cancelled: '圣旨已中止',
    failed: '朝议失败',
    running: '运行中',
    queued: '候派',
    done: '已覆命',
    blocked: '受阻',
    error: '错误',
    copy: '复制起居注',
    copied: '已复制',
    realBadge: 'REAL',
    openRun: '恢复上次朝议',
    approvalTitle: '审批请求',
    approvalHint: 'DSH approval 请求：允许或拒绝本次真实写操作/命令。',
    allow: '允许',
    deny: '拒绝',
    idle: '待命',
    awaiting: '候旨',
  },
  en: {
    title: 'Three Departments Workflow',
    subtitle: 'dsh-tang-agent · real sub-agents',
    real: 'Real sub-agents',
    edict: 'Emperor · Edict',
    placeholder: 'Describe the task; six ministries spawn real agents and call real file / shell / scan / count tools.',
    start: 'Issue edict',
    cancel: 'Cancel',
    reset: 'Clear',
    mode: 'Mode',
    full: 'Full court',
    single: 'Single ministry',
    quick: 'Quick answer',
    ministry: 'Ministry',
    rejectLimit: 'Rejection limit',
    stage: 'Stage',
    agentCount: 'Agents',
    idleTitle: 'The throne awaits an edict',
    idleBody: 'Issuing an edict spawns Zhongshu, the Observatory, Menxia, Shangshu and six ministry agents, each with its own model session and real tools.',
    drafting: 'Drafting',
    feasibility: 'Feasibility',
    review: 'Review',
    dispatch: 'Dispatch',
    executing: 'Executing',
    aggregate: 'Aggregate',
    agents: 'Agent activity',
    agentEmpty: 'No agents yet',
    model: 'Model',
    session: 'Session',
    stream: 'Stream',
    tools: 'Real tool calls',
    noTools: 'No tool calls',
    draft: 'Zhongshu draft',
    risks: 'Risks',
    acceptance: 'Acceptance',
    feasibilityTitle: 'Observatory check',
    feasible: 'Feasible',
    infeasible: 'Infeasible',
    gaps: 'Gaps',
    evidence: 'Evidence',
    reviewTitle: 'Menxia verdict',
    approve: 'Approved',
    reject: 'Rejected',
    issues: 'Issues',
    results: 'Ministry reports',
    noResults: 'No reports yet',
    audit: 'Audit trail',
    noAudit: 'No entries yet.',
    completed: 'All six ministries reported',
    escalated: 'Rejection limit reached — returned to the throne',
    cancelled: 'Run cancelled',
    failed: 'Court failed',
    running: 'Running',
    queued: 'Queued',
    done: 'Done',
    blocked: 'Blocked',
    error: 'Error',
    copy: 'Copy audit trail',
    copied: 'Copied',
    realBadge: 'REAL',
    openRun: 'Resume last run',
    approvalTitle: 'Approval request',
    approvalHint: 'DSH approval request: allow or deny this real write/command.',
    allow: 'Allow',
    deny: 'Deny',
    idle: 'Idle',
    awaiting: 'Awaiting',
  },
};

const STORAGE_KEY = 'dsh-tang-agent:last-run';

function useLang() {
  const locale = tangCtx && tangCtx.get ? tangCtx.get('locale') : undefined;
  const [, force] = React.useState(0);
  React.useEffect(() => {
    if (!locale || typeof locale.subscribe !== 'function') return undefined;
    const off = locale.subscribe(() => force((n) => n + 1));
    return () => {
      if (typeof off === 'function') off();
    };
  }, [locale]);
  let active = 'zh';
  try {
    if (locale && typeof locale.getLocale === 'function') active = (locale.getLocale() || {}).active || 'zh';
  } catch {
    active = 'zh';
  }
  return String(active).toLowerCase().slice(0, 2) === 'zh' ? 'zh' : 'en';
}

function useRun() {
  const [runId, setRunId] = React.useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [run, setRun] = React.useState(null);
  const [error, setError] = React.useState('');
  const timer = React.useRef(null);

  React.useEffect(() => {
    if (!runId) return undefined;
    let stopped = false;
    let source;
    let pollTimer;

    const poll = () => {
      if (stopped) return;
      fetch(`/api/tang/runs/${encodeURIComponent(runId)}`)
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
        .then((payload) => {
          setRun(payload);
          if (payload.status !== 'running') stopped = true;
        })
        .catch((reason) => setError(String(reason.message || reason)))
        .finally(() => {
          if (!stopped) pollTimer = setTimeout(poll, 1_200);
        });
    };

    try {
      source = new EventSource(`/api/tang/runs/${encodeURIComponent(runId)}/stream`);
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setRun(payload);
          setError('');
          if (payload.status !== 'running' && source) source.close();
        } catch {
          /* ignore malformed frame */
        }
      };
      source.onerror = () => {
        if (source) source.close();
        poll();
      };
    } catch {
      poll();
    }

    return () => {
      stopped = true;
      if (source) source.close();
      if (pollTimer) clearTimeout(pollTimer);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [runId]);

  // 工具/其他会话启动的朝议也可能有 pending 审批；面板自动附着到该 run，避免审批不可见。
  React.useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const list = await fetch('/api/tang/runs').then((response) => (response.ok ? response.json() : []));
        for (const item of list) {
          if (item.status !== 'running' || item.id === runId) continue;
          const detail = await fetch(`/api/tang/runs/${encodeURIComponent(item.id)}`).then((response) =>
            response.ok ? response.json() : null,
          );
          if (detail && (detail.approvals || []).some((approval) => approval.status === 'pending')) {
            if (!stopped) setRunId(item.id);
            return;
          }
        }
      } catch {
        /* 面板自动附着失败不影响当前 run */
      }
    };
    const interval = setInterval(check, 5_000);
    check();
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [runId]);

  const remember = (id) => {
    setRunId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const start = async (body) => {
    setError('');
    try {
      const response = await fetch('/api/tang/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tang-ui': '1' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      remember(payload.runId);
      setRun(null);
    } catch (reason) {
      setError(String(reason.message || reason));
    }
  };

  const cancel = async () => {
    if (!runId) return;
    try {
      await fetch(`/api/tang/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
        headers: { 'x-tang-ui': '1' },
      });
    } catch (reason) {
      setError(String(reason.message || reason));
    }
  };

  const decideApproval = async (id, decision) => {
    try {
      await fetch(`/api/tang/approvals/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tang-ui': '1' },
        body: JSON.stringify({ decision }),
      });
    } catch (reason) {
      setError(String(reason.message || reason));
    }
  };

  const clear = () => {
    setRunId('');
    setRun(null);
    setError('');
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  return { runId, run, error, start, cancel, clear, decideApproval, resume: () => setRunId((id) => id) };
}

const STAGE_INDEX = {
  idle: -1,
  drafting: 1,
  revising: 1,
  feasibility: 2,
  reviewing: 3,
  dispatching: 4,
  executing: 5,
  aggregating: 5,
  completed: 6,
  escalated: 3,
  single: 5,
  quick: 1,
  cancelled: -1,
  failed: -1,
};

const ROLE_ORDER = ['zhongshu', 'qintianjian', 'menxia', 'shangshu', 'works', 'justice', 'war', 'rites', 'revenue', 'personnel'];

function Rail({ phase, t }) {
  const labels = [t.stage === 'Stage' ? 'Emperor' : '皇帝', '中书省', '钦天监', '门下省', '尚书省', '六部'];
  const index = STAGE_INDEX[phase] ?? -1;
  return h(
    'div',
    { className: 'tda-rail', role: 'list', 'aria-label': 'court stages' },
    labels.map((label, step) => {
      let status = 'pending';
      if (phase === 'escalated' && step === 3) status = 'error';
      else if (phase === 'failed' && step === 5) status = 'error';
      else if (index > step) status = 'done';
      else if (index === step) status = 'active';
      return h(
        'div',
        { key: label, className: 'tda-rail-node is-' + status, role: 'listitem' },
        h('span', { className: 'tda-rail-dot' }, String(step + 1)),
        h('span', { className: 'tda-rail-label' }, label),
      );
    }),
  );
}

function Head({ title, en, right }) {
  return h(
    'div',
    { className: 'tda-card-head' },
    h('span', { className: 'tda-eyebrow' }, title, h('small', null, en || '')),
    right || null,
  );
}

function AgentGrid({ run, t }) {
  const agents = run?.agents || {};
  const ordered = ROLE_ORDER.map(
    (role) =>
      agents[role] || {
        role,
        name: CourtMeta.ROLE_LABELS[role] || role,
        status: 'idle',
        model: '—',
        sessionId: '',
        stream: '',
        text: '',
        toolCalls: [],
      },
  );
  const icon = (status) =>
    status === 'running' ? '◐' : status === 'done' ? '✓' : status === 'blocked' ? '!' : status === 'failed' ? '×' : '○';
  return h(
    'section',
    { className: 'tda-card' },
    h(Head, {
      title: t.agents,
      en: `${Object.keys(agents).length} / ${ROLE_ORDER.length}`,
      right: h('span', { className: 'tda-badge tda-badge-real' }, t.realBadge),
    }),
    h(
      'div',
      { className: 'tda-agentgrid' },
      ordered.map((agent) =>
        h(
          'article',
          { key: agent.role, className: 'tda-agent is-' + (agent.status || 'idle') },
          h(
            'div',
            { className: 'tda-agent-head' },
            h('span', { className: 'tda-status-icon is-' + (agent.status || 'idle'), 'aria-label': agent.status }, icon(agent.status)),
            h('span', { className: 'tda-glyph' }, (CourtMeta.MINISTRIES[agent.role] || CourtMeta.EXTRA_ROLES[agent.role] || {}).glyph || '臣'),
            h(
              'div',
              { style: { minWidth: 0 } },
              h('div', { className: 'tda-ministry-name' }, agent.name),
              h('div', { className: 'tda-agent-meta' }, `${t.model}: ${agent.model || '—'}`),
            ),
            h('span', { className: 'tda-badge' }, agent.status === 'idle' ? t.idle : agent.status || 'queued'),
          ),
          agent.sessionId
            ? h('div', { className: 'tda-agent-meta' }, `${t.session}: ${agent.sessionId.slice(0, 8)}`)
            : null,
          h(
            'div',
            { className: 'tda-agent-stream' },
            (agent.stream || agent.text || '').slice(-1200) || (agent.status === 'idle' ? t.awaiting : t.stream + '…'),
          ),
              agent.error ? h('div', { className: 'tda-agent-error' }, agent.error) : null,
              h(
                'div',
                { className: 'tda-tools' },
                (agent.toolCalls || []).length === 0
                  ? h('span', { className: 'tda-pending' }, t.noTools)
                  : (agent.toolCalls || []).map((call, index) =>
                      h(
                        'div',
                        { className: 'tda-tool', key: call.name + index },
                        h('div', { className: 'tda-tool-name' }, '⚙ ' + call.name),
                        h('div', { className: 'tda-tool-args' }, JSON.stringify(call.args)),
                        h(
                          'div',
                          { className: 'tda-tool-result' + (call.error ? ' is-error' : '') },
                          call.error || call.result || '…',
                        ),
                      ),
                    ),
              ),
            ),
          ),
        ),
  );
}

function DraftCard({ draft, t }) {
  if (!draft) return null;
  return h(
    'section',
    { className: 'tda-card' },
    h(Head, { title: t.draft, en: 'Draft ' + draft.revision, right: h('span', { className: 'tda-counter' }, `${draft.orders.length} 部`) }),
    h('p', { className: 'tda-summary' }, draft.summary),
    h(
      'div',
      { className: 'tda-orders' },
      draft.orders.map((order) =>
        h(
          'div',
          { className: 'tda-order', key: order.ministry },
          h('span', { className: 'tda-order-name' }, order.name),
          h('span', { className: 'tda-order-obj', title: order.objective }, order.objective),
          h('span', { className: 'tda-order-deadline' }, order.deadline),
        ),
      ),
    ),
    draft.risks?.length
      ? h('div', null, h('div', { className: 'tda-note' }, t.risks), h('ul', { className: 'tda-list' }, draft.risks.map((item, i) => h('li', { key: i }, item))))
      : null,
    draft.acceptance?.length
      ? h('div', null, h('div', { className: 'tda-note' }, t.acceptance), h('ul', { className: 'tda-list' }, draft.acceptance.map((item, i) => h('li', { key: i }, item))))
      : null,
  );
}

function FeasibilityCard({ feasibility, t }) {
  if (!feasibility) return null;
  return h(
    'section',
    { className: 'tda-card' + (feasibility.feasible ? ' is-ok' : ' is-bad') },
    h(Head, {
      title: t.feasibilityTitle,
      en: 'Observatory',
      right: h('span', { className: 'tda-badge' }, feasibility.feasible ? t.feasible : t.infeasible),
    }),
    feasibility.gaps?.length
      ? h('div', null, h('div', { className: 'tda-note' }, t.gaps), h('ul', { className: 'tda-list' }, feasibility.gaps.map((gap, i) => h('li', { key: i }, gap))))
      : null,
    feasibility.evidence?.length
      ? h('div', null, h('div', { className: 'tda-note' }, t.evidence), h('ul', { className: 'tda-list' }, feasibility.evidence.map((item, i) => h('li', { key: i }, item))))
      : null,
  );
}

function ReviewCard({ review, t }) {
  if (!review) return null;
  const rejected = !review.approved;
  return h(
    'section',
    { className: 'tda-card ' + (rejected ? 'is-bad' : 'is-ok') },
    h(Head, { title: t.reviewTitle, en: 'Menxia' }),
    h(
      'div',
      { className: 'tda-review-wrap' },
      h('div', { className: 'tda-stamp' + (rejected ? ' is-bad' : '') }, rejected ? '驳' : '准'),
      h(
        'div',
        null,
        h('p', { className: 'tda-summary' }, review.comment),
        review.issues?.length
          ? h('div', null, h('div', { className: 'tda-note' }, t.issues), h('ul', { className: 'tda-list' }, review.issues.map((issue, i) => h('li', { key: i }, issue))))
          : null,
      ),
    ),
  );
}

function Results({ run, t }) {
  const results = run?.results || [];
  return h(
    'section',
    { className: 'tda-card' },
    h(Head, { title: t.results, en: `${results.length} / 6` }),
    results.length === 0
      ? h('p', { className: 'tda-pending' }, t.noResults)
      : h(
          'div',
          { className: 'tda-ministries' },
          results.map((result) =>
            h(
              'article',
              { className: 'tda-ministry' + (result.status === 'done' ? ' is-done' : ''), key: result.ministry },
              h(
                'div',
                { className: 'tda-ministry-head' },
                h('span', { className: 'tda-glyph' }, (CourtMeta.MINISTRIES[result.ministry] || {}).glyph || '部'),
                h('div', null, h('div', { className: 'tda-ministry-name' }, result.name), h('div', { className: 'tda-ministry-en' }, result.status)),
              ),
              h('p', { className: 'tda-ministry-duty' }, result.summary),
              h('ul', { className: 'tda-list' }, (result.artifacts || []).map((item, i) => h('li', { key: i }, item))),
              h(
                'div',
                { className: 'tda-kpis' },
                Object.keys(result.metrics || {}).map((key) =>
                  h('span', { className: 'tda-kpi', key }, key, ' ', h('b', null, result.metrics[key])),
                ),
              ),
            ),
          ),
        ),
  );
}

function Audit({ history, t }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [history?.length]);
  return h(
    'aside',
    { className: 'tda-audit' },
    h(
      'div',
      { className: 'tda-audit-head' },
      h('span', { className: 'tda-eyebrow' }, t.audit, h('small', null, 'Audit')),
      h('span', { className: 'tda-counter' }, String(history?.length || 0)),
    ),
    !history?.length
      ? h('p', { className: 'tda-muted tda-small', style: { padding: '12px 14px' } }, t.noAudit)
      : h(
          'ul',
          { className: 'tda-audit-list', ref },
          history.map((entry) =>
            h(
              'li',
              { key: entry.seq, className: 'tda-audit-item is-' + (entry.tone || 'neutral') },
              h(
                'div',
                { className: 'tda-audit-meta' },
                h('span', { className: 'tda-audit-actor' }, entry.actor),
                h('span', null, entry.action),
                h('span', null, entry.at ? new Date(entry.at).toLocaleTimeString([], { hour12: false }) : ''),
              ),
              h('p', { className: 'tda-audit-detail' }, entry.detail),
            ),
          ),
        ),
  );
}

function Banner({ run, t }) {
  if (!run) return null;
  if (run.status === 'failed') {
    return h('div', { className: 'tda-banner is-bad' }, h('span', { className: 'tda-banner-seal' }, '!'), h('div', null, h('h3', null, t.failed), h('p', null, run.error || '')));
  }
  if (run.status === 'cancelled') {
    return h('div', { className: 'tda-banner is-bad' }, h('span', { className: 'tda-banner-seal' }, '止'), h('div', null, h('h3', null, t.cancelled), h('p', null, run.summary || '')));
  }
  if (run.status === 'escalated') {
    return h('div', { className: 'tda-banner is-bad' }, h('span', { className: 'tda-banner-seal' }, '驳'), h('div', null, h('h3', null, t.escalated), h('p', null, run.summary || '')));
  }
  if (run.status === 'completed') {
    return h('div', { className: 'tda-banner is-ok' }, h('span', { className: 'tda-banner-seal' }, '准'), h('div', null, h('h3', null, t.completed), h('p', null, run.summary || '')));
  }
  return null;
}

function ApprovalCard({ run, t, decide }) {
  const pending = (run?.approvals || []).filter((item) => item.status === 'pending');
  if (pending.length === 0) return null;
  return h(
    'div',
    { className: 'tda-approval', role: 'alertdialog', 'aria-label': t.approvalTitle },
    pending.map((item) =>
      h(
        'div',
        { className: 'tda-approval-row', key: item.id },
        h(
          'div',
          { style: { minWidth: 0, flex: '1 1 220px' } },
          h('h3', null, t.approvalTitle + ' · ' + item.toolName),
          h('p', null, item.reason || t.approvalHint),
          h('div', { className: 'tda-agent-meta' }, t.approvalHint),
        ),
        h(
          'div',
          { className: 'tda-approval-actions' },
          h('button', { type: 'button', className: 'tda-btn tda-btn-primary', onClick: () => decide(item.id, 'allow') }, t.allow),
          h('button', { type: 'button', className: 'tda-btn tda-btn-danger', onClick: () => decide(item.id, 'deny') }, t.deny),
        ),
      ),
    ),
  );
}

function TangPanel() {
  const lang = useLang();
  const t = TEXT[lang];
  const { runId, run, error, start, cancel, clear, decideApproval } = useRun();
  const [text, setText] = React.useState(() => {
    try {
      return window.localStorage.getItem('dsh-tang-agent:edict') || '';
    } catch {
      return '';
    }
  });
  const [mode, setMode] = React.useState('full');
  const [ministry, setMinistry] = React.useState('works');
  const [maxRejections, setMaxRejections] = React.useState(3);
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef(null);
  const busy = run?.status === 'running';

  const issue = () => {
    const value = text.trim();
    if (!value) return;
    try {
      window.localStorage.setItem('dsh-tang-agent:edict', value);
    } catch {
      /* ignore */
    }
    start({ edict: value, mode, ministry, maxRejections });
  };

  const copy = () => {
    const value = run ? JSON.stringify(run, null, 2) : '';
    const done = () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      setCopied(true);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    };
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(done, done);
      else done();
    } catch {
      done();
    }
  };

  const stats = run
    ? [
        `${t.agentCount} ${run.agentCount || 0}`,
        `${run.rejections || 0}/${run.maxRejections || 3}`,
        run.mode,
      ]
    : [];

  return h(
    'div',
    { className: 'tda-root' },
    h(
      'div',
      { className: 'tda-shell' },
      h(
        'header',
        { className: 'tda-header' },
        h(
          'div',
          { className: 'tda-brand' },
          h(TangSeal, { size: 46 }),
          h('div', null, h('h1', null, t.title), h('p', null, t.subtitle)),
        ),
        h(
          'div',
          { className: 'tda-head-actions' },
          h('span', { className: 'tda-badge tda-badge-real' }, t.realBadge),
          run
            ? h(
                'span',
                { className: 'tda-stage-pill' },
                h('span', { className: 'tda-dot ' + (busy ? 'is-live' : run.status === 'completed' ? 'is-ok' : 'is-bad') }),
                h('span', null, t.stage + ' · ' + (CourtMeta.STAGE_LABELS[run.phase] || run.phase)),
              )
            : null,
          h('button', { type: 'button', className: 'tda-btn tda-btn-ghost', onClick: copy }, copied ? t.copied : t.copy),
        ),
      ),

      h(
        'section',
        { className: 'tda-edict' },
        h(Head, {
          title: t.edict,
          en: 'Emperor',
          right: run ? h('span', { className: 'tda-counter' }, stats.join(' · ')) : null,
        }),
        h('textarea', {
          className: 'tda-textarea',
          value: text,
          placeholder: t.placeholder,
          onChange: (event) => setText(event.target.value),
          onKeyDown: (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') issue();
          },
          'aria-label': t.edict,
        }),
        h(
          'div',
          { className: 'tda-controls' },
          h('button', { type: 'button', className: 'tda-btn tda-btn-primary', onClick: issue, disabled: busy }, t.start),
          busy ? h('button', { type: 'button', className: 'tda-btn tda-btn-danger', onClick: cancel }, t.cancel) : null,
          h('button', { type: 'button', className: 'tda-btn', onClick: clear }, t.reset),
          h('select', { className: 'tda-select', value: mode, onChange: (event) => setMode(event.target.value), 'aria-label': t.mode },
            h('option', { value: 'full' }, t.full),
            h('option', { value: 'single' }, t.single),
            h('option', { value: 'quick' }, t.quick),
          ),
          mode === 'single'
            ? h('select', { className: 'tda-select', value: ministry, onChange: (event) => setMinistry(event.target.value), 'aria-label': t.ministry },
                CourtMeta.MINISTRY_ORDER.map((key) => h('option', { key, value: key }, CourtMeta.MINISTRIES[key].name)),
              )
            : null,
          h('select', { className: 'tda-select', value: maxRejections, onChange: (event) => setMaxRejections(Number(event.target.value)), 'aria-label': t.rejectLimit },
            h('option', { value: 2 }, '2'),
            h('option', { value: 3 }, '3'),
          ),
        ),
      ),

      error ? h('div', { className: 'tda-banner is-bad', style: { marginBottom: 16 } }, h('span', { className: 'tda-banner-seal' }, '!'), h('div', null, h('h3', null, t.error), h('p', null, error))) : null,
      h(Rail, { phase: run?.phase || 'idle', t }),
      h(Banner, { run, t }),
      h(ApprovalCard, { run, t, decide: decideApproval }),

      h(
        'div',
        { className: 'tda-columns' },
        h(
          'div',
          { className: 'tda-main' },
          !run
            ? h('div', { className: 'tda-card' }, h('div', { className: 'tda-empty' }, h(TangSeal, { size: 60, mono: true }), h('h2', null, t.idleTitle), h('p', null, t.idleBody)))
            : null,
          h(AgentGrid, { run, t }),
          h(DraftCard, { draft: run?.draft, t }),
          h(FeasibilityCard, { feasibility: run?.feasibility, t }),
          h(ReviewCard, { review: run?.review, t }),
          h(Results, { run, t }),
        ),
        h(Audit, { history: run?.history || [], t }),
      ),
    ),
  );
}

function TangSidebarIcon(props) {
  const size = Math.max(16, (props && props.size ? props.size : 22) - 2);
  const active = Boolean(props && props.active);
  return h(
    'div',
    { className: 'tda-sidebar-icon' + (active ? ' is-active' : ''), title: '三省六部工作流 · dsh-tang-agent' },
    h(
      'span',
      {
        className: 'tda-sidebar-seal',
        style: { width: size, height: size, fontSize: Math.round(size * 0.62) },
        'aria-hidden': 'true',
      },
      '唐',
    ),
  );
}

function apply(ctx) {
  tangCtx = ctx;
  let disposeStyles = null;
  const styleService =
    typeof styles !== 'undefined'
      ? styles
      : typeof globalThis !== 'undefined'
        ? globalThis.styles
        : undefined;
  if (styleService && typeof styleService.insert === 'function') {
    disposeStyles = styleService.insert(TANG_CSS);
  } else if (typeof document !== 'undefined') {
    const element = document.createElement('style');
    element.setAttribute('data-plugin', 'dsh-tang-agent');
    element.textContent = TANG_CSS;
    document.head.appendChild(element);
    disposeStyles = () => {
      if (element.parentNode) element.parentNode.removeChild(element);
    };
  }
  if (disposeStyles && ctx.effect) ctx.effect(() => disposeStyles, 'dsh-tang-agent: styles');

  if (!ctx.slots) return;
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: 'tang', order: 30, label: () => '三省六部工作流' },
      TangSidebarIcon,
    ),
  );
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'tang' }, TangPanel));
}

const inject = ['slots'];

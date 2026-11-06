/**
 * dsh-tang-agent · 侧边栏面板（React，无 JSX）
 *
 * 注册两处：
 *   - sidebar.panellist / id=tang  → 左侧栏“唐”字印章入口
 *   - main / key=tang              → 中央“圣旨流转”面板
 *
 * 数据全部来自 engine.js（与 Python graph.py 同构），组件只负责呈现与
 * 推进；不使用任何 Harness Client 包，样式全部走 --dsw-alias-* 令牌。
 */

const h = React.createElement;
let tangCtx = null;

const TDA_TEXT = {
  zh: {
    title: '三省六部工作流',
    subtitle: 'dsh-tang-agent · 圣旨流转',
    railLabel: '三省六部流转阶段',
    edictTitle: '皇帝 · 下旨',
    emperorEn: 'Emperor',
    placeholder: '朕命……写下要办的事；若有期限、钱粮、禁忌，一并写入。',
    send: '传旨',
    demo: '连驳演练',
    auto: '自动',
    step: '单步',
    manual: '亲批',
    pace: '节奏',
    slow: '慢',
    normal: '标准',
    fast: '快',
    reset: '重置',
    copy: '复制起居注',
    copied: '已复制',
    stage: '当前',
    idleTitle: '丹墀静候，圣旨未下',
    idleBody: '写下圣旨，三省六部即行运转：中书起草、门下朱批、尚书下发、六部覆命。',
    presetLabel: '样例圣旨',
    presets: [
      '着工部于三月内修缮东市水渠，户部拨钱粮，刑部核验工料，吏部考成，礼部告示百姓。',
      '着兵部整饬北境烽燧，工部修缮关城，户部核拨军资，刑部严查克扣，礼部抚慰边民，吏部考成将官。',
      '着礼部筹办今岁科考，吏部铨选考官，刑部严防舞弊，工部修缮贡院，户部拨付考资，兵部维持秩序。',
    ],
    draftTitle: '中书省 · 草案',
    draftEn: 'Planner',
    draftEmpty: '中书省尚未落笔。',
    revision: '第 {n} 稿',
    risks: '风险预案',
    acceptance: '验收标准',
    reviewTitle: '门下省 · 朱批',
    reviewEn: 'Reviewer',
    reviewWait: '奏本已呈，恭候朱批。',
    approve: '准奏',
    reject: '驳回',
    rejectPlaceholder: '驳回缘由（留空则由门下省自列驳议）',
    rejections: '连驳 {n}/{max}',
    escalation: '连驳三次，封还御前',
    escalationBody: '门下省依制封还圣旨，不再下发六部。请皇帝改旨，或再下明谕。',
    dispatchTitle: '尚书省 · 下发',
    dispatchEn: 'Orchestrator',
    dispatchBody: '奉门下省放行文书，六部并行办理。',
    dispatchWait: '候门下省放行。',
    sixTitle: '六部 · 覆命',
    sixEn: 'Six Ministries',
    pending: '候令',
    done: '已覆命',
    audit: '起居注',
    auditEn: 'Audit',
    auditEmpty: '尚无记事。',
    completed: '六部覆命，圣旨已毕',
    completedBody: '交付物已汇总，恭呈御览。',
    deliver: '交付',
    deadline: '限期',
    metrics: '度支',
    rail: ['皇帝', '中书省', '门下省', '尚书省', '六部'],
    stages: {
      idle: '静候',
      drafting: '起草',
      reviewing: '朱批',
      revising: '修订',
      dispatching: '下发',
      executing: '奉行',
      completed: '覆命',
      escalated: '封还',
    },
  },
  en: {
    title: 'Three Departments Workflow',
    subtitle: 'dsh-tang-agent · Edict flow',
    railLabel: 'Court workflow stages',
    edictTitle: 'Emperor · Edict',
    emperorEn: 'Emperor',
    placeholder: 'Write the edict: what must be done, by when, with what means, and what is forbidden.',
    send: 'Issue edict',
    demo: 'Rejection drill',
    auto: 'Auto',
    step: 'Step',
    manual: 'Hand-review',
    pace: 'Pace',
    slow: 'Slow',
    normal: 'Normal',
    fast: 'Fast',
    reset: 'Reset',
    copy: 'Copy audit trail',
    copied: 'Copied',
    stage: 'Stage',
    idleTitle: 'The throne awaits an edict',
    idleBody: 'Issue an edict and the court moves: Zhongshu drafts, Menxia reviews, Shangshu dispatches, the Six Ministries report.',
    presetLabel: 'Sample edicts',
    presets: [
      'Repair the East Market canal within three months: Works builds, Revenue funds, Justice audits materials, Personnel appraises, Rites informs the people.',
      'Fortify the northern beacon line: War musters, Works repairs the pass, Revenue allocates, Justice probes graft, Rites comforts the frontier, Personnel evaluates officers.',
      'Hold this year’s imperial examination: Rites organizes, Personnel selects examiners, Justice prevents fraud, Works repairs the hall, Revenue funds, War keeps order.',
    ],
    draftTitle: 'Zhongshu · Draft',
    draftEn: 'Planner',
    draftEmpty: 'Zhongshu has not drafted yet.',
    revision: 'Draft {n}',
    risks: 'Risk register',
    acceptance: 'Acceptance criteria',
    reviewTitle: 'Menxia · Review',
    reviewEn: 'Reviewer',
    reviewWait: 'The draft is submitted, awaiting the vermilion verdict.',
    approve: 'Approve',
    reject: 'Reject',
    rejectPlaceholder: 'Reason for rejection (leave blank to let Menxia list its own findings)',
    rejections: 'Rejections {n}/{max}',
    escalation: 'Three rejections: returned to the throne',
    escalationBody: 'Menxia has sealed the edict and halted dispatch. The Emperor must revise it or issue a new decree.',
    dispatchTitle: 'Shangshu · Dispatch',
    dispatchEn: 'Orchestrator',
    dispatchBody: 'With Menxia’s approval, all six ministries proceed in parallel.',
    dispatchWait: 'Awaiting Menxia’s approval.',
    sixTitle: 'Six Ministries · Reports',
    sixEn: 'Execution',
    pending: 'Awaiting orders',
    done: 'Reported',
    audit: 'Audit trail',
    auditEn: 'Chronicle',
    auditEmpty: 'No entries yet.',
    completed: 'All six ministries reported — the edict is complete',
    completedBody: 'Deliverables are consolidated for the throne.',
    deliver: 'Deliverables',
    deadline: 'Deadline',
    metrics: 'Metrics',
    rail: ['Emperor', 'Zhongshu', 'Menxia', 'Shangshu', 'Six Ministries'],
    stages: {
      idle: 'Idle',
      drafting: 'Drafting',
      reviewing: 'Review',
      revising: 'Revising',
      dispatching: 'Dispatch',
      executing: 'Executing',
      completed: 'Complete',
      escalated: 'Escalated',
    },
  },
};

const TDA_STORAGE_KEY = 'dsh-tang-agent:last-edict';
const TDA_SAMPLE_EDICT = TDA_TEXT.zh.presets[0];

function tdaLoadEdict() {
  try {
    return window.localStorage.getItem(TDA_STORAGE_KEY) || '';
  } catch (error) {
    return '';
  }
}

function tdaStoreEdict(value) {
  try {
    window.localStorage.setItem(TDA_STORAGE_KEY, value);
  } catch (error) {
    /* 隐私模式或存储配额不足时静默降级 */
  }
}

function tdaCopyFallback(value, done) {
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
    done();
  } catch (error) {
    /* 复制失败不阻断主流程 */
  }
}

function tdaUseLang() {
  const locale =
    tangCtx && typeof tangCtx.get === 'function' ? tangCtx.get('locale') : undefined;
  const [, forceRender] = React.useState(0);
  React.useEffect(() => {
    if (!locale || typeof locale.subscribe !== 'function') return undefined;
    const off = locale.subscribe(() => forceRender((n) => n + 1));
    return () => {
      if (typeof off === 'function') off();
    };
  }, [locale]);
  let active = 'zh';
  try {
    if (locale && typeof locale.getLocale === 'function') {
      active = (locale.getLocale() || {}).active || 'zh';
    }
  } catch (error) {
    active = 'zh';
  }
  return String(active).toLowerCase().slice(0, 2) === 'zh' ? 'zh' : 'en';
}

function tdaClock(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch (error) {
    return String(iso || '').slice(11, 19);
  }
}

function tdaFormat(template, values) {
  let output = String(template);
  Object.keys(values || {}).forEach((key) => {
    output = output.split('{' + key + '}').join(String(values[key]));
  });
  return output;
}

function StageRail(props) {
  const phase = props.phase;
  const t = props.t;
  const indexes = {
    idle: -1,
    drafting: 1,
    revising: 1,
    reviewing: 2,
    dispatching: 3,
    executing: 4,
    completed: 5,
    escalated: 2,
  };
  const index = typeof indexes[phase] === 'number' ? indexes[phase] : -1;
  return h(
    'div',
    { className: 'tda-rail', role: 'list', 'aria-label': t.railLabel },
    t.rail.map((label, step) => {
      let status = 'pending';
      if (phase === 'escalated' && step === 2) status = 'error';
      else if (index > step) status = 'done';
      else if (index === step) status = 'active';
      return h(
        'div',
        {
          key: label,
          className: 'tda-rail-node is-' + status,
          role: 'listitem',
          'aria-current': status === 'active' ? 'step' : undefined,
        },
        h('span', { className: 'tda-rail-dot' }, String(step + 1)),
        h('span', { className: 'tda-rail-label' }, label),
      );
    }),
  );
}

function SectionHead(props) {
  return h(
    'div',
    { className: 'tda-card-head' },
    h(
      'span',
      { className: 'tda-eyebrow' },
      props.title,
      h('small', null, props.en || ''),
    ),
    props.right || null,
  );
}

function DraftCard(props) {
  const draft = props.draft;
  const t = props.t;
  return h(
    'section',
    { className: 'tda-card', 'aria-label': t.draftTitle },
    h(SectionHead, {
      title: t.draftTitle,
      en: t.draftEn,
      right: h('span', { className: 'tda-counter' }, tdaFormat(t.revision, { n: draft.revision })),
    }),
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
    draft.risks.length
      ? h(
          'div',
          null,
          h('div', { className: 'tda-note' }, t.risks),
          h(
            'ul',
            { className: 'tda-list' },
            draft.risks.map((risk, i) => h('li', { key: 'risk-' + i }, risk)),
          ),
        )
      : null,
    draft.acceptance.length
      ? h(
          'div',
          null,
          h('div', { className: 'tda-note' }, t.acceptance),
          h(
            'ul',
            { className: 'tda-list' },
            draft.acceptance.map((item, i) => h('li', { key: 'acc-' + i }, item)),
          ),
        )
      : null,
  );
}

function ReviewCard(props) {
  const t = props.t;
  const state = props.state;
  const review = state.review;
  const pendingManual = props.manual && state.phase === 'reviewing';
  if (!review && !pendingManual) return null;

  const rejected = Boolean(review && !review.approved);
  const stampText = review ? (review.approved ? '准' : '驳') : '待';
  const comment = review
    ? review.comment
    : t.reviewWait;
  const issues = review && review.issues ? review.issues : [];

  return h(
    'section',
    {
      className:
        'tda-card ' + (review ? (rejected ? 'is-bad' : 'is-ok') : ''),
      'aria-label': t.reviewTitle,
    },
    h(SectionHead, {
      title: t.reviewTitle,
      en: t.reviewEn,
      right: h(
        'span',
        { className: 'tda-counter' },
        tdaFormat(t.rejections, { n: state.rejections, max: state.maxRejections }),
      ),
    }),
    h(
      'div',
      { className: 'tda-review-wrap' },
      h(
        'div',
        {
          className:
            'tda-stamp' + (review && !review.approved ? ' is-bad' : ''),
          'aria-hidden': 'true',
        },
        stampText,
      ),
      h(
        'div',
        null,
        h('p', { className: 'tda-summary' }, comment),
        issues.length
          ? h(
              'ul',
              { className: 'tda-list' },
              issues.map((issue, i) => h('li', { key: 'issue-' + i }, issue)),
            )
          : null,
        pendingManual
          ? h(
              'div',
              { className: 'tda-review-actions' },
              h('input', {
                className: 'tda-input',
                type: 'text',
                value: props.note,
                placeholder: t.rejectPlaceholder,
                onChange: (event) => props.onNote(event.target.value),
                'aria-label': t.rejectPlaceholder,
              }),
              h(
                'div',
                { className: 'tda-review-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tda-btn tda-btn-seal',
                    onClick: props.onApprove,
                  },
                  t.approve,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tda-btn tda-btn-danger',
                    onClick: props.onReject,
                  },
                  t.reject,
                ),
              ),
            )
          : null,
      ),
    ),
  );
}

function DispatchCard(props) {
  const t = props.t;
  const state = props.state;
  return h(
    'section',
    { className: 'tda-card is-flat', 'aria-label': t.dispatchTitle },
    h(SectionHead, {
      title: t.dispatchTitle,
      en: t.dispatchEn,
      right: h(
        'span',
        { className: 'tda-counter' },
        state.draft ? state.draft.orders.length + ' / 6' : '',
      ),
    }),
    h('p', { className: 'tda-summary' }, t.dispatchBody),
    h(
      'div',
      { className: 'tda-kpis', style: { marginTop: '10px' } },
      (state.draft ? state.draft.orders : []).map((order) =>
        h(
          'span',
          { className: 'tda-kpi', key: 'dispatch-' + order.ministry },
          h('b', null, order.name),
          ' · ',
          order.deadline,
        ),
      ),
    ),
  );
}

function MinistryGrid(props) {
  const t = props.t;
  const state = props.state;
  const orders = state.draft ? state.draft.orders : [];
  return h(
    'section',
    { 'aria-label': t.sixTitle },
    h(SectionHead, {
      title: t.sixTitle,
      en: t.sixEn,
      right: h('span', { className: 'tda-counter' }, state.results.length + ' / 6'),
    }),
    h(
      'div',
      { className: 'tda-ministries' },
      TangEngine.MINISTRY_ORDER.map((key) => {
        const meta = TangEngine.MINISTRIES[key];
        const order = orders.find((item) => item.ministry === key);
        const result = state.results.find((item) => item.ministry === key);
        const next = orders[state.results.length];
        const isActive =
          state.phase === 'executing' && !result && next && next.ministry === key;
        return h(
          'article',
          {
            key,
            className:
              'tda-ministry' + (result ? ' is-done' : '') + (isActive ? ' is-active' : ''),
          },
          h(
            'div',
            { className: 'tda-ministry-head' },
            h(MinistryGlyph, { id: key }),
            h(
              'div',
              null,
              h('div', { className: 'tda-ministry-name' }, meta.name),
              h('div', { className: 'tda-ministry-en' }, meta.en),
            ),
          ),
          h('p', { className: 'tda-ministry-duty' }, meta.duty),
          h(
            'div',
            { className: 'tda-ministry-body' },
            result
              ? h('div', null, result.summary)
              : h(
                  'div',
                  { className: 'tda-pending' },
                  order ? order.objective : t.pending,
                ),
          ),
          result
            ? h(
                'div',
                { className: 'tda-kpis' },
                Object.keys(result.metrics).map((metric) =>
                  h(
                    'span',
                    { className: 'tda-kpi', key: metric },
                    metric,
                    ' ',
                    h('b', null, result.metrics[metric]),
                  ),
                ),
              )
            : null,
          result
            ? h(
                'ul',
                { className: 'tda-list' },
                result.artifacts.map((artifact, i) =>
                  h('li', { key: 'artifact-' + i }, artifact),
                ),
              )
            : null,
        );
      }),
    ),
  );
}

function AuditRail(props) {
  const t = props.t;
  const history = props.history;
  const listRef = React.useRef(null);
  React.useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [history.length]);
  return h(
    'aside',
    { className: 'tda-audit', 'aria-label': t.audit },
    h(
      'div',
      { className: 'tda-audit-head' },
      h(
        'span',
        { className: 'tda-eyebrow' },
        t.audit,
        h('small', null, t.auditEn),
      ),
      h('span', { className: 'tda-counter' }, String(history.length)),
    ),
    history.length === 0
      ? h(
          'p',
          { className: 'tda-audit-empty tda-muted tda-small', style: { padding: '12px 14px' } },
          t.auditEmpty,
        )
      : h(
          'ul',
          { className: 'tda-audit-list', ref: listRef },
          history.map((entry) =>
            h(
              'li',
              {
                key: entry.seq,
                className:
                  'tda-audit-item' +
                  (entry.tone === 'ok'
                    ? ' is-ok'
                    : entry.tone === 'warn'
                      ? ' is-warn'
                      : entry.tone === 'bad'
                        ? ' is-bad'
                        : ''),
              },
              h(
                'div',
                { className: 'tda-audit-meta' },
                h('span', { className: 'tda-audit-actor' }, entry.actor),
                h('span', { className: 'tda-audit-action' }, entry.action),
                h('span', null, tdaClock(entry.at)),
              ),
              h('p', { className: 'tda-audit-detail' }, entry.detail),
            ),
          ),
        ),
  );
}

function Banner(props) {
  return h(
    'div',
    { className: 'tda-banner is-' + props.tone, role: 'status' },
    h('span', { className: 'tda-banner-seal' }, props.seal),
    h('div', null, h('h3', null, props.title), h('p', null, props.body)),
  );
}

function TangPanel(props) {
  const lang = tdaUseLang();
  const t = TDA_TEXT[lang];
  const [text, setText] = React.useState(tdaLoadEdict);
  const [state, setState] = React.useState(() =>
    props && props.initialState ? props.initialState : TangEngine.createState(),
  );
  const [auto, setAuto] = React.useState(true);
  const [manual, setManual] = React.useState(false);
  const [speed, setSpeed] = React.useState(620);
  const [note, setNote] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const copiedTimer = React.useRef(null);

  React.useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const busy =
    state.phase === 'drafting' ||
    state.phase === 'reviewing' ||
    state.phase === 'revising' ||
    state.phase === 'dispatching' ||
    state.phase === 'executing';

  React.useEffect(() => {
    if (state.phase === 'idle' || state.phase === 'completed' || state.phase === 'escalated') {
      return undefined;
    }
    if (!auto) return undefined;
    if (manual && state.phase === 'reviewing') return undefined;
    const timer = setTimeout(() => {
      setState((previous) => TangEngine.step(previous));
    }, speed);
    return () => clearTimeout(timer);
  }, [state, auto, manual, speed]);

  const issue = (forceReject) => {
    const value = String(text || '').trim() || TDA_SAMPLE_EDICT;
    setText(value);
    tdaStoreEdict(value);
    setNote('');
    setManual(forceReject ? false : manual);
    setAuto(true);
    setState(
      TangEngine.begin(value, {
        maxRejections: 3,
        forceReject: Boolean(forceReject),
      }),
    );
  };

  const reset = () => {
    setState(TangEngine.createState());
    setNote('');
  };

  const approve = () => {
    setState((previous) => TangEngine.submitReview(previous, true, t.approve));
  };

  const reject = () => {
    setState((previous) => TangEngine.submitReview(previous, false, note));
    setNote('');
  };

  const copyTrace = () => {
    const value = TangEngine.renderReport(state);
    const done = () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      setCopied(true);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(value).then(done, () => tdaCopyFallback(value, done));
      } else {
        tdaCopyFallback(value, done);
      }
    } catch (error) {
      tdaCopyFallback(value, done);
    }
  };

  const dotClass = busy
    ? 'is-live'
    : state.phase === 'completed'
      ? 'is-ok'
      : state.phase === 'escalated'
        ? 'is-bad'
        : '';
  const stageName = t.stages[state.phase] || state.phase;

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
          h(
            'div',
            null,
            h('h1', null, t.title),
            h('p', null, t.subtitle),
          ),
        ),
        h(
          'div',
          { className: 'tda-head-actions' },
          h(
            'span',
            { className: 'tda-stage-pill' },
            h('span', { className: 'tda-dot ' + dotClass }),
            h('span', null, t.stage + ' · ' + stageName),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'tda-btn tda-btn-ghost',
              onClick: copyTrace,
            },
            copied ? t.copied : t.copy,
          ),
        ),
      ),

      h(
        'section',
        { className: 'tda-edict' },
        h(SectionHead, {
          title: t.edictTitle,
          en: t.emperorEn,
          right: state.revision
            ? h(
                'span',
                { className: 'tda-counter' },
                tdaFormat(t.revision, { n: state.revision }) +
                  ' · ' +
                  tdaFormat(t.rejections, { n: state.rejections, max: state.maxRejections }),
              )
            : null,
        }),
        h('textarea', {
          className: 'tda-textarea',
          value: text,
          placeholder: t.placeholder,
          onChange: (event) => setText(event.target.value),
          onKeyDown: (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') issue(false);
          },
          'aria-label': t.edictTitle,
        }),
        h(
          'div',
          { className: 'tda-controls' },
          h(
            'button',
            {
              type: 'button',
              className: 'tda-btn tda-btn-primary',
              onClick: () => issue(false),
            },
            t.send,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'tda-btn',
              onClick: () => issue(true),
              title: t.escalation,
            },
            t.demo,
          ),
          h(
            'div',
            { className: 'tda-seg', role: 'group', 'aria-label': t.auto + ' / ' + t.step },
            h(
              'button',
              {
                type: 'button',
                className: 'tda-btn' + (auto ? ' is-on' : ''),
                'aria-pressed': auto,
                onClick: () => setAuto(true),
              },
              t.auto,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'tda-btn' + (!auto ? ' is-on' : ''),
                'aria-pressed': !auto,
                onClick: () => setAuto(false),
              },
              t.step,
            ),
          ),
          !auto
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'tda-btn',
                  disabled: manual && state.phase === 'reviewing',
                  onClick: () => setState((previous) => TangEngine.step(previous)),
                },
                '› ' + t.step,
              )
            : null,
          h(
            'label',
            { className: 'tda-check' },
            h('input', {
              type: 'checkbox',
              checked: manual,
              onChange: (event) => setManual(event.target.checked),
            }),
            t.manual,
          ),
          h(
            'select',
            {
              className: 'tda-select',
              value: speed,
              onChange: (event) => setSpeed(Number(event.target.value)),
              'aria-label': t.pace,
            },
            h('option', { value: 900 }, t.slow),
            h('option', { value: 620 }, t.normal),
            h('option', { value: 380 }, t.fast),
          ),
          h(
            'button',
            { type: 'button', className: 'tda-btn', onClick: reset },
            t.reset,
          ),
        ),
        h(
          'div',
          { className: 'tda-presets' },
          h('span', { className: 'tda-counter' }, t.presetLabel),
          t.presets.map((preset, i) =>
            h(
              'button',
              {
                key: 'preset-' + i,
                type: 'button',
                className: 'tda-chip',
                onClick: () => {
                  setText(preset);
                  tdaStoreEdict(preset);
                },
              },
              preset.slice(0, 14) + (preset.length > 14 ? '…' : ''),
            ),
          ),
        ),
      ),

      h(StageRail, { phase: state.phase, t }),

      state.phase === 'escalated'
        ? h(Banner, {
            tone: 'bad',
            seal: '驳',
            title: t.escalation,
            body: state.escalationReason || t.escalationBody,
          })
        : null,
      state.phase === 'completed'
        ? h(Banner, {
            tone: 'ok',
            seal: '准',
            title: t.completed,
            body: t.completedBody,
          })
        : null,

      h(
        'div',
        { className: 'tda-columns' },
        h(
          'div',
          { className: 'tda-main' },
          state.phase === 'idle'
            ? h(
                'div',
                { className: 'tda-card' },
                h(
                  'div',
                  { className: 'tda-empty' },
                  h(TangSeal, { size: 60, mono: true }),
                  h('h2', null, t.idleTitle),
                  h('p', null, t.idleBody),
                ),
              )
            : null,
          state.draft
            ? h(DraftCard, { draft: state.draft, t })
            : null,
          h(ReviewCard, {
            state,
            t,
            manual,
            note,
            onNote: setNote,
            onApprove: approve,
            onReject: reject,
          }),
          state.phase === 'dispatching' ||
          state.phase === 'executing' ||
          state.phase === 'completed'
            ? h(DispatchCard, { state, t })
            : null,
          h(MinistryGrid, { state, t }),
        ),
        h(AuditRail, { history: state.history, t }),
      ),
    ),
  );
}

function TangSidebarIcon(props) {
  const size = Math.max(16, (props && props.size ? props.size : 22) - 2);
  const active = Boolean(props && props.active);
  return h(
    'div',
    {
      className: 'tda-sidebar-icon' + (active ? ' is-active' : ''),
      title: '三省六部工作流 · dsh-tang-agent',
    },
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
  // 动态 Cordis runner 会注入 `styles` 全局；以独立 bundle 安装时没有该全局，
  // 因此保留 <style> 回退并确保两种路径都返回可清理的 disposer。
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
  if (disposeStyles && ctx.effect) {
    ctx.effect(() => disposeStyles, 'dsh-tang-agent: styles');
  }

  if (!ctx.slots) return;
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: 'tang',
        order: 30,
        label: () => '三省六部工作流',
      },
      TangSidebarIcon,
    ),
  );
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: 'tang' }, TangPanel),
  );
}

const inject = ['slots'];

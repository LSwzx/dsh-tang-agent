/**
 * 门下省 · 本地规则审核
 *
 * 在调用门下 LLM 之前先跑确定性规则，明显不合格的草案直接打回；
 * 只有本地通过，或显式开启“严审”时，才进入 LLM 复核。
 */

const DANGEROUS_RULES = [
  { id: 'rm-rf', pattern: /\brm\s+-rf\s+[\/~]/i, message: '包含危险命令 rm -rf /' },
  { id: 'del-f', pattern: /\bdel\s+\/[fqs]\b/i, message: '包含危险命令 del /f' },
  { id: 'format', pattern: /\bformat\s+[a-z]:/i, message: '包含磁盘格式化命令' },
  { id: 'drop-table', pattern: /\bdrop\s+table\b/i, message: '包含 DROP TABLE' },
  { id: 'curl-pipe', pattern: /(?:curl|wget)[^\n|]*\|\s*(?:sh|bash)\b/i, message: '包含 curl/wget 管道执行' },
  { id: 'eval', pattern: /\b(?:eval|exec)\s*\(/, message: '包含动态执行 eval/exec' },
  { id: 'secret', pattern: /(?:password|passwd|secret)\s*[:=]\s*['"][^'"]+['"]/i, message: '疑似硬编码口令' },
];

function orderText(order) {
  return [order?.objective, order?.deliverable, order?.name].filter(Boolean).join('\n');
}

function draftText(draft) {
  return [
    draft?.summary,
    ...(draft?.orders || []).map(orderText),
    ...(draft?.risks || []),
    ...(draft?.acceptance || []),
  ]
    .filter(Boolean)
    .join('\n');
}

export function localReview(draft, edict = '') {
  const issues = [];
  const hard = [];
  const orders = Array.isArray(draft?.orders) ? draft.orders : [];
  if (orders.length === 0) issues.push('无任何条陈：至少按需派一个部门。');
  if (String(draft?.summary || '').trim().length < 10) issues.push('草案主旨不足 10 字，目标含混。');
  if (!Array.isArray(draft?.risks) || draft.risks.length === 0) issues.push('未列风险预案。');
  if (!Array.isArray(draft?.acceptance) || draft.acceptance.length === 0) issues.push('未列验收标准。');

  for (const order of orders) {
    if (!String(order?.deliverable || '').trim()) issues.push(`${order?.name || order?.ministry || '某部'}条陈无交付物。`);
    if (!String(order?.objective || '').trim()) issues.push(`${order?.name || order?.ministry || '某部'}条陈无目标。`);
    if (order?.ministry === 'rites' && !order?.args?.path) issues.push('礼部条陈缺少 args.path，无法读取文档。');
  }

  const text = draftText(draft);
  for (const rule of DANGEROUS_RULES) {
    if (rule.pattern.test(text)) {
      issues.push(rule.message);
      hard.push(rule.message);
    }
  }
  const fences = (text.match(/```/g) || []).length;
  if (fences % 2 === 1) issues.push('代码块未闭合。');
  if (fences > 0 && !orders.some((order) => order.ministry === 'justice')) {
    issues.push('草案含代码块但未派刑部审查。');
  }
  if (edict && /\brm\s+-rf\s+[\/~]/i.test(edict)) {
    issues.push('圣旨包含危险删除命令。');
    hard.push('圣旨包含危险删除命令。');
  }

  const unique = [...new Set(issues)];
  const hardIssues = [...new Set(hard)];
  return {
    approved: unique.length === 0,
    source: 'local',
    hard: hardIssues,
    comment: unique.length === 0 ? '本地规则通过。' : `本地规则驳回：${unique[0]}`,
    issues: unique,
  };
}

export const LOCAL_REVIEW_RULES = DANGEROUS_RULES;

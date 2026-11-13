/**
 * dsh-tang-agent · 侧边栏面板样式
 *
 * 约束：
 * - 所有选择器以 .tda- 前缀命名，不污染宿主页面；
 * - 颜色一律取 --dsw-alias-* 主题令牌，随亮/暗主题自动切换；
 * - 仅印章/朱批的朱砂色是“作品色”，用 --tda-seal 固定，属于有意为之。
 */

export const TANG_CSS = `
.tda-root {
  --tda-seal: #a8322a;
  --tda-seal-soft: rgba(168, 50, 42, 0.08);
  --tda-serif: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif;
  box-sizing: border-box;
  height: 100%;
  overflow-y: auto;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  line-height: 1.55;
  padding: 26px clamp(16px, 4vw, 48px) 80px;
}
.tda-root *, .tda-root *::before, .tda-root *::after { box-sizing: border-box; }
.tda-shell { max-width: 1180px; margin: 0 auto; }

/* ---------- header ---------- */
.tda-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 18px; flex-wrap: wrap; margin-bottom: 20px;
}
.tda-brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
.tda-brand h1 {
  margin: 0; font-family: var(--tda-serif); font-size: 21px; font-weight: 700;
  letter-spacing: 0.02em; line-height: 1.2;
}
.tda-brand p {
  margin: 3px 0 0; color: var(--dsw-alias-label-secondary);
  font-family: var(--tda-serif); font-size: 12px; letter-spacing: 0.18em;
}
.tda-head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tda-stage-pill {
  display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1); font-size: 12px; white-space: nowrap;
}
.tda-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.tda-dot.is-live { background: var(--dsw-alias-brand-primary); animation: tda-pulse 1.4s ease-in-out infinite; }
.tda-dot.is-ok { background: var(--dsw-alias-state-success-primary); }
.tda-dot.is-bad { background: var(--dsw-alias-state-error-primary); }

/* ---------- buttons / inputs ---------- */
.tda-btn {
  appearance: none; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  border-radius: 8px; padding: 7px 13px; font-size: 12.5px; cursor: pointer;
  font-family: inherit; transition: border-color .15s ease, background .15s ease, transform .1s ease;
  white-space: nowrap;
}
.tda-btn:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.tda-btn:active { transform: translateY(1px); }
.tda-btn:focus-visible, .tda-textarea:focus-visible, .tda-select:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px;
}
.tda-btn:disabled { opacity: .45; cursor: not-allowed; }
.tda-btn-primary {
  background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base); font-weight: 600;
}
.tda-btn-primary:hover { filter: brightness(1.06); background: var(--dsw-alias-brand-primary); }
.tda-btn-seal {
  background: var(--tda-seal); border-color: var(--tda-seal); color: #fff;
  font-family: var(--tda-serif); letter-spacing: .1em; font-weight: 600;
}
.tda-btn-ghost { background: transparent; }
.tda-btn-danger { color: var(--dsw-alias-state-error-primary); }
.tda-seg {
  display: inline-flex; padding: 2px; gap: 2px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.tda-seg .tda-btn { border: 0; background: transparent; padding: 5px 10px; border-radius: 6px; }
.tda-seg .tda-btn.is-on { background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 2px rgba(0,0,0,.08); font-weight: 600; }
.tda-select {
  appearance: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  padding: 6px 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-family: inherit; font-size: 12px;
}
.tda-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; user-select: none; }
.tda-check input { accent-color: var(--dsw-alias-brand-primary); }

/* ---------- edict card ---------- */
.tda-edict {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1); padding: 16px 18px;
  margin-bottom: 18px; position: relative; overflow: hidden;
}
.tda-edict::before {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 3px;
  background: linear-gradient(180deg, var(--tda-seal), transparent 85%);
}
.tda-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.tda-eyebrow {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--tda-serif); font-size: 14px; font-weight: 700; letter-spacing: .08em;
}
.tda-eyebrow small { font-family: inherit; font-size: 10px; font-weight: 400; letter-spacing: .12em; color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
.tda-counter { color: var(--dsw-alias-label-secondary); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.tda-textarea {
  width: 100%; min-height: 84px; resize: vertical; display: block;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  padding: 11px 13px; font-family: var(--tda-serif); font-size: 14px; line-height: 1.7;
}
.tda-textarea::placeholder { color: var(--dsw-alias-label-secondary); font-family: inherit; }
.tda-controls { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-top: 11px; }
.tda-presets { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 9px; }
.tda-chip {
  appearance: none; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  padding: 4px 11px; font-size: 11.5px; cursor: pointer; font-family: inherit;
}
.tda-chip:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }

/* ---------- stage rail ---------- */
.tda-rail {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 0;
  margin: 0 0 20px; padding: 12px 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.tda-rail-node { display: flex; flex-direction: column; align-items: center; gap: 7px; position: relative; }
.tda-rail-node::after {
  content: ""; position: absolute; top: 13px; left: calc(50% + 18px); right: calc(-50% + 18px);
  height: 1px; background: var(--dsw-alias-border-l1);
}
.tda-rail-node:last-child::after { display: none; }
.tda-rail-dot {
  width: 27px; height: 27px; border-radius: 50%; display: grid; place-items: center;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary); font-family: var(--tda-serif); font-size: 12px;
  position: relative; z-index: 1; transition: all .2s ease;
}
.tda-rail-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary); text-align: center; }
.tda-rail-node.is-done .tda-rail-dot { background: var(--tda-seal); border-color: var(--tda-seal); color: #fff; }
.tda-rail-node.is-active .tda-rail-dot {
  border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 3px var(--tda-seal-soft); animation: tda-pulse 1.6s ease-in-out infinite;
}
.tda-rail-node.is-active .tda-rail-label, .tda-rail-node.is-done .tda-rail-label { color: var(--dsw-alias-label-primary); font-weight: 600; }
.tda-rail-node.is-error .tda-rail-dot { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); color: #fff; }

/* ---------- layout ---------- */
.tda-columns { display: grid; grid-template-columns: minmax(0, 1fr) 306px; gap: 18px; align-items: start; }
.tda-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.tda-side { position: sticky; top: 14px; min-width: 0; }

/* ---------- cards ---------- */
.tda-card {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1); padding: 16px 18px;
  animation: tda-rise .28s ease both;
}
.tda-card.is-ok { border-color: var(--dsw-alias-state-success-primary); }
.tda-card.is-bad { border-color: var(--dsw-alias-state-error-primary); }
.tda-card.is-flat { padding: 14px 16px; }
.tda-muted { color: var(--dsw-alias-label-secondary); }
.tda-small { font-size: 11.5px; }
.tda-serif { font-family: var(--tda-serif); }
.tda-summary { font-family: var(--tda-serif); font-size: 14px; line-height: 1.85; margin: 8px 0 0; }
.tda-note {
  margin-top: 8px; font-size: 11.5px; color: var(--dsw-alias-label-secondary);
  border-left: 2px solid var(--dsw-alias-border-l2); padding-left: 9px;
}
.tda-orders { display: flex; flex-direction: column; gap: 0; margin-top: 12px; }
.tda-order {
  display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 10px;
  align-items: baseline; padding: 8px 0; border-top: 1px dashed var(--dsw-alias-border-l1);
}
.tda-order:first-child { border-top: 0; }
.tda-order-name { font-family: var(--tda-serif); font-weight: 700; font-size: 12.5px; }
.tda-order-obj { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.tda-order-deadline { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.tda-list { margin: 8px 0 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.tda-list li { margin: 3px 0; }

/* ---------- review ---------- */
.tda-review-wrap { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 14px; align-items: start; }
.tda-stamp {
  width: 74px; height: 74px; border: 3px double var(--tda-seal); border-radius: 9px;
  display: grid; place-items: center; color: var(--tda-seal);
  font-family: var(--tda-serif); font-size: 31px; font-weight: 700;
  transform: rotate(-9deg); opacity: .9; animation: tda-stamp .32s cubic-bezier(.2,1.5,.4,1) both;
  user-select: none; background: var(--tda-seal-soft);
}
.tda-stamp.is-bad { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); background: transparent; }
.tda-review-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.tda-input {
  width: 100%; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  padding: 7px 10px; font-family: inherit; font-size: 12px; margin-top: 9px;
}

/* ---------- ministries ---------- */
.tda-ministries { display: grid; grid-template-columns: repeat(auto-fit, minmax(248px, 1fr)); gap: 12px; }
.tda-ministry {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1); padding: 13px 14px; min-width: 0;
  animation: tda-rise .3s ease both;
}
.tda-ministry.is-done { border-color: var(--dsw-alias-state-success-primary); }
.tda-ministry.is-active { border-color: var(--dsw-alias-brand-primary); }
.tda-ministry-head { display: flex; align-items: center; gap: 9px; }
.tda-glyph {
  width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
  border: 1px solid var(--dsw-alias-border-l1); color: var(--tda-seal);
  font-family: var(--tda-serif); font-weight: 700; font-size: 15px;
  background: var(--tda-seal-soft); flex: none;
}
.tda-ministry-name { font-family: var(--tda-serif); font-weight: 700; font-size: 13.5px; line-height: 1.2; }
.tda-ministry-en { font-size: 10px; letter-spacing: .1em; color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
.tda-ministry-duty { margin: 8px 0 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.tda-ministry-body { margin-top: 9px; font-size: 12px; }
.tda-kpis { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
.tda-kpi {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  padding: 2px 7px; font-size: 10.5px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-base); font-variant-numeric: tabular-nums;
}
.tda-kpi b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.tda-pending { color: var(--dsw-alias-label-secondary); font-size: 11.5px; font-style: italic; }

/* ---------- banner ---------- */
.tda-banner {
  border-radius: 12px; padding: 13px 16px; border: 1px solid var(--dsw-alias-border-l1);
  display: flex; gap: 12px; align-items: flex-start; background: var(--dsw-alias-bg-layer-1);
  animation: tda-rise .3s ease both;
}
.tda-banner.is-bad { border-color: var(--dsw-alias-state-error-primary); background: var(--tda-seal-soft); }
.tda-banner.is-ok { border-color: var(--dsw-alias-state-success-primary); }
.tda-banner-seal {
  flex: none; width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center;
  border: 2px double currentColor; font-family: var(--tda-serif); font-weight: 700; font-size: 17px;
}
.tda-banner.is-bad .tda-banner-seal { color: var(--dsw-alias-state-error-primary); }
.tda-banner.is-ok .tda-banner-seal { color: var(--dsw-alias-state-success-primary); }
.tda-banner h3 { margin: 0; font-family: var(--tda-serif); font-size: 14px; }
.tda-banner p { margin: 3px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }

/* ---------- audit ---------- */
.tda-audit {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1); overflow: hidden;
}
.tda-audit-head {
  padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
}
.tda-audit-list { list-style: none; margin: 0; padding: 8px 12px 12px; max-height: 62vh; overflow-y: auto; }
.tda-audit-item { position: relative; padding: 7px 0 7px 18px; }
.tda-audit-item::before {
  content: ""; position: absolute; left: 3px; top: 13px; width: 6px; height: 6px;
  border-radius: 50%; background: var(--dsw-alias-state-idle-primary);
}
.tda-audit-item.is-ok::before { background: var(--dsw-alias-state-success-primary); }
.tda-audit-item.is-warn::before { background: var(--dsw-alias-state-warn-primary); }
.tda-audit-item.is-bad::before { background: var(--dsw-alias-state-error-primary); }
.tda-audit-item::after {
  content: ""; position: absolute; left: 5.5px; top: 21px; bottom: -3px; width: 1px;
  background: var(--dsw-alias-border-l1);
}
.tda-audit-item:last-child::after { display: none; }
.tda-audit-meta { display: flex; gap: 6px; align-items: baseline; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.tda-audit-actor { color: var(--dsw-alias-label-primary); font-weight: 600; font-family: var(--tda-serif); }
.tda-audit-action { letter-spacing: .04em; }
.tda-audit-detail { margin: 2px 0 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }

/* ---------- empty ---------- */
.tda-empty { text-align: center; padding: 26px 16px 8px; color: var(--dsw-alias-label-secondary); }
.tda-empty h2 { margin: 12px 0 4px; font-family: var(--tda-serif); font-size: 17px; color: var(--dsw-alias-label-primary); }
.tda-empty p { margin: 0 auto; max-width: 560px; font-size: 12.5px; line-height: 1.8; }

/* ---------- sidebar icon ---------- */
.tda-sidebar-icon {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; color: var(--dsw-alias-label-secondary);
  transition: color .15s ease;
}
.tda-sidebar-icon:hover, .tda-sidebar-icon.is-active { color: var(--dsw-alias-label-primary); }
.tda-sidebar-seal {
  display: grid; place-items: center; border-radius: 7px; border: 1px solid currentColor;
  font-family: var(--tda-serif); font-weight: 700; line-height: 1;
  transition: background .15s ease, color .15s ease;
}
.tda-sidebar-icon.is-active .tda-sidebar-seal { background: var(--tda-seal); border-color: var(--tda-seal); color: #fff; }

/* ---------- real agents ---------- */
.tda-agentgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.tda-agent {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2); padding: 12px 13px; min-width: 0;
}
.tda-agent.is-running { border-color: var(--dsw-alias-brand-primary); }
.tda-agent.is-done { border-color: var(--dsw-alias-state-success-primary); }
.tda-agent.is-failed { border-color: var(--dsw-alias-state-error-primary); }
.tda-agent-head { display: flex; align-items: center; gap: 8px; }
.tda-agent-meta { color: var(--dsw-alias-label-secondary); font-size: 10.5px; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tda-agent-stream {
  margin-top: 8px; padding: 8px 9px; border-radius: 8px;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary); font-family: var(--tda-serif);
  font-size: 11.5px; line-height: 1.65; white-space: pre-wrap; word-break: break-word;
  max-height: 132px; overflow: auto;
}
.tda-agent-error { margin-top: 6px; color: var(--dsw-alias-state-error-primary); font-size: 11px; word-break: break-word; }
.tda-tools { margin-top: 9px; display: flex; flex-direction: column; gap: 6px; }
.tda-tool { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 8px; background: var(--dsw-alias-bg-base); }
.tda-tool-name { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.tda-tool-args, .tda-tool-result { margin-top: 3px; font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; color: var(--dsw-alias-label-secondary); word-break: break-all; max-height: 88px; overflow: auto; }
.tda-tool-result { color: var(--dsw-alias-state-success-primary); }
.tda-tool-result.is-error { color: var(--dsw-alias-state-error-primary); }
.tda-badge {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  font-size: 10px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-base); white-space: nowrap;
}
.tda-badge-real { color: var(--tda-seal); border-color: var(--tda-seal); font-family: var(--tda-serif); letter-spacing: .08em; }
.tda-status-icon {
  width: 20px; height: 20px; flex: none; display: grid; place-items: center;
  border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2);
  font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-base);
}
.tda-status-icon.is-running { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); animation: tda-pulse 1.4s ease-in-out infinite; }
.tda-status-icon.is-done { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.tda-status-icon.is-blocked { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.tda-status-icon.is-failed { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.tda-approval {
  border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1); padding: 12px 14px; margin-bottom: 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.tda-approval-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.tda-approval-row h3 { margin: 0; font-family: var(--tda-serif); font-size: 13.5px; }
.tda-approval-row p { margin: 3px 0; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-word; }
.tda-approval-actions { display: flex; gap: 8px; flex: none; }
.tda-continuation {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 9px;
  padding: 6px 9px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px;
  color: var(--dsw-alias-label-secondary); font-size: 11.5px;
}
.tda-check {
  display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px;
  color: var(--dsw-alias-label-secondary); cursor: pointer; user-select: none;
}

/* ---------- org chart ---------- */
.tda-org {
  position: relative; display: flex; flex-direction: column; align-items: center;
  padding: 8px 0 2px; overflow-x: auto;
}
.tda-org-emperor {
  display: flex; align-items: center; gap: 8px; padding: 9px 18px;
  border: 1px solid var(--tda-seal); border-radius: 8px;
  background: var(--tda-seal-soft); color: var(--dsw-alias-label-primary);
  font-family: var(--tda-serif); box-shadow: 0 1px 0 rgba(0,0,0,.04);
}
.tda-org-emperor .tda-org-name { font-size: 14px; }
.tda-org-node {
  appearance: none; border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary); padding: 8px 10px;
  min-width: 88px; display: flex; flex-direction: column; align-items: center;
  gap: 2px; cursor: pointer; font-family: var(--tda-serif);
  writing-mode: horizontal-tb; transition: border-color .15s ease, box-shadow .15s ease;
}
.tda-org-node:hover { border-color: var(--dsw-alias-brand-primary); }
.tda-org-node.is-selected { box-shadow: 0 0 0 2px var(--tda-seal-soft); border-color: var(--tda-seal); }
.tda-org-node.is-running { border-color: var(--dsw-alias-brand-primary); }
.tda-org-node.is-done { border-color: var(--dsw-alias-state-success-primary); }
.tda-org-node.is-blocked { border-color: var(--dsw-alias-state-warn-primary); }
.tda-org-node.is-failed { border-color: var(--dsw-alias-state-error-primary); }
.tda-org-node.is-idle { opacity: .78; }
.tda-org-dot {
  width: 7px; height: 7px; border-radius: 50%; flex: none;
  background: var(--dsw-alias-state-idle-primary);
}
.tda-org-dot.is-running { background: var(--dsw-alias-brand-primary); animation: tda-pulse 1.4s ease-in-out infinite; }
.tda-org-dot.is-done { background: var(--dsw-alias-state-success-primary); }
.tda-org-dot.is-blocked { background: var(--dsw-alias-state-warn-primary); }
.tda-org-dot.is-failed { background: var(--dsw-alias-state-error-primary); }
.tda-org-name { font-size: 12.5px; font-weight: 700; line-height: 1.25; white-space: nowrap; }
.tda-org-status { font-size: 9.5px; color: var(--dsw-alias-label-secondary); line-height: 1.2; }
.tda-org-trunk, .tda-org-bus { width: 1px; height: 20px; background: var(--dsw-alias-border-l2); flex: none; }
.tda-org-departments {
  position: relative; display: grid;
  grid-template-columns: repeat(3, minmax(92px, 126px)); gap: 14px;
  padding-top: 14px;
}
.tda-org-departments::before {
  content: ""; position: absolute; top: 0; left: 16.66%; right: 16.66%;
  height: 1px; background: var(--dsw-alias-border-l2);
}
.tda-org-dept { position: relative; }
.tda-org-dept::before {
  content: ""; position: absolute; top: -14px; left: 50%; width: 1px; height: 14px;
  background: var(--dsw-alias-border-l2);
}
.tda-org-ministries {
  position: relative; display: grid;
  grid-template-columns: repeat(6, minmax(48px, 1fr)); gap: 8px;
  padding-top: 14px; width: 100%; max-width: 760px;
}
.tda-org-ministries::before {
  content: ""; position: absolute; top: 0; left: 8%; right: 8%;
  height: 1px; background: var(--dsw-alias-border-l2);
}
.tda-org-ministry { position: relative; min-width: 0; padding: 7px 4px; }
.tda-org-ministry::before {
  content: ""; position: absolute; top: -14px; left: 50%; width: 1px; height: 14px;
  background: var(--dsw-alias-border-l2);
}
.tda-org-aux { position: absolute; right: 0; top: 118px; display: flex; align-items: center; gap: 6px; }
.tda-org-aux-line { width: 26px; border-top: 1px dashed var(--dsw-alias-border-l2); }
.tda-org-aux .tda-org-node { min-width: 78px; opacity: .9; }
.tda-org-detail { margin-top: 16px; border-top: 1px dashed var(--dsw-alias-border-l1); padding-top: 12px; }
.tda-org-detail-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.tda-org-detail-head strong { font-family: var(--tda-serif); font-size: 13.5px; }

@keyframes tda-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes tda-stamp { from { opacity: 0; transform: rotate(-24deg) scale(1.35); } to { opacity: .9; transform: rotate(-9deg) scale(1); } }
@keyframes tda-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }

@media (max-width: 980px) {
  .tda-columns { grid-template-columns: minmax(0, 1fr); }
  .tda-side { position: static; }
  .tda-audit-list { max-height: 320px; }
  .tda-rail-label { font-size: 10px; }
  .tda-org-aux { position: static; margin-top: 10px; }
  .tda-org-aux-line { display: none; }
  .tda-org-ministries { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tda-org-ministries::before, .tda-org-ministry::before { display: none; }
}
@media (max-width: 620px) {
  .tda-root { padding: 18px 12px 64px; }
  .tda-rail { grid-template-columns: repeat(6, minmax(0, 1fr)); padding: 10px 4px; }
  .tda-rail-dot { width: 23px; height: 23px; font-size: 11px; }
  .tda-review-wrap { grid-template-columns: 1fr; }
  .tda-order { grid-template-columns: 46px minmax(0, 1fr); }
  .tda-order-deadline { display: none; }
  .tda-org-departments { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .tda-org-node { min-width: 0; padding: 6px 4px; }
  .tda-org-name { font-size: 11.5px; }
}
@media (prefers-reduced-motion: reduce) {
  .tda-root *, .tda-root *::before, .tda-root *::after { animation: none !important; transition: none !important; }
}
`;

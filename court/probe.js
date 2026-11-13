/**
 * 钦天监 · 本地能力探测
 *
 * 环境探测是确定性的：不启动 LLM，只读 Host Service 与已注册 provider，
 * 结果作为中书起草的上下文，避免为“探测”支付一次模型调用。
 */

import { MINISTRY_TOOL_NAMES } from './tools.js';

const SERVICE_NAMES = [
  'fs',
  'subprocess',
  'approval',
  'storage',
  'storageDomain',
  'webServer',
  'agents',
  'subagents',
  'llm',
  'agentDefaultModel',
];

function providerName(provider) {
  if (typeof provider === 'string') return provider;
  return provider && (provider.name || provider.id || provider.providerName);
}

export function probeCapabilities(ctx, run) {
  const services = {};
  for (const name of SERVICE_NAMES) {
    services[name] = Boolean(ctx.get && ctx.get(name) !== undefined);
  }
  let providers = [];
  try {
    providers = (ctx.subagents?.list?.() || []).map(providerName).filter(Boolean);
  } catch {
    providers = [];
  }
  const gaps = [];
  if (!services.fs) gaps.push('缺少 fs：无法读写工作区交付物');
  if (!services.subprocess) gaps.push('缺少 subprocess：兵部/刑部无法执行本地命令');
  if (!services.approval) gaps.push('缺少 approval：真实写入/命令无法人工审批');
  return {
    feasible: Boolean(services.fs),
    gaps,
    services,
    providers,
    planned_tools: MINISTRY_TOOL_NAMES,
    platform: process.platform,
    node: process.version,
    cwd: run.cwd,
    checked_at: new Date().toISOString(),
  };
}

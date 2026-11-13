/**
 * dsh-tang-agent · Host 半部
 *
 * 真实多智能体版本：
 *   - 通过 ctx.subagents.startActivation({ provider: 'spawn' }) 派生独立子 Agent
 *   - 中书 / 钦天监 / 门下 / 尚书 / 六部 各自拥有独立 Prompt 与工具面
 *   - 六部并发执行，真实调用 DSH 的 fs / subprocess / approval
 *   - 通过 /api/tang/* 向侧边栏提供真实事件流与运行快照
 *
 * 不再用本地状态机伪造“六部覆命”。engine.js 仅保留为离线测试夹具。
 */

import { RunStore } from './court/store.js';
import { CourtOrchestrator, renderRunReport } from './court/orchestrator.js';
import { registerRoutes } from './court/routes.js';
import { startAutoUpdate } from './court/auto-update.js';

export const name = 'dsh-tang-agent';
export const inject = ['tools', 'agents', 'subagents', 'webServer', 'fs', 'subprocess', 'workingDirectory', 'agentDefaultModel'];

const MAX_EDICT_LENGTH = 4000;

function render(value) {
  return [{ type: 'text', text: String(value) }];
}

export function apply(ctx, config = {}) {
  const store = new RunStore(ctx);
  const orchestrator = new CourtOrchestrator(ctx, store, {
    timeoutMs: Number(config.timeoutMs) || 15 * 60 * 1000,
    models: config.models,
  });

  const disposeAutoUpdate = startAutoUpdate(ctx, {
    autoUpdate: config.autoUpdate,
    autoUpdateDelayMs: config.autoUpdateDelayMs,
    registry: config.registry,
  });
  ctx.effect(() => disposeAutoUpdate, 'dsh-tang-agent: auto-update');

  ctx.effect(
    () => async () => {
      await orchestrator.dispose();
    },
    'dsh-tang-agent: orchestrator',
  );

  const disposeRoutes = registerRoutes(ctx, orchestrator);
  if (disposeRoutes) {
    ctx.effect(() => disposeRoutes, 'dsh-tang-agent: routes');
  }

  ctx.tools.register({
    name: 'tang_court',
    description:
      'dsh-tang-agent：按需派发的三省六部朝议。钦天监本地探测，中书起草，门下先跑本地规则再按需调用 LLM；' +
      '工/兵/刑派真实子 Agent，户/礼/吏直接跑 JS 工具，尚书派发与汇总均由代码完成。' +
      '默认等待完成并返回完整起居注；连续驳回达到上限会封还御前。',
    parameters: {
      type: 'object',
      properties: {
        edict: { type: 'string', description: '圣旨正文：目标、期限、钱粮、禁忌。' },
        mode: { type: 'string', enum: ['full', 'single', 'quick'], description: 'full=完整朝议；single=单部直调；quick=快速问答。' },
        max_rejections: { type: 'integer', description: '门下省连驳上限，默认 3。' },
        ministry: { type: 'string', enum: ['works', 'justice', 'war', 'rites', 'revenue', 'personnel'], description: '单部直调时的部门。' },
        strict_review: { type: 'boolean', description: '严审开关：本地规则不通过时仍调用门下 LLM 复核；默认 false。' },
        continue_from: { type: 'string', description: '续旨：上一案的 runId；复用同一父会话并带上上一案结果。' },
        wait: { type: 'boolean', description: '是否等待完成；默认 true。false 时只返回 runId。' },
      },
      required: ['edict'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => render(value) },
    timeoutMs: 15 * 60 * 1000,
    execute: async (args, exec) => {
      const edict = typeof args.edict === 'string' ? args.edict.trim() : '';
      if (!edict) throw new Error('圣旨不可为空。');
      if (edict.length > MAX_EDICT_LENGTH) throw new Error(`圣旨过长：上限 ${MAX_EDICT_LENGTH} 字。`);
      const runId = await orchestrator.start(edict, {
        mode: args.mode,
        maxRejections: args.max_rejections,
        ministry: args.ministry,
        strictReview: args.strict_review,
        continueFrom: args.continue_from,
      });
      if (args.wait === false) return `started run ${runId}`;
      const run = await orchestrator.wait(runId, exec.signal);
      return renderRunReport(run);
    },
  });

  ctx.tools.register({
    name: 'tang_court_status',
    description: '查看一次 dsh-tang-agent 朝议的实时状态、真实工具调用与结果。',
    parameters: {
      type: 'object',
      properties: { run_id: { type: 'string' } },
      required: ['run_id'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => render(value) },
    execute: async (args) => {
      const run = orchestrator.get(String(args.run_id));
      if (!run) throw new Error(`run 不存在：${args.run_id}`);
      return renderRunReport(run);
    },
  });

  ctx.tools.register({
    name: 'tang_court_cancel',
    description: '中止一次运行中的 dsh-tang-agent 朝议，取消所有子 Agent。',
    parameters: {
      type: 'object',
      properties: { run_id: { type: 'string' } },
      required: ['run_id'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => render(value) },
    execute: async (args) => {
      const run = orchestrator.cancel(String(args.run_id));
      if (!run) throw new Error(`run 不存在：${args.run_id}`);
      return `cancelled run ${run.id}（${run.status}）`;
    },
  });
}

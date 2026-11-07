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
  });

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
      'dsh-tang-agent：以三省六部制启动一次真实多智能体朝议。中书起草、钦天监勘验、门下封驳、尚书派发，' +
      '六部各自派生独立子 Agent 并调用真实工具（读写文件、终端命令、代码扫描、统计、工具盘点、文档读取）。' +
      '默认等待完成并返回完整起居注；连续驳回达到上限会封还御前。',
    parameters: {
      type: 'object',
      properties: {
        edict: { type: 'string', description: '圣旨正文：目标、期限、钱粮、禁忌。' },
        mode: { type: 'string', enum: ['full', 'single', 'quick'], description: 'full=完整朝议；single=单部直调；quick=快速问答。' },
        max_rejections: { type: 'integer', description: '门下省连驳上限，默认 3。' },
        ministry: { type: 'string', enum: ['works', 'justice', 'war', 'rites', 'revenue', 'personnel'], description: '单部直调时的部门。' },
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

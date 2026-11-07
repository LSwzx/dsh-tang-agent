/**
 * dsh-tang-agent · 真实子 Agent 执行器
 *
 * 使用 DSH 的 `ctx.subagents.startActivation({ provider: 'spawn', ... })`
 * 派生独立子 Agent；在 `agent/created` 事件里：
 *   1. 注入角色 System Prompt（来自 prompts.py）；
 *   2. 注册该部专属工具（scoped tools）；
 *   3. 只保留 read 全局工具，隐藏其他无关能力；
 *   4. 订阅子 Agent 的 session/event，向上回传真实工具调用与流式文本。
 *
 * 这是与 `dsh-code-review` 相同的原生 spawn 模式，不模拟、不伪造。
 */

import { randomUUID } from 'node:crypto';

export function defaultModelOptions(ctx) {
  try {
    const selection = ctx.agentDefaultModel?.currentSelection?.();
    if (selection && selection.provider && selection.model) {
      return {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
      };
    }
  } catch {
    /* 使用宿主默认 */
  }
  return undefined;
}

/**
 * 创建一个只用于承载子 Agent 的父会话（不产生 LLM 调用）。
 * 若创建失败，退回任意 live root，保证 run 仍可进行。
 */
export async function createRunParent(ctx, { cwd, signal }) {
  try {
    const handle = await ctx.agents.createAgent(ctx, {
      sessionId: randomUUID(),
      meta: { cwd, origin: 'subagent', delegationDepth: 0 },
      agentOptions: defaultModelOptions(ctx),
      signal,
    });
    return { agent: handle.agent, handle, owned: true };
  } catch (error) {
    const live = ctx.agents.list()[0];
    if (!live) throw new Error(`无法创建或找到朝议父 Agent：${error.message || error}`);
    return { agent: live, handle: undefined, owned: false };
  }
}

function extractOutput(result) {
  if (!result || !Array.isArray(result.output)) return '';
  return result.output
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * 派生一个真实子 Agent 并等待其完成。
 *
 * @param {object} ctx Host 插件上下文（根 ctx）
 * @param {object} options
 * @param {string} options.role 角色 id（works / justice / ...）
 * @param {string} options.label 展示名
 * @param {string} options.prompt 从 prompts.py 动态读取的 System Prompt
 * @param {string} options.task 交给子 Agent 的任务正文
 * @param {Array} options.tools 该角色专属的工具定义
 * @param {string} options.cwd 工作目录
 * @param {object} options.parent 父 Agent
 * @param {AbortSignal} options.signal 取消/超时信号
 * @param {(role: string, event: object) => void} [options.onEvent]
 * @returns {Promise<{childId: string, output: string, stopReason: string, model: object|undefined}>}
 */
export async function runSubagent(ctx, options) {
  const { role, label, prompt, task, tools, cwd, parent, signal, onEvent, onCreated } = options;
  const provider = ctx.subagents?.getProvider?.('spawn');
  if (!provider) throw new Error('DSH 未加载 spawn 子 Agent provider，无法创建真实子 Agent。');

  const childId = randomUUID();
  const model = defaultModelOptions(ctx);
  let childAgent;
  let activation;

  const stopCreated = ctx.on('agent/created', ({ agent }) => {
    if (agent.id !== childId) return;
    childAgent = agent;
    try {
      onCreated?.(childId, agent);
      // 当前会话可能默认 never；为子 Agent 打开原生 approval 请求，交给插件侧边栏作答。
      const approval = ctx.get ? ctx.get('approval') : ctx.approval;
      if (approval && typeof approval.setPolicy === 'function') approval.setPolicy(agent, 'ask');
    } catch {
      /* 审批服务不可用时工具会 fail-closed */
    }
    try {
      const order = Number(agent.ctx.systemPrompt.getSectionOrder?.('DEPLOYMENT_PERSONA_PREFIX'));
      agent.ctx.systemPrompt.section({
        name: `tang:${role}:${childId.slice(0, 8)}`,
        order: Number.isFinite(order) ? order : 1000,
        text: prompt,
      });
    } catch (error) {
      // 角色 prompt 注入失败必须显式暴露，而不是静默跑成通用 Agent。
      throw new Error(`角色 System Prompt 注入失败（${role}）：${error.message || error}`);
    }
    for (const tool of tools || []) {
      try {
        agent.ctx.tools.register(tool);
      } catch (error) {
        throw new Error(`工具注册失败（${role}/${tool.name}）：${error.message || error}`);
      }
    }
    try {
      // 只保留只读 read；各部专属工具是 scoped registration，不受此限制影响。
      agent.ctx.tools.restrict({ allow: ['read'] });
    } catch {
      /* 没有 read 时保留默认工具面 */
    }
    try {
      // subagent 等来自 preset 的 scoped 工具，restrict 管不到；用 guard 兜底禁用递归派生。
      agent.ctx.tools.guard((exec) =>
        exec.name === 'subagent' || exec.name === 'subagent_fork' || exec.name === 'workflow'
          ? 'dsh-tang-agent：六部子 Agent 不允许再派生 Agent。'
          : undefined,
      );
    } catch {
      /* 老版本没有 guard 时降级 */
    }
    if (onEvent) {
      agent.ctx.on('session/event', (session, event) => {
        try {
          onEvent(role, event, session);
        } catch {
          /* UI 观察失败不能影响子 Agent */
        }
      });
    }
  });

  try {
    activation = await ctx.subagents.startActivation({
      provider: 'spawn',
      label,
      childId,
      request: {
        parent,
        cwd,
        prompt: [{ type: 'text', text: task }],
        ...(model ? { agentOptions: model } : {}),
      },
      signal,
      delivery: 'caller',
    });
    const result = await activation.result;
    const output = extractOutput(result);
    return {
      childId,
      output,
      stopReason: result.stopReason,
      model,
      sessionId: childId,
    };
  } finally {
    stopCreated();
    if (activation) {
      try {
        await activation.dispose();
      } catch {
        /* 清理失败不覆盖真实结果 */
      }
    }
  }
}

export function roleSessionId(run, role) {
  return run.agents?.[role]?.sessionId;
}

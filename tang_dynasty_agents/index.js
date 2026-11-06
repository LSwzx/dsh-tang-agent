/**
 * Tang-Dynasty-Agents · Host 半部
 *
 * 向模型暴露一个 `tang_court` 工具：把一道圣旨交给三省六部状态机，
 * 返回完整的起居注（下旨、草拟、朱批、驳回、下发、六部覆命）。
 * 状态机与侧边栏 UI 共用 engine.js，行为完全一致。
 *
 * 本插件不访问网络、不读写业务文件、不修改其他插件；纯本地确定性演练。
 */

import { runAll, renderReport } from './engine.js';

export const name = 'tang-dynasty-agents';
export const inject = ['tools'];

const MAX_EDICT_LENGTH = 4000;

export function apply(ctx) {
  ctx.tools.register({
    name: 'tang_court',
    description:
      'Tang-Dynasty-Agents：以三省六部制（中书起草 → 门下朱批 → 尚书下发 → 六部覆命）演练一道圣旨。' +
      '默认门下省会驳回一次并要求修订；连续驳回三次则封还圣旨、上报皇帝（防死锁）。' +
      '返回完整起居注与六部交付物。纯本地确定性引擎，不调用模型、不访问网络。',
    parameters: {
      type: 'object',
      properties: {
        edict: {
          type: 'string',
          description: '圣旨正文：要办的事、期限、钱粮人手、禁忌等。',
        },
        always_reject: {
          type: 'boolean',
          description: '设为 true 可演练“门下省连驳三次，封还御前”的防死锁路径。',
        },
      },
      required: ['edict'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute(args) {
      const edict = typeof args.edict === 'string' ? args.edict.trim() : '';
      if (!edict) throw new Error('圣旨不可为空。');
      if (edict.length > MAX_EDICT_LENGTH) {
        throw new Error(`圣旨过长：上限 ${MAX_EDICT_LENGTH} 字。`);
      }
      const state = runAll(edict, { forceReject: Boolean(args.always_reject) });
      return renderReport(state);
    },
  });
}

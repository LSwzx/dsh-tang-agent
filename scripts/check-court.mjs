/**
 * Host 安全边界静态测试：
 * - scratch 判定不能被 `..` 绕过；
 * - 兵部只读白名单必须整串匹配，不能带 shell 元字符。
 *
 * 这些是 Code Review 发现的真实绕过点，必须回归。
 */

import assert from 'node:assert/strict';
import { isScratchPath, isSafeReadonlyCommand } from '../court/tools.js';
import { localReview } from '../court/local-review.js';
import { PROMPTS } from '../court/prompts.js';

assert.equal(isScratchPath('tang-artifacts/report.md'), true);
assert.equal(isScratchPath('tang-artifacts\\report.md'), true);
assert.equal(isScratchPath('.tang-court/demo.md'), true);
assert.equal(isScratchPath('src/index.js'), false);
assert.equal(isScratchPath('tang-artifacts/../deliverable.md'), false);
assert.equal(isScratchPath('../tang-artifacts/report.md'), false);

assert.equal(isSafeReadonlyCommand('echo 三省六部真实朝议'), true);
assert.equal(isSafeReadonlyCommand('pwd'), true);
assert.equal(isSafeReadonlyCommand('git status'), true);
assert.equal(isSafeReadonlyCommand('node --version'), true);
assert.equal(isSafeReadonlyCommand('echo x; rm -rf /'), false);
assert.equal(isSafeReadonlyCommand('echo x && whoami'), false);
assert.equal(isSafeReadonlyCommand('git status; evil'), false);
assert.equal(isSafeReadonlyCommand('echo x > file.txt'), false);
assert.equal(isSafeReadonlyCommand('echo $(whoami)'), false);
assert.equal(isSafeReadonlyCommand('powershell -Command "echo hi"'), false);

const draft = {
  summary: '这是一份足够长的草案摘要，用于验证本地审核规则。',
  orders: [
    { ministry: 'works', name: '工部', objective: '写交付文件', deliverable: 'report.md', args: {}, deadline: '旬日' },
  ],
  risks: ['工期风险'],
  acceptance: ['文件存在'],
};
assert.equal(localReview(draft, '').approved, true);
assert.equal(localReview({ ...draft, summary: '太短' }, '').approved, false);
assert.equal(localReview({ ...draft, orders: [{ ...draft.orders[0], objective: '执行 rm -rf /' }] }, '').approved, false);
assert.equal(
  localReview({ ...draft, orders: [{ ministry: 'rites', name: '礼部', objective: '读文档', deliverable: '摘要', args: {} }] }, '').approved,
  false,
);

for (const [role, prompt] of Object.entries(PROMPTS)) {
  assert.ok(prompt.length <= 150, `${role} prompt 超过 150 字：${prompt.length}`);
  assert.ok(!/python/i.test(prompt), `${role} prompt 仍依赖 Python`);
}

process.stdout.write('court security ok: scratch traversal blocked, shell metacharacters blocked\n');
process.stdout.write('local review/prompt ok: rules enforced, prompts <=150 chars, no python dependency\n');

/**
 * Node 冒烟测试：验证 JS 引擎与 Python 参考实现同构的关键行为。
 * 用法：node scripts/smoke.mjs
 */

import assert from 'node:assert/strict';
import { begin, step, submitReview, runAll, renderReport } from '../engine.js';

const EDICT =
  '着工部于三月内修缮东市水渠，户部拨钱粮，刑部核验工料，吏部考成，礼部告示百姓。';

// 1. 默认路径：一次驳回 → 修订 → 准奏 → 六部覆命
const done = runAll(EDICT);
assert.equal(done.phase, 'completed');
assert.equal(done.revision, 2);
assert.equal(done.rejections, 1);
assert.equal(done.results.length, 6);
assert.equal(done.review.approved, true);
assert.ok(renderReport(done).includes('门下省'));
assert.ok(renderReport(done).includes('准奏'));

// 2. 连驳演练：三次封还 → 上报皇帝，且不再下发六部
const blocked = runAll(EDICT, { forceReject: true });
assert.equal(blocked.phase, 'escalated');
assert.equal(blocked.rejections, 3);
assert.equal(blocked.results.length, 0);
assert.ok(blocked.escalationReason.includes('连驳 3 次'));
assert.ok(renderReport(blocked).includes('封还'));

// 3. 亲批模式：手动驳回一次，再手动准奏，然后继续执行
let manual = begin(EDICT);
manual = step(manual); // drafting → reviewing
assert.equal(manual.phase, 'reviewing');
manual = submitReview(manual, false, '钱粮未核，着即重拟。');
assert.equal(manual.phase, 'revising');
assert.equal(manual.rejections, 1);
manual = step(manual); // revising → reviewing
assert.equal(manual.phase, 'reviewing');
manual = submitReview(manual, true, '准奏。');
assert.equal(manual.phase, 'dispatching');
let guard = 0;
while (manual.phase !== 'completed' && guard < 50) {
  manual = step(manual);
  guard += 1;
}
assert.equal(manual.phase, 'completed');

// 4. 亲批留空驳回：第 2 稿已补齐风险/验收，base.issues 为空，必须有兜底驳议
let blank = begin(EDICT);
blank = step(blank); // drafting → reviewing
blank = step(blank); // 自动驳回 → revising
blank = step(blank); // revising → reviewing（第 2 稿）
assert.equal(blank.draft.revision, 2);
blank = submitReview(blank, false, '   ');
assert.equal(blank.phase, 'revising');
assert.ok(blank.review.issues.length > 0);
assert.ok(!blank.review.comment.includes('undefined'));
assert.ok(!renderReport(blank).includes('undefined'));

// 5. 审计轨迹连续
const seqs = manual.history.map((entry) => entry.seq);
assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 1));

process.stdout.write('smoke ok: completed=6 ministries, escalation=3 rejections, manual review ok\n');

/**
 * Host 安全边界静态测试：
 * - scratch 判定不能被 `..` 绕过；
 * - 兵部只读白名单必须整串匹配，不能带 shell 元字符。
 *
 * 这些是 Code Review 发现的真实绕过点，必须回归。
 */

import assert from 'node:assert/strict';
import { isScratchPath, isSafeReadonlyCommand } from '../court/tools.js';

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

process.stdout.write('court security ok: scratch traversal blocked, shell metacharacters blocked\n');

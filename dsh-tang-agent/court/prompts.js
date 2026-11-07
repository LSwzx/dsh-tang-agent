/**
 * dsh-tang-agent · Prompt 装载器
 *
 * 每次创建圣旨时动态读取 prompts.py（以 mtime 判断是否需要重新加载），
 * 由 Python 解释器执行 `prompts.all_prompts()` 后以 JSON 返回。
 * 这样 prompts.py 是唯一事实来源，不再是死文档。
 */

import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROMPTS_FILE = join(PLUGIN_ROOT, 'prompts.py');

let cache = { mtime: 0, prompts: undefined };

const PYTHON_SCRIPT = [
  'import json, sys',
  `sys.path.insert(0, ${JSON.stringify(PLUGIN_ROOT)})`,
  'import prompts',
  'print(json.dumps(prompts.all_prompts(), ensure_ascii=False))',
].join('\n');

async function runPython(command, args) {
  return execFileAsync(command, args, {
    cwd: PLUGIN_ROOT,
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  });
}

/**
 * 读取 prompts.py 的全量 prompt。
 * @returns {Promise<Record<string, string>>}
 */
export async function loadPrompts() {
  const mtime = statSync(PROMPTS_FILE).mtimeMs;
  if (cache.prompts !== undefined && cache.mtime === mtime) return cache.prompts;

  const candidates = process.platform === 'win32' ? [['python', []], ['py', ['-3']]] : [['python3', []], ['python', []]];
  let lastError;
  for (const [command, prefix] of candidates) {
    try {
      const { stdout } = await runPython(command, [...prefix, '-c', PYTHON_SCRIPT]);
      const prompts = JSON.parse(stdout);
      if (typeof prompts !== 'object' || prompts === null) throw new Error('prompts.py 返回了非对象');
      cache = { mtime, prompts };
      return prompts;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`无法从 prompts.py 加载 Prompt：${lastError ? lastError.message : '未知错误'}`);
}

/** 供测试与状态接口使用：不执行 Python，返回缓存状态。 */
export function promptCacheInfo() {
  return { file: PROMPTS_FILE, loaded: cache.prompts !== undefined, mtime: cache.mtime };
}

/**
 * dsh-tang-agent · 六部真实工具
 *
 * 每个工具都通过 DSH Service 执行真实操作：
 *   - 工部：ctx.fs 读写工作区文件
 *   - 兵部：ctx.subprocess 执行命令（带超时）
 *   - 刑部：扫描源码 + python -m py_compile
 *   - 户部：统计字符 / 词 / 近似 Token
 *   - 吏部：读取当前 Agent 可见工具面
 *   - 礼部：读取文档并整理标题
 *   - 钦天监：探测当前 Host 能力面
 *
 * 写文件与执行命令前必须调用 ctx.approval.request()；未获 allowed-once
 * 一律拒绝。所有路径都被限制在本次 run 的 cwd 内。
 */

import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, relative } from 'node:path';

const READ_LIMIT = 120_000;
const MAX_SCAN_FILES = 200;
const MAX_SCAN_BYTES = 512_000;

function render(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

function defineTool(name, description, parameters, execute, options = {}) {
  return {
    name,
    description,
    parameters,
    output: { schema: { type: 'object' }, render: (_args, value) => render(value) },
    execute,
    timeoutMs: options.timeoutMs ?? 60_000,
    isConcurrencySafe: options.concurrencySafe ?? false,
  };
}

async function approve(ctx, run, exec, toolName, reason) {
  // 优先走插件侧边栏的审批队列：这是用户真实点击的入口，且不依赖宿主是否挂载 ui-approval。
  if (typeof run.requestApproval === 'function') {
    const decision = await run.requestApproval({
      toolName,
      reason,
      displayReason: { zh: reason, en: reason },
      signal: exec.signal,
      actor: exec.agent?.id,
    });
    if (decision !== 'allow') throw new Error(`审批未通过（${decision}）：${reason}`);
    return;
  }
  const approval = ctx.get ? ctx.get('approval') : ctx.approval;
  if (!approval) throw new Error('审批服务不可用，拒绝执行真实写操作。');
  const outcome = await approval.request({
    agent: exec.agent,
    toolName,
    callId: exec.callId,
    reason,
    displayReason: { zh: reason, en: reason },
    signal: exec.signal,
  });
  if (outcome !== 'allowed-once') throw new Error(`审批未通过（${outcome}）：${reason}`);
}

export function isScratchPath(path) {
  const normalized = String(path || '').replace(/\\/g, '/');
  if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') return false;
  return normalized.startsWith('tang-artifacts/') || normalized.startsWith('.tang-court/');
}

export function isSafeReadonlyCommand(command) {
  const text = String(command || '').trim();
  // 必须整串匹配，且禁止任何 shell 元字符；避免 `echo x; rm -rf y` 之类绕过审批。
  if (/[;&|<>`$()\r\n]/.test(text)) return false;
  return [
    /^echo(?:\s+[^;&|<>`$()\r\n]+)?$/i,
    /^pwd$/i,
    /^whoami$/i,
    /^git status$/i,
    /^git diff --stat$/i,
    /^(?:python|py|node|npm) --version$/i,
  ].some((pattern) => pattern.test(text));
}

async function resolveInside(ctx, run, path) {
  const root = await ctx.fs.resolve(run.cwd);
  const target = await ctx.fs.resolve(String(path), { cwd: run.cwd });
  if (!ctx.fs.contains(root, target)) {
    throw new Error(`路径越界：只允许在 ${run.cwd} 内操作，收到 ${target.displayPath}`);
  }
  return target;
}

async function readText(ctx, run, path) {
  const target = await resolveInside(ctx, run, path);
  const text = await ctx.fs.readText(target);
  if (text.length > READ_LIMIT) return { path: target.displayPath, text: text.slice(0, READ_LIMIT), truncated: true };
  return { path: target.displayPath, text, truncated: false };
}

function countText(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWords = (text.match(/[A-Za-z0-9_]+(?:['-][A-Za-z0-9_]+)*/g) || []).length;
  const words = cjk + latinWords;
  const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  // 近似：CJK 约 1.4 token/字，拉丁词约 1.3 token/词；仅用于预算，不是计费口径。
  const approxTokens = Math.ceil(cjk * 1.4 + latinWords * 1.3);
  return { chars: text.length, cjk, latin_words: latinWords, words, lines, approx_tokens: approxTokens };
}

async function readOutput(handle) {
  const read = (reader) => {
    if (!reader) return '';
    try {
      return reader.readFrom(0).text;
    } catch {
      return '';
    }
  };
  const outcome = await handle.done;
  return {
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    stdout: read(handle.collected.stdout),
    stderr: read(handle.collected.stderr),
  };
}

async function runArgv(ctx, run, argv, timeoutMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('命令超时')), Math.max(1_000, Math.min(timeoutMs, 120_000)));
  const forward = () => controller.abort(signal.reason);
  signal.addEventListener('abort', forward, { once: true });
  try {
    const handle = ctx.subprocess.spawn({
      argv,
      cwd: run.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 131_072, spill: { maxBytes: 2_097_152 } },
        stderr: { maxBytes: 65_536 },
      },
      graceMs: 2_000,
      signal: controller.signal,
    });
    try {
      return await readOutput(handle);
    } catch (error) {
      handle.terminate();
      throw error;
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forward);
  }
}

async function runCommand(ctx, run, command, timeoutMs, signal) {
  const environment = await ctx.subprocess.terminalEnvironment(signal);
  const windows = environment.platform === 'windows';
  const argv = windows
    ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command]
    : ['/bin/sh', '-lc', command];
  return runArgv(ctx, run, argv, timeoutMs, signal);
}

const SCAN_RULES = [
  { id: 'eval', severity: 'high', pattern: /\beval\s*\(/, message: '动态执行 eval()' },
  { id: 'exec', severity: 'high', pattern: /\bexec\s*\(/, message: '动态执行 exec()' },
  { id: 'shell', severity: 'high', pattern: /(?:child_process|subprocess|os\.system|shell=True)/, message: '子进程 / Shell 调用' },
  { id: 'secret', severity: 'high', pattern: /(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/, message: '疑似硬编码密钥' },
  { id: 'password', severity: 'medium', pattern: /(?:password|passwd|secret)\s*[:=]\s*['"][^'"]+['"]/i, message: '疑似硬编码口令' },
  { id: 'html', severity: 'medium', pattern: /\.innerHTML\s*=/, message: '直接写入 innerHTML' },
  { id: 'pickle', severity: 'high', pattern: /pickle\.loads?\s*\(/, message: '不安全的 pickle 反序列化' },
];

async function collectFiles(ctx, target, files, depth = 0) {
  if (files.length >= MAX_SCAN_FILES || depth > 6) return;
  const info = await ctx.fs.stat(target);
  if (!info) return;
  if (info.type === 'file') {
    files.push(target);
    return;
  }
  if (info.type !== 'directory') return;
  const entries = await ctx.fs.listDir(target);
  for (const entry of entries) {
    if (files.length >= MAX_SCAN_FILES) break;
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '__pycache__') continue;
    await collectFiles(ctx, entry.target, files, depth + 1);
  }
}

export function createMinistryTools(ctx, run, role) {
  const tools = [];

  if (role === 'works') {
    tools.push(
      defineTool(
        'tang_works_write',
        '工部：在工作区内写入 UTF-8 文件。会触发 DSH 审批；路径越界会被拒绝。',
        {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对工作区的文件路径' },
            content: { type: 'string', description: '完整文件内容' },
            reason: { type: 'string', description: '为什么要写这个文件' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
        async (args, exec) => {
          const root = await ctx.fs.resolve(run.cwd);
          const target = await resolveInside(ctx, run, args.path);
          const relativePath = relative(ctx.fs.processPath(root), ctx.fs.processPath(target)).replace(/\\/g, '/');
          const scratch = isScratchPath(relativePath);
          if (!scratch) {
            await approve(ctx, run, exec, 'tang_works_write', `工部拟写入 ${target.displayPath}：${args.reason || '交付物'}`);
          }
          try {
            await mkdir(dirname(ctx.fs.processPath(target)), { recursive: true });
          } catch {
            /* 目录已存在或后端自行处理 */
          }
          const outcome = await ctx.fs.writeText(
            target,
            String(args.content),
            undefined,
            exec.signal,
            {
              mode: 'workspace-write',
              workspaceRoot: run.cwd,
              ...(exec.agent ? { sessionId: exec.agent.id } : {}),
            },
          );
          return {
            ok: true,
            path: target.displayPath,
            operation: outcome.operation,
            bytes: outcome.after.length,
            approval: scratch ? 'scratch-exempt (tang-artifacts/)' : 'allowed-once',
          };
        },
        { timeoutMs: 480_000 },
      ),
      defineTool(
        'tang_works_read',
        '工部：读取工作区内的 UTF-8 文件（只读，不需要审批）。',
        {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
        async (args) => readText(ctx, run, args.path),
        { concurrencySafe: true },
      ),
    );
  }

  if (role === 'war') {
    tools.push(
      defineTool(
        'tang_war_run',
        '兵部：在工作区执行一条终端命令（默认 30 秒超时）。会触发 DSH 审批。',
        {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的命令' },
            timeout_ms: { type: 'integer', description: '超时毫秒，最大 120000' },
          },
          required: ['command'],
          additionalProperties: false,
        },
        async (args, exec) => {
          const command = String(args.command);
          const safe = isSafeReadonlyCommand(command);
          if (!safe) {
            await approve(ctx, run, exec, 'tang_war_run', `兵部拟执行命令：${command}`);
          }
          const result = await runCommand(ctx, run, command, Number(args.timeout_ms) || 30_000, exec.signal);
          return { ...result, approval: safe ? 'safe-readonly' : 'allowed-once' };
        },
        { timeoutMs: 480_000 },
      ),
    );
  }

  if (role === 'justice') {
    tools.push(
      defineTool(
        'tang_justice_scan',
        '刑部：扫描工作区源码中的危险模式，并对 Python 文件运行 py_compile。只读，不需要审批。',
        {
          type: 'object',
          properties: {
            path: { type: 'string', description: '要扫描的文件或目录，默认 "."' },
          },
          additionalProperties: false,
        },
        async (args, exec) => {
          const target = await resolveInside(ctx, run, args.path || '.');
          const files = [];
          await collectFiles(ctx, target, files);
          const findings = [];
          const compile = [];
          for (const file of files) {
            if (!/\.(?:js|mjs|cjs|ts|tsx|jsx|py|json|md)$/i.test(file.displayPath)) continue;
            const info = await ctx.fs.stat(file);
            if (!info || (info.size ?? 0) > MAX_SCAN_BYTES) continue;
            const text = await ctx.fs.readText(file);
            const lines = text.split(/\r?\n/);
            lines.forEach((line, index) => {
              for (const rule of SCAN_RULES) {
                if (rule.pattern.test(line)) {
                  findings.push({
                    rule: rule.id,
                    severity: rule.severity,
                    file: file.displayPath,
                    line: index + 1,
                    message: rule.message,
                    excerpt: line.trim().slice(0, 200),
                  });
                }
              }
            });
            if (/\.py$/i.test(file.displayPath) && ctx.subprocess) {
              try {
                let python = 'python';
                try {
                  python = await ctx.subprocess.resolveExecutable('python', undefined, exec.signal);
                } catch {
                  /* 尝试裸名 */
                }
                const result = await runArgv(ctx, run, [python, '-B', '-m', 'py_compile', file.displayPath], 15_000, exec.signal);
                compile.push({ file: file.displayPath, exitCode: result.exitCode, stderr: result.stderr.slice(0, 500) });
              } catch (error) {
                compile.push({ file: file.displayPath, error: String(error.message || error) });
              }
            }
          }
          return {
            scanned: files.length,
            findings,
            compile,
            summary: findings.length === 0 ? '未发现危险模式。' : `发现 ${findings.length} 条可疑模式。`,
          };
        },
        { timeoutMs: 90_000, concurrencySafe: true },
      ),
    );
  }

  if (role === 'revenue') {
    tools.push(
      defineTool(
        'tang_revenue_count',
        '户部：统计一段文本或一个文件的字符数、词数与近似 Token 消耗。',
        {
          type: 'object',
          properties: {
            text: { type: 'string' },
            path: { type: 'string' },
          },
          additionalProperties: false,
        },
        async (args) => {
          if (typeof args.text === 'string' && args.text.length > 0) {
            return { source: 'text', ...countText(args.text) };
          }
          if (typeof args.path === 'string' && args.path.length > 0) {
            const file = await readText(ctx, run, args.path);
            return { source: file.path, truncated: file.truncated, ...countText(file.text) };
          }
          return countText(run.edict);
        },
        { concurrencySafe: true },
      ),
    );
  }

  if (role === 'personnel') {
    tools.push(
      defineTool(
        'tang_personnel_tools',
        '吏部：列出当前子 Agent 实际可见的工具（名称与描述）。',
        { type: 'object', properties: {}, additionalProperties: false },
        async (_args, exec) => {
          const schemas = ctx.tools.schemas(exec.agent);
          return {
            count: schemas.length,
            tools: schemas.map((schema) => ({ name: schema.name, description: schema.description })),
          };
        },
        { concurrencySafe: true },
      ),
    );
  }

  if (role === 'rites') {
    tools.push(
      defineTool(
        'tang_rites_doc',
        '礼部：读取一份文档并提取标题、行数与摘要，用于撰写 README / 告示。',
        {
          type: 'object',
          properties: {
            path: { type: 'string' },
            max_chars: { type: 'integer' },
          },
          required: ['path'],
          additionalProperties: false,
        },
        async (args) => {
          const file = await readText(ctx, run, args.path);
          const headings = file.text
            .split(/\r?\n/)
            .filter((line) => /^#{1,4}\s+/.test(line))
            .slice(0, 20);
          const max = Math.max(500, Math.min(Number(args.max_chars) || 4000, 20_000));
          return {
            path: file.path,
            lines: file.text.split(/\r?\n/).length,
            headings,
            excerpt: file.text.slice(0, max),
            truncated: file.truncated,
          };
        },
        { concurrencySafe: true },
      ),
    );
  }

  if (role === 'qintianjian') {
    tools.push(
      defineTool(
        'tang_qintian_probe',
        '钦天监：探测当前 Host 的 Service 与工具面，确认方案所需能力是否真的存在。',
        { type: 'object', properties: {}, additionalProperties: false },
        async (_args, exec) => {
          const services = {};
          for (const name of ['fs', 'subprocess', 'approval', 'storage', 'storageDomain', 'webServer', 'agents', 'subagents', 'llm']) {
            services[name] = ctx.get(name) !== undefined;
          }
          const tools = ctx.tools.schemas(exec.agent).map((schema) => schema.name);
          let providers = [];
          try {
            providers = ctx.subagents ? ctx.subagents.list() : [];
          } catch {
            providers = [];
          }
          return { services, tools, planned_tools: MINISTRY_TOOL_NAMES, providers };
        },
        { concurrencySafe: true },
      ),
    );
  }

  return tools;
}

export const MINISTRY_TOOL_NAMES = {
  works: ['tang_works_write', 'tang_works_read'],
  war: ['tang_war_run'],
  justice: ['tang_justice_scan'],
  revenue: ['tang_revenue_count'],
  personnel: ['tang_personnel_tools'],
  rites: ['tang_rites_doc'],
  qintianjian: ['tang_qintian_probe'],
  zhongshu: [],
  menxia: [],
  shangshu: [],
};

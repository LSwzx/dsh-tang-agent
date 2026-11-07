/**
 * dsh-tang-agent · Host HTTP / SSE 接口
 *
 * 客户端的“下旨”按钮、运行快照、真实事件流和取消操作都走这里。
 * 只允许 loopback + x-tang-ui 的 POST；SSE 为只读，允许 loopback 直接连接。
 */

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function loopback(req) {
  const address = req.socket?.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function requireUi(req, res) {
  if (!loopback(req) || req.headers['x-tang-ui'] !== '1') {
    json(res, 403, { error: '仅允许本地 DSH 界面调用。' });
    return false;
  }
  return true;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('请求体过大。');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function registerRoutes(ctx, orchestrator) {
  const web = ctx.get ? ctx.get('webServer') : undefined;
  if (!web || typeof web.register !== 'function') {
    return () => {};
  }

  return web.register({
    kind: 'prefix',
    path: '/api/tang',
    async handler(req, res) {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        const path = url.pathname.replace(/\/+$/, '');
        const method = (req.method || 'GET').toUpperCase();

        if (method === 'GET' && path === '/api/tang/health') {
          return json(res, 200, {
            ok: true,
            mode: 'real-agents',
            services: {
              agents: ctx.get('agents') !== undefined,
              subagents: ctx.get('subagents') !== undefined,
              fs: ctx.get('fs') !== undefined,
              subprocess: ctx.get('subprocess') !== undefined,
              approval: ctx.get('approval') !== undefined,
              webServer: true,
            },
            runCount: orchestrator.list().length,
          });
        }

        if (method === 'POST' && path === '/api/tang/run') {
          if (!requireUi(req, res)) return;
          const body = await readJson(req);
          const id = await orchestrator.start(body.edict, {
            mode: body.mode,
            maxRejections: body.maxRejections,
            ministry: body.ministry,
          });
          return json(res, 202, { runId: id });
        }

        if (method === 'GET' && path === '/api/tang/runs') {
          return json(
            res,
            200,
            orchestrator.list().map((run) => ({
              id: run.id,
              edict: run.edict,
              mode: run.mode,
              phase: run.phase,
              status: run.status,
              agentCount: run.agentCount,
              createdAt: run.createdAt,
              summary: run.summary || '',
            })),
          );
        }

        const streamMatch = path.match(/^\/api\/tang\/runs\/([^/]+)\/stream$/);
        if (method === 'GET' && streamMatch) {
          if (!loopback(req)) return json(res, 403, { error: '仅允许本地事件流。' });
          const run = orchestrator.get(decodeURIComponent(streamMatch[1]));
          if (!run) return json(res, 404, { error: 'run 不存在。' });
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          });
          const write = (payload) => {
            if (!res.writableEnded) res.write(`data: ${payload}\n\n`);
          };
          write(JSON.stringify(run));
          const unsubscribe = orchestrator.subscribe(run.id, write);
          const ping = setInterval(() => {
            if (!res.writableEnded) res.write(': ping\n\n');
          }, 15_000);
          req.on('close', () => {
            clearInterval(ping);
            unsubscribe();
            if (!res.writableEnded) res.end();
          });
          return;
        }

        const cancelMatch = path.match(/^\/api\/tang\/runs\/([^/]+)\/cancel$/);
        if (method === 'POST' && cancelMatch) {
          if (!requireUi(req, res)) return;
          const run = orchestrator.cancel(decodeURIComponent(cancelMatch[1]));
          if (!run) return json(res, 404, { error: 'run 不存在。' });
          return json(res, 200, run);
        }

        const runMatch = path.match(/^\/api\/tang\/runs\/([^/]+)$/);
        if (method === 'GET' && runMatch) {
          const run = orchestrator.get(decodeURIComponent(runMatch[1]));
          if (!run) return json(res, 404, { error: 'run 不存在。' });
          return json(res, 200, run);
        }

        return json(res, 404, { error: '未知的 tang API。' });
      } catch (error) {
        return json(res, 500, { error: String(error?.message || error) });
      }
    },
  });
}

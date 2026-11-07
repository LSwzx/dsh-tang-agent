/**
 * dsh-tang-agent · 运行记录持久化
 *
 * 优先使用 DSH Storage 的 kv form；若当前组合没有挂载 kv form，则回退到
 * DSH_HOME 下的 JSON 文件。刷新页面或重启 Host 后，历史 run 仍可恢复。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

export class RunStore {
  constructor(ctx) {
    this.ctx = ctx;
    this.unit = undefined;
    this.runs = {};
    this.file = undefined;
    this.queue = Promise.resolve();
    this.mode = 'memory';
  }

  async init() {
    const storage = this.ctx.get ? this.ctx.get('storage') : undefined;
    if (storage && typeof storage.form === 'function') {
      try {
        const kv = storage.form('kv');
        if (kv && typeof kv.open === 'function') {
          this.unit = await kv.open({
            name: 'tang-dynasty-agents',
            version: 1,
            tables: ['runs'],
            hasGlobal: false,
            layout: 'per-record',
          });
          const loaded = await this.unit.loadAll();
          this.runs = loaded.tables && loaded.tables.runs ? loaded.tables.runs : {};
          this.mode = 'dsh-storage';
          this.markStale();
          return;
        }
      } catch (error) {
        this.mode = 'fs-fallback';
      }
    }

    const home = process.env.DSH_HOME || join(homedir(), '.dsh');
    this.file = join(home, 'tang-dynasty-agents', 'runs.json');
    try {
      this.runs = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      this.runs = {};
    }
    this.mode = this.mode === 'fs-fallback' ? 'fs-fallback' : 'fs';
    this.markStale();
  }

  /** Host 重启/崩溃后，遗留的 running 记录不再有控制器，标记为中断，避免 UI 永久卡住。 */
  markStale() {
    const stamp = new Date().toISOString();
    for (const run of Object.values(this.runs)) {
      if (run && run.status === 'running') {
        run.status = 'failed';
        run.phase = 'failed';
        run.error = 'Host 重启或进程中断：该 run 已无控制器。';
        run.finishedAt = stamp;
        run.updatedAt = stamp;
      }
    }
  }

  async save(run) {
    if (!run || !run.id) return;
    const payload = plain(run);
    this.runs[run.id] = payload;
    if (this.unit) {
      this.queue = this.queue
        .then(() => this.unit.putRecord('runs', run.id, payload))
        .catch(() => undefined);
      return this.queue;
    }
    this.queue = this.queue
      .then(async () => {
        if (!this.file) return;
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(this.file, JSON.stringify(this.runs, null, 2), 'utf8');
      })
      .catch(() => undefined);
    return this.queue;
  }

  list() {
    return Object.values(this.runs).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  get(id) {
    return this.runs[id];
  }

  async close() {
    if (this.unit && typeof this.unit.close === 'function') {
      try {
        await this.unit.close();
      } catch {
        /* idempotent */
      }
    }
    this.unit = undefined;
  }
}

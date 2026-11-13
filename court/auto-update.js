/**
 * 可选自动更新：只对 npm 安装的 bundle 生效。
 *
 * 本地 link/file 安装不会自动更新，避免开发目录被 npm 版本覆盖。
 * 更新走 DSH pluginManager.updateBundle()，由 DSH 自己完成卸载/安装/重启。
 */

import { randomUUID } from 'node:crypto';

const PACKAGE = 'dsh-tang-agent';

function isRegistryInstall(bundle) {
  if (!bundle || !bundle.installed || !bundle.updatable) return false;
  const source = String(bundle.source || '');
  return !/^(?:link:|file:|git\+|https?:)/i.test(source);
}

export function startAutoUpdate(ctx, options = {}) {
  if (options.autoUpdate === false) return () => {};
  const delay = Math.max(5_000, Number(options.autoUpdateDelayMs) || 15_000);
  let stopped = false;
  let timer;

  const check = async () => {
    if (stopped) return;
    try {
      const manager = ctx.get ? ctx.get('pluginManager') : undefined;
      if (!manager || typeof manager.listBundles !== 'function' || typeof manager.listVersions !== 'function') return;
      if (typeof manager.updateBundle !== 'function') return;
      const bundles = await manager.listBundles();
      const self = bundles.find((bundle) => bundle.name === PACKAGE);
      if (!isRegistryInstall(self)) return;
      const result = await manager.listVersions(PACKAGE, { registry: options.registry });
      if (!result || result.status !== 'listed' || !Array.isArray(result.versions)) return;
      const latest = result.versions.find((version) => !version.prerelease && !version.incompatible);
      if (!latest || latest.version === result.installed) return;
      await manager.updateBundle(PACKAGE, latest.version, {
        registry: result.registry,
        requestId: randomUUID(),
      });
    } catch {
      // 自动更新失败不能影响朝议主流程；下次启动再试。
    }
  };

  timer = setTimeout(() => void check(), delay);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

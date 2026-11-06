/**
 * Client 模块装配检查（无浏览器）：
 * 1) client.js 能被 __ModuleLoader__ 加载；
 * 2) factory 返回 { inject, apply }；
 * 3) apply 只注册 sidebar.panellist(tang) 与 main(tang)；
 * 4) 用最小 React 运行时真正执行面板组件树（idle / completed / escalated），
 *    提前暴露空引用、字段缺失与渲染期异常。
 *
 * 这不是视觉验证，但能覆盖安装前能静态发现的问题。
 * 用法：node scripts/check-client.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { runAll } from '../engine.js';

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

let hookState = [];
let hookIndex = 0;
const resetHooks = () => {
  hookState = [];
  hookIndex = 0;
};

const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: Object.assign({}, props, { children }),
  }),
  useState(initial) {
    const index = hookIndex;
    hookIndex += 1;
    if (!(index in hookState)) {
      hookState[index] = typeof initial === 'function' ? initial() : initial;
    }
    return [
      hookState[index],
      (next) => {
        hookState[index] = typeof next === 'function' ? next(hookState[index]) : next;
      },
    ];
  },
  useEffect() {},
  useRef() {
    const index = hookIndex;
    hookIndex += 1;
    if (!(index in hookState)) hookState[index] = { current: null };
    return hookState[index];
  },
};

const sandbox = { window: {}, console, navigator: {} };
sandbox.window.__ModuleLoader__ = {
  load(definition) {
    sandbox.__definition = definition;
  },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });

const definition = sandbox.__definition;
assert.ok(definition, 'client.js did not call __ModuleLoader__.load');
assert.equal(definition.id, 'tang-dynasty-agents');
assert.equal(typeof definition.factory, 'function');

const module = definition.factory((name) => {
  assert.equal(name, 'react');
  return React;
});
assert.ok(Array.isArray(module.inject), 'factory must return inject');
assert.equal(typeof module.apply, 'function', 'factory must return apply');

const injected = [];
const registrations = [];
const ctx = {
  get: () => undefined,
  effect: (callback) => callback(),
  slots: {
    inject(slotName, callback) {
      injected.push(slotName);
      callback();
    },
    register(spec, component) {
      registrations.push({
        slot: spec.name,
        key: spec.id || spec.key,
        component,
      });
    },
  },
};
module.apply(ctx);

assert.deepEqual(injected, ['sidebar.panellist', 'main']);
assert.deepEqual(
  registrations.map((entry) => [entry.slot, entry.key, typeof entry.component]),
  [
    ['sidebar.panellist', 'tang', 'function'],
    ['main', 'tang', 'function'],
  ],
);

/** 递归展开函数组件，得到一棵由字符串与宿主元素组成的树。 */
function renderNode(node) {
  if (Array.isArray(node)) return node.map(renderNode);
  if (node === null || node === undefined) return node;
  if (typeof node !== 'object') return node;
  if (typeof node.type === 'function') {
    resetHooks();
    return renderNode(node.type(node.props || {}));
  }
  return {
    type: node.type,
    props: Object.assign({}, node.props, {
      children: renderNode(node.props ? node.props.children : []),
    }),
  };
}

function collectText(node, sink) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, sink));
    return;
  }
  if (node === null || node === undefined) return;
  if (typeof node === 'string' || typeof node === 'number') {
    sink.push(String(node));
    return;
  }
  if (typeof node === 'object' && node.props) {
    collectText(node.props.children, sink);
  }
}

function renderPanel(panel, props) {
  resetHooks();
  const tree = renderNode(React.createElement(panel, props || {}));
  const text = [];
  collectText(tree, text);
  return text.join(' ');
}

const sidebar = registrations[0].component;
const panel = registrations[1].component;

const iconText = renderPanel(sidebar, { size: 22, active: true });
assert.ok(iconText.includes('唐'), 'sidebar icon must render the 唐 seal');

const idle = renderPanel(panel, {});
assert.ok(idle.includes('Tang-Dynasty-Agents'));
assert.ok(idle.includes('丹墀静候'), 'idle panel should show the empty state');
assert.ok(idle.includes('工部') && idle.includes('吏部'), 'idle panel should preview six ministries');

const EDICT = '着工部于三月内修缮东市水渠，户部拨钱粮，刑部核验工料，吏部考成，礼部告示百姓。';
const completed = renderPanel(panel, { initialState: runAll(EDICT) });
assert.ok(completed.includes('六部覆命'), 'completed panel should show the completion banner');
assert.ok(completed.includes('准奏'), 'completed panel should show the approval verdict');
assert.ok(completed.includes('预算'), 'completed panel should show ministry metrics');

const escalated = renderPanel(panel, { initialState: runAll(EDICT, { forceReject: true }) });
assert.ok(escalated.includes('封还'), 'escalated panel should show the return-to-throne banner');
assert.ok(escalated.includes('连驳 3 次'), 'escalated panel should explain the deadlock guard');

process.stdout.write(
  'client ok: module loads, inject=[slots], registrations=[sidebar.panellist/tang, main/tang], renders idle/completed/escalated\n',
);

/**
 * Client 装配检查（无浏览器）：
 * 1) client.js 能被 __ModuleLoader__ 加载；
 * 2) factory 返回 { inject, apply }；
 * 3) apply 注册 sidebar.panellist(tang) 与 main(tang)；
 * 4) 用最小 React 运行时执行真实面板的 idle 渲染，确认标题与结构无空引用。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
let hookState = [];
let hookIndex = 0;
const resetHooks = () => {
  hookState = [];
  hookIndex = 0;
};

const React = {
  createElement: (type, props, ...children) => ({ type, props: Object.assign({}, props, { children }) }),
  useState(initial) {
    const index = hookIndex;
    hookIndex += 1;
    if (!(index in hookState)) hookState[index] = typeof initial === 'function' ? initial() : initial;
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
assert.equal(definition.id, 'dsh-tang-agent');
const module = definition.factory((name) => {
  assert.equal(name, 'react');
  return React;
});
assert.equal(module.inject.join(','), 'slots');

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
        label: typeof spec.label === 'function' ? spec.label() : spec.label,
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
assert.equal(registrations[0].label, '三省六部工作流');

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
    props: Object.assign({}, node.props, { children: renderNode(node.props ? node.props.children : []) }),
  };
}

function collectText(node, sink) {
  if (Array.isArray(node)) return node.forEach((child) => collectText(child, sink));
  if (node === null || node === undefined) return;
  if (typeof node === 'string' || typeof node === 'number') return sink.push(String(node));
  if (typeof node === 'object' && node.props) collectText(node.props.children, sink);
}

resetHooks();
const tree = renderNode(React.createElement(registrations[1].component, {}));
const text = [];
collectText(tree, text);
const joined = text.join(' ');
assert.ok(joined.includes('三省六部工作流'), 'panel should show the workflow title');
assert.ok(joined.includes('REAL'), 'panel should show the REAL badge');
assert.ok(joined.includes('丹墀静候'), 'panel should show the idle state');

process.stdout.write('client ok: module loads, registrations=[sidebar.panellist/tang, main/tang], idle render ok\n');

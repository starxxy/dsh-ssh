/**
 * Integration test for the dual-surface panel logic in lib/client.js:
 *  - native surface (no dsh-better-sidebar, or panelSurface=native): the
 *    details column + right-edge rail are used;
 *  - sidebar surface (dsh-better-sidebar present, panelSurface auto/sidebar):
 *    the panel registers as a sidebar tab, the rail is dropped, and the
 *    AI-connect auto-open lands in the sidebar via openTab.
 *
 * Self-contained: stubs window/document/WebSocket/React and drives the real
 * client bundle with a mock Cordis context. No live server required.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------------------------------------------------------------------------
// Browser stubs
// ---------------------------------------------------------------------------

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  Fragment: Symbol('Fragment'),
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useSyncExternalStore: (sub, get) => get(),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
};
const primitives = { StateDot: () => null, RiskConfirmation: () => null };

let wsInstance = null;
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    wsInstance = this;
    queueMicrotask(() => {
      this.readyState = 1;
      if (this.onopen) this.onopen();
    });
  }
  send(data) {
    const message = JSON.parse(String(data));
    if (message.method === 'snapshot') {
      queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id: message.id, result: serverSnapshot }) }));
      return;
    }
    if (message.method === 'closeTab') {
      queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id: message.id, result: { ok: true } }) }));
      return;
    }
    queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id: message.id, result: { ok: true } }) }));
  }
  close() { this.readyState = 3; }
}

function makeWindow() {
  return {
    location: { protocol: 'ws:', host: '127.0.0.1:3080' },
    __dshSshEvents: [],
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1400,
    innerHeight: 900,
  };
}
const documentStub = {
  querySelector: () => null,
  createElement: (tag) => ({ tag, style: {}, dataset: {}, appendChild() {}, remove() {} }),
  head: { appendChild() {} },
  body: { setAttribute() {}, removeAttribute() {} },
};

// ---------------------------------------------------------------------------
// Scenario harness
// ---------------------------------------------------------------------------

async function runScenario({ name, sidebar, surface, autoConnect }) {
  serverSnapshot = { records: [], tabs: [], panelSurface: surface };
  const slotState = { registered: new Map() };
  const calls = { openTab: [], layout: [] };
  const sidebarCalls = [];
  const stateSubs = [];

  const sidebarService = sidebar ? {
    registerTab: (descriptor) => {
      sidebarCalls.push({ kind: 'registerTab', id: descriptor.id });
      return () => sidebarCalls.push({ kind: 'disposeTab', id: descriptor.id });
    },
    subscribeState: (fn) => { stateSubs.push(fn); return () => {}; },
    getSnapshot: () => ({ sessionId: 'sess-1', state: {
      panelOpen: true, splits: { kind: 'leaf', id: 'l1', tabs: [], active: null },
      bottomSplits: { kind: 'leaf', id: 'l2', tabs: [], active: null }, floats: [],
    }, prefs: {} }),
    openTab: (seed, scope) => calls.openTab.push({ seed, scope }),
  } : undefined;

  const effects = [];
  const childEffect = (fn, label) => { const d = fn(); if (d) effects.push(d); };
  const ctxEffect = (fn, label) => { const d = fn(); if (d) effects.push(d); };

  const slotsInject = [];
  const slots = {
    inject: (slotName, cb) => {
      slotsInject.push(slotName);
      return cb();
    },
    register: (spec, comp) => {
      const key = `${spec.name}:${spec.id ?? ''}`;
      slotState.registered.set(key, { spec, comp });
      return () => slotState.registered.delete(key);
    },
  };
  const layout = {
    openDetails: () => calls.layout.push('open'),
    closeDetails: () => calls.layout.push('close'),
  };

  const ctx = {
    effect: ctxEffect,
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
      subscribe: () => () => {},
      getSnapshot: () => ({ active: 'en' }),
    },
    slots,
    layout,
    get: (name) => {
      if (name === 'layout') return layout;
      if (name === 'betterSidebar') return sidebarService;
      return undefined;
    },
    inject: (deps, cb) => {
      // Simulate Cordis: the child fiber activates only when a provider
      // for every declared service exists in the composition.
      if (deps.includes('betterSidebar') && sidebarService !== undefined) {
        const childCtx = {
          get: (name) => (name === 'betterSidebar' ? sidebarService : undefined),
          effect: childEffect,
        };
        cb(childCtx);
      }
      return Promise.resolve({});
    },
  };

  // Load the real client bundle in a fresh context.
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const win = makeWindow();
  const captured = [];
  win.__ModuleLoader__ = { load: (spec) => captured.push(spec) };
  const requireStub = (mod) => {
    if (mod === 'react') return React;
    if (mod === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error(`unexpected require: ${mod}`);
  };
  const sandbox = {
    window: win,
    document: documentStub,
    WebSocket: FakeWebSocket,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    JSON,
    Math,
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  check(`${name}: bundle loaded`, captured.length === 1);
  const plugin = captured[0].factory(requireStub);
  check(`${name}: apply available`, typeof plugin.apply === 'function');
  const apply = plugin.apply;

  apply(ctx);
  await new Promise((resolve) => setTimeout(resolve, 30)); // snapshot round-trip

  // Simulate the AI connecting: a new tab appears in a state frame.
  if (autoConnect) {
    wsInstance.onmessage({ data: JSON.stringify({ event: 'state', state: {
      records: [],
      tabs: [{ key: 'box', name: 'box', status: 'connected' }],
      panelSurface: surface,
    } }) });
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  return { slotState, calls, sidebarCalls, stateSubs, sidebarService };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

let serverSnapshot = {};

const a = await runScenario({ name: 'A(native,no-sidebar)', sidebar: false, surface: 'auto', autoConnect: true });
check('A: rail registered', a.slotState.registered.has('shell.overlay:dsh-ssh-rail'));
check('A: details column registered on auto-open', a.slotState.registered.has('details:'));
check('A: no sidebar tab', a.sidebarCalls.length === 0);

const b = await runScenario({ name: 'B(sidebar,auto)', sidebar: true, surface: 'auto', autoConnect: true });
check('B: sidebar tab registered', b.sidebarCalls.some((c) => c.kind === 'registerTab' && c.id === 'dsh-ssh:terminal'));
check('B: rail NOT registered', !b.slotState.registered.has('shell.overlay:dsh-ssh-rail'));
check('B: details column NOT registered', ![...b.slotState.registered.keys()].some((k) => k.startsWith('details:')));
check('B: auto-open opened the sidebar tab', b.calls.openTab.some((c) => c.seed.type === 'dsh-ssh:terminal' && c.seed.path === 'ssh'));

const c = await runScenario({ name: 'C(sidebar,native-forced)', sidebar: true, surface: 'native', autoConnect: true });
check('C: rail registered (forced native)', c.slotState.registered.has('shell.overlay:dsh-ssh-rail'));
check('C: details column registered', c.slotState.registered.has('details:'));
check('C: sidebar tab registered but unused', c.sidebarCalls.some((x) => x.kind === 'registerTab'));
check('C: auto-open did NOT use the sidebar', c.calls.openTab.length === 0);

// D: the consistency watcher (user closed our tab → drop the panelOpen
// flag) must be wired to the sidebar state stream.
const d = await runScenario({ name: 'D(sidebar,watcher)', sidebar: true, surface: 'auto', autoConnect: true });
check('D: sidebar state watcher registered', d.stateSubs.length >= 1);
check('D: auto-open opened the sidebar tab', d.calls.openTab.some((x) => x.seed.type === 'dsh-ssh:terminal'));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);

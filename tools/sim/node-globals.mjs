// Browser globals the game touches at import time, for scripts that import the bundled game directly (same stand-ins as worker.mjs).
const g = globalThis;
const mem = new Map();
g.window ??= g;
g.localStorage ??= {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k), clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
g.location ??= { search: '', href: 'http://sim.local/', hostname: 'sim.local' };
g.requestAnimationFrame ??= () => 0;
g.cancelAnimationFrame ??= () => {};
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {}, setAttribute() {}, getContext: () => null });
g.document ??= { createElement: el, body: el(), documentElement: el(), addEventListener() {}, removeEventListener() {}, hidden: false, querySelector: () => null, getElementById: () => null };

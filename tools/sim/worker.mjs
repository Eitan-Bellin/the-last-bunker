// One simulation run in its own thread (fresh module state per seed: the bus and id counters are module-level).
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

// Only what the browser has and Node lacks; the game systems themselves don't need any of it.
const g = globalThis;
const memStore = new Map();
g.window ??= g;
g.localStorage ??= {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null), setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k), clear: () => memStore.clear(), key: i => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size; },
};
g.location ??= { search: '', href: 'http://sim.local/', hostname: 'sim.local' };
g.requestAnimationFrame ??= () => 0;
g.cancelAnimationFrame ??= () => {};
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {}, setAttribute() {}, getContext: () => null });
g.document ??= { createElement: el, body: el(), documentElement: el(), addEventListener() {}, removeEventListener() {}, hidden: false, querySelector: () => null, getElementById: () => null };
try { g.navigator ??= { userAgent: 'node-sim', language: 'en' }; } catch { /* read-only in newer Node */ }

const { bundle, opts } = workerData;
try {
  const mod = await import(pathToFileURL(bundle).href);
  let last = 0;
  const res = await mod.runSim({
    ...opts,
    onProgress: (f, label) => {
      if (f - last >= 0.1 || f >= 1) { last = f; parentPort.postMessage({ type: 'progress', seed: opts.seed, f, label }); }
    },
  });
  parentPort.postMessage({ type: 'done', res });
} catch (err) {
  parentPort.postMessage({ type: 'error', seed: opts.seed, err: String(err?.stack ?? err) });
}

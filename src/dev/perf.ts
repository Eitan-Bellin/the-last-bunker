/**
 * Performance probe (plan 2026-10, Q10): `?perf` shows a small overlay, and `__perf2()` returns the same numbers as JSON for the
 * automatic checks in tools/perf/. Loaded only with ?perf / ?debug / dev builds, so a normal session pays nothing for it.
 *
 * What it counts (all deterministic enough to gate a build on, unlike milliseconds):
 *  - draw calls per picture (the GL draw functions are wrapped while the probe is on),
 *  - objects the scene tree sends to the GPU (visible renderables) and in total,
 *  - how often each render group had to rebuild its instruction list (`structureDidChange`), the cost Pixi hides,
 *  - texture memory, JS heap, long tasks, and how busy the main thread is (picture + simulation ticks per wall second).
 */
import type { BunkerRenderer } from '../rendering/BunkerRenderer';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- this file pokes at Pixi and engine internals on purpose

interface GroupStat { label: string; objects: number; frames: number; changed: number }

/** One recorded picture. */
interface Sample { t: number; update: number; draw: number; total: number; calls: number }

const SAMPLE_EVERY = 20; // the scene walk is not free: count objects and groups on every 20th picture only
const MAX_SAMPLES = 4000;

export interface PerfReport {
  v: 1;
  quality: string;
  res: number;
  target: number;
  seconds: number;
  frames: number;
  fps: number;
  updateMsMed: number;
  updateMsP95: number;
  drawMsMed: number;
  drawMsP95: number;
  frameMsMed: number;
  frameMsP95: number;
  intervalMed: number;
  intervalP95: number;
  /** Share of the wall clock spent in pictures and simulation ticks (a proxy for heat). */
  busyPct: number;
  tickMsAvg: number;
  drawCalls: number;
  renderablesDrawn: number;
  renderablesTotal: number;
  renderGroups: number;
  /** The worst share of pictures in which a render group of more than 500 objects had to rebuild its instruction list. */
  structureChangedPct: number;
  groups: { label: string; objects: number; changedPct: number }[];
  gpuTextureMB: number;
  gpuTextures: number;
  jsHeapMB: number;
  longTasks: number;
  longTaskMs: number;
  longTaskMax: number;
}

const pct = (a: number[], p: number): number => (a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2) : 0);

export function installPerf(renderer: BunkerRenderer, engine: Any, audio?: Any): void {
  const w = window as unknown as Record<string, unknown>;
  const R = renderer as Any;
  const app = R.app;
  const gl: WebGL2RenderingContext | undefined = app.renderer.gl;

  // --- draw calls -----------------------------------------------------------------------------------------------
  const cnt = { draw: 0 };
  if (gl && !(gl as Any).__perfWrapped) {
    (gl as Any).__perfWrapped = true;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
      const orig = (gl[fn] as Any).bind(gl);
      (gl as Any)[fn] = (...a: unknown[]) => { cnt.draw++; return orig(...a); };
    }
  }

  // --- samples --------------------------------------------------------------------------------------------------
  let samples: Sample[] = [];
  let groups = new Map<string, GroupStat>();
  let renderablesDrawn = 0, renderablesTotal = 0, groupCount = 0;
  let ticks = 0, tickMs = 0;
  let longTasks: number[] = [];
  let since = performance.now();
  let n = 0;

  try {
    new PerformanceObserver(list => { for (const e of list.getEntries()) longTasks.push(e.duration); }).observe({ entryTypes: ['longtask'] });
  } catch {
    // long tasks are not reported by this browser
  }

  const labelOf = (o: Any): string => (o === app.stage ? 'stage' : o.label && o.label !== 'Container' ? String(o.label) : 'group');
  const statFor = (label: string): GroupStat => {
    let st = groups.get(label);
    if (!st) groups.set(label, st = { label, objects: 0, frames: 0, changed: 0 });
    return st;
  };

  /** Walks the scene once: visible renderables per render group, the total, and the list of group roots. */
  const groupRoots: { stat: GroupStat; root: Any }[] = [];
  const scan = (): void => {
    let drawn = 0, total = 0;
    const counts = new Map<Any, number>(); // visible renderables per group root (several groups share a label: rooms)
    groupRoots.length = 0;
    const walk = (o: Any, visible: boolean, root: Any, stat: GroupStat | null): void => {
      total++;
      const vis = visible && o.visible && o.renderable !== false;
      if (vis && o.renderPipeId && o.renderPipeId !== 'container' && root) counts.set(root, (counts.get(root) ?? 0) + 1);
      if (vis && o.renderPipeId && o.renderPipeId !== 'container') drawn++;
      let r = root, s = stat;
      if (o === app.stage || o.isRenderGroup) {
        s = statFor(labelOf(o));
        r = o;
        groupRoots.push({ stat: s, root: o });
      }
      const kids = o.children;
      if (!kids) return;
      for (let i = 0; i < kids.length; i++) walk(kids[i], vis, r, s);
    };
    walk(app.stage, true, null, null);
    for (const g of groupRoots) g.stat.objects = Math.max(g.stat.objects, counts.get(g.root) ?? 0);
    renderablesDrawn = drawn;
    renderablesTotal = total;
    groupCount = groupRoots.length;
  };

  // --- hooks ----------------------------------------------------------------------------------------------------
  let calls0 = 0;
  R.perfHook = {
    beforeDraw: () => {
      calls0 = cnt.draw;
      // The rebuild flags are reset by the draw that follows: read them now. The scene walk itself runs on every 20th picture only.
      if (n % SAMPLE_EVERY === 0 || groupRoots.length === 0) scan();
      for (const g of groupRoots) {
        g.stat.frames++;
        if (g.root.renderGroup?.structureDidChange) g.stat.changed++;
      }
    },
    afterDraw: (t0: number, t1: number, t2: number) => {
      n++;
      if (samples.length < MAX_SAMPLES) samples.push({ t: t0, update: t1 - t0, draw: t2 - t1, total: t2 - t0, calls: cnt.draw - calls0 });
    },
  };

  // simulation ticks and the whole rendered frame (picture + HUD) as the main thread sees them
  if (engine) {
    const origTick = engine.tick?.bind(engine);
    if (origTick) engine.tick = () => { const t = performance.now(); try { return origTick(); } finally { tickMs += performance.now() - t; ticks++; } };
  }

  const reset = (): void => {
    samples = [];
    groups = new Map();
    longTasks = [];
    ticks = 0;
    tickMs = 0;
    n = 0;
    since = performance.now();
    groupRoots.length = 0;
  };

  const textureStats = (): { mb: number; count: number } => {
    const list: Any[] = app.renderer.texture.managedTextures ?? [];
    let bytes = 0, count = 0;
    for (const s of list) {
      if (!s) continue;
      count++;
      bytes += s.pixelWidth * s.pixelHeight * 4 * (s.autoGenerateMipmaps || s.mipLevelCount > 1 ? 1.333 : 1);
    }
    return { mb: Math.round(bytes / 1048576), count };
  };

  const report = (): PerfReport => {
    const seconds = (performance.now() - since) / 1000;
    const ms = (f: (s: Sample) => number) => samples.map(f).sort((a, b) => a - b);
    const upd = ms(s => s.update), drw = ms(s => s.draw), tot = ms(s => s.total);
    const dts: number[] = [];
    for (let i = 1; i < samples.length; i++) dts.push(samples[i].t - samples[i - 1].t);
    dts.sort((a, b) => a - b);
    const busy = samples.reduce((a, s) => a + s.total, 0) + tickMs;
    const gs = [...groups.values()].filter(g => g.frames > 0);
    const big = gs.filter(g => g.objects > 500);
    const tex = textureStats();
    const mem = (performance as Any).memory;
    const lt = longTasks.slice();
    return {
      v: 1,
      quality: R.postfx?.quality ?? '?',
      res: +app.renderer.resolution.toFixed(2),
      target: +(1000 / (R.frameTarget || 16.7)).toFixed(0),
      seconds: +seconds.toFixed(1),
      frames: samples.length,
      fps: +(samples.length / Math.max(0.001, seconds)).toFixed(1),
      updateMsMed: pct(upd, 0.5), updateMsP95: pct(upd, 0.95),
      drawMsMed: pct(drw, 0.5), drawMsP95: pct(drw, 0.95),
      frameMsMed: pct(tot, 0.5), frameMsP95: pct(tot, 0.95),
      intervalMed: pct(dts, 0.5), intervalP95: pct(dts, 0.95),
      busyPct: +((busy / Math.max(1, seconds * 1000)) * 100).toFixed(1),
      tickMsAvg: ticks ? +(tickMs / ticks).toFixed(2) : 0,
      drawCalls: samples.length ? Math.round(samples.reduce((a, s) => a + s.calls, 0) / samples.length) : 0,
      renderablesDrawn, renderablesTotal, renderGroups: groupCount,
      structureChangedPct: big.length ? +Math.max(...big.map(g => (g.changed / g.frames) * 100)).toFixed(1) : 0,
      groups: gs.sort((a, b) => b.changed / b.frames - a.changed / a.frames).slice(0, 14).map(g => ({ label: g.label, objects: g.objects, changedPct: +((g.changed / g.frames) * 100).toFixed(1) })),
      gpuTextureMB: tex.mb, gpuTextures: tex.count,
      jsHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : -1,
      longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, b) => a + b, 0)), longTaskMax: Math.round(Math.max(0, ...lt)),
    };
  };

  const perf2 = Object.assign(() => report(), { reset });
  w.__perf2 = perf2;
  w.__perfFixture = (floors = 24, people = 60) => buildFixture(engine, floors, people);
  reset();

  // --- overlay (?perf) ------------------------------------------------------------------------------------------
  if (new URLSearchParams(location.search).has('perf')) {
    const box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:99999;margin:0;padding:4px 6px;border-radius:6px;pointer-events:none;'
      + 'background:rgba(0,0,0,.72);color:#9fe9a8;font:10px/1.25 ui-monospace,Menlo,Consolas,monospace;white-space:pre;max-width:96vw;overflow:hidden';
    document.body.appendChild(box);
    window.setInterval(() => {
      const r = report();
      box.textContent = `${r.fps} fps (want ${r.target})  upd ${r.updateMsMed} + draw ${r.drawMsMed} ms (p95 ${r.frameMsP95})\n`
        + `calls ${r.drawCalls}  objs ${r.renderablesDrawn}/${r.renderablesTotal}  groups ${r.renderGroups}  rebuild ${r.structureChangedPct}%\n`
        + `tex ${r.gpuTextureMB} MB (${r.gpuTextures})  heap ${r.jsHeapMB} MB  busy ${r.busyPct}%  q ${r.quality} x${r.res}\n`
        + `long tasks ${r.longTasks} (${r.longTaskMs} ms, max ${r.longTaskMax})`
        + (audio?.debugState ? `\naudio ${audio.debugState}` : '');
      reset();
    }, 1000);
  }
}

/** A bunker of N full floors with M people, built through the game's own state (never saved: use a fresh profile or ?slot). */
function buildFixture(E: Any, floors: number, people: number): { buildings: number; people: number } {
  const sm = E.stateManager;
  const t2 = ['generator', 'workshop', 'canteen', 'laboratory', 'waterPurifier', 'trainingRoom', 'waterPump', 'medbay', 'radioTower', 'armory'];
  const t3 = ['quarters', 'farm', 'hydroponics', 'reactor', 'storage'];
  const pat = [[3, 3, 3, 3], [2, 2, 2, 3, 3], [3, 2, 2, 2, 3], [2, 3, 3, 2, 2], [2, 2, 2, 2, 2, 2]];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let id = 1000;
  const blds: Any[] = [];
  for (let f = 0; f < floors; f++) {
    let x = 0;
    for (const wd of pat[f % pat.length]) {
      const type = wd === 3 ? t3[Math.floor(rnd() * t3.length)] : t2[Math.floor(rnd() * t2.length)];
      blds.push({ id: `b_${id++}`, type, level: 1 + Math.floor(rnd() * 9), position: { x, y: 0, floor: f }, assignedSurvivorIds: [], constructionProgress: 10, constructionTotal: 10, isConstructing: false, specialization: null });
      x += wd;
    }
  }
  sm.applyDelta({ path: 'ruins', value: [] });
  sm.applyDelta({ path: 'currentFloors', value: floors });
  sm.applyDelta({ path: 'buildings', value: blds });
  for (let i = 0; i < people; i++) {
    const s = E.populationSystem.createSurvivor(E.rng);
    const b = blds[Math.floor(rnd() * blds.length)];
    s.assignedBuildingId = i % 3 === 0 ? null : b.id;
    if (i % 11 === 0) s.child = true;
    E.populationSystem.addSurvivor(sm, s);
  }
  return { buildings: blds.length, people: sm.state.survivors.length };
}

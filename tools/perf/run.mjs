// Performance runner and regression gate (plan 2026-10, 3-mobile-performance.md, section 5).
//
//   npm run build && node tools/perf/run.mjs --check                 # gate against tools/perf/budget.json
//   node tools/perf/run.mjs --dist <dir> --out base.json              # measure any build, write the numbers
//   node tools/perf/run.mjs --only f24-close-medium --throttle 4      # CPU x4 (a rough mid-range phone), information only
//   node tools/perf/run.mjs --shots store/plan-2026-10/perf-shots/after   # also save half-size screenshots per camera
//
// Gated (deterministic, independent of the machine): draw calls, objects drawn, render group rebuild share, GPU texture MB, JS allocation per
// picture, idle main-thread share, bundle size. Reported but never gating: milliseconds (they depend on the machine, so they are noisy).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { launch, phoneSetup, procMem, serve, sleep, waitFor } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true; };
const dist = path.resolve(arg('dist', path.join(root, 'dist')));
const budget = JSON.parse(fs.readFileSync(path.join(here, 'budget.json'), 'utf8'));
const only = arg('only', '') ? String(arg('only')).split(',') : null;
const throttle = +arg('throttle', 1);
const seconds = +arg('seconds', 6);
const shotsDir = arg('shots', '') ? path.resolve(String(arg('shots'))) : null;
const outFile = arg('out', '') ? path.resolve(String(arg('out'))) : null;
const check = !!arg('check', false);
const dpr = +arg('dpr', 2.75);

const gz = f => zlib.gzipSync(fs.readFileSync(f)).length;
/**
 * Script and style sizes of a build (gzipped, KB = 1024 bytes). `jsGzKB` is every .js file in assets/ (what a visitor downloads over time
 * and the service worker keeps); `initialJsGzKB` is what the first screen needs: the scripts named in index.html and everything they
 * import statically (plan 4 wave 3: string tables, the Bunker Book and the sound recipes are chunks fetched later). `chunks` lists each file.
 */
function bundleStats() {
  const dir = path.join(dist, 'assets');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const size = {};
  let js = 0, css = 0;
  for (const f of files) {
    if (f.endsWith('.js')) { size[f] = gz(path.join(dir, f)); js += size[f]; } else if (f.endsWith('.css')) css += gz(path.join(dir, f));
  }
  // Initial set: <script type=module src>, <link rel=modulepreload>, then static `import ... from "./x.js"` / `import "./x.js"` (dynamic import() has parentheses and is skipped).
  const initial = new Set();
  const queue = [];
  const html = fs.existsSync(path.join(dist, 'index.html')) ? fs.readFileSync(path.join(dist, 'index.html'), 'utf8') : '';
  for (const m of html.matchAll(/(?:src|href)="[^"]*?assets\/([^"]+\.js)"/g)) queue.push(m[1]);
  while (queue.length) {
    const f = queue.pop();
    if (initial.has(f) || !(f in size)) continue;
    initial.add(f);
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g)) queue.push(m[1]);
  }
  let init = 0;
  for (const f of initial) init += size[f];
  const kb = n => Math.round(n / 1024);
  const chunks = Object.fromEntries(Object.entries(size).sort((a, b) => b[1] - a[1]).map(([f, n]) => [f.replace(/-[\w-]{8}\.js$/, '.js'), { gzKB: Math.round(n / 102.4) / 10, initial: initial.has(f) }]));
  return { jsGzKB: kb(js), initialJsGzKB: kb(init), cssGzKB: kb(css), chunks };
}

const yMid = floors => Math.round(70 + Math.min(12, floors / 2) * 116);
const CAMERAS = { overview: [308, f => yMid(f), 1], close: [300, f => yMid(f), 2.5], far: [308, f => yMid(f), 0.55] };

async function runScenario(port, name, sc) {
  const c = await launch();
  try {
    await phoneSetup(c, { quality: sc.quality, throttle: 1, dpr });
    await c.send('HeapProfiler.enable');
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/?debug${sc.fixture ? `&perfFixture=${sc.fixture}` : ''}${arg("query", "")}` });
    if (!await waitFor(c, '!!(window.__engine && window.__renderer && window.__renderer.postfx && window.__perf2)')) throw new Error('game did not start');
    await sleep(1500);
    await c.evalJs(`window.__perfFixture(${sc.floors}, ${sc.people})`);
    // A fresh game opens with the intro, a difficulty sheet and era cards over the picture, and they pause the simulation: keep it
    // running like in play (the overlays are DOM only; shots hide them).
    await c.evalJs('setInterval(() => { __engine.paused = false; }, 200); true', false);
    const mode = sc.mode || 'active';
    // The player's touch is simulated by notifying the engine (no real input is needed): active = just touched, watch = a few seconds ago, idle = long ago.
    // moving = the camera is being dragged (the picture runs at its motion rate).
    const touch = mode === 'active' ? '__engine.notifyInteraction()' : mode === 'moving' ? '__engine.notifyInteraction(); __engine.noteCameraMotion()'
      : mode === 'watch' ? '__engine.lastInteraction = Date.now() - 6000' : '__engine.lastInteraction = 0';
    await c.evalJs(`window.__keep = setInterval(() => { ${touch} }, 100); true`, false);
    await sleep(9000);
    const [cx, cy, cz] = CAMERAS[sc.camera || 'overview'];
    await c.evalJs(`__renderer.devCamera(${cx}, ${typeof cy === 'function' ? cy(sc.floors) : cy}, ${cz}); true`, false);
    await sleep(2500);
    if (throttle > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await sleep(1500);
    // How fast this machine is right now (other programs share it): a fixed loop, in ms. Compare milliseconds only between runs with a similar value.
    const cal = await c.evalJs('(() => { const t = performance.now(); let x = 0; for (let i = 0; i < 2e7; i++) x += Math.sqrt(i); return Math.round(performance.now() - t) + (x < 0 ? 1 : 0); })()');
    await c.evalJs('__perf2.reset(); true', false);
    await sleep(seconds * 1000);
    const rep = await c.evalJs('__perf2()');
    rep.calMs = cal;
    // Allocation per picture: sample the heap while the scene runs for a few more seconds.
    await c.evalJs('__perf2.reset(); true', false);
    await c.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    await sleep(Math.max(4, seconds) * 1000);
    const rep2 = await c.evalJs('__perf2()');
    // Overdraw estimate (same method as src/dev/perf.ts, injected so that older builds without it can be measured too).
    const od = await c.evalJs(`(() => {
      const app = __renderer.app, sw = app.screen.width, sh = app.screen.height, byGroup = {}; let total = 0;
      const walk = (o, visible, label) => {
        const vis = visible && o.visible && o.renderable !== false && o.alpha !== 0; if (!vis) return;
        let lb = label; if (o.isRenderGroup && o !== app.stage) lb = o.label && o.label !== 'Container' ? String(o.label) : 'group';
        if (o.renderPipeId && o.renderPipeId !== 'container') { const b = o.getBounds();
          const w = Math.max(0, Math.min(b.x + b.width, sw) - Math.max(b.x, 0)), h = Math.max(0, Math.min(b.y + b.height, sh) - Math.max(b.y, 0));
          const a = (w * h) / (sw * sh); total += a; byGroup[lb] = (byGroup[lb] || 0) + a; }
        for (const ch of o.children || []) walk(ch, true, lb);
      };
      walk(app.stage, true, 'stage');
      for (const k of Object.keys(byGroup)) byGroup[k] = +byGroup[k].toFixed(2);
      return { factor: +total.toFixed(2), byGroup };
    })()`);
    rep.overdraw = od.factor;
    rep.overdrawBy = Object.entries(od.byGroup).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`);
    const { profile } = await c.send('HeapProfiler.stopSampling');
    let total = 0;
    const walk = n => { total += n.selfSize; for (const ch of n.children || []) walk(ch); };
    walk(profile.head);
    rep.allocKBPerFrame = rep2.frames ? Math.round(total / rep2.frames / 1024 * 10) / 10 : 0;
    if (throttle > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    rep.mem = procMem(c.dir);
    if (shotsDir) {
      fs.mkdirSync(shotsDir, { recursive: true });
      await sleep(600);
      // Freeze the clock so before/after shots are comparable (night 0 = day), then wait a moment for the picture to settle.
      await c.evalJs(`__renderer.setNight = () => {}; __renderer.nightNow = 0;
        const st = document.createElement('style'); st.textContent = 'body *{visibility:hidden !important} #game-canvas{visibility:visible !important}'; document.head.appendChild(st); true`, false);
      await sleep(1500);
      const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 360, height: 740, scale: +arg('shotscale', 0.5) } });
      fs.writeFileSync(path.join(shotsDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
    }
    const errs = c.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).length;
    rep.consoleErrors = errs;
    return rep;
  } finally { c.close(); }
}

/**
 * Audio start-up: after the first touch the game synthesizes its sounds. Reports when the first sounds are ready, when everything is,
 * the long main-thread tasks in the first 60 s (they freeze the picture), and how far the renderer process's memory climbed.
 */
async function runAudio(port, sc) {
  const c = await launch();
  try {
    await phoneSetup(c, { quality: 'medium', throttle: 1, dpr });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/?debug` });
    if (!await waitFor(c, '!!(window.__engine && window.__audio)')) throw new Error('game did not start');
    await sleep(2500);
    const th = sc.throttle || throttle;
    const before = procMem(c.dir);
    if (th > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: th });
    await c.evalJs(`window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(performance.now() - window.__t0), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] });
      window.__t0 = performance.now(); window.dispatchEvent(new PointerEvent('pointerdown')); true`, false);
    let readyMs = null, doneMs = null, peak = 0;
    for (let t = 0; t < 240000; t += 500) {
      await sleep(500);
      const s = await c.evalJs('({ st: __audio.debugState, ms: Math.round(performance.now() - window.__t0) })');
      const m = procMem(c.dir); if (m) peak = Math.max(peak, m.renderer);
      if (readyMs === null && (/ready=true/.test(s.st) || (/rendering=false/.test(s.st) && s.ms > 3000))) readyMs = s.ms;
      if (/rendering=false/.test(s.st) && s.ms > 3000) { doneMs = s.ms; break; }
    }
    // keep watching a little: background work after "ready" must not freeze the picture either
    await sleep(3000);
    const lt = await c.evalJs('window.__lt');
    const first60 = lt.filter(([at]) => at < 60000).map(x => x[1]);
    const after = procMem(c.dir);
    const builds = await c.evalJs('window.__audioStats ? window.__audioStats.builds : null');
    if (th > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    if (arg('verbose', false)) console.log('   long tasks (at ms, duration):', JSON.stringify(first60.length ? lt.slice(0, 80) : []), '\n   graph builds (ms):', JSON.stringify(builds));
    return { throttle: th, readyMs, doneMs, longTasks60: first60.length, longTaskMs60: first60.reduce((a, b) => a + b, 0), longTaskMax: Math.max(0, ...lt.map(x => x[1])),
      rendererMB: { before: before?.renderer, peak, after: after?.renderer }, peakGainMB: before ? peak - before.renderer : null };
  } finally { c.close(); }
}

/**
 * Coming back after a day away: the bunker is simulated 1,440 steps forward. Reports the longest freeze of the page (a long task) and
 * the total time. Builds without simulateSliced (older ones) run the simulation in one piece, which is what this measures against.
 */
async function runOffline(port, sc) {
  const c = await launch();
  try {
    await phoneSetup(c, { quality: 'medium', throttle: 1, dpr });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/?debug` });
    if (!await waitFor(c, '!!(window.__engine && window.__renderer && window.__perf2)')) throw new Error('game did not start');
    await sleep(1500);
    await c.evalJs(`window.__perfFixture(${sc.floors || 24}, ${sc.people || 60})`);
    await c.evalJs('setInterval(() => { __engine.paused = false; __engine.notifyInteraction(); }, 100); true', false);
    await sleep(5000);
    const th = sc.throttle || throttle;
    if (th > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: th });
    const r = await c.evalJs(`(async () => {
      const lt = []; const ob = new PerformanceObserver(l => { for (const e of l.getEntries()) lt.push(e.duration); }); ob.observe({ entryTypes: ['longtask'] });
      const sliced = typeof __engine.simulateSliced === 'function';
      const t0 = performance.now();
      let frames = 0; const raf = () => { frames++; requestAnimationFrame(raf); }; requestAnimationFrame(raf);
      // comeBack is what the game runs when the player returns after being away (it sets up everything around the simulation too).
      await Promise.resolve(__engine.comeBack(${sc.hours || 24} * 3600));
      const total = performance.now() - t0;
      await new Promise(r => setTimeout(r, 300));
      return { sliced, totalMs: Math.round(total), longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt)), sumLongMs: Math.round(lt.reduce((a, b) => a + b, 0)), frames };
    })()`);
    if (th > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return { throttle: th, ...r };
  } finally { c.close(); }
}

const LIMITS = { maxDrawCalls: 'drawCalls', maxRenderables: 'renderablesDrawn', maxStructureChangedPct: 'structureChangedPct', maxAllocKBPerFrame: 'allocKBPerFrame', maxGpuTextureMB: 'gpuTextureMB', maxBusyPct: 'busyPct' };

const { port, close } = await serve(dist);
const results = { dist, throttle, dpr, bundle: bundleStats(), scenarios: {} };
const failures = [];
const pendingNotes = [];
try {
  for (const [name, sc] of Object.entries(budget.scenarios)) {
    if (only && !only.includes(name)) continue;
    process.stdout.write(`${name} ... `);
    if (sc.kind === 'offline') {
      const o = await runOffline(port, sc);
      results.scenarios[name] = o;
      console.log(`${o.sliced ? 'sliced' : 'one piece'}: total ${o.totalMs} ms  longest freeze ${o.longestMs} ms  long tasks ${o.longTasks} (${o.sumLongMs} ms)  frames drawn meanwhile ${o.frames}`);
      if (throttle === 1 && sc.maxLongestMs !== undefined && o.longestMs > sc.maxLongestMs * 1.1) failures.push(`${name}: longest freeze ${o.longestMs} ms > ${sc.maxLongestMs} (+10%)`);
      continue;
    }
    if (sc.kind === 'audio') {
      const a = await runAudio(port, sc);
      results.scenarios[name] = a;
      console.log(`ready ${a.readyMs} ms  done ${a.doneMs} ms  long tasks(60s) ${a.longTasks60} = ${a.longTaskMs60} ms (max ${a.longTaskMax})  renderer MB ${JSON.stringify(a.rendererMB)}`);
      const lim = (k, v, max) => { if (max !== undefined && v > max * 1.1) failures.push(`${name}: ${k} ${v} > ${max} (+10%)`); };
      if (throttle === 1 && !sc.throttle) { lim('readyMs', a.readyMs, sc.maxReadyMs); lim('longTaskMs60', a.longTaskMs60, sc.maxLongTaskMs); lim("longTaskMax", a.longTaskMax, sc.maxLongTaskMax); lim('peakGainMB', a.peakGainMB, sc.maxPeakGainMB); }
      continue;
    }
    const rep = await runScenario(port, name, sc);
    results.scenarios[name] = rep;
    console.log(`calls ${rep.drawCalls}  objs ${rep.renderablesDrawn}/${rep.renderablesTotal}  rebuild ${rep.structureChangedPct}%  alloc ${rep.allocKBPerFrame} KB/frame  tex ${rep.gpuTextureMB} MB  `
      + `${rep.fps} fps  frame ${rep.frameMsMed}/${rep.frameMsP95} ms  busy ${rep.busyPct}%  long ${rep.longTasks}  rss ${rep.mem ? `${rep.mem.renderer}/${rep.mem.gpu}` : '-'} MB  errors ${rep.consoleErrors}`);
    if (arg('verbose', false)) console.log('   biggest: ' + (rep.biggest || []).join('  ') + '\n   overdraw ' + rep.overdraw + 'x  by group: ' + rep.overdrawBy.join('  ') + '   cal ' + rep.calMs + ' ms');
    if (arg('verbose', false)) console.log('   groups: ' + (rep.groups || []).map(g => `${g.label}(${g.objects}) ${g.changedPct}%`).join('  ') + `   groupsTotal ${rep.renderGroups}`);
    // "pending": true = measured and reported, never gating (the f24w-* scenarios until wide layouts exist, plan 4 X-4).
    const into = sc.pending ? pendingNotes : failures;
    if (rep.consoleErrors) into.push(`${name}: ${rep.consoleErrors} console errors`);
    for (const [limit, field] of Object.entries(LIMITS)) {
      const max = sc[limit];
      if (max === undefined || throttle > 1) continue;
      if (rep[field] > max * 1.1 + (max === 0 ? 0.5 : 0)) into.push(`${name}: ${field} ${rep[field]} > ${max} (+10%)`);
    }
  }
  const g = budget.global || {};
  if (g.jsGzKB && results.bundle.jsGzKB > g.jsGzKB * 1.1) failures.push(`bundle js (all chunks) ${results.bundle.jsGzKB} KB gz > ${g.jsGzKB}`);
  if (g.initialJsGzKB && results.bundle.initialJsGzKB > g.initialJsGzKB * 1.1) failures.push(`bundle js (first load) ${results.bundle.initialJsGzKB} KB gz > ${g.initialJsGzKB}`);
} finally { close(); }

if (outFile) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, JSON.stringify(results, null, 1)); }
console.log(`bundle: js ${results.bundle.jsGzKB} KB gz in all chunks, ${results.bundle.initialJsGzKB} KB gz needed for the first load, css ${results.bundle.cssGzKB} KB gz`);
if (arg('chunks', false)) for (const [f, v] of Object.entries(results.bundle.chunks)) console.log(`   ${String(v.gzKB).padStart(7)} KB  ${f}${v.initial ? '' : '  (lazy)'}`);
if (pendingNotes.length) console.log('\nPENDING (reported, not gating):\n  ' + pendingNotes.join('\n  '));
if (failures.length) { console.log('\nOVER BUDGET:\n  ' + failures.join('\n  ')); if (check) process.exit(1); } else console.log('\nwithin budget');
process.exit(0);

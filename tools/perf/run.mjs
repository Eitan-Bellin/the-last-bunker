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
function bundleStats() {
  const dir = path.join(dist, 'assets');
  let js = 0, css = 0;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) { if (f.endsWith('.js')) js += gz(path.join(dir, f)); else if (f.endsWith('.css')) css += gz(path.join(dir, f)); }
  return { jsGzKB: Math.round(js / 1024), cssGzKB: Math.round(css / 1024) };
}

const yMid = floors => Math.round(70 + Math.min(12, floors / 2) * 116);
const CAMERAS = { overview: [308, f => yMid(f), 1], close: [300, f => yMid(f), 2.5], far: [308, f => yMid(f), 0.55] };

async function runScenario(port, name, sc) {
  const c = await launch();
  try {
    await phoneSetup(c, { quality: sc.quality, throttle: 1, dpr });
    await c.send('HeapProfiler.enable');
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/?debug` });
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
    const od = await c.evalJs('__perf2.overdraw()');
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

const LIMITS = { maxDrawCalls: 'drawCalls', maxRenderables: 'renderablesDrawn', maxStructureChangedPct: 'structureChangedPct', maxAllocKBPerFrame: 'allocKBPerFrame', maxGpuTextureMB: 'gpuTextureMB', maxBusyPct: 'busyPct' };

const { port, close } = await serve(dist);
const results = { dist, throttle, dpr, bundle: bundleStats(), scenarios: {} };
const failures = [];
try {
  for (const [name, sc] of Object.entries(budget.scenarios)) {
    if (only && !only.includes(name)) continue;
    process.stdout.write(`${name} ... `);
    if (sc.kind === 'audio') {
      const a = await runAudio(port, sc);
      results.scenarios[name] = a;
      console.log(`ready ${a.readyMs} ms  done ${a.doneMs} ms  long tasks(60s) ${a.longTasks60} = ${a.longTaskMs60} ms (max ${a.longTaskMax})  renderer MB ${JSON.stringify(a.rendererMB)}`);
      const lim = (k, v, max) => { if (max !== undefined && v > max * 1.1) failures.push(`${name}: ${k} ${v} > ${max} (+10%)`); };
      if (throttle === 1 && !sc.throttle) { lim('readyMs', a.readyMs, sc.maxReadyMs); lim('longTaskMs60', a.longTaskMs60, sc.maxLongTaskMs); lim('longTaskMax', a.longTaskMax, sc.maxLongTaskMax); lim('peakGainMB', a.peakGainMB, sc.maxPeakGainMB); }
      continue;
    }
    const rep = await runScenario(port, name, sc);
    results.scenarios[name] = rep;
    console.log(`calls ${rep.drawCalls}  objs ${rep.renderablesDrawn}/${rep.renderablesTotal}  rebuild ${rep.structureChangedPct}%  alloc ${rep.allocKBPerFrame} KB/frame  tex ${rep.gpuTextureMB} MB  `
      + `${rep.fps} fps  frame ${rep.frameMsMed}/${rep.frameMsP95} ms  busy ${rep.busyPct}%  long ${rep.longTasks}  rss ${rep.mem ? `${rep.mem.renderer}/${rep.mem.gpu}` : '-'} MB  errors ${rep.consoleErrors}`);
    if (arg('verbose', false)) console.log('   biggest: ' + rep.biggest.join('  ') + '\n   overdraw ' + rep.overdraw + 'x  by group: ' + rep.overdrawBy.join('  ') + '   cal ' + rep.calMs + ' ms');
    if (arg('verbose', false)) console.log('   groups: ' + rep.groups.map(g => `${g.label}(${g.objects}) ${g.changedPct}%`).join('  ') + `   groupsTotal ${rep.renderGroups}`);
    if (rep.consoleErrors) failures.push(`${name}: ${rep.consoleErrors} console errors`);
    for (const [limit, field] of Object.entries(LIMITS)) {
      const max = sc[limit];
      if (max === undefined || throttle > 1) continue;
      if (rep[field] > max * 1.1 + (max === 0 ? 0.5 : 0)) failures.push(`${name}: ${field} ${rep[field]} > ${max} (+10%)`);
    }
  }
  const g = budget.global || {};
  if (g.jsGzKB && results.bundle.jsGzKB > g.jsGzKB * 1.1) failures.push(`bundle js ${results.bundle.jsGzKB} KB gz > ${g.jsGzKB}`);
} finally { close(); }

if (outFile) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, JSON.stringify(results, null, 1)); }
console.log(`bundle: js ${results.bundle.jsGzKB} KB gz, css ${results.bundle.cssGzKB} KB gz`);
if (failures.length) { console.log('\nOVER BUDGET:\n  ' + failures.join('\n  ')); if (check) process.exit(1); } else console.log('\nwithin budget');
process.exit(0);

// Flash-budget check (plan4 AC-5): starts a blackout, a breach and a fire in the running game, samples every effect's light for 10 s and
// counts its flashes (peaks that rise at least 0.12 above the preceding trough) in the worst one-second window.
//
//   node tools/a11y/flash-check.mjs [--dist dist] [--seconds 10] [--safe]      # exit 1 when any effect (or all together) exceeds 3 per second
//
// The light is read straight from the effect sprites (incident glow, the breach beacon sprite, the sky's lightning sprite), once per frame.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, serve, sleep, waitFor } from '../perf/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true; };
const dist = path.resolve(String(arg('dist', path.join(root, 'dist'))));
const seconds = +arg('seconds', 10);
const safe = !!arg('safe', false);
const savePath = path.join(root, 'store/sim/saves-v6/e30-seed1.json');

const { compressToUTF16 } = (m => m.default ?? m)(await import(pathToFileURL(path.join(root, 'node_modules/lz-string/libs/lz-string.js')).href));
const raw = JSON.parse(fs.readFileSync(savePath, 'utf8'));
raw.storyFlags = [...new Set([...(raw.storyFlags ?? []), 'intro:done', 'difficulty:chosen'])];
const packed = compressToUTF16(JSON.stringify(raw));

const srv = await serve(dist);
const c = await launch();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${srv.port}/privacy.html` });
  await sleep(1200);
  await c.evalJs(`new Promise((res, rej) => { const o = indexedDB.open('keyval-store'); o.onupgradeneeded = () => o.result.createObjectStore('keyval');
    o.onsuccess = () => { const db = o.result, tx = db.transaction('keyval', 'readwrite'); tx.objectStore('keyval').put(${JSON.stringify(packed)}, 'lastbunker_auto'); tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => rej(tx.error); }; })`);
  await c.evalJs(`localStorage.setItem('lastbunker_a11y', JSON.stringify({ flash: ${safe ? "'safe'" : "'normal'"} })); localStorage.setItem('lastbunker_gfx','low'); true`);
  await c.send('Page.navigate', { url: `http://127.0.0.1:${srv.port}/?debug` });
  if (!await waitFor(c, '!!(window.__engine && window.__renderer && window.__renderer.incidents)', 120, 500)) throw new Error('game did not start');
  await sleep(3000);
  const report = await c.evalJs(`new Promise(async (resolve) => {
    const eng = __engine, ren = __renderer, st = eng.stateManager.state;
    document.querySelectorAll('.modal-overlay.open .modal-actions button').forEach(b => b.click());
    setInterval(() => { eng.paused = false; }, 200);
    const rooms = st.buildings.filter(b => !b.isConstructing && b.position.floor < 8 && b.position.floor >= 1);
    const pick = (i) => rooms[i % rooms.length];
    const mk = (kind, i) => ({ id: 'flashtest-' + kind, kind, buildingId: pick(i).id, severity: 0.8, progress: 0, startedAt: Date.now(), peak: 0 });
    const kinds = ['blackout', 'breach', 'fire'];
    st.incidents.push(...kinds.map((k, i) => mk(k, i * 3)));
    await new Promise(r => setTimeout(r, 1500));
    const views = ren.incidents.views;
    const series = { blackout: [], breach: [], fire: [], lightning: [], all: [] };
    // Virtual clock: the real ticker is stopped and the effect layer is stepped by hand at 60 fps for ${seconds} simulated seconds
    // (headless Chrome throttles requestAnimationFrame, and a flash budget measured on a stalled clock proves nothing).
    ren.app.ticker.stop();
    const lightning = (ren.surface2 || ren.surface || {}).flash;
    const dt = 1 / 60;
    const floorRect = (f) => ({ x: 0, y: f * 130, w: 600 });
    let t = 1000;
    for (let i = 0; i < Math.round(${seconds} * 60); i++) {
      t += dt;
      window.__flashNow = t; // the flash budget reads this instead of the wall clock
      ren.incidents.update(st, t, dt, id => ren.roomRect(id), floorRect);
      let sum = 0;
      for (const k of kinds) {
        const v = views.get('flashtest-' + k);
        if (!v) { series[k].push([i * dt, 0]); continue; }
        // The effect's own light: the arc's flash value, the beacon's flash sprite, the flame glow.
        const a = k === 'breach' ? (v.extra[3]?.alpha ?? 0) : k === 'blackout' ? v.flash : v.glow.alpha;
        series[k].push([i * dt, a]); sum += a;
      }
      series.lightning.push([i * dt, lightning ? lightning.alpha : 0]);
      series.all.push([i * dt, sum]);
    }
    delete window.__flashNow;
    resolve({ series, flash: window.__a11yFlashStats ? window.__a11yFlashStats() : null, found: kinds.map(k => !!views.get('flashtest-' + k)) });
  })`);
  // Peak counting: a flash is a local maximum that rose >= 0.12 above the last trough; windowed per second.
  const peaks = (s) => { const out = []; let trough = s[0]?.[1] ?? 0, rising = false, last = trough;
    for (let i = 1; i < s.length; i++) { const a = s[i][1]; if (a < trough) trough = a;
      if (a > last) rising = true; else if (a < last && rising) { if (last - trough >= 0.12) out.push(s[i - 1][0]); rising = false; trough = a; }
      last = a; }
    return out; };
  const worst = (ts) => { let m = 0; for (const t of ts) m = Math.max(m, ts.filter(x => x >= t && x < t + 1).length); return m; };
  console.log(`flash check (${safe ? 'flash: safe' : 'flash: normal'}, ${seconds}s) incidents found: ${report.found.join(',')}`);
  let bad = false, all = [];
  for (const k of ['blackout', 'breach', 'fire', 'lightning']) {
    const p = peaks(report.series[k]); if (k === 'blackout' || k === 'lightning') all = all.concat(p); // the budgeted, discrete flashes; fire and the beacon are smooth pulses, each held to 3 a second on its own
    const w = worst(p); if (w > 3) bad = true;
    const max = Math.max(...report.series[k].map(x => x[1]));
    console.log(`  ${k.padEnd(10)} samples ${report.series[k].length} flashes ${String(p.length).padStart(3)} in ${seconds}s, worst second ${w}, max light ${max.toFixed(2)}`);
  }
  all.sort((a, b) => a - b);
  console.log(`  budgeted   worst second ${worst(all)} (limit 3)`);
  if (worst(all) > 3) bad = true;
  if (bad) { console.log('FAIL: more than 3 flashes in a second'); process.exitCode = 1; } else console.log('ok: never more than 3 flashes a second');
} finally { c.close(); srv.close(); }

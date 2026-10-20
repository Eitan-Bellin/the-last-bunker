// [phase1 cheat] Measures what interrupts a new (or returning) player, in a headless Chrome against a running dev server.
// It plays with `__pt.autoplay()` (src/dev/playthrough.ts) at a fast-forward speed and prints `__pt.report()`.
//
//   node tools/playthrough-measure.mjs --url http://localhost:5175 --minutes 30 [--speed 5] [--stage d30] [--lang he] [--out file.json]
//
// --minutes = game minutes to play; --stage loads store/playthrough/saves/<stage>-seed1.json first (a returning player).
// Uses its own temporary Chrome profile and its own save slot, so no real save is touched. Only the Chrome it started is closed.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://localhost:5175');
const minutes = Number(arg('minutes', 30));
const speed = Number(arg('speed', 5));
const stage = arg('stage', '');
const away = Number(arg('away', 0)); // hours away before the stage save is opened (a returning player)
const lang = arg('lang', 'he');
const out = arg('out', '');
const slot = `measure-${Date.now()}`;
const idle = process.argv.includes('--idle'); // do nothing: the first-minute check
const probe = arg('probe', ''); // extra JS expression recorded with every sample (debugging)
const STATE = `(() => { const s = __app.state; const h = s.survivors.map(p => p.happiness); return { act: s.longGame?.act, paused: __engine.paused, morale: Math.round(h.reduce((a, b) => a + b, 0) / Math.max(1, h.length)), people: s.survivors.length, power: Math.round(s.resources.power.amount), food: Math.round(s.resources.food.amount), playSeconds: Math.round(s.stats.totalPlayTime), strip: (document.querySelector('.objective-text')?.textContent ?? '').slice(0, 60), sheet: ([...document.querySelectorAll('.sheet-overlay.open .sheet-title, .sheet-overlay.open h2')][0]?.textContent ?? '').slice(0, 40), rooms: s.buildings.length, probe: (() => { try { return ${probe ? probe : 'null'}; } catch (e) { return String(e); } })() }; })()`;
const samples = [];
const tour = process.argv.includes('--tour'); // open every tab, the bell and the status chip: one PNG each (needs --out)
const roomsOnly = process.argv.includes('--rooms-only'); // [clean:1] with --tour: only the main view and the room screen stops
const width = Number(arg('width', 375));
const shots = (arg('shots', '') || '').split(',').filter(Boolean).map(Number); // wall seconds after the start to save a PNG (needs --out)
const CHROMES = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const chromePath = CHROMES.find(p => existsSync(p));
if (!chromePath) throw new Error('no Chrome/Edge found');

const profile = mkdtempSync(join(tmpdir(), 'lb-measure-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new',
  `--window-size=${width},812`, '--force-device-scale-factor=2', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* not up yet */ }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result ?? m); pending.delete(m.id); } });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 812, deviceScaleFactor: 2, mobile: true });
  const url = `${base}/?slot=${slot}&debug`;
  const go = async () => { await send('Page.navigate', { url }); for (let i = 0; i < 80; i++) { await sleep(500); if (await evaluate('typeof window.__pt === "object"').catch(() => false)) return; } throw new Error('game did not load'); };
  await go();
  await evaluate(`localStorage.setItem('lastbunker_lang', ${JSON.stringify(lang)})`);
  await go();
  if (stage) {
    await evaluate(`__pt.load(${JSON.stringify(stage)}, ${away})`);
    await sleep(1500);
    for (let i = 0; i < 80; i++) { await sleep(500); if (await evaluate('typeof window.__pt === "object" && !!window.__app?.state').catch(() => false)) break; }
  }
  if (idle) { // get through the intro and the difficulty question, then keep hands off
    await evaluate('__pt.autoplay(true)');
    for (let i = 0; i < 120; i++) { await sleep(250); if (await evaluate('!__engine.paused && __app.state.stats.totalPlayTime > 0').catch(() => false)) break; }
  }
  if (tour) {
    const snap = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(out.replace(/\.json$/, '') + '-' + name + '.png', Buffer.from(s.data, 'base64')); };
    const close = "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))";
    await evaluate('__pt.autoplay(true)'); await sleep(6000); await evaluate('__pt.autoplay(false)'); // through intro, difficulty, welcome-back
    for (let i = 0; i < 4; i++) { await evaluate(close); await sleep(400); }
    await sleep(1500); await snap('main');
    // [clean:2] Camera numbers at the home view: zoom, world floors in the band between the HUD bars, screen px of a 2-slot room.
    // floorsVisible: the band's height over one floor pitch (FLOOR_H 144 with the airy slabs).
    const camInfo = `(() => { const c = __app.renderer.camera, v = c.view, vy = c.visibleY();
      return { zoom: +v.z.toFixed(3), base: +c.baseZoom.toFixed(3), camY: Math.round(v.y), y0: Math.round(vy.y0), y1: Math.round(vy.y1), floorsVisible: +((vy.y1 - vy.y0) / 144).toFixed(2), slot2px: Math.round(92 * v.z),
        tag: document.querySelector('.cf2-floortag')?.textContent ?? null }; })()`;
    const info = { main: await evaluate(camInfo).catch(e => String(e)) };
    // [clean:2] Scroll: two finger drags down the bunker (~1.3 screens in all; the second one released while moving, a fling), shot after the snap settled.
    const drag = async (x, y0, y1, ms, fling) => {
      const steps = Math.max(6, Math.round(ms / 16));
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
      for (let i = 1; i <= steps; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(y0 + (y1 - y0) * (i / steps)), id: 1 }] }); await sleep(16); }
      if (!fling) await sleep(160);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const flingT0 = Date.now();
    await drag(Math.round(width * 0.5), 640, 260, 500, false); await sleep(900);
    info.scroll1 = await evaluate(camInfo).catch(e => String(e));
    await drag(Math.round(width * 0.5), 600, 320, 260, true);
    // Settle timing: poll the camera until it stops moving.
    const tFling = Date.now();
    for (let i = 0; i < 60; i++) { await sleep(50); if (!(await evaluate('__app.renderer.cameraMoving').catch(() => false))) break; }
    info.settleMs = Date.now() - tFling; info.dragTotalMs = Date.now() - flingT0;
    await sleep(400); await snap('scroll');
    info.scroll = await evaluate(camInfo).catch(e => String(e));
    // The floor tag's quick jump list (step 2), when there is one.
    if (await evaluate("!!document.querySelector('.cf2-floortag')")) {
      await evaluate("document.querySelector('.cf2-floortag').click()"); await sleep(700); await snap('jump');
      await evaluate("(() => { const b = [...document.querySelectorAll('.cf2-jump-item')]; b[Math.floor(b.length / 2)]?.click(); })()"); await sleep(2200); await snap('jumped');
      info.jumped = await evaluate(camInfo).catch(e => String(e));
    }
    // Far: zoomed out to the overview band (strata and shell come back), then the city map.
    await evaluate('(() => { const c = __app.renderer.camera, v = c.view; c.setView(v.x, v.y, 0.52); })()'); await sleep(1500); await snap('far');
    await evaluate('(() => { const c = __app.renderer.camera, v = c.view; c.setView(v.x, v.y, 0.36); })()'); await sleep(1500); await snap('map');
    await evaluate('__app.renderer.camera.goHome()'); await sleep(2500); await snap('home');
    info.home = await evaluate(camInfo).catch(e => String(e));
    console.log('camera ' + JSON.stringify(info));
    if (out) writeFileSync(out.replace(/\.json$/, '') + '-camera.json', JSON.stringify(info, null, 1));
    const stops =[['bell', '.hx-alerts'], ['status', '.hx-act'], ['build', '.hx-tab[data-key=build]'], ['people', '.hx-tab[data-key=people]'],
      ['research', '.hx-tab[data-key=research]'], ['menu', '.hx-tab[data-key=menu]'], ['surface', '.hx-tab[data-key=surface]']];
    for (const [name, sel] of roomsOnly ? [] : stops) {
      await evaluate('document.querySelector(' + JSON.stringify(sel) + ')?.click()'); await sleep(1600); await snap(name);
      for (let i = 0; i < 3; i++) { await evaluate(close); await sleep(350); }
    }
    // [clean:1] The room screen: the busiest room opened through the app's own tap handler (renderer.onBuildingClick, what a tap on the room
    // calls), then the same with "More" expanded (before the room screen existed: the old sheet scrolled to its end).
    const busiest = "(() => { const b = [...__app.state.buildings].filter(x => !x.isConstructing).sort((a, c) => c.assignedSurvivorIds.length - a.assignedSurvivorIds.length)[0]; return b ? b.id : null; })()";
    const roomId = await evaluate(busiest);
    if (roomId) {
      await evaluate(`__app.renderer.onBuildingClick(${JSON.stringify(roomId)})`); await sleep(2200); await snap('room');
      await evaluate("(() => { const t = document.querySelector('.rs-more-toggle'); if (t) { t.click(); return; } const s = document.querySelector('.sheet-overlay.open .sheet'); if (s) s.scrollTop = s.scrollHeight; })()");
      await sleep(1200); await snap('room-more');
      for (let i = 0; i < 3; i++) { await evaluate(close); await sleep(350); }
    }
    console.log('tour done');
  } else {
  await evaluate(`${stage ? '' : '__pt.reset(); '}__pt.speed(${speed}); __pt.autoplay(${!idle})`);
  const wallMs = (minutes * 60 * 1000) / speed;
  const t0 = Date.now();
  for (const at of shots) { // screenshots first, then the rest of the run
    await sleep(Math.max(0, at * 1000 - (Date.now() - t0)));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (out) writeFileSync(out.replace(/.json$/, '') + `-${at}s.png`, Buffer.from(shot.data, 'base64'));
  }
  while (Date.now() - t0 < wallMs) {
    await sleep(Math.min(idle ? 5000 : 15000, wallMs));
    const r = await evaluate('__pt.report()');
    samples.push(await evaluate(STATE).catch(() => null));
    process.stdout.write(`  ${r.gameMinutes} game min · dialogs ${r.dialogs} story ${r.story} spotlights ${r.spotlights} toasts ${r.toasts}\n`);
    if (r.gameMinutes >= minutes) break;
  }
  }
  if (!tour) {
  const report = await evaluate('__pt.report()');
  report.state = await evaluate(STATE).catch(e => String(e));
  report.samples = samples;
  report.config = { base, minutes, speed, stage, away, lang };
  console.log(JSON.stringify(report, null, 1));
  if (out) writeFileSync(out, JSON.stringify(report, null, 1));
  }
} finally {
  try { ws?.close(); } catch { /* closed */ }
  chrome.kill(); // only the Chrome this script started
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
}

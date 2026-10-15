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
const STATE = `(() => { const s = __app.state; const h = s.survivors.map(p => p.happiness); return { act: s.longGame?.act, paused: __engine.paused, morale: Math.round(h.reduce((a, b) => a + b, 0) / Math.max(1, h.length)), people: s.survivors.length, power: Math.round(s.resources.power.amount), food: Math.round(s.resources.food.amount), playSeconds: Math.round(s.stats.totalPlayTime) }; })()`;
const samples = [];
const tour = process.argv.includes('--tour'); // open every tab, the bell and the status chip: one PNG each (needs --out)
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
    const stops = [['bell', '.hx-alerts'], ['status', '.hx-act'], ['build', '.hx-tab[data-key=build]'], ['people', '.hx-tab[data-key=people]'],
      ['research', '.hx-tab[data-key=research]'], ['menu', '.hx-tab[data-key=menu]'], ['surface', '.hx-tab[data-key=surface]']];
    for (const [name, sel] of stops) {
      await evaluate('document.querySelector(' + JSON.stringify(sel) + ')?.click()'); await sleep(1600); await snap(name);
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

// [phase4b] Agent D's screenshot tour: the Exposure gauge, the Exposure sheet, a raid warning with its odds and the Foreman's policies.
// Usage: node store/playthrough/phase4b/D-tour.mjs --url http://localhost:5173 --stage d20 --width 375 --lang he --out store/playthrough/phase4b/D-tour/d20
// Its own temporary Chrome profile and save slot (no real save is touched); only the Chrome it started is closed.
// The p4bD.* strings are not merged into en/he.json yet (the lead does that): the tour adds them to the dev string tables in the page.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://localhost:5173');
const stage = arg('stage', 'd20');
const lang = arg('lang', 'he');
const width = Number(arg('width', 375));
const out = arg('out', 'store/playthrough/phase4b/D-tour/d20');
mkdirSync(dirname(out), { recursive: true });
const strings = JSON.parse(readFileSync(new URL('./i18n-D.json', import.meta.url), 'utf8'));
const CHROMES = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const chromePath = CHROMES.find(p => existsSync(p));
const profile = mkdtempSync(join(tmpdir(), 'lb-dtour-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', `--window-size=${width},812`,
  '--force-device-scale-factor=2', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const snap = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}-${name}.png`, Buffer.from(s.data, 'base64')); console.log('  shot', name); };
const close = "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))";
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* */ } }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id); } });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 812, deviceScaleFactor: 2, mobile: true });
  const url = `${base}/?slot=dtour-${Date.now()}&debug`;
  const go = async () => { await send('Page.navigate', { url }); for (let i = 0; i < 80; i++) { await sleep(500); if (await evaluate('typeof window.__pt === "object"').catch(() => false)) return; } throw new Error('game did not load'); };
  await go();
  await evaluate(`localStorage.setItem('lastbunker_lang', ${JSON.stringify(lang)})`);
  await go();
  await evaluate(`__pt.load(${JSON.stringify(stage)}, 0)`).catch(() => null);
  await sleep(6000); // __pt.load reloads the page
  for (let i = 0; i < 80; i++) { await sleep(500); if (await evaluate('!!window.__app?.state && !!window.__engine').catch(() => false)) break; }
  await sleep(1500);
  // The agent's strings into the dev tables (the same objects i18n reads).
  const inject = () => evaluate(`(async () => { const s = ${JSON.stringify(strings)}; const { i18n } = await import('/src/i18n/I18nManager.ts');
    for (const l of ['en', 'he']) { const raw = JSON.parse((await import('/src/i18n/' + l + '.json?raw')).default); i18n.provide(l, { ...raw, ...s[l], ...s.replace[l] }); }
    return i18n.t('p4bD.exp.title'); })()`);
  console.log('strings:', await inject());
  await evaluate('__pt.autoplay(true)'); await sleep(6000); await evaluate('__pt.autoplay(false)');
  for (let i = 0; i < 4; i++) { await evaluate(close); await sleep(400); }
  const tips = "(() => { for (const b of document.querySelectorAll('button')) if (/^(הבנתי|Got it)$/.test(b.textContent.trim())) b.click(); return true; })()";
  await evaluate(tips); await sleep(400);
  // The app wiring the lead adds (app.ts): the sheet behind the gauge.
  await evaluate(`(async () => { const m = await import('/src/ui/components/ExposureSheet.ts'); window.__xs = new m.ExposureSheet(__engine); __app.hud.onExposure = () => window.__xs.show(__app.state); return true; })()`);
  await sleep(1500); await snap('main');
  // The row with and without the gauge: tile widths and how many amounts are cut.
  const rowProbe = "(() => { const t = [...document.querySelectorAll('#hud .hx-res')].filter(x => x.offsetParent); return { tiles: t.map(x => Math.round(x.getBoundingClientRect().width)), cut: t.filter(x => { const a = x.querySelector('.k-chip__amount'); return a && a.scrollWidth > a.clientWidth + 1; }).length, status: Math.round(document.querySelector('.hx-status').getBoundingClientRect().width) }; })()";
  const withG = await evaluate(rowProbe);
  await evaluate("(() => { const g = document.querySelector('.p4bd-gauge'); g.dataset.saved = g.style.display; g.style.display = 'none'; g.parentElement.classList.remove('p4bd-has-gauge'); return true; })()"); await sleep(400);
  const without = await evaluate(rowProbe);
  await evaluate("(() => { const g = document.querySelector('.p4bd-gauge'); g.style.display = g.dataset.saved; g.parentElement.classList.add('p4bd-has-gauge'); return true; })()"); await sleep(400);
  console.log('row with gauge', JSON.stringify(withG), 'without', JSON.stringify(without));
  await evaluate("document.querySelector('.p4bd-gauge')?.click()"); await sleep(1500); await evaluate(tips); await sleep(300); await snap('exposure');
  await evaluate("[...document.querySelectorAll('.p4bd-lever')].pop()?.scrollIntoView({ block: 'end' })"); await sleep(600); await snap('exposure-levers');
  await evaluate("[...document.querySelectorAll('.p4bd-lever .k-btn')][0]?.click()"); await sleep(1200); await snap('exposure-hidden');
  await evaluate("[...document.querySelectorAll('.p4bd-lever .k-btn')][0]?.click()"); await sleep(400);
  for (let i = 0; i < 3; i++) { await evaluate(close); await sleep(350); }
  // A raid on its way: the warning with the odds.
  await evaluate("(() => { __engine.eventSystem.startRaid(); __app.danger.showDanger(); return true; })()"); await sleep(1500); await snap('raid');
  await evaluate("(() => { __app.modal.hide(); return true; })()"); await sleep(800); await snap('main-raid');
  // The raid resolved (a fight): the result dialog with the rolled odds.
  await evaluate("(() => { const r = __engine.eventSystem.resolveRaid('fight'); __app.modal.hide(); return r?.key; })()"); await sleep(2500); await snap('raid-result');
  for (let i = 0; i < 4; i++) { await evaluate("(() => { __app.modal.hide(); return true; })()"); await sleep(700); }
  // The Foreman's policies, in a sheet of their own (the lead puts the card on the Command's Policies tab).
  await evaluate(`(async () => { const m = await import('/src/ui/components/ExposureForeman.ts'); const S = (await import('/src/ui/components/Sheet.ts')).Sheet;
    const sh = new S('p4bd-foreman-test'); sh.setTitle('Command'); const draw = () => sh.body.replaceChildren(m.renderForemanPolicies(__engine, draw)); draw(); sh.show(); return true; })()`);
  await sleep(1500); await evaluate(tips); await sleep(300); await snap('foreman');
  await evaluate("[...document.querySelectorAll('.p4bd-policy, .p4bd-switch')].pop()?.scrollIntoView({ block: 'end' })"); await sleep(600); await snap('foreman-end');
  const info = await evaluate(`(() => { const g = document.querySelector('.p4bd-gauge'); const r = g?.getBoundingClientRect(); const row = document.querySelector('.hx-row')?.getBoundingClientRect();
    return { gauge: r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) } : null, row: row ? Math.round(row.width) : null, docW: document.documentElement.scrollWidth, meter: __app.state.longGame?.threat.meter }; })()`);
  console.log(JSON.stringify(info));
  writeFileSync(`${out}-info.json`, JSON.stringify(info, null, 1));
} finally {
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
}

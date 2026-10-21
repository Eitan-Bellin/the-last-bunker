// Several screenshots of a dev page in a row (to check animation) in a headless Chrome of its own.
//   node tools/v2frames.mjs <url> <out-prefix> [width=390] [height=844] [waitMs=4000] [frames=3] [gapMs=250]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, w = '390', h = '844', wait = '4000', n = '3', gap = '250'] = process.argv.slice(2);
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'lb-shot-'));
const port = 9800 + Math.floor(Math.random() * 150);
const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* starting */ } }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url });
  await sleep(+wait);
  for (let k = 0; k < +n; k++) {
    if (k) await sleep(+gap);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${out}-${k}.png`, Buffer.from(shot.data, 'base64'));
  }
  console.log('saved', n, 'frames', out);
} finally {
  try { ws?.close(); } catch { /* closed */ }
  proc.kill(); // only the Chrome this script started
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* still held */ }
}

// Runs a dev tool page headless until a flag is set, then prints its log (no real Chrome profile touched).
//   node tools/runpage.mjs <url> <doneExpression> [timeoutSec=600] [logSelector=#log]
// e.g. node tools/runpage.mjs "http://localhost:5173/tools/art.html?auto" "window.__artDone === true"
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, done, timeoutSec = '600', logSel = '#log'] = process.argv.slice(2);
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'lb-run-'));
const port = 9650 + Math.floor(Math.random() * 150);
const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-background-timer-throttling', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* starting */ } }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < +timeoutSec * 1000) { await sleep(2000); if (await evaluate(`!!(${done})`)) { ok = true; break; } }
  console.log(await evaluate(`document.querySelector(${JSON.stringify(logSel)})?.textContent ?? ''`));
  console.log(ok ? 'DONE' : 'TIMEOUT');
  process.exitCode = ok ? 0 : 1;
} finally {
  try { ws?.close(); } catch { /* closed */ }
  proc.kill(); // only the Chrome this script started
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* held */ }
}

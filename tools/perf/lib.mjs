// Dependency-free helpers for the performance runner: a static server (gzip like GitHub Pages), headless Chrome, and a tiny
// Chrome DevTools Protocol client over the WebSocket that ships with Node 22. Nothing here touches a real player's save: every
// run uses a brand-new Chrome profile in the temp folder.
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function chromePath() {
  const cands = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const p = cands.find(c => c && fs.existsSync(c));
  if (!p) throw new Error('Chrome not found: set CHROME=<path>');
  return p;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

/** Static file server over a built `dist`; returns { port, close() }. */
export function serve(root) {
  const server = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(path.resolve(root))) { r.statusCode = 403; r.end(); return; }
    fs.readFile(f, (e, b) => {
      if (e) { r.statusCode = 404; r.end('not found'); return; }
      const ext = path.extname(f);
      r.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
      r.setHeader('Cache-Control', 'public, max-age=600');
      if (['.html', '.js', '.css', '.json', '.svg', '.webmanifest'].includes(ext) && /gzip/.test(q.headers['accept-encoding'] || '')) {
        r.setHeader('Content-Encoding', 'gzip');
        r.end(zlib.gzipSync(b));
      } else r.end(b);
    });
  });
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({ port: server.address().port, close: () => server.close() })));
}

function freePort() {
  return new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

async function getJson(url) {
  const r = await fetch(url);
  return r.json();
}

/** Starts headless Chrome with a fresh profile and connects to its first page. */
export async function launch(extraArgs = []) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bunker-perf-'));
  const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--enable-precise-memory-info', '--window-size=400,800', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...extraArgs, 'about:blank'];
  const proc = spawn(chromePath(), args, { stdio: 'ignore' });
  let version = null;
  for (let i = 0; i < 60 && !version; i++) { try { version = await getJson(`http://127.0.0.1:${port}/json/version`); } catch { await sleep(250); } }
  if (!version) { proc.kill(); throw new Error('Chrome did not start'); }
  let page = null;
  for (let i = 0; i < 20 && !page; i++) { page = (await getJson(`http://127.0.0.1:${port}/json/list`)).find(t => t.type === 'page'); if (!page) await sleep(200); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } else events.push(d);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, timeout: 300000 });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  const close = () => { try { ws.close(); } catch { /* already closed */ } proc.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still locked */ } }, 1500); };
  return { send, evalJs, events, close, proc, dir };
}

/** Working set (MB) of the Chrome processes started by `launch` (Windows only; returns null elsewhere). */
export function procMem(dir) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'chrome.exe\'\\" | Select-Object WorkingSetSize,CommandLine | ConvertTo-Json -Compress"', { maxBuffer: 1e8 }).toString();
    const list = [].concat(JSON.parse(out)).filter(p => (p.CommandLine || '').includes(path.basename(dir)));
    const mb = t => list.filter(p => new RegExp(`--type=${t}`).test(p.CommandLine)).map(p => Math.round(p.WorkingSetSize / 1048576)).sort((a, b) => b - a)[0] ?? 0;
    return { renderer: mb('renderer'), gpu: mb('gpu') };
  } catch { return null; }
}

/** A phone-like page: 360x740 CSS px at DPR 2.75, touch pointer (the game then starts at Medium, like on a phone), optional CPU throttle. */
export async function phoneSetup(c, { quality, throttle = 1, dpr = 2.75, width = 360, height = 740, extraInit = '' } = {}) {
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: true });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const init = `${quality ? `try{localStorage.setItem('lastbunker_gfx','${quality}')}catch(e){}` : ''}${extraInit}`;
  if (init) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
  if (throttle > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}

export async function waitFor(c, expr, tries = 90, every = 500) {
  for (let i = 0; i < tries; i++) { await sleep(every); try { if (await c.evalJs(expr)) return true; } catch { /* page still loading */ } }
  return false;
}

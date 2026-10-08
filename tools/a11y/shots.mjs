// Screenshots for the accessibility work (plan4 AC-6/AC-7): the Accessibility tab and a row of toasts + cost chips in every colour mode.
//
//   node tools/a11y/shots.mjs [--out store/compare/a11y/shots] [--dist dist]
//
// Same throw-away profile and sample save as audit.mjs; the toasts are built straight in the toast stack with the game's own classes, so
// what is shown is exactly what the stylesheet does with them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, serve, sleep, waitFor } from '../perf/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true; };
const dist = path.resolve(String(arg('dist', path.join(root, 'dist'))));
const out = path.resolve(root, String(arg('out', 'store/compare/a11y/shots')));
fs.mkdirSync(out, { recursive: true });

const { compressToUTF16 } = (m => m.default ?? m)(await import(pathToFileURL(path.join(root, 'node_modules/lz-string/libs/lz-string.js')).href));
const save = JSON.parse(fs.readFileSync(path.join(root, 'store/sim/saves-v6/e30-seed1.json'), 'utf8'));
save.storyFlags = [...new Set([...(save.storyFlags ?? []), 'intro:done', 'difficulty:chosen'])];
const packed = compressToUTF16(JSON.stringify(save));

const srv = await serve(dist);
const c = await launch();
const shot = async name => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.data, 'base64')); console.log('shot', name); };
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (const mode of ['none', 'deuter', 'protan', 'tritan']) {
    await c.send('Page.navigate', { url: `http://127.0.0.1:${srv.port}/privacy.html` });
    await sleep(1200);
    await c.evalJs(`new Promise((res, rej) => { const o = indexedDB.open('keyval-store'); o.onupgradeneeded = () => o.result.createObjectStore('keyval');
      o.onsuccess = () => { const db = o.result, tx = db.transaction('keyval', 'readwrite'); tx.objectStore('keyval').put(${JSON.stringify(packed)}, 'lastbunker_auto'); tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => rej(tx.error); }; })`);
    await c.evalJs(`localStorage.setItem('lastbunker_a11y', JSON.stringify({ colorMode: '${mode}', captions: true })); localStorage.setItem('lastbunker_gfx','low'); true`);
    await c.send('Page.navigate', { url: `http://127.0.0.1:${srv.port}/?debug` });
    if (!await waitFor(c, '!!(window.__engine && document.querySelector(".hud-bottom"))', 120, 500)) throw new Error('game did not start');
    await sleep(3000);
    await c.evalJs(`document.querySelectorAll('.modal-overlay.open .modal-actions button').forEach(b => b.click()); true`);
    await sleep(800);
    // Toasts and chips, built with the game's classes.
    await c.evalJs(`(() => {
      const stack = document.querySelector('.toast-stack');
      const add = (cls, text) => { const t = document.createElement('div'); t.className = 'toast in ' + cls; t.innerHTML = '<span class="toast-msg">' + text + '</span><span class="toast-count"></span>'; stack.appendChild(t); };
      add('info', 'Info: a newcomer is at the door');
      add('good', 'Good: Farm finished');
      add('bad', 'Bad: Food is running low');
      add('critical', 'Critical: the game cannot save');
      const chips = document.createElement('div');
      chips.style.cssText = 'position:fixed;top:420px;inset-inline:0;display:flex;gap:8px;justify-content:center;z-index:40;font-size:15px';
      chips.innerHTML = '<span class="cost-chip affordable">120</span><span class="cost-chip expensive">340</span><div class="bar-track good" style="width:70px"><div class="bar-fill" style="width:60%"></div></div><div class="bar-track danger" style="width:70px"><div class="bar-fill" style="width:60%"></div></div>';
      document.body.appendChild(chips);
      return true; })()`);
    await sleep(500);
    await shot(`toasts-${mode}`);
    await c.evalJs(`document.querySelectorAll('.toast, .cost-chip').forEach(n => n.parentElement && n.parentElement.remove ? (n.classList.contains('toast') ? n.remove() : n.parentElement.remove()) : 0); true`);
    // The Accessibility tab.
    await c.evalJs(`document.querySelector('.nav-btn.nav-menu').click(); true`);
    await sleep(800);
    await c.evalJs(`document.querySelectorAll('.sheet-overlay.open .tab-row .tab')[1].click(); true`);
    await sleep(600);
    await shot(`a11y-tab-${mode}`);
    if (mode === 'none') {
      await c.evalJs(`document.querySelector('.sheet-overlay.open .sheet-body').scrollTop = 99999; true`);
      await sleep(300);
      await shot('a11y-tab-none-bottom');
    }
  }
} finally { c.close(); srv.close(); }

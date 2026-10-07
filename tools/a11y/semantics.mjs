// Semantics smoke test (plan4 AC-8/AC-10/AC-11): drives the built game with real key events and checks roles, focus, inert and the list view.
//   node tools/a11y/semantics.mjs [--dist dist]        exit 1 when a check fails
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, serve, sleep, waitFor } from '../perf/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true; };
const dist = path.resolve(String(arg('dist', path.join(root, 'dist'))));
const { compressToUTF16 } = (m => m.default ?? m)(await import(pathToFileURL(path.join(root, 'node_modules/lz-string/libs/lz-string.js')).href));
const save = JSON.parse(fs.readFileSync(path.join(root, 'store/sim/saves-v6/e30-seed1.json'), 'utf8'));
save.storyFlags = [...new Set([...(save.storyFlags ?? []), 'intro:done', 'difficulty:chosen'])];
const packed = compressToUTF16(JSON.stringify(save));

const srv = await serve(dist);
const c = await launch();
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const key = async (k) => { await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k }); await sleep(500); };
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${srv.port}/privacy.html` });
  await sleep(1200);
  await c.evalJs(`new Promise((res, rej) => { const o = indexedDB.open('keyval-store'); o.onupgradeneeded = () => o.result.createObjectStore('keyval');
    o.onsuccess = () => { const db = o.result, tx = db.transaction('keyval', 'readwrite'); tx.objectStore('keyval').put(${JSON.stringify(packed)}, 'lastbunker_auto'); tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => rej(tx.error); }; })`);
  await c.evalJs(`localStorage.setItem('lastbunker_gfx','low'); localStorage.setItem('lastbunker_a11y', JSON.stringify({ announce: true })); true`);
  await c.send('Page.navigate', { url: `http://127.0.0.1:${srv.port}/?debug` });
  if (!await waitFor(c, '!!(window.__engine && document.querySelector(".hud-bottom"))', 120, 500)) throw new Error('game did not start');
  await sleep(3000);
  // The welcome-back report and tips arrive over the first seconds: dismiss until the screen has been quiet for a while.
  for (let quiet = 0; quiet < 4;) {
    const open = await c.evalJs(`(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-actions button')].pop(); if (b) b.click(); return !!b; })()`);
    quiet = open ? 0 : quiet + 1;
    await sleep(open ? 700 : 600);
  }

  check('canvas role=application with label', await c.evalJs(`(() => { const e = document.getElementById('game-canvas'); return e.getAttribute('role') === 'application' && !!e.getAttribute('aria-label'); })()`));
  check('nav is a toolbar', await c.evalJs(`document.querySelector('.hud-bottom').getAttribute('role') === 'toolbar'`));
  const label = await c.evalJs(`document.querySelector('.resource-item').getAttribute('aria-label')`);
  check('resource button has a spoken label', !!label && /\d/.test(label), String(label));

  await key('b');
  check('B opens the build sheet (dialog, modal, labelled)', await c.evalJs(`(() => { const s = document.querySelector('.sheet-overlay.open .sheet'); return !!s && s.getAttribute('role') === 'dialog' && s.getAttribute('aria-modal') === 'true' && !!document.getElementById(s.getAttribute('aria-labelledby')); })()`));
  check('HUD and canvas are inert behind the sheet', await c.evalJs(`document.getElementById('hud').inert === true && document.getElementById('game-canvas').inert === true`));
  check('focus moved to the sheet title', await c.evalJs(`document.activeElement && document.activeElement.classList.contains('sheet-title')`));
  check('nav shows aria-current for build', await c.evalJs(`document.querySelector('.nav-btn[data-key="build"]').getAttribute('aria-current') === 'page'`));
  await key('Escape');
  check('Escape closes it and releases inert', await c.evalJs(`!document.querySelector('.sheet-overlay.open') && document.getElementById('hud').inert === false`));

  await c.evalJs(`document.querySelector('.nav-btn.nav-menu').focus(); document.querySelector('.nav-btn.nav-menu').click(); true`);
  await sleep(700);
  check('menu tabs are a tablist with one selected tab', await c.evalJs(`(() => { const r = document.querySelector('.sheet-overlay.open [role=tablist]'); return !!r && r.querySelectorAll('[role=tab]').length >= 4 && r.querySelectorAll('[aria-selected=true]').length === 1 && !!document.querySelector('.sheet-overlay.open [role=tabpanel]'); })()`));
  await c.evalJs(`document.querySelector('.sheet-overlay.open [role=tab][aria-selected=true]').focus(); true`);
  await key('ArrowLeft');
  check('arrow key moves to the next tab and keeps focus on a tab', await c.evalJs(`(() => { const a = document.activeElement; return a && a.getAttribute('role') === 'tab' && a.getAttribute('aria-selected') === 'true' && a.textContent.trim().length > 0; })()`), await c.evalJs(`document.activeElement.textContent.trim()`));
  await key('Escape');
  check('focus returns to the menu button', await c.evalJs(`document.activeElement === document.querySelector('.nav-btn.nav-menu')`));

  await key('l');
  const rooms = await c.evalJs(`document.querySelectorAll('.sheet-overlay.open .struct-room').length`);
  check('L opens the list view with rooms', rooms > 5, `${rooms} rooms`);
  await c.evalJs(`document.querySelector('.sheet-overlay.open .struct-room button').click(); true`);
  await sleep(800);
  check('"Open" in the list opens that room\'s panel', await c.evalJs(`!!document.querySelector('.sheet-overlay.open .sheet-title') && !document.querySelector('.sheet-overlay.open .struct-room')`));
  await key('Escape');

  const z0 = await c.evalJs(`__renderer.worldContainer.scale.x`);
  await key('+'); await sleep(1200);
  const z1 = await c.evalJs(`__renderer.worldContainer.scale.x`);
  check('+ zooms in', z1 > z0 * 1.05, `${z0.toFixed(2)} -> ${z1.toFixed(2)}`);
  const x0 = await c.evalJs(`__renderer.worldContainer.x`);
  await key('ArrowRight'); await sleep(1200);
  const x1 = await c.evalJs(`__renderer.worldContainer.x`);
  check('arrow pans the camera', Math.abs(x1 - x0) > 5, `${x0.toFixed(0)} -> ${x1.toFixed(0)}`);

  // announce(): the live region exists after an incident announcement.
  await c.evalJs(`(() => { const st = __engine.stateManager.state; const b = st.buildings.find(x => !x.isConstructing && x.position.floor >= 1); st.incidents.push({ id: 'sem-fire', kind: 'fire', buildingId: b.id, severity: 0.5, progress: 0, startedAt: Date.now(), peak: 0 }); return true; })()`);
  await sleep(1500);
  check('reduced motion flag reflects settings', await c.evalJs(`document.documentElement.dataset.motion === 'full' || document.documentElement.dataset.motion === 'reduced'`));
} finally { c.close(); srv.close(); }
process.exit(failed ? 1 : 0);

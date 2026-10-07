// Automatic accessibility audit (plan4 AC-15). No dependencies: it drives Chromium over the same CDP client as tools/perf/lib.mjs.
//
//   npm run build && node tools/a11y/audit.mjs                       # all viewports x text scales, JSON + summary
//   node tools/a11y/audit.mjs --quick                                 # one viewport, one scale (fast)
//   node tools/a11y/audit.mjs --url http://localhost:5173/            # use a running dev server instead of serving dist
//   node tools/a11y/audit.mjs --tag after --shots store/compare/a11y/shots
//
// For every viewport (375x667, 390x844, 430x932) and text scale (1.1, 1.4, 1.6) it loads the game on a mid-game sample save
// (store/sim/saves-v6, written into a throw-away Chrome profile: a real save is never touched) with `?slot=a11y&debug`, then audits the
// bare HUD, every bottom-nav sheet and every menu tab for:
//   targets   interactive elements smaller than 44x44 CSS px
//   contrast  text below 4.5:1 (3:1 for large text), computed from getComputedStyle by compositing the ancestors' backgrounds
//   noName    buttons / links / inputs with no accessible name
//   noAlt     images without alt (or aria-hidden)
//   overflow  elements sticking out of the viewport sideways
//   modals    dialogs and sheets whose last action / close button is outside the viewport
// Output: store/compare/a11y/<tag>.json plus a human summary on stdout. Never fails the build (exit 0) unless --strict.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, serve, sleep, waitFor } from '../perf/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true; };
const quick = !!arg('quick', false);
const tag = String(arg('tag', 'baseline'));
const dist = path.resolve(String(arg('dist', path.join(root, 'dist'))));
const extUrl = arg('url', '') ? String(arg('url')) : '';
const savePath = path.resolve(root, String(arg('save', 'store/sim/saves-v6/e30-seed1.json')));
const outDir = path.resolve(root, String(arg('out', 'store/compare/a11y')));
const shotsDir = arg('shots', '') ? path.resolve(String(arg('shots'))) : null;
const strict = !!arg('strict', false);
const only = arg('only', '') ? String(arg('only')).split(',') : null; // scene names
const extraQuery = String(arg('query', ''));

const VIEWPORTS = quick ? [[390, 844]] : [[375, 667], [390, 844], [430, 932]];
const SCALES = quick ? [1.1] : [1.1, 1.4, 1.6];
const CATS = ['targets', 'contrast', 'noName', 'noAlt', 'overflow', 'modals'];
const inpage = fs.readFileSync(path.join(here, 'inpage.js'), 'utf8');

async function lz() {
  const m = await import(pathToFileURL(path.join(root, 'node_modules', 'lz-string', 'libs', 'lz-string.js')).href);
  return (m.default ?? m).compressToUTF16;
}

/** Writes the sample save into the (empty) profile's IndexedDB under the key the game reads (main slot and the ?slot=a11y dev slot). */
async function seed(c, raw) {
  const compressToUTF16 = await lz();
  const json = JSON.stringify({ ...JSON.parse(raw), storyFlags: [...new Set([...(JSON.parse(raw).storyFlags ?? []), 'intro:done', 'difficulty:chosen'])] });
  const packed = compressToUTF16(json);
  await c.evalJs(`new Promise((res, rej) => {
    const open = indexedDB.open('keyval-store');
    open.onupgradeneeded = () => open.result.createObjectStore('keyval');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('keyval', 'readwrite'), st = tx.objectStore('keyval');
      const v = ${JSON.stringify(packed)};
      st.put(v, 'lastbunker_auto'); st.put(v, 'lastbunker_auto_a11y');
      tx.oncomplete = () => { db.close(); res(true); };
      tx.onerror = () => rej(tx.error);
    };
  })`);
}

const click = (c, expr) => c.evalJs(`(() => { const e = ${expr}; if (!e) return false; e.click(); return true; })()`);

/** Scenes: each one puts the UI into a state, then the page audit runs on it. */
const SCENES = [
  { name: 'hud', run: async () => undefined },
  ...['build', 'people', 'research', 'surface'].map(k => ({
    name: `sheet-${k}`,
    run: async (c) => { await click(c, `document.querySelector('.nav-btn[data-key="${k}"]')`); await sleep(700); },
    after: async (c) => { await click(c, `document.querySelector('.sheet-overlay.open .sheet-close, .sheet-overlay.open .surface-close')`); await sleep(450); },
  })),
  ...['settings', 'a11y', 'stats', 'achievements', 'genesis'].map((t, i) => ({
    name: `menu-${t}`,
    run: async (c) => {
      if (i === 0) { await click(c, `document.querySelector('.nav-btn.nav-menu')`); await sleep(700); }
      await click(c, `document.querySelectorAll('.sheet-overlay.open .tab-row .tab')[${i}]`); await sleep(400);
    },
    after: i === 4 ? async (c) => { await click(c, `document.querySelector('.sheet-overlay.open .sheet-close, .sheet-overlay.open .surface-close')`); await sleep(450); } : undefined,
  })),
];

async function auditConfig(c, port, w, h, scale, raw) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  const base = extUrl || `http://127.0.0.1:${port}/`;
  await c.send("Page.navigate", { url: `${base.split("?")[0]}privacy.html` });
  await sleep(1500);
  await seed(c, raw);
  // Text scale as the player would have chosen it (a11y.ts reads this key before the game starts).
  await c.evalJs(`localStorage.setItem('lastbunker_a11y', JSON.stringify({ textScale: ${scale} })); localStorage.setItem('lastbunker_gfx', 'low'); true`);
  await c.send('Page.navigate', { url: `${base}?slot=a11y&debug${extraQuery}` });
  const ok = await waitFor(c, '!!(window.__engine && window.__renderer && document.querySelector(".hud-bottom"))', 120, 500);
  if (!ok) throw new Error(`game did not start at ${w}x${h}`);
  await sleep(2500);
  await c.evalJs('setInterval(() => { __engine.paused = false; }, 200); true', false);
  // The bunker may greet the player (welcome-back report, tips): those dialogs are scenes of their own, audited first, then dismissed.
  const result = { w, h, scale, scenes: {} };
  const modalOpen = () => c.evalJs(`!!document.querySelector('.modal-overlay.open')`);
  for (let i = 0; i < 4 && await modalOpen(); i++) {
    const rep = await c.evalJs(inpage);
    result.scenes[`dialog-${i}`] = rep;
    if (shotsDir) await shot(c, `${w}x${h}-s${scale}-dialog-${i}`);
    await click(c, `[...document.querySelectorAll('.modal-overlay.open .modal-actions button')].pop()`);
    await sleep(600);
  }
  for (const sc of SCENES) {
    if (only && !only.includes(sc.name)) continue;
    try {
      await sc.run(c);
      result.scenes[sc.name] = await c.evalJs(inpage);
      if (shotsDir) await shot(c, `${w}x${h}-s${scale}-${sc.name}`);
      await sc.after?.(c);
    } catch (e) { result.scenes[sc.name] = { error: String(e).slice(0, 200) }; }
  }
  return result;
}

async function shot(c, name) {
  fs.mkdirSync(shotsDir, { recursive: true });
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotsDir, `${name}.png`), Buffer.from(r.data, 'base64'));
}

function summarize(results) {
  const perCfg = [], unique = Object.fromEntries(CATS.map(k => [k, new Map()]));
  for (const r of results) {
    const row = { cfg: `${r.w}x${r.h} @${r.scale}`, counts: {}, approxContrast: 0 };
    const seenCfg = Object.fromEntries(CATS.map(k => [k, new Set()]));
    for (const [scene, rep] of Object.entries(r.scenes)) {
      if (rep.error) continue;
      for (const k of CATS) for (const f of rep[k] ?? []) {
        const key = `${f.sel}${k === 'contrast' ? '|' + f.text : ''}`;
        seenCfg[k].add(key);
        const u = unique[k].get(key) ?? { ...f, scenes: new Set(), cfgs: new Set() };
        u.scenes.add(scene); u.cfgs.add(row.cfg);
        if (k === 'contrast') u.ratio = Math.min(u.ratio, f.ratio);
        unique[k].set(key, u);
        if (k === 'contrast' && f.approx) row.approxContrast += 0; // counted via seenCfg below
      }
      if (rep.docOverflow) { seenCfg.overflow.add('document'); }
    }
    for (const k of CATS) row.counts[k] = seenCfg[k].size;
    perCfg.push(row);
  }
  return { perCfg, unique };
}

async function main() {
  const raw = fs.readFileSync(savePath, 'utf8');
  const srv = extUrl ? null : await serve(dist);
  const c = await launch(['--disable-features=Translate']);
  const results = [];
  try {
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    for (const [w, h] of VIEWPORTS) for (const scale of SCALES) {
      process.stderr.write(`audit ${w}x${h} @${scale} ... `);
      try { results.push(await auditConfig(c, srv?.port, w, h, scale, raw)); process.stderr.write('ok\n'); }
      catch (e) { process.stderr.write(`FAILED ${e.message}\n`); results.push({ w, h, scale, scenes: { error: { error: String(e) } } }); }
    }
  } finally { c.close(); srv?.close(); }

  const { perCfg, unique } = summarize(results);
  fs.mkdirSync(outDir, { recursive: true });
  const uniq = Object.fromEntries(CATS.map(k => [k, [...unique[k].values()].map(u => ({ ...u, scenes: [...u.scenes], cfgs: [...u.cfgs] }))]));
  const totals = Object.fromEntries(CATS.map(k => [k, uniq[k].length]));
  const outFile = path.join(outDir, `${tag}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ tag, when: new Date().toISOString(), viewports: VIEWPORTS, scales: SCALES, totals, perConfig: perCfg, unique: uniq, raw: results }, null, 1));

  console.log(`\nAccessibility audit "${tag}" (${results.length} configurations) -> ${path.relative(root, outFile)}\n`);
  console.log('configuration'.padEnd(18) + CATS.map(k => k.padStart(10)).join(''));
  for (const r of perCfg) console.log(r.cfg.padEnd(18) + CATS.map(k => String(r.counts[k]).padStart(10)).join(''));
  console.log('unique offenders'.padEnd(18) + CATS.map(k => String(totals[k]).padStart(10)).join(''));
  const approx = uniq.contrast.filter(u => u.approx).length;
  console.log(`\n(contrast: ${approx} of ${totals.contrast} sit on a translucent layer over the canvas, so the backdrop is approximated)`);
  for (const k of CATS) {
    if (!uniq[k].length) continue;
    console.log(`\n${k} (${uniq[k].length}):`);
    for (const u of uniq[k].slice().sort((a, b) => b.cfgs.length - a.cfgs.length).slice(0, 12)) {
      const detail = k === 'targets' ? `${u.w}x${u.h} "${u.text}"` : k === 'contrast' ? `${u.ratio}:1 (need ${u.need}) ${u.px}px "${u.text}"${u.approx ? ' ~' : ''}` : k === 'overflow' ? `${u.left}..${u.right}` : '';
      console.log(`  ${u.sel}  ${detail}  [${u.scenes.slice(0, 3).join(',')}${u.scenes.length > 3 ? ',+' + (u.scenes.length - 3) : ''}] x${u.cfgs.length}`);
    }
  }
  if (strict && CATS.some(k => totals[k])) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(strict ? 1 : 0); });

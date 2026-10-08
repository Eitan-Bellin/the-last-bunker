#!/usr/bin/env node
// Screenshot protocol for the redesign (plan 4, X-5 / QA-2): the fixed camera views of src/dev/camShots.ts, shot at the iPhone sizes, and a
// numeric pixel diff between two shot sets. Plain Node, no dependencies beyond what the repo has (Chrome is driven with tools/perf/lib.mjs;
// PNGs are decoded/encoded here with zlib).
//
// USAGE
//   node tools/compare/run.mjs capture --tag before                          # default source: the 24-floor / 60-people perf fixture
//   node tools/compare/run.mjs capture --tag before --save store/sim/saves-v6/e30-seed1.json --save store/sim/saves-v6/c-seed1.json
//   node tools/compare/run.mjs capture --tag before --save store/sim/saves-v6          # a folder = every .json in it
//   node tools/compare/run.mjs capture --tag after  --sizes 390x844 --cams cam1,cam2 --lang he
//   node tools/compare/run.mjs diff before after                             # numeric diff per shot, exit 0
//   node tools/compare/run.mjs diff before after --check --tolerance 1       # exit 1 if any shot differs by more than 1 % of its pixels
//   node tools/compare/run.mjs diff before after --block 1 --threshold 0   # strict: every pixel, any change (grain and dust show up)
//   node tools/compare/run.mjs diff before after --images                    # also write red-on-grey diff PNGs next to the shots
//
// capture options
//   --tag <name>        output folder store/compare/<name>/ (gitignored). Required.
//   --save <file|dir>   a sample game (the JSON `tools/sim/run.mjs --dump-save` writes); repeatable or comma separated. Its timestamp is set
//                       to "now" so no offline catch-up changes the bunker between runs (use --keep-time to leave it alone).
//   --fixture <FxP>     F floors and P people built by the perf fixture, e.g. 24x60 (default when no --save); `--fixture 24x60w` adds
//                       ?perfFixture=wide (the wide-floor hook of X-4).
//   --sizes <list>      CSS-pixel device sizes (default 375x667,375x812,390x844,430x932).
//   --dpr <n>           device pixel ratio (default 2; plan 4 asks for 3 on the final protocol: pass --dpr 3).
//   --cams <list>       view-id prefixes (default: all of __camIds, i.e. cam1..cam6; a view the bunker lacks is skipped and reported).
//   --eval <js>         JavaScript run in the page after the game is frozen and before the shots (state tweaks such as a pushed district).
//   --lang en|he        language (default en).     --quality low|medium|high   starting quality (the shot itself pins high, like __compare).
//   --text <n>          not supported yet (reserved for the text-size axis of QA-2).
//   --frames <n>        frames rendered by hand before each shot (default 20).
//   --repeat <n>        take each shot n times in a row and keep the last (long animations in short steps, see the code).
//   --url <origin>      use an already running DEV server (e.g. http://localhost:5173) instead of starting Vite on a free port. Needed:
//                       ?slot and __camPng exist in dev builds only, so a production `dist` cannot be shot with this tool.
// Files: store/compare/<tag>/<source>/<WxH>/<camId>.png  (+ meta.json: git head, sizes, dpr, time).
// Chrome: set CHROME=<path> (this container: CHROME=/opt/pw-browsers/chromium, picked up automatically by tools/perf/lib.mjs).
// Known noise: production pop-ups ("+0.9"), light glows and film grain follow the wall clock, so two captures of the SAME code differ: measured
// 2.8 % (overview) to 4.1 % (close-up) of 4x4 blocks on a 30-day sample at 390x844, mostly the pop-up blobs. Diff is therefore block-averaged
// (--block 4, grain disappears) and a refactor that must be pixel-identical is judged against the floor: capture the baseline twice
// (`--tag base`, `--tag base2`), `diff base base2` once, and treat anything clearly above that as a real change (look at --images).
// Speed: a software-GL machine (this container, CI) needs about 1-2 minutes per source and size; use --sizes / --cams / --frames to narrow.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launch, phoneSetup, sleep, waitFor } from '../perf/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(root, 'store', 'compare');
const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
const multi = { save: [] };
const positional = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (k in multi) multi[k].push(v); else flags[k] = v;
  } else positional.push(argv[i]);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PNG: decode (8-bit gray / gray+alpha / RGB / RGBA / palette, non-interlaced) and encode (RGBA), zlib only.
// ---------------------------------------------------------------------------------------------------------------------------------
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, plte = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error(`unsupported PNG colour type ${ctype}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0, b = y ? px[dst - stride + x] : 0, c = x >= ch && y ? px[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (ctype === 6) { px.copy(rgba, o, i * 4, i * 4 + 4); }
    else if (ctype === 2) { rgba[o] = px[i * 3]; rgba[o + 1] = px[i * 3 + 1]; rgba[o + 2] = px[i * 3 + 2]; rgba[o + 3] = 255; }
    else if (ctype === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[i]; rgba[o + 3] = 255; }
    else if (ctype === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[i * 2]; rgba[o + 3] = px[i * 2 + 1]; }
    else { const k = px[i] * 3; rgba[o] = plte[k]; rgba[o + 1] = plte[k + 1]; rgba[o + 2] = plte[k + 2]; rgba[o + 3] = 255; }
  }
  return { w, h, rgba };
}

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); // filter 0 on every row
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Box-averages `block` x `block` pixels (film grain and dust speckle average out; real changes of a few pixels in size survive). */
function downscale(img, block) {
  if (block <= 1) return img;
  const w = Math.floor(img.w / block), h = Math.floor(img.h / block), out = Buffer.alloc(w * h * 4), n = block * block;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sum = [0, 0, 0, 0];
    for (let j = 0; j < block; j++) for (let i = 0; i < block; i++) { const o = ((y * block + j) * img.w + x * block + i) * 4; for (let k = 0; k < 4; k++) sum[k] += img.rgba[o + k]; }
    for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = Math.round(sum[k] / n);
  }
  return { w, h, rgba: out };
}

/**
 * Compares two RGBA images after averaging `block`x`block` pixels. A block counts as different when any channel moves by more than `threshold`
 * (of 255). Returns the share of such blocks (diffPct) and the mean absolute error over all channels (meanErrPct).
 */
export function diffImages(a, b, threshold = 8, wantImage = false, block = 4) {
  if (a.w !== b.w || a.h !== b.h) return { sameSize: false, diffPct: 100, meanErrPct: 100, size: `${a.w}x${a.h} vs ${b.w}x${b.h}` };
  a = downscale(a, block); b = downscale(b, block);
  const n = a.w * a.h;
  let bad = 0, err = 0;
  const out = wantImage ? Buffer.alloc(n * 4) : null;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d0 = Math.abs(a.rgba[o] - b.rgba[o]), d1 = Math.abs(a.rgba[o + 1] - b.rgba[o + 1]), d2 = Math.abs(a.rgba[o + 2] - b.rgba[o + 2]), d3 = Math.abs(a.rgba[o + 3] - b.rgba[o + 3]);
    const d = Math.max(d0, d1, d2, d3);
    err += d0 + d1 + d2 + d3;
    if (d > threshold) bad++;
    if (out) {
      if (d > threshold) { out[o] = 255; out[o + 1] = 40; out[o + 2] = 40; } else { const g = (a.rgba[o] + a.rgba[o + 1] + a.rgba[o + 2]) / 3 * 0.35 + 140; out[o] = out[o + 1] = out[o + 2] = g; }
      out[o + 3] = 255;
    }
  }
  return { sameSize: true, diffPct: +(bad / n * 100).toFixed(3), meanErrPct: +(err / (n * 4 * 255) * 100).toFixed(3), size: `${a.w}x${a.h}`, image: out };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------------------------------------------------------------
function listPngs(dir) {
  const out = [];
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.png')) out.push(path.relative(dir, p).split(path.sep).join('/')); } };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

function runDiff() {
  const [ta, tb] = positional;
  if (!ta || !tb) { console.error('usage: node tools/compare/run.mjs diff <tagA> <tagB> [--threshold 8] [--tolerance 1] [--block 4] [--check] [--images]'); process.exit(2); }
  const A = path.join(OUT, ta), B = path.join(OUT, tb);
  const threshold = +(flags.threshold ?? 8), tolerance = +(flags.tolerance ?? 1), block = +(flags.block ?? 4);
  const names = [...new Set([...listPngs(A), ...listPngs(B)])].sort();
  if (!names.length) { console.error(`no shots under ${A} or ${B}`); process.exit(2); }
  const rows = [];
  for (const n of names) {
    const fa = path.join(A, n), fb = path.join(B, n);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) { rows.push({ shot: n, missing: fs.existsSync(fa) ? tb : ta, diffPct: 100, meanErrPct: 100 }); continue; }
    const r = diffImages(decodePng(fs.readFileSync(fa)), decodePng(fs.readFileSync(fb)), threshold, !!flags.images, block);
    if (r.image) { const dst = path.join(OUT, `diff-${ta}-vs-${tb}`, n); fs.mkdirSync(path.dirname(dst), { recursive: true }); const [w, h] = r.size.split('x').map(Number); fs.writeFileSync(dst, encodePng(w, h, r.image)); }
    delete r.image;
    rows.push({ shot: n, ...r });
  }
  const pad = (s, k) => String(s).padEnd(k);
  console.log(`${pad('shot', 58)} ${pad('diff %', 9)} ${pad('mean err %', 11)} note`);
  for (const r of rows) console.log(`${pad(r.shot, 58)} ${pad(r.diffPct, 9)} ${pad(r.meanErrPct, 11)} ${r.missing ? `only in ${r.missing === ta ? tb : ta}` : r.sameSize === false ? `size ${r.size}` : r.diffPct > tolerance ? 'OVER' : ''}`);
  const over = rows.filter(r => r.diffPct > tolerance);
  const mean = rows.reduce((a, r) => a + r.diffPct, 0) / rows.length;
  console.log(`\n${rows.length} shots, mean diff ${mean.toFixed(3)} %, max ${Math.max(...rows.map(r => r.diffPct))} %, ${over.length} over ${tolerance} % (a ${block}x${block} block counts as different above ${threshold}/255)`);
  const summary = { a: ta, b: tb, block, threshold, tolerance, meanDiffPct: +mean.toFixed(3), over: over.length, rows };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `diff-${ta}-vs-${tb}.json`), JSON.stringify(summary, null, 1));
  if (flags.check && over.length) process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------------------------------------------------------------
async function startVite() {
  const net = await import('node:net');
  const port = await new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const proc = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(url + '/')).ok) return { url, stop: () => proc.kill() }; } catch { /* not up yet */ } await sleep(500); }
  proc.kill();
  throw new Error('Vite dev server did not start');
}

const gitHead = () => { try { return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { return null; } };

/** Writes the sample game into the browser's IndexedDB under the dev slot's key, in the game's own format (LZ-compressed JSON, UTF-16). */
async function seedSave(c, origin, slot, jsonText) {
  const lz = createRequire(import.meta.url)('lz-string');
  const state = JSON.parse(jsonText);
  if (!flags['keep-time']) state.timestamp = Date.now();
  const value = lz.compressToUTF16(JSON.stringify(state));
  await c.send('Page.navigate', { url: `${origin}/icon.svg` }); // any page of the same origin can write the origin's IndexedDB
  await sleep(800);
  await c.evalJs(`new Promise((res, rej) => { const r = indexedDB.open('keyval-store'); r.onupgradeneeded = () => r.result.createObjectStore('keyval');
    r.onsuccess = () => { const db = r.result, tx = db.transaction('keyval', 'readwrite'); tx.objectStore('keyval').put(${JSON.stringify(value)}, ${JSON.stringify('lastbunker_auto_' + slot)});
    tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); })`);
  return state;
}

async function shootSource(origin, source, size, tag) {
  const [w, h] = size.split('x').map(Number);
  const dpr = +(flags.dpr ?? 2);
  const c = await launch();
  const dir = path.join(OUT, tag, source.name, size);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const lang = flags.lang === 'he' ? 'he' : 'en';
    // __forceNight = 0 holds the clock at day (camShots reads it on every frame of a shot).
    await phoneSetup(c, { quality: flags.quality || 'medium', dpr, width: w, height: h, extraInit: `window.__forceNight = 0; try { localStorage.setItem('lastbunker_lang', '${lang}'); } catch (e) {}` });
    const slot = 'cmp';
    let expectFloors = null;
    if (source.save) expectFloors = (await seedSave(c, origin, slot, source.save)).currentFloors;
    await c.send('Page.navigate', { url: `${origin}/?debug&slot=${slot}${source.wide ? '&perfFixture=wide' : ''}` });
    if (!await waitFor(c, '!!(window.__engine && window.__renderer && window.__camPng && window.__perfFixture)', 240, 500)) throw new Error('game did not start (is this a dev server with src/dev/camShots.ts?)');
    await sleep(3000);
    if (source.fixture) await c.evalJs(`window.__perfFixture(${source.fixture[0]}, ${source.fixture[1]})`);
    else {
      const floors = await c.evalJs('__engine.stateManager.state.currentFloors');
      if (floors !== expectFloors) console.log(`   warning: ${source.name} has ${expectFloors} floors but the game loaded ${floors} (save not picked up?)`);
    }
    // Freeze the world: the game loop stops, so only the shot's own hand-stepped frames advance animation.
    await c.evalJs('__engine.paused = true; __engine.running = false; true', false);
    await sleep(500);
    // --eval <js>: runs in the page once the game is frozen, before the shots (e.g. to set up a wing with __setExt).
    if (flags.eval && flags.eval !== true) { await c.evalJs(String(flags.eval)); await sleep(400); }
    const ids = flags.cams ? String(flags.cams).split(',') : await c.evalJs('window.__camIds');
    const skipped = [];
    let n = 0;
    for (const id of ids) {
      // [plan4:polish] --repeat n: the shot is taken n times in a row (frames each) and the last one kept: a long animation (smoke, a walk) is stepped in short
      // evaluations, because one evaluation of hundreds of frames hangs on a software-GL machine.
      let r = null;
      for (let k = 0; k < Math.max(1, +(flags.repeat ?? 1)); k++) r = await c.evalJs(`__camPng(${JSON.stringify(id)}, ${dpr}, ${+(flags.frames ?? 20)})`);
      if (!r) { skipped.push(id); continue; }
      fs.writeFileSync(path.join(dir, `${r.id}.png`), Buffer.from(r.png, 'base64'));
      n++;
    }
    const errs = c.events.filter(e => e.method === 'Runtime.exceptionThrown').length;
    console.log(`   ${source.name} ${size}@${dpr}x: ${n} shots${skipped.length ? `, no subject for ${skipped.join(',')}` : ''}${errs ? `, ${errs} page exceptions` : ''}`);
  } finally { c.close(); }
}

async function runCapture() {
  const tag = flags.tag;
  if (!tag || tag === true) { console.error('capture needs --tag <name>'); process.exit(2); }
  const sizes = String(flags.sizes || '375x667,375x812,390x844,430x932').split(',');
  const sources = [];
  for (const spec of multi.save.flatMap(s => String(s).split(','))) {
    const p = path.resolve(spec);
    const files = fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f)) : [p];
    for (const f of files) sources.push({ name: path.basename(f, '.json'), save: fs.readFileSync(f, 'utf8') });
  }
  if (flags.fixture || !sources.length) {
    const m = /^(\d+)x(\d+)(w?)$/.exec(String(flags.fixture === true || !flags.fixture ? '24x60' : flags.fixture));
    if (!m) { console.error('--fixture must look like 24x60 or 24x60w'); process.exit(2); }
    sources.push({ name: `fixture-${m[1]}x${m[2]}${m[3]}`, fixture: [+m[1], +m[2]], wide: !!m[3] });
  }
  let vite = null;
  const origin = flags.url && flags.url !== true ? String(flags.url).replace(/\/$/, '') : (vite = await startVite()).url;
  console.log(`capture "${tag}" from ${origin}: ${sources.map(s => s.name).join(', ')} x ${sizes.join(' ')}`);
  try {
    for (const s of sources) for (const size of sizes) await shootSource(origin, s, size, tag);
  } finally { vite?.stop(); }
  fs.writeFileSync(path.join(OUT, tag, 'meta.json'), JSON.stringify({ tag, head: gitHead(), at: new Date().toISOString(), sizes, dpr: +(flags.dpr ?? 2), lang: flags.lang || 'en', sources: sources.map(s => s.name) }, null, 1));
  console.log(`done: ${path.join(OUT, tag)}`);
}

if (cmd === 'capture') await runCapture();
else if (cmd === 'diff') runDiff();
else { console.error('usage: node tools/compare/run.mjs capture --tag <name> [--save <file|dir>] [--fixture 24x60] [--sizes ...]\n       node tools/compare/run.mjs diff <tagA> <tagB> [--check] [--tolerance 1] [--images]'); process.exit(2); }
process.exit(0);

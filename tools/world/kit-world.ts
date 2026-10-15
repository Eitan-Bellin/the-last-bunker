/**
 * WORLD KIT BAKER ("The City Below", asset-pipeline agent)
 * =========================================================================================================================
 *
 * README
 * ------
 * What it makes: every sprite, tile, strip and plate of the world redesign (rock cut faces per kit, banding strips, the cut-edge
 * rim and AO, caution tape, railing, deck, the Bell Square vault wall, the service-corridor tile, blast doors, stair flights,
 * rubble, timber, lamps, far / back plates, foreground silhouettes) as WebP files in `public/art/world/`, plus emissive masks and
 * `public/art/world/world.json` (the table with frames and byte sizes, for tools and docs; the game reads the same table from
 * `src/world/tokensAssets.ts` and does not need the JSON).
 *
 * Everything is procedural (Canvas 2D, seeded by the asset id): rerunning gives the same pixels. The only inputs besides code are
 * three painted kit files already in the repo, re-used as material detail (`public/art/kit/wall-L.webp` concrete, `wheel.webp` the
 * door hand wheel). Missing inputs fall back to noise.
 *
 * How to run (dev server must be up, e.g. launch config "world" on port 5176):
 *   - look:      http://localhost:5176/tools/world/kit-world.html            bakes in the page and shows the contact sheet (no saving)
 *   - bake+save: http://localhost:5176/tools/world/kit-world.html?auto       also POSTs every file to /__art/save/world/... (vite.config.ts)
 *   - check:     http://localhost:5176/tools/world/kit-world.html?view       shows what is on disk (loads public/art/world)
 *   - one asset: add &only=rock-shelter,door-closed (with ?auto it saves only those; atlas pages are always rebaked whole)
 *   Headless (the browser pane pauses hidden tabs):
 *     chrome --headless=new --virtual-time-budget=120000 --window-size=1400,900 "http://localhost:5176/tools/world/kit-world.html?auto"
 *   The page sets document.title to "WORLD KIT DONE <n> files <bytes>" when it has finished.
 *
 * Where things are defined:
 *   - sizes, world units, anchors, lamps, atlas pages: src/world/tokensAssets.ts (shared with the runtime)
 *   - recipes: tools/world/recipes-surfaces.ts (per-pixel tiles and strips), recipes-plates.ts (plates), recipes-sprites.ts (sprites)
 *   - painting helpers and the "one hand" passes (palette cap, lit height fields, grain, 1.5 u outline): tools/world/paint.ts
 *   - runtime loader with procedural fallbacks: src/art/worldKit.ts
 *   - inventory and budget: store/world-redesign/C-assets.md
 *
 * Budget rule: the whole kit stays under 2.5 MB on disk; the page prints the total and turns red above it.
 */
import { WORLD_ASSETS, WORLD_ASSET_IDS, WORLD_DIR, WORLD_KIT_VERSION, WORLD_PAGES, worldEmissiveFile, worldFrame, worldFrames, type WorldAssetDef, type WorldAssetId, type WorldKitId, type WorldPageId } from '../../src/world/tokensAssets';
import { ctx, loadImage, mk, webp } from './paint';
import { corridorTile, deck, edgeAo, edgeRim, hubVault, railing, rockBand, rockTile, tape, type Baked, type Sources } from './recipes-surfaces';
import { backGalleries, backPipes, backSurface, farPlate, foreLip } from './recipes-plates';
import {
  door, foreCable, foreOutcrop, forePipeH, forePipes, lampBeacon, lampBulb, lampCage, lampChandelier, lampLantern, lampTube, lampWall, lampWork,
  rubble, stairFlight, timberBeam, timberPlanks, timberSet,
} from './recipes-sprites';

const BUDGET = 2.5 * 1024 * 1024;
const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');
const VIEW = params.has('view');
const ONLY = params.get('only')?.split(',').filter(Boolean) ?? null;

const logEl = document.getElementById('log')!;
const log = (s: string) => { logEl.textContent += s + '\n'; console.log(s); };

type Recipe = (def: WorldAssetDef, src: Sources) => Baked;
const RECIPES: Record<WorldAssetId, Recipe> = {} as Record<WorldAssetId, Recipe>;
for (const id of WORLD_ASSET_IDS) {
  if (id.startsWith('rock-')) RECIPES[id] = d => rockTile(d, id.slice(5) as WorldKitId);
  else if (id.startsWith('band-')) RECIPES[id] = d => rockBand(d, id.slice(5) as WorldKitId);
}
Object.assign(RECIPES, {
  'edge-rim': edgeRim, 'edge-ao': edgeAo, tape, railing, deck,
  'hub-vault': hubVault, 'corridor-tile': corridorTile,
  'far-shelter': (d: WorldAssetDef) => farPlate(d, true), 'far-generic': (d: WorldAssetDef) => farPlate(d, false),
  'back-shelter': backGalleries, 'back-pipes': backPipes, 'back-surface': backSurface, 'fore-lip': foreLip,
  'door-closed': (d: WorldAssetDef, s: Sources) => door(d, s, 'closed'), 'door-open': (d: WorldAssetDef, s: Sources) => door(d, s, 'open'),
  'door-welded': (d: WorldAssetDef, s: Sources) => door(d, s, 'welded'),
  'stair-flight': stairFlight, 'rubble-a': (d: WorldAssetDef, s: Sources) => rubble(d, s, 'a'), 'rubble-b': (d: WorldAssetDef, s: Sources) => rubble(d, s, 'b'),
  'rubble-c': (d: WorldAssetDef, s: Sources) => rubble(d, s, 'c'), 'timber-set': timberSet, 'timber-planks': timberPlanks, 'timber-beam': timberBeam,
  'lamp-tube': lampTube, 'lamp-chandelier': lampChandelier, 'lamp-bulb': lampBulb, 'lamp-work': lampWork, 'lamp-cage': lampCage,
  'lamp-wall': lampWall, 'lamp-beacon': lampBeacon, 'lamp-lantern': lampLantern,
  'fore-outcrop': foreOutcrop, 'fore-pipes': forePipes, 'fore-cable': foreCable, 'fore-pipe-h': forePipeH,
} satisfies Partial<Record<WorldAssetId, Recipe>>);

/** WebP quality per output (alpha strips need a little more, plates and masks less). */
function quality(file: string): number {
  if (file.endsWith('-e')) return 0.72;
  if (file.startsWith('far-') || file.startsWith('back-')) return 0.76;
  if (file.startsWith('rock-') || file.startsWith('band-')) return 0.8;
  if (file.startsWith('atlas-')) return 0.86;
  return 0.84;
}

interface OutFile { name: string; canvas: HTMLCanvasElement; blob?: Blob }

async function bakeAll(): Promise<{ files: OutFile[]; baked: Map<WorldAssetId, Baked> }> {
  const [wall, column, wheel] = await Promise.all([loadImage('/art/kit/wall-L.webp'), loadImage('/art/kit/column-L.webp'), loadImage('/art/kit/wheel.webp')]);
  const src: Sources = { wall, column, wheel };
  log(`sources: wall ${wall ? 'ok' : 'missing'}, wheel ${wheel ? 'ok' : 'missing'}`);
  worldFrames(); // throws on an overflowing page
  const baked = new Map<WorldAssetId, Baked>();
  const files: OutFile[] = [];
  for (const id of WORLD_ASSET_IDS) {
    const def = WORLD_ASSETS[id];
    if (ONLY && !def.page && !ONLY.includes(id)) continue;
    const t0 = performance.now();
    const b = RECIPES[id](def, src);
    if (b.albedo.width !== def.px[0] || b.albedo.height !== def.px[1]) throw new Error(`${id}: painted ${b.albedo.width}x${b.albedo.height}, table says ${def.px.join('x')}`);
    baked.set(id, b);
    log(`${id.padEnd(16)} ${def.px.join('x').padEnd(9)} ${(performance.now() - t0).toFixed(0)} ms`);
    await new Promise(r => setTimeout(r, 0));
    if (!def.page) {
      files.push({ name: def.file, canvas: b.albedo });
      const ef = worldEmissiveFile(id);
      if (ef && b.emissive) files.push({ name: ef, canvas: b.emissive });
    }
  }
  // atlas pages and their emissive twins
  for (const pid of Object.keys(WORLD_PAGES) as WorldPageId[]) {
    const P = WORLD_PAGES[pid];
    const page = mk(P.size[0], P.size[1]);
    const pe = mk(P.size[0], P.size[1]);
    const peg = ctx(pe);
    peg.fillStyle = '#000';
    peg.fillRect(0, 0, pe.width, pe.height);
    for (const id of WORLD_ASSET_IDS) {
      const def = WORLD_ASSETS[id];
      if (def.page !== pid) continue;
      const f = worldFrame(id);
      const b = baked.get(id)!;
      ctx(page).drawImage(b.albedo, f.x, f.y);
      if (b.emissive) peg.drawImage(b.emissive, f.x, f.y);
    }
    files.push({ name: P.file, canvas: page });
    if (P.emissive) files.push({ name: `${P.file}-e`, canvas: pe });
  }
  for (const f of files) f.blob = await webp(f.canvas, quality(f.name));
  return { files, baked };
}

async function save(files: OutFile[]): Promise<void> {
  for (const f of files) {
    const res = await fetch(`/__art/save/${WORLD_DIR}/${f.name}.webp`, { method: 'POST', body: f.blob });
    if (!res.ok) throw new Error(`save ${f.name}: ${res.status}`);
  }
  const sizes: Record<string, number> = {};
  for (const f of files) sizes[f.name] = f.blob!.size;
  let prev: { files?: Record<string, number> } = {};
  if (ONLY) { try { prev = await (await fetch(`/art/${WORLD_DIR}/world.json?${Date.now()}`)).json(); } catch { /* first run */ } }
  const allSizes = { ...(prev.files ?? {}), ...sizes };
  const json = {
    version: WORLD_KIT_VERSION,
    note: 'Generated by tools/world/kit-world.ts. The game reads src/world/tokensAssets.ts; this file is for tools and docs.',
    totalBytes: Object.values(allSizes).reduce((a, b) => a + b, 0),
    files: allSizes,
    assets: Object.fromEntries(WORLD_ASSET_IDS.map(id => [id, { ...WORLD_ASSETS[id], frame: worldFrame(id), emissiveFile: worldEmissiveFile(id) }])),
  };
  await fetch(`/__art/save/${WORLD_DIR}/world.json`, { method: 'POST', body: JSON.stringify(json, null, 1) });
}

// =================================================================================================================================
// Contact sheet
// =================================================================================================================================

function checker(c: HTMLCanvasElement): void {
  const g = ctx(c);
  for (let y = 0; y < c.height; y += 8) for (let x = 0; x < c.width; x += 8) { g.fillStyle = ((x + y) / 8) % 2 ? '#26262a' : '#1e1e22'; g.fillRect(x, y, 8, 8); }
}

/** A 48-unit adult silhouette for scale, drawn at `ppu`. */
function person(g: CanvasRenderingContext2D, x: number, yBottom: number, ppu: number): void {
  const s = ppu;
  g.fillStyle = 'rgba(255,216,160,0.55)';
  g.beginPath(); g.arc(x, yBottom - 44 * s, 4 * s, 0, Math.PI * 2); g.fill();
  g.fillRect(x - 5 * s, yBottom - 39 * s, 10 * s, 18 * s);
  g.fillRect(x - 4.5 * s, yBottom - 21 * s, 4 * s, 21 * s);
  g.fillRect(x + 0.5 * s, yBottom - 21 * s, 4 * s, 21 * s);
}

function card(title: string, sub: string, canvas: HTMLCanvasElement): HTMLElement {
  const d = document.createElement('div');
  d.className = 'card';
  const h = document.createElement('div');
  h.className = 'cap';
  h.innerHTML = `<b>${title}</b> ${sub}`;
  d.append(canvas, h);
  return d;
}

function preview(id: WorldAssetId, alb: CanvasImageSource, emi: CanvasImageSource | null, bytes: number | null): HTMLElement {
  const def = WORLD_ASSETS[id];
  const [w, h] = def.px;
  const tiles = def.repeat === 'xy' ? 2 : def.repeat === 'x' ? 2 : 1;
  const maxW = def.repeat === 'none' ? 360 : 520;
  const k = Math.min(1, maxW / (w * tiles), 300 / (h * (def.repeat === 'xy' ? 2 : 1)));
  const sprite = def.repeat === 'none';
  const scaleW = sprite ? Math.max(48 * def.ppu * 0.6, 0) : 0;
  const c = mk(w * tiles * k + (sprite ? scaleW + 20 : 0), h * (def.repeat === 'xy' ? 2 : 1) * k);
  checker(c);
  const g = ctx(c);
  for (let ty = 0; ty < (def.repeat === 'xy' ? 2 : 1); ty++) for (let tx = 0; tx < tiles; tx++) {
    g.drawImage(alb, tx * w * k, ty * h * k, w * k, h * k);
    if (emi) { g.save(); g.globalCompositeOperation = 'lighter'; g.drawImage(emi, tx * w * k, ty * h * k, w * k, h * k); g.restore(); }
  }
  if (sprite) person(g, w * k + 14 + scaleW / 2, h * k, def.ppu * k);
  // lamp and glow spots, anchor
  const ax = def.anchor[0] * w * k, ay = def.anchor[1] * h * k;
  if (sprite) {
    g.strokeStyle = '#4af'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(ax - 4, ay); g.lineTo(ax + 4, ay); g.moveTo(ax, ay - 4); g.lineTo(ax, ay + 4); g.stroke();
    for (const L of def.lamps ?? []) { g.strokeStyle = '#ff0'; g.beginPath(); g.arc(ax + L.x * def.ppu * k, ay + L.y * def.ppu * k, 3, 0, Math.PI * 2); g.stroke(); }
  }
  const kb = bytes != null ? ` ${(bytes / 1024).toFixed(1)} KB` : '';
  return card(id, `${w}x${h}px · ${def.world.map(v => Math.round(v)).join('x')}u · ${def.repeat}${kb}`, c);
}

/** A rough slice mock-up: rock, a cut cavity with its rim and AO, the vault wall, balcony, stairs, door, chandelier and pools. */
function mock(get: (id: WorldAssetId) => { a: CanvasImageSource; e: CanvasImageSource | null }): HTMLElement {
  const W = 1200, H = 620, Z = 1.25; // screen px per world unit
  const c = mk(W, H);
  const g = ctx(c);
  const draw = (id: WorldAssetId, x: number, y: number, flip = false) => {
    const def = WORLD_ASSETS[id];
    const s = Z / def.ppu;
    const { a, e } = get(id);
    const fw = def.px[0] * s, fh = def.px[1] * s;
    g.save();
    g.translate(x, y);
    if (flip) g.scale(-1, 1);
    g.drawImage(a, -def.anchor[0] * fw, -def.anchor[1] * fh, fw, fh);
    g.restore();
    return { e, fw, fh, def, x, y, flip };
  };
  const tileX = (id: WorldAssetId, x0: number, x1: number, y: number) => { const def = WORLD_ASSETS[id]; const step = def.world[0] * Z; for (let x = x0; x < x1; x += step) draw(id, x, y); };
  // rock everywhere
  const rk = WORLD_ASSETS['rock-shelter'];
  for (let y = 0; y < H; y += rk.world[1] * Z) for (let x = 0; x < W; x += rk.world[0] * Z) draw('rock-shelter', x, y);
  tileX('band-shelter', 0, W, 60);
  // the cavity
  const cx0 = 150, cx1 = 1050, cy0 = 140, cy1 = 560;
  g.save();
  g.beginPath(); g.rect(cx0, cy0, cx1 - cx0, cy1 - cy0); g.clip();
  tileX('hub-vault', cx0, cx1, cy1);
  tileX('hub-vault', cx0, cx1, cy1 - 192 * Z);
  // edges
  g.restore();
  g.save(); g.beginPath(); g.rect(cx0, cy0, cx1 - cx0, cy1 - cy0); g.clip();
  tileX('edge-ao', cx0, cx1, cy0);
  g.restore();
  g.save(); g.globalAlpha = 0.35; g.globalCompositeOperation = 'source-over';
  tileX('edge-rim', cx0, cx1, cy0 - 2);
  g.restore();
  // balcony
  const by = cy1 - 150 * Z;
  g.save(); g.beginPath(); g.rect(cx0, 0, 380, H); g.clip();
  tileX('deck', cx0, cx0 + 380, by);
  tileX('railing', cx0, cx0 + 380, by);
  g.restore();
  // stairs from the floor to the balcony
  // stairs: four flights rising leftward from the floor to the balcony end (scale.x = -1)
  let sx = cx0 + 380 + 4 * 38 * Z, sy = cy1;
  for (let i = 0; i < 4; i++) { draw('stair-flight', sx, sy, true); sx -= 38 * Z; sy -= 36 * Z; }
  const doorP = draw('door-closed', cx1 - 120, cy1);
  const ch = draw('lamp-chandelier', 640, cy0);
  const rb = draw('rubble-c', 300, cy1);
  const tube = draw('lamp-tube', 860, cy0 + 4);
  const work = draw('lamp-work', 960, cy1);
  draw('lamp-wall', cx0 + 100, by - 40 * Z);
  void rb;
  // ambient darkness + pools (multiply), then emissive (add)
  const L = mk(W, H);
  const lg = ctx(L);
  lg.fillStyle = 'rgb(70,62,52)';
  lg.fillRect(0, 0, W, H);
  lg.globalCompositeOperation = 'lighter';
  const pool = (x: number, y: number, r: number, col: string) => { const gr = lg.createRadialGradient(x, y, r * 0.1, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); lg.fillStyle = gr; lg.fillRect(x - r, y - r, r * 2, r * 2); };
  pool(640, cy0 + 75 * Z, 320 * Z, 'rgba(255,194,122,0.95)');
  pool(860, cy0 + 12, 130 * Z, 'rgba(200,240,224,0.7)');
  pool(965, cy1 - 70 * Z, 160 * Z, 'rgba(255,240,208,0.6)');
  pool(cx0 + 100, by - 40 * Z, 90 * Z, 'rgba(255,194,122,0.7)');
  g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(L, 0, 0); g.restore();
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const p of [doorP, ch, tube, work]) {
    if (!p.e) continue;
    const f = worldFrame(p.def.id);
    const s = Z / p.def.ppu;
    g.drawImage(p.e, f.x, f.y, f.w, f.h, p.x - p.def.anchor[0] * p.fw, p.y - p.def.anchor[1] * p.fh, f.w * s, f.h * s);
  }
  g.restore();
  person(g, 560, cy1, Z);
  person(g, 700, cy1, Z);
  return card('slice mock-up', '(rough composite: rock, cavity, vault wall, balcony, stairs, door, chandelier, pools, emissive)', c);
}

async function main(): Promise<void> {
  const out = document.getElementById('outs')!;
  let totalBytes = 0;
  const sizeOf = new Map<string, number>();
  const albedoOf = new Map<WorldAssetId, CanvasImageSource>();
  const emissiveOf = new Map<WorldAssetId, CanvasImageSource | null>();
  const pageImg = new Map<string, CanvasImageSource>();
  if (VIEW) {
    const json = await (await fetch(`/art/${WORLD_DIR}/world.json?${Date.now()}`)).json().catch(() => ({ files: {} }));
    for (const [k, v] of Object.entries(json.files as Record<string, number>)) { sizeOf.set(k, v); totalBytes += v; }
    const load = async (name: string) => { if (!pageImg.has(name)) { const im = await loadImage(`/art/${WORLD_DIR}/${name}.webp?${Date.now()}`); if (im) pageImg.set(name, im); } return pageImg.get(name) ?? null; };
    for (const id of WORLD_ASSET_IDS) {
      const def = WORLD_ASSETS[id];
      const im = await load(def.file);
      const ef = worldEmissiveFile(id);
      const em = ef ? await load(ef) : null;
      if (!im) continue;
      if (def.page) {
        const f = worldFrame(id);
        const a = mk(f.w, f.h); ctx(a).drawImage(im, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
        albedoOf.set(id, a);
        if (em) { const e = mk(f.w, f.h); ctx(e).drawImage(em, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h); emissiveOf.set(id, e); }
        else emissiveOf.set(id, null);
      } else {
        albedoOf.set(id, im);
        emissiveOf.set(id, em);
      }
    }
  } else {
    const { files, baked } = await bakeAll();
    for (const f of files) { sizeOf.set(f.name, f.blob!.size); totalBytes += f.blob!.size; }
    for (const [id, b] of baked) { albedoOf.set(id, b.albedo); emissiveOf.set(id, b.emissive ?? null); }
    for (const f of files) pageImg.set(f.name, f.canvas);
    if (AUTO) { await save(files); log(`saved ${files.length} files to public/art/${WORLD_DIR}/`); }
  }
  const over = totalBytes > BUDGET;
  log(`total ${(totalBytes / 1024).toFixed(0)} KB of ${(BUDGET / 1024).toFixed(0)} KB budget${over ? '  OVER BUDGET' : ''}`);
  for (const [k, v] of [...sizeOf].sort()) log(`  ${k.padEnd(20)} ${(v / 1024).toFixed(1).padStart(7)} KB`);
  if (over) logEl.style.color = '#f66';
  // contact sheet
  if (albedoOf.size === WORLD_ASSET_IDS.length) {
    out.append(mock(id => ({
      a: albedoOf.get(id)!,
      e: WORLD_ASSETS[id].page ? (pageImg.get(`${WORLD_ASSETS[id].file}-e`) ?? null) : emissiveOf.get(id) ?? null,
    })));
  }
  const groups: [string, (id: WorldAssetId) => boolean][] = [
    ['Rock cut faces and banding', id => id.startsWith('rock-') || id.startsWith('band-')],
    ['Cut edge, strips and walls', id => ['edge-rim', 'edge-ao', 'tape', 'railing', 'deck', 'hub-vault', 'corridor-tile'].includes(id)],
    ['Structure and props (atlas-struct)', id => WORLD_ASSETS[id].page === 'struct'],
    ['Lamps (atlas-lamps, emissive added)', id => WORLD_ASSETS[id].page === 'lamps'],
    ['Plates', id => id.startsWith('far-') || id.startsWith('back-')],
    ['Foreground', id => id.startsWith('fore-')],
  ];
  for (const [title, f] of groups) {
    const h = document.createElement('h2');
    h.textContent = title;
    out.append(h);
    for (const id of WORLD_ASSET_IDS.filter(f)) {
      const a = albedoOf.get(id);
      if (!a) continue;
      const def = WORLD_ASSETS[id];
      out.append(preview(id, a, emissiveOf.get(id) ?? null, def.page ? null : sizeOf.get(def.file) ?? null));
    }
  }
  const h = document.createElement('h2');
  h.textContent = 'Atlas pages';
  out.append(h);
  for (const P of Object.values(WORLD_PAGES)) for (const name of [P.file, ...(P.emissive ? [`${P.file}-e`] : [])]) {
    const im = pageImg.get(name);
    if (!im) continue;
    const c = mk((im as HTMLCanvasElement).width * 0.5, (im as HTMLCanvasElement).height * 0.5);
    checker(c);
    ctx(c).drawImage(im, 0, 0, c.width, c.height);
    out.append(card(name, `${(sizeOf.get(name) ?? 0) / 1024 | 0} KB`, c));
  }
  document.title = `WORLD KIT DONE ${sizeOf.size} files ${totalBytes}`;
}

main().catch(e => { log(`ERROR ${e?.stack ?? e}`); document.title = `WORLD KIT ERROR ${e}`; });

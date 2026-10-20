import { Assets, CanvasSource, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import { STRATA, type StratumId } from '../world/tokens';
import {
  WORLD_ASSETS, WORLD_DIR, WORLD_KIT_VERSION, worldEmissiveFile, worldFrame, type FallbackKind, type WorldAssetDef, type WorldAssetId, type WorldLampSpot,
} from '../world/tokensAssets';

/**
 * World kit runtime ("The City Below"): typed access to the baked world art in `public/art/world/` (made by
 * `tools/world/kit-world.html`), with a procedural stand-in for every piece so no code ever waits on a file.
 *
 *   worldTex(id)        the albedo texture, now: the real one when loaded, else a small procedural stand-in (and the load starts)
 *   worldEmissive(id)   the emissive mask (glow on black, draw additively), or null when the piece has none
 *   worldMeta(id)       the table row: world size, anchor, ppu, repeat, lamps, glows, tint role (src/world/tokensAssets.ts)
 *   makeWorldSprite / makeWorldTiling   ready-scaled display objects that swap to the real art by themselves when it arrives
 *   worldLamps(id, x, y, flip)          the row's lamp spots in world coordinates, for the lighting system
 *   preloadWorldKit(ids) / releaseWorldKit(ids)   bulk load and unload (atlas pages are shared: a page leaves only when unused)
 *
 * Memory: textures are loaded per FILE on first use, so a stratum that is never shown costs nothing. GPU sizes are listed in
 * store/world-redesign/C-assets.md. Plates (far/back) and emissive masks skip mipmaps (they are never minified much).
 */

export type { WorldAssetId };

type Layer = 'albedo' | 'emissive';

interface FileState {
  promise: Promise<Texture | null>;
  tex: Texture | null;
  failed: boolean;
}

const files = new Map<string, FileState>();
const real = new Map<string, Texture>();
const stand = new Map<string, Texture>();
const listeners = new Set<(id: WorldAssetId) => void>();
const pendingSprites = new Map<WorldAssetId, Set<Sprite | TilingSprite>>();
let mipmaps = true;

/** Lite mode / tests: no mipmaps (a quarter less texture memory). Call before the first load. */
export function configureWorldKit(opts: { mipmaps?: boolean }): void {
  if (opts.mipmaps !== undefined) mipmaps = opts.mipmaps;
}

function baseUrl(): string {
  try {
    return import.meta.env?.BASE_URL ?? './';
  } catch {
    return './';
  }
}

export function worldUrl(file: string): string {
  return `${baseUrl()}art/${WORLD_DIR}/${file}.webp?v=${WORLD_KIT_VERSION}`;
}

/** The table row (sizes in world units, anchor, ppu, lamps...). */
export function worldMeta(id: WorldAssetId): WorldAssetDef {
  return WORLD_ASSETS[id];
}

/** World size of the FULL frame (padding included): the size a sprite of this texture must be drawn at. */
export function worldFrameSize(id: WorldAssetId): [number, number] {
  const d = WORLD_ASSETS[id];
  return [d.px[0] / d.ppu, d.px[1] / d.ppu];
}

/** True when the baked art (not the stand-in) is in use. */
export function isWorldTexReal(id: WorldAssetId, layer: Layer = 'albedo'): boolean {
  return real.has(key(id, layer));
}

const key = (id: WorldAssetId, layer: Layer) => `${id}|${layer}`;

function fileOf(id: WorldAssetId, layer: Layer): string | null {
  return layer === 'albedo' ? WORLD_ASSETS[id].file : worldEmissiveFile(id);
}

function loadFile(file: string, noMips: boolean): FileState {
  let st = files.get(file);
  if (st) return st;
  const state: FileState = { promise: Promise.resolve(null), tex: null, failed: false };
  state.promise = Assets.load<Texture>({ src: worldUrl(file), data: { autoGenerateMipmaps: mipmaps && !noMips, scaleMode: 'linear' } })
    .then(tex => {
      tex.source.autoGarbageCollect = false;
      state.tex = tex;
      return tex;
    })
    .catch(() => {
      state.failed = true; // missing or broken: the stand-in stays
      return null;
    });
  files.set(file, state);
  st = state;
  return st;
}

/** Starts (or joins) the load of one asset layer; resolves to the real texture or null. */
function ensure(id: WorldAssetId, layer: Layer): Promise<Texture | null> {
  const k = key(id, layer);
  const have = real.get(k);
  if (have) return Promise.resolve(have);
  const file = fileOf(id, layer);
  if (!file) return Promise.resolve(null);
  const d = WORLD_ASSETS[id];
  const noMips = layer === 'emissive' || d.layer === 'far' || d.layer === 'back';
  const st = loadFile(file, noMips);
  return st.promise.then(page => {
    if (!page) {
      if (layer === 'albedo') pendingSprites.delete(id); // the stand-in stays for good
      return null;
    }
    const already = real.get(k);
    if (already) return already;
    let tex = page;
    if (d.page) {
      const f = worldFrame(id);
      tex = new Texture({ source: page.source, frame: new Rectangle(f.x, f.y, f.w, f.h) });
    }
    real.set(k, tex);
    if (layer === 'albedo') {
      const set = pendingSprites.get(id);
      if (set) {
        for (const s of set) if (!s.destroyed) applyTexture(s, id, tex);
        pendingSprites.delete(id);
      }
      for (const fn of listeners) fn(id);
    }
    return tex;
  });
}

/** The albedo texture now: the baked one when loaded, else the procedural stand-in (the load starts in the background). */
export function worldTex(id: WorldAssetId): Texture {
  const r = real.get(key(id, 'albedo'));
  if (r) return r;
  void ensure(id, 'albedo');
  return standIn(id, 'albedo');
}

/** The emissive mask now (glow on black, draw with blendMode 'add'); null when the piece has none. */
export function worldEmissive(id: WorldAssetId): Texture | null {
  if (!worldEmissiveFile(id)) return null;
  const r = real.get(key(id, 'emissive'));
  if (r) return r;
  void ensure(id, 'emissive');
  return WORLD_ASSETS[id].fallback === 'lamp' ? standIn(id, 'emissive') : null;
}

/** Resolves when both layers of the asset have loaded (or failed: then the stand-in is what you get). */
export async function worldTexAsync(id: WorldAssetId): Promise<Texture> {
  await Promise.all([ensure(id, 'albedo'), ensure(id, 'emissive')]);
  return worldTex(id);
}

export async function preloadWorldKit(ids: readonly WorldAssetId[]): Promise<void> {
  await Promise.all(ids.flatMap(id => [ensure(id, 'albedo'), ensure(id, 'emissive')]));
}

/** Called once per asset when its baked albedo replaces the stand-in. Returns an unsubscribe function. */
export function onWorldKitLoaded(fn: (id: WorldAssetId) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Unloads the files of these assets that no other loaded asset still needs (atlas pages are shared). Display objects using them
 * must be gone first.
 */
export function releaseWorldKit(ids: readonly WorldAssetId[]): void {
  const drop = new Set(ids);
  const keep = new Set<string>();
  for (const k of real.keys()) {
    const [id, layer] = k.split('|') as [WorldAssetId, Layer];
    if (!drop.has(id)) { const f = fileOf(id, layer); if (f) keep.add(f); }
  }
  for (const id of ids) {
    for (const layer of ['albedo', 'emissive'] as Layer[]) {
      const k = key(id, layer);
      const t = real.get(k);
      if (t && WORLD_ASSETS[id].page) t.destroy(false);
      real.delete(k);
      const f = fileOf(id, layer);
      if (f && !keep.has(f) && files.get(f)?.tex) {
        void Assets.unload(worldUrl(f));
        files.delete(f);
      }
    }
  }
}

/** Loaded / failed files and the estimated GPU bytes of what is loaded (RGBA, plus a third for mipmaps where used). */
export function worldKitStats(): { loaded: string[]; failed: string[]; gpuBytes: number } {
  const loaded: string[] = [], failed: string[] = [];
  let gpu = 0;
  for (const [f, st] of files) {
    if (st.failed) failed.push(f);
    else if (st.tex) {
      loaded.push(f);
      const b = st.tex.source.pixelWidth * st.tex.source.pixelHeight * 4;
      gpu += st.tex.source.autoGenerateMipmaps ? b * 4 / 3 : b;
    }
  }
  return { loaded, failed, gpuBytes: Math.round(gpu) };
}

// =================================================================================================================================
// Display helpers
// =================================================================================================================================

/** The multiply tint for a piece in a stratum (palette entry named by the row's `tint`; white when it carries its own colour). */
export function worldTint(id: WorldAssetId, stratum: StratumId): number {
  const role = WORLD_ASSETS[id].tint;
  if (role === 'none') return 0xffffff;
  const p = STRATA[stratum]?.palette;
  if (!p) return 0xffffff;
  // tints are pulled up a little so a neutral light bake lands on the palette value instead of darker
  const c = p[role];
  const lift = (v: number) => Math.min(255, Math.round(v * 1.25 + 18));
  return (lift((c >> 16) & 255) << 16) | (lift((c >> 8) & 255) << 8) | lift(c & 255);
}

function applyTexture(obj: Sprite | TilingSprite, id: WorldAssetId, tex: Texture): void {
  const d = WORLD_ASSETS[id];
  if (obj instanceof TilingSprite) {
    obj.texture = tex;
    obj.tileScale.set(d.world[0] / tex.width, d.world[1] / tex.height);
    return;
  }
  const [fw, fh] = worldFrameSize(id);
  const sx = Math.sign(obj.scale.x) || 1, sy = Math.sign(obj.scale.y) || 1;
  obj.texture = tex;
  obj.scale.set((sx * fw) / tex.width, (sy * fh) / tex.height);
}

/**
 * A sprite at true world size with the row's anchor (position it at the anchor point in world units). `flip` mirrors it
 * (stairs of the other hand). It swaps to the baked art by itself when that arrives.
 */
export function makeWorldSprite(id: WorldAssetId, opts: { stratum?: StratumId; flip?: boolean; emissive?: boolean } = {}): Sprite {
  const d = WORLD_ASSETS[id];
  const tex = opts.emissive ? worldEmissive(id) ?? Texture.EMPTY : worldTex(id);
  const s = new Sprite(tex);
  s.anchor.set(d.anchor[0], d.anchor[1]);
  const [fw, fh] = worldFrameSize(id);
  s.scale.set(((opts.flip ? -1 : 1) * fw) / tex.width || 1, fh / tex.height || 1);
  if (opts.emissive) s.blendMode = 'add';
  else if (opts.stratum !== undefined) s.tint = worldTint(id, opts.stratum);
  if (!opts.emissive && !isWorldTexReal(id)) {
    let set = pendingSprites.get(id);
    if (!set) pendingSprites.set(id, (set = new Set()));
    set.add(s);
  } else if (opts.emissive && !isWorldTexReal(id, 'emissive')) {
    void ensure(id, 'emissive').then(t => { if (t && !s.destroyed) applyTexture(s, id, t); });
  }
  return s;
}

/** A tiling strip / tile filling `width` x `height` world units at true texel scale. */
export function makeWorldTiling(id: WorldAssetId, width: number, height: number, opts: { stratum?: StratumId } = {}): TilingSprite {
  const d = WORLD_ASSETS[id];
  const tex = worldTex(id);
  const t = new TilingSprite({ texture: tex, width, height });
  t.tileScale.set(d.world[0] / tex.width, d.world[1] / tex.height);
  if (opts.stratum !== undefined) t.tint = worldTint(id, opts.stratum);
  if (!isWorldTexReal(id)) {
    let set = pendingSprites.get(id);
    if (!set) pendingSprites.set(id, (set = new Set()));
    set.add(t);
  }
  return t;
}

/** The row's lamp spots in world coordinates for a sprite placed with its anchor at (x, y); `flip` mirrors x. */
export function worldLamps(id: WorldAssetId, x: number, y: number, flip = false): (WorldLampSpot & { x: number; y: number })[] {
  return (WORLD_ASSETS[id].lamps ?? []).map(l => ({ ...l, x: x + (flip ? -l.x : l.x), y: y + l.y, dir: l.dir !== undefined && flip ? -l.dir : l.dir }));
}

// =================================================================================================================================
// Procedural stand-ins: small canvases with the right aspect, palette and silhouette, so the world reads before (or without) art
// =================================================================================================================================

function hex(c: number, a = 1): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function standIn(id: WorldAssetId, layer: Layer): Texture {
  const k = key(id, layer);
  const have = stand.get(k);
  if (have) return have;
  if (typeof document === 'undefined') return Texture.WHITE; // Node tests
  const d = WORLD_ASSETS[id];
  // the stand-in covers the full frame (padding included) at a capped resolution, so sprite scaling is the same as for the real art
  const s = Math.min(1, 256 / Math.max(d.px[0], d.px[1]));
  const w = Math.max(2, Math.round(d.px[0] * s)), h = Math.max(2, Math.round(d.px[1] * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const pal = STRATA[d.strata[0] ?? 1].palette;
  const r = seeded(strHash(id));
  const px = d.pad * s;
  const cw = w - px * 2, ch = h - px * 2;
  if (layer === 'emissive') {
    for (const L of d.lamps ?? []) {
      const lx = d.anchor[0] * w + L.x * d.ppu * s, ly = d.anchor[1] * h + L.y * d.ppu * s;
      const gr = g.createRadialGradient(lx, ly, 0, lx, ly, Math.max(3, 6 * d.ppu * s));
      gr.addColorStop(0, 'rgba(255,230,190,1)');
      gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
  } else {
    drawStandIn(d.fallback, g, w, h, px, cw, ch, pal, r);
  }
  const tex = new Texture({ source: new CanvasSource({ resource: c, scaleMode: 'linear', autoGarbageCollect: false }) });
  stand.set(k, tex);
  return tex;
}

type Pal = (typeof STRATA)[number]['palette'];

function drawStandIn(kind: FallbackKind, g: CanvasRenderingContext2D, w: number, h: number, px: number, cw: number, ch: number, p: Pal, r: () => number): void {
  const grain = (n: number, a: number) => { for (let i = 0; i < n; i++) { g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,240,220,${a * 0.6})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 1.5); } };
  const outline = (x: number, y: number, ww: number, hh: number) => { g.strokeStyle = 'rgba(10,8,6,0.85)'; g.lineWidth = 1.5; g.strokeRect(x + 0.75, y + 0.75, ww - 1.5, hh - 1.5); };
  switch (kind) {
    case 'rock': {
      g.fillStyle = hex(p.rock);
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { g.fillStyle = hex(r() < 0.5 ? p.rockDark : p.rockRim, 0.18); g.beginPath(); g.ellipse(r() * w, r() * h, 6 + r() * 18, 3 + r() * 9, 0, 0, Math.PI * 2); g.fill(); }
      grain(w * h / 30, 0.25);
      break;
    }
    case 'band': {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, hex(p.rockDark, 0)); gr.addColorStop(0.35, hex(p.rockDark, 0.8)); gr.addColorStop(0.65, hex(p.rockDark, 0.8)); gr.addColorStop(1, hex(p.rockDark, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      grain(w * h / 20, 0.2);
      break;
    }
    case 'rim': {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0.15, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      break;
    }
    case 'ao': {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(8,6,5,0.95)'); gr.addColorStop(1, 'rgba(8,6,5,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      break;
    }
    case 'stripe': {
      g.save();
      g.beginPath(); g.rect(0, h * 0.25, w, h * 0.5); g.clip();
      g.fillStyle = hex(0x1c1a16); g.fillRect(0, 0, w, h);
      g.fillStyle = hex(p.hazard);
      for (let x = -h; x < w + h; x += h) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h / 2, h); g.lineTo(x + h, 0); g.lineTo(x + h / 2, 0); g.closePath(); g.fill(); }
      g.restore();
      break;
    }
    case 'rail': {
      g.fillStyle = hex(0xd6d2c8);
      g.fillRect(0, h * 0.12, w, h * 0.12);
      g.fillRect(0, h * 0.52, w, h * 0.07);
      g.fillRect(0, h * 0.82, w, h * 0.18);
      for (const x of [w * 0.125, w * 0.625]) g.fillRect(x, h * 0.12, Math.max(2, w * 0.02), h * 0.88);
      break;
    }
    case 'deck': {
      g.fillStyle = hex(0x4a4c48);
      g.fillRect(0, h * 0.06, w, h * 0.42);
      g.fillStyle = hex(0x6a6c66);
      g.fillRect(0, h * 0.06, w, h * 0.08);
      const gr = g.createLinearGradient(0, h * 0.48, 0, h * 0.75);
      gr.addColorStop(0, 'rgba(6,5,4,0.45)'); gr.addColorStop(1, 'rgba(6,5,4,0)');
      g.fillStyle = gr;
      g.fillRect(0, h * 0.48, w, h * 0.27);
      break;
    }
    case 'wall': {
      g.fillStyle = hex(0x8d8670); g.fillRect(0, 0, w, h);
      g.fillStyle = hex(0x5d6b58); g.fillRect(0, h * 0.64, w, h * 0.36);
      g.fillStyle = 'rgba(10,8,6,0.35)';
      g.beginPath(); g.moveTo(w * 0.19, h); g.lineTo(w * 0.19, h * 0.5); g.arc(w / 2, h * 0.5, w * 0.31, Math.PI, 0); g.lineTo(w * 0.81, h); g.closePath(); g.fill();
      grain(w * h / 25, 0.18);
      break;
    }
    case 'tiles': {
      g.fillStyle = hex(0xb8b08e); g.fillRect(0, 0, w, h * 0.6);
      g.fillStyle = hex(0x4f6b5e); g.fillRect(0, h * 0.6, w, h * 0.35);
      g.fillStyle = hex(0x2a2a26); g.fillRect(0, h * 0.95, w, h * 0.05);
      g.fillStyle = 'rgba(40,36,30,0.6)';
      for (let y = 0; y < h * 0.95; y += h / 16) g.fillRect(0, y, w, 1);
      for (let y = 0, row = 0; y < h * 0.95; y += h / 16, row++) for (let x = (row % 2) * w / 16; x < w; x += w / 8) g.fillRect(x, y, 1, h / 16);
      break;
    }
    case 'plate': {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, hex(p.farBase, 0)); gr.addColorStop(0.3, hex(p.farBase, 1)); gr.addColorStop(1, hex(p.farBase, 1));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.fillStyle = hex(p.rockDark, 0.8);
      g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) g.lineTo(x, h * (0.55 + 0.15 * Math.sin((x / w) * Math.PI * 6) + (r() - 0.5) * 0.04));
      g.lineTo(w, h); g.closePath(); g.fill();
      break;
    }
    case 'lip': {
      g.fillStyle = 'rgba(11,10,10,1)';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0);
      for (let x = w; x >= 0; x -= 6) g.lineTo(x, h * (0.35 + r() * 0.2));
      g.closePath(); g.fill();
      break;
    }
    case 'box': {
      const gr = g.createLinearGradient(0, px, 0, px + ch);
      gr.addColorStop(0, hex(0x6a6c66)); gr.addColorStop(1, hex(0x3e3f3c));
      g.fillStyle = gr;
      g.fillRect(px, px, cw, ch);
      grain(cw * ch / 30, 0.2);
      outline(px, px, cw, ch);
      break;
    }
    case 'stair': {
      // the stringer and a sawtooth of treads, rising to the right
      g.strokeStyle = hex(0x4a4c48);
      g.lineWidth = Math.max(2, ch * 0.12);
      g.beginPath(); g.moveTo(px, px + ch); g.lineTo(px + cw, px + ch * 0.08); g.stroke();
      g.fillStyle = hex(0x6a6c66);
      for (let i = 0; i < 6; i++) g.fillRect(px + (cw * i) / 6, px + ch - (ch * (i + 1)) / 6, cw / 6, Math.max(1.5, ch * 0.05));
      break;
    }
    case 'rubble': {
      g.fillStyle = hex(p.built);
      g.beginPath(); g.moveTo(px, px + ch);
      for (let i = 0; i <= 10; i++) { const t = i / 10; g.lineTo(px + cw * t, px + ch - ch * Math.sin(Math.PI * t) * (0.7 + r() * 0.3)); }
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(10,8,6,0.85)'; g.lineWidth = 1.5; g.stroke();
      grain(cw * ch / 20, 0.25);
      break;
    }
    case 'lamp': {
      g.fillStyle = hex(0x3a3a38);
      g.fillRect(px + cw * 0.3, px, cw * 0.4, ch * 0.3);
      const cx = w / 2, cy = px + ch * 0.6;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(2, Math.min(cw, ch) * 0.35));
      gr.addColorStop(0, 'rgba(255,248,230,1)'); gr.addColorStop(1, 'rgba(255,200,120,0.2)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(cx, cy, Math.max(2, Math.min(cw, ch) * 0.35), 0, Math.PI * 2); g.fill();
      break;
    }
    case 'silhouette': {
      g.fillStyle = 'rgba(11,10,10,1)';
      g.fillRect(px, px, cw, ch);
      break;
    }
  }
}

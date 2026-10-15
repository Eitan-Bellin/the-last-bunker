import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { BuildingInstance, BuildingType, Ruin } from '../core/GameState';
import { isDistrict, isHall, roomSlots } from '../data/buildingDefs';
import { zoneForFloor } from '../data/zones';
import { ArtLibrary, glowTexture } from '../art/ArtLibrary';
import { ROOMS_X, ROOM_H, SHAFT_W, SLOT_W, floorTop, slotX, type Ext } from './layout';
import { hashString, mix, seeded, shade, vGradient } from './draw';
import { depthGains, occupancy, type Grid, type WorldLamp } from './structure';
import { GFX } from './gfxFeatures';

/**
 * Graphics overhaul G8 + G5 props: text and signs inside the world as painted / metal objects.
 * - a screwed enamel zone plate per level on the shaft landing (level + zone name, in the zone's colour)
 * - the level name sprayed through a stencil on the slab face under each level
 * - 0–2 small painted props per level on the steel columns (clock, fuse box, extinguisher...), more from era 2
 * - `steelTag`: the shared bolted-steel tag look for room tags, the dig sign and the district sign
 * Only built with gfx2 on (hooked from BunkerRenderer.renderUtilities, painted branch).
 */

// ---------- zones ----------

type SignZone = 'living' | 'agri' | 'engineering' | 'science' | 'security';

const ZONE_COLOR: Record<SignZone, number> = {
  living: 0xc9a25a,
  agri: 0x4e8c84,
  engineering: 0xc46a2a,
  science: 0x9fb4c8,
  security: 0xa8443a,
};

const EXTRA_NAMES: Record<'science' | 'security', Record<string, string>> = {
  science: { he: 'מדע ורפואה', en: 'Science & Medical' },
  security: { he: 'ביטחון', en: 'Security' },
};

const ROOM_ZONE: Partial<Record<BuildingType, SignZone>> = {
  quarters: 'living', canteen: 'living', atrium: 'living',
  farm: 'agri', waterPump: 'agri', hydroponics: 'agri', waterPurifier: 'agri',
  generator: 'engineering', workshop: 'engineering', reactor: 'engineering', reactorHall: 'engineering',
  medbay: 'science', laboratory: 'science', radioTower: 'science',
  armory: 'security', trainingRoom: 'security', storage: 'security',
  // [plan4:BL-13] every room of waves 1-3 (a deep level is named after what stands on it; districts are skipped by signZone)
  batteryBank: 'engineering', recycler: 'engineering', condenser: 'agri', mushroomFarm: 'agri', aquaculture: 'agri',
  commons: 'living', nursery: 'living', bathhouse: 'living', memorialHall: 'living', market: 'living', forum: 'living',
  library: 'science', school: 'science', quarantineWard: 'science', decon: 'science', dataCenter: 'science', seedLab: 'science',
  gatePost: 'security', barracks: 'security', watchtower: 'security',
  garage: 'engineering', solarArray: 'engineering', windTurbine: 'engineering', componentsPlant: 'engineering', alloyFoundry: 'engineering',
};

/**
 * Colour and name painted on a level's plate. The three founding levels keep their zone;
 * deep levels (any room allowed) are named after what the colony actually put there.
 */
export function signZone(floor: number, buildings: BuildingInstance[], locale: string): { color: number; name: string } {
  const z = zoneForFloor(floor);
  const pick = (n: Record<string, string>) => n[locale] ?? n.en;
  if (z.id !== 'deep') return { color: ZONE_COLOR[z.id], name: pick(z.name) };
  const weight = new Map<SignZone, number>();
  for (const b of buildings) {
    const onFloor = b.position.floor === floor || (isHall(b.type) && b.position.floor === floor - 1);
    if (!onFloor || isDistrict(b.type)) continue;
    const k = ROOM_ZONE[b.type];
    if (k) weight.set(k, (weight.get(k) ?? 0) + roomSlots(b.type));
  }
  let best: SignZone | null = null;
  for (const [k, w] of weight) if (!best || w > weight.get(best)!) best = k;
  if (!best) return { color: ZONE_COLOR.science, name: pick(z.name) };
  const name = best === 'science' || best === 'security' ? pick(EXTRA_NAMES[best])
    : pick(zoneForFloor(best === 'living' ? 0 : best === 'agri' ? 1 : 2).name);
  return { color: ZONE_COLOR[best], name };
}

// ---------- shared steel tag ----------

/**
 * A bolted steel tag (room tags, the dig sign, the district sign): dark plate with a soft drop shadow,
 * a lit top edge, a shadowed bottom edge and rivets.
 */
export function steelTag(
  g: Graphics, x: number, y: number, w: number, h: number,
  o: { rivets?: 2 | 4; alpha?: number; stripe?: boolean } = {},
): void {
  const a = o.alpha ?? 0.95;
  const r = Math.min(2, h * 0.12);
  // Soft drop shadow (two layers), so the tag sits on the wall instead of floating over it.
  g.roundRect(x + 0.6, y + 1.8, w + 0.8, h + 0.6, r + 1).fill({ color: 0x000000, alpha: 0.16 });
  g.roundRect(x + 0.6, y + 1.1, w, h, r).fill({ color: 0x000000, alpha: 0.32 });
  g.roundRect(x, y, w, h, r).fill(vGradient([[0, 0x302c25, a], [0.55, 0x24211c, a], [1, 0x1a1814, a]]));
  if (o.stripe) {
    // Worn hazard stripe along the top of big signs.
    const sh = Math.min(5, h * 0.14);
    g.rect(x + 2, y + 2, w - 4, sh).fill({ color: 0xc8962e, alpha: 0.8 });
    for (let sx = x + 2; sx < x + w - 4; sx += 9) g.poly([sx, y + 2, sx + 4.5, y + 2, sx + 1.5, y + 2 + sh, sx - 3, y + 2 + sh]).fill({ color: 0x15130f, alpha: 0.85 });
    g.rect(x + 2, y + 2, 2, sh).fill({ color: 0x24211c, alpha: a });
    g.rect(x + w - 4, y + 2, 2, sh).fill({ color: 0x24211c, alpha: a });
  }
  g.rect(x + 1, y + 0.5, w - 2, 1).fill({ color: 0xd8c8a0, alpha: 0.22 });
  g.rect(x + 1, y + h - 1.5, w - 2, 1).fill({ color: 0x000000, alpha: 0.4 });
  g.roundRect(x, y, w, h, r).stroke({ color: 0x0c0a08, alpha: 0.9, width: 1 });
  const rv = (rx: number, ry: number) => {
    g.circle(rx, ry, 1.3).fill(0x6a6458);
    g.circle(rx + 0.3, ry + 0.4, 1.3).fill({ color: 0x000000, alpha: 0.25 });
    g.circle(rx, ry, 1.1).fill(0x6a6458);
    g.circle(rx - 0.3, ry - 0.3, 0.5).fill({ color: 0xffffff, alpha: 0.35 });
  };
  if ((o.rivets ?? 2) === 4) {
    for (const rx of [x + 3.2, x + w - 3.2]) for (const ry of [y + 3.2, y + h - 3.2]) rv(rx, ry);
  } else {
    for (const rx of [x + 3.2, x + w - 3.2]) rv(rx, y + h / 2);
  }
}

/** Miners' spray paint on rock: a rough, broken outline of where the next dig opens. */
export function sprayOutline(g: Graphics, x: number, y: number, w: number, h: number, rnd: () => number, color = 0xd9a441): void {
  const pts: [number, number][] = [];
  const r = 14;
  const per = 2 * (w + h);
  for (let d = 0; d < per; d += 3) {
    let px: number, py: number;
    if (d < w) { px = x + d; py = y; } else if (d < w + h) { px = x + w; py = y + d - w; } else if (d < 2 * w + h) { px = x + w - (d - w - h); py = y + h; } else { px = x; py = y + h - (d - 2 * w - h); }
    // Round the corners off a little.
    const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
    const dx = px - cx, dy = py - cy, dl = Math.hypot(dx, dy);
    if (dl > r) { px = cx + (dx / dl) * r; py = cy + (dy / dl) * r; }
    pts.push([px + (rnd() - 0.5) * 1.2, py + (rnd() - 0.5) * 1.2]);
  }
  // Dashes of uneven length, each with a faint overspray.
  let i = 0;
  while (i < pts.length - 1) {
    const len = 2 + Math.floor(rnd() * 3);
    const seg = pts.slice(i, Math.min(pts.length, i + len + 1));
    for (const [wd, a] of [[4.2, 0.1], [2, 0.55]] as const) {
      g.moveTo(seg[0][0], seg[0][1]);
      for (const p of seg.slice(1)) g.lineTo(p[0], p[1]);
      g.stroke({ color, width: wd, alpha: a, cap: 'round' });
    }
    i += len + 1 + Math.floor(rnd() * 2);
  }
  // A paint drip or two.
  for (let k = 0; k < 2; k++) {
    const dx = x + 20 + rnd() * (w - 40);
    g.rect(dx, y + 1, 0.9, 3 + rnd() * 5).fill({ color, alpha: 0.4 });
  }
}

/** A small indicator lamp on a tag: lit green with a halo, or dark red glass when the post is empty. */
export function tagLamp(g: Graphics, x: number, y: number, lit: boolean): void {
  g.circle(x, y + 0.5, 2.9).fill({ color: 0x000000, alpha: 0.35 });
  g.circle(x, y, 2.7).fill(0x15130f);
  g.circle(x, y, 2.7).stroke({ color: 0x5a554b, width: 0.6, alpha: 0.8 });
  if (lit) {
    g.circle(x, y, 4.8).fill({ color: 0x6dff9a, alpha: 0.13 });
    g.circle(x, y, 2).fill(0x5eea86);
    g.circle(x, y, 1.1).fill(0xc8ffd6);
  } else {
    g.circle(x, y, 2).fill(0x4a1612);
    g.circle(x, y + 0.4, 1.3).fill({ color: 0x7a2a22, alpha: 0.6 });
  }
  g.circle(x - 0.7, y - 0.8, 0.55).fill({ color: 0xffffff, alpha: lit ? 0.7 : 0.3 });
}

// ---------- canvas painting helpers ----------

let fontsReady = typeof document !== 'undefined' && document.fonts.check('700 20px Karantina') && document.fonts.check('600 20px Rubik');
const fontWaiters: (() => void)[] = [];
if (!fontsReady && typeof document !== 'undefined') {
  void Promise.all([document.fonts.load('700 64px Karantina'), document.fonts.load('600 32px Rubik')]).then(() => {
    fontsReady = true;
    for (const fn of fontWaiters.splice(0)) fn();
  });
}

const hexCss = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
const lum = (c: number) => (0.3 * ((c >> 16) & 255) + 0.59 * ((c >> 8) & 255) + 0.11 * (c & 255)) / 255;

/** Smooth 2D value noise in 0..1 (cheap, deterministic per seed). */
function noise2(seed: number): (x: number, y: number) => number {
  const h = (ix: number, iy: number) => {
    let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
  };
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * sx;
    const b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

const texCache = new Map<string, Texture>();

function cachedTexture(key: string, paint: () => HTMLCanvasElement): Texture {
  let t = texCache.get(key);
  if (!t) {
    t = Texture.from(paint());
    texCache.set(key, t);
  }
  return t;
}

// ---------- zone plate ----------

const PLATE_W = 54;
const PLATE_H = 17;
const PS = 6; // canvas px per world unit

/** Splits a name over at most two lines so it fits `avail` px at the largest possible size. */
function fitName(ctx: CanvasRenderingContext2D, name: string, avail: number, rtl: boolean): { lines: string[]; size: number } {
  const font = (s: number) => `600 ${s}px Rubik, sans-serif`;
  for (let s = 5.6 * PS; s >= 4.2 * PS; s -= 0.2 * PS) {
    ctx.font = font(s);
    if (ctx.measureText(name).width <= avail) return { lines: [name], size: s };
  }
  const words = name.split(' ');
  let best: string[] = [name];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const l = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    ctx.font = font(4.6 * PS);
    const w = Math.max(...l.map(t => ctx.measureText(t).width));
    if (w < bestW) { bestW = w; best = l; }
  }
  void rtl;
  let s = 4.8 * PS;
  ctx.font = font(s);
  while (s > 3.4 * PS && Math.max(...best.map(t => ctx.measureText(t).width)) > avail) {
    s -= 0.2 * PS;
    ctx.font = font(s);
  }
  return { lines: best, size: s };
}

/** Paints one enamel-on-steel level plate. wear: 0 = fresh, 1 = wrecked. */
function paintPlate(level: string, name: string, color: number, wear: number, rtl: boolean, seed: number): HTMLCanvasElement {
  const W = PLATE_W * PS, H = PLATE_H * PS;
  const [c, ctx] = makeCanvas(W, H);
  const rnd = seeded(seed);
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  // Steel backing plate with a bevel.
  const steel = ctx.createLinearGradient(0, 0, 0, H);
  steel.addColorStop(0, '#6a6862');
  steel.addColorStop(0.5, '#45443f');
  steel.addColorStop(1, '#2a2926');
  round(0, 0, W, H, 1.4 * PS);
  ctx.fillStyle = steel;
  ctx.fill();
  // Enamel field.
  const e = 1.1 * PS;
  const enamel = wear > 0.6 ? mix(color, 0x5a5348, 0.35) : color;
  const field = ctx.createLinearGradient(0, e, 0, H - e);
  field.addColorStop(0, hexCss(mix(enamel, 0xffffff, 0.14)));
  field.addColorStop(0.6, hexCss(enamel));
  field.addColorStop(1, hexCss(shade(enamel, 0.78)));
  round(e, e, W - 2 * e, H - 2 * e, 0.7 * PS);
  ctx.fillStyle = field;
  ctx.fill();
  // Level block: dark enamel square with the level in Karantina.
  const bw = 15 * PS;
  const bx = rtl ? W - e - bw : e;
  ctx.save();
  round(e, e, W - 2 * e, H - 2 * e, 0.7 * PS);
  ctx.clip();
  const blk = ctx.createLinearGradient(0, e, 0, H - e);
  blk.addColorStop(0, '#2c2924');
  blk.addColorStop(1, '#171512');
  ctx.fillStyle = blk;
  ctx.fillRect(bx, e, bw, H - 2 * e);
  ctx.restore();
  ctx.fillStyle = wear > 0.6 ? '#b9ad90' : '#f1e6c8';
  ctx.font = `700 ${13.5 * PS}px Karantina, Rubik, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'ltr';
  ctx.fillText(level, bx + bw / 2, H / 2 + 0.9 * PS);
  // Zone name.
  const nx0 = rtl ? e + 1.6 * PS : bx + bw + 1.6 * PS;
  const nx1 = rtl ? bx - 1.6 * PS : W - e - 1.6 * PS;
  ctx.direction = rtl ? 'rtl' : 'ltr';
  const { lines, size } = fitName(ctx, name, nx1 - nx0, rtl);
  ctx.font = `600 ${size}px Rubik, sans-serif`;
  ctx.fillStyle = lum(enamel) < 0.56 ? '#f4ecd8' : '#1e1913';
  const lh = size * 1.02;
  lines.forEach((l, i) => ctx.fillText(l, (nx0 + nx1) / 2, H / 2 + (i - (lines.length - 1) / 2) * lh + 0.15 * PS));
  ctx.direction = 'ltr';
  // Painted surface: speckle and blotchy grime over the whole face (no flat fills).
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const n = noise2(seed);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] === 0) continue;
      const blot = n(x / 26, y / 26) * 0.6 + n(x / 9, y / 9) * 0.4;
      const k = 0.9 + (rnd() - 0.5) * 0.12 + (blot - 0.5) * (0.18 + wear * 0.25) - (y / H) * 0.06 * (1 + wear);
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Chips: enamel knocked off down to the steel (more on older plates), rust bleeding out of them.
  const chips = Math.round(2 + wear * 14);
  for (let k = 0; k < chips; k++) {
    const edge = rnd() < 0.7;
    const cx = edge ? (rnd() < 0.5 ? e + rnd() * 3 * PS : W - e - rnd() * 3 * PS) : e + rnd() * (W - 2 * e);
    const cy = edge ? e + rnd() * (H - 2 * e) : rnd() < 0.5 ? e + rnd() * 1.5 * PS : H - e - rnd() * 1.5 * PS;
    const r = (0.3 + rnd() * (0.5 + wear)) * PS;
    ctx.beginPath();
    for (let a = 0; a < 7; a++) {
      const ang = (a / 7) * Math.PI * 2;
      const rr = r * (0.55 + rnd() * 0.6);
      ctx[a ? 'lineTo' : 'moveTo'](cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr * 0.8);
    }
    ctx.closePath();
    ctx.fillStyle = wear > 0.4 && rnd() < 0.6 ? '#5a3a22' : '#6e6c66';
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,16,12,0.5)';
    ctx.lineWidth = 0.25 * PS;
    ctx.stroke();
  }
  // Scratches.
  ctx.strokeStyle = 'rgba(255,248,230,0.16)';
  ctx.lineWidth = 0.18 * PS;
  for (let k = 0; k < 3 + wear * 6; k++) {
    const x = e + rnd() * (W - 2 * e), y = e + rnd() * (H - 2 * e), len = (2 + rnd() * 6) * PS, a = (rnd() - 0.5) * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  // Screws at both ends, with rust tears under them on old plates.
  for (const sx of [2.6 * PS, W - 2.6 * PS]) {
    const sy = H / 2;
    if (wear > 0.3) {
      const tear = ctx.createLinearGradient(0, sy, 0, sy + (3 + wear * 6) * PS);
      tear.addColorStop(0, 'rgba(110,60,25,0.75)');
      tear.addColorStop(1, 'rgba(110,60,25,0)');
      ctx.fillStyle = tear;
      ctx.fillRect(sx - 0.5 * PS, sy, 1 * PS, (3 + wear * 6) * PS);
    }
    ctx.beginPath();
    ctx.arc(sx + 0.15 * PS, sy + 0.25 * PS, 1.05 * PS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    const sg = ctx.createRadialGradient(sx - 0.3 * PS, sy - 0.3 * PS, 0, sx, sy, 0.95 * PS);
    sg.addColorStop(0, '#c9c4b6');
    sg.addColorStop(1, '#4e4b44');
    ctx.beginPath();
    ctx.arc(sx, sy, 0.95 * PS, 0, Math.PI * 2);
    ctx.fillStyle = sg;
    ctx.fill();
    const a = rnd() * Math.PI;
    ctx.strokeStyle = '#26231e';
    ctx.lineWidth = 0.28 * PS;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(a) * 0.7 * PS, sy - Math.sin(a) * 0.7 * PS);
    ctx.lineTo(sx + Math.cos(a) * 0.7 * PS, sy + Math.sin(a) * 0.7 * PS);
    ctx.stroke();
  }
  // Lit top edge, dark bottom edge.
  ctx.fillStyle = 'rgba(255,245,220,0.25)';
  ctx.fillRect(1.2 * PS, 0.3 * PS, W - 2.4 * PS, 0.35 * PS);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(1.2 * PS, H - 0.6 * PS, W - 2.4 * PS, 0.4 * PS);
  return c;
}

// ---------- stencil ----------

const SS = 8; // canvas px per world unit
const STENCIL_H = 10.5;

/** The level's name sprayed through a stencil: soft overspray, worn patches, a couple of drips. */
function paintStencil(text: string, paint: number, wear: number, seed: number, rtl: boolean): HTMLCanvasElement {
  const fontPx = STENCIL_H * SS;
  const [m, mctx] = makeCanvas(10, 10);
  mctx.font = `700 ${fontPx}px Karantina, Rubik, sans-serif`;
  const tw = mctx.measureText(text).width;
  const W = tw + 6 * SS, H = fontPx * 1.5;
  const [c, ctx] = makeCanvas(W, H);
  const rnd = seeded(seed);
  ctx.font = mctx.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Callers order mixed Hebrew/Latin text visually, so the run is always laid out left to right.
  ctx.direction = 'ltr';
  void rtl;
  const cx = W / 2, cy = H * 0.44;
  // Overspray halo, then the crisp paint.
  ctx.filter = `blur(${0.45 * SS}px)`;
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = hexCss(paint);
  ctx.fillText(text, cx, cy);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillText(text, cx, cy);
  // Drips running down from the letters.
  const drips = 2 + Math.round(wear * 3);
  for (let k = 0; k < drips; k++) {
    const x = cx - tw / 2 + rnd() * tw;
    const y0 = cy + fontPx * 0.25;
    const len = (1 + rnd() * 2.5) * SS;
    ctx.fillStyle = hexCss(paint, 0.85);
    ctx.fillRect(x, y0, 0.22 * SS, len);
    ctx.beginPath();
    ctx.arc(x + 0.11 * SS, y0 + len, 0.22 * SS, 0, Math.PI * 2);
    ctx.fill();
  }
  // Grunge mask: worn-off patches and speckle, stronger on older paint.
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const n = noise2(seed + 7);
  const t = 0.24 + wear * 0.22;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4 + 3;
      if (!d[i]) continue;
      const v = n(x / 14, y / 14) * 0.65 + n(x / 4, y / 4) * 0.35;
      let k = Math.min(1, Math.max(0, (v - t) / 0.14));
      if (rnd() < 0.1 + wear * 0.12) k *= 0.35;
      d[i] = Math.round(d[i] * k);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------- props ----------

/** Painted wall props (kit sheet K-25b, tools/kit.ts → kit/wprop-<i>). */
export const WALL_PROP_KEYS = Array.from({ length: 9 }, (_, i) => `kit/wprop-${i}`);

interface PropDef {
  /** Height in world units (room 100 = 3.1 m). */
  h: number;
  /** Max width in world units (narrow props fit a 9-unit column with a little overhang). */
  maxW: number;
  /** Centre height below the level's ceiling. */
  y: number;
  wide?: boolean;
  /** Can show up broken in the Remnant. */
  broken?: boolean;
  /** Only once the colony is lived-in. */
  homely?: boolean;
}

// Sheet order: clock, poster, notice board, fuse box, extinguisher, first-aid box, string lights, hanging plant, calendar.
const PROPS: PropDef[] = [
  { h: 11, maxW: 12, y: 30, broken: true },
  { h: 22, maxW: 17, y: 44, wide: true, broken: true },
  { h: 15, maxW: 20, y: 42, wide: true },
  { h: 14, maxW: 12, y: 40, broken: true },
  { h: 20, maxW: 10, y: 70, broken: true },
  { h: 12, maxW: 13, y: 38 },
  { h: 9, maxW: 34, y: 17, homely: true },
  { h: 18, maxW: 13, y: 24, homely: true },
  { h: 13, maxW: 11, y: 40, homely: true },
];

function brightness(x: number, y: number, lamps: WorldLamp[], ambient: number): number {
  let b = ambient;
  for (const l of lamps) {
    const R = l.reach * 1.6;
    const dd = Math.hypot(x - l.x, (y - l.y) * 1.3);
    if (dd >= R) continue;
    const k = 1 - dd / R;
    b += l.power * k * k * 0.75;
  }
  return Math.min(1.05, b);
}

function lightTint(v: number, y: number): number {
  const [r, g, b] = depthGains(y);
  const ch = (k: number) => Math.round(255 * Math.max(0, Math.min(1, v * k)));
  return (ch(r) << 16) | (ch(g) << 8) | ch(b);
}

/** Columns of a level: x, and whether the slot on each side is an empty bay (no room painting). */
function columnsOf(grid: Grid, f: number): { x: number; openL: boolean; openR: boolean }[] {
  const out: { x: number; openL: boolean; openR: boolean }[] = [];
  const row = grid[f], ew = grid.ext[f].w; // [plan4:ST-4] index i is slot i - ew; the shaft stands at i = ew
  for (let s = 1; s < row.length; s++) {
    if (s === ew) continue;
    const a = row[s - 1], b = row[s];
    if ((a || b) && a?.key !== b?.key) out.push({ x: slotX(s - ew), openL: !a, openR: !b });
  }
  out.push({ x: slotX(grid.ext[f].e), openL: !row[row.length - 1], openR: false });
  return out;
}

/** Places 0–2 props on a level's columns; returns the props used so the next level can avoid repeating them. */
function placeProps(
  root: Container, f: number, grid: Grid, era: number, lamps: WorldLamp[], ambient: number, halls: [number, number][],
  above: Set<number>,
): Set<number> {
  const rnd = seeded(hashString(`props-${f}`) ^ (era * 7919));
  const cols = columnsOf(grid, f).filter(c => !halls.some(([a, b]) => c.x > a + 1 && c.x < b - 1));
  const placed = new Set<number>();
  if (!cols.length) return placed;
  const count = era <= 0 ? (rnd() < 0.45 ? 1 : 0) : era === 1 ? (rnd() < 0.6 ? 1 : 0) : rnd() < (era >= 3 ? 0.7 : 0.5) ? 2 : 1;
  // Never the same prop as the level above: stacked copies read as copy-paste.
  const used = new Set<number>(above);
  const usedCols = new Set<number>();
  const top = floorTop(f);
  for (let n = 0, tries = 0; n < count && tries < 20; tries++) {
    const pi = Math.floor(rnd() * PROPS.length);
    const p = PROPS[pi];
    if (used.has(pi)) continue;
    if (era <= 0 && !p.broken) continue;
    if (era <= 1 && p.homely) continue;
    const ci = Math.floor(rnd() * cols.length);
    if (usedCols.has(ci)) continue;
    const col = cols[ci];
    // Wide things only hang where they don't cover a room painting.
    if (p.wide && !col.openL && !col.openR) continue;
    const tex = ArtLibrary.get(WALL_PROP_KEYS[pi]);
    if (!tex) { used.add(pi); continue; }
    used.add(pi);
    placed.add(pi);
    usedCols.add(ci);
    n++;
    const s = Math.min(p.h / tex.height, p.maxW / tex.width);
    const w = tex.width * s, h = tex.height * s;
    let x = col.x;
    if (p.wide) x += col.openR ? w / 2 - 3 : -(w / 2 - 3);
    const y = top + p.y;
    const holder = new Container();
    const sp = new Sprite(tex);
    sp.anchor.set(0.5);
    sp.scale.set(s);
    const broken = era <= 0;
    if (broken) {
      sp.rotation = (rnd() - 0.5) * 0.35;
      sp.y = 1.5;
    } else {
      sp.rotation = (rnd() - 0.5) * 0.05;
    }
    const v = brightness(x, y, lamps, ambient) * (broken ? 0.62 : 0.86);
    sp.tint = lightTint(v, y);
    // Soft contact shadow on the wall behind it.
    const sh = new Sprite(tex);
    sh.anchor.set(0.5);
    sh.scale.set(s);
    sh.rotation = sp.rotation;
    sh.position.set(0.9, 1.6 + sp.y);
    sh.tint = 0x000000;
    sh.alpha = 0.38;
    holder.addChild(sh, sp);
    holder.position.set(x, y);
    root.addChild(holder);
  }
  return placed;
}

// ---------- the whole layer ----------

export interface SignageInput {
  buildings: BuildingInstance[];
  ruins: Ruin[];
  floors: number;
  era: number;
  locale: string;
  rtl: boolean;
  lamps: WorldLamp[];
  ambient: number;
  /** [Danger C5] The memorial plaque text ("In memory: names"), empty when nobody has been lost. */
  memorial?: string;
  /** [plan4:ST-4] How far each floor reaches (default: the classic 12 east of the shaft). */
  exts?: readonly Ext[];
  /** [plan4:polish] Stairwell and vent stack columns (layout.infra): the level name is sprayed clear of them. */
  infra?: readonly { kind: string; floor: number; x: number; floors?: number }[];
}

/** Floor-plate keys this layer asks ArtLibrary for (so the renderer can request them early). */
export function signageArtKeys(): string[] {
  return WALL_PROP_KEYS;
}

export function buildSignage(inp: SignageInput): Container {
  const root = new Container();
  root.eventMode = 'none';
  const fill = () => {
    root.removeChildren().forEach(c => c.destroy({ children: true }));
    const grid = occupancy(inp.buildings, inp.ruins, inp.floors, inp.exts);
    const wear = inp.era <= 0 ? 0.9 : inp.era === 1 ? 0.5 : inp.era === 2 ? 0.22 : 0.08;
    const props = new Container();
    const plates = new Container();
    const stencils = new Container();
    let above = new Set<number>();
    for (let f = 0; f < inp.floors; f++) {
      const top = floorTop(f);
      const zone = signZone(f, inp.buildings, inp.locale);
      const level = `B${f + 1}`;
      // Zone plate on the shaft landing, above the car's doors.
      // [airy:B3] The landing plate is the shaft's address sign: always clean enamel (no wear), lit, a little larger, with the zone's colour glowing round it.
      const pwear = GFX.airy ? Math.min(wear, 0.1) : wear;
      const pkey = `plate|${level}|${zone.name}|${zone.color}|${pwear}|${inp.rtl}`;
      const ptex = cachedTexture(pkey, () => paintPlate(level, zone.name, zone.color, pwear, inp.rtl, hashString(pkey)));
      const plate = new Container();
      const shadow = new Graphics();
      shadow.roundRect(-PLATE_W / 2 + 0.8, -PLATE_H / 2 + 1.4, PLATE_W, PLATE_H, 1.6).fill({ color: 0x000000, alpha: 0.4 });
      shadow.roundRect(-PLATE_W / 2 + 0.4, -PLATE_H / 2 + 2.2, PLATE_W + 1, PLATE_H + 0.6, 2.2).fill({ color: 0x000000, alpha: 0.16 });
      const ps = new Sprite(ptex);
      ps.anchor.set(0.5);
      ps.scale.set(1 / PS);
      const py = top + 11;
      ps.tint = GFX.airy ? 0xffffff : lightTint(0.92 - (inp.era <= 0 ? 0.12 : 0), py);
      if (GFX.airy) {
        const halo = new Sprite(glowTexture());
        halo.anchor.set(0.5);
        halo.tint = zone.color;
        halo.blendMode = 'add';
        halo.alpha = 0.55;
        halo.width = PLATE_W * 1.9;
        halo.height = PLATE_H * 2.6;
        plate.addChild(halo);
      }
      plate.addChild(shadow, ps);
      plate.position.set(SHAFT_W / 2, py);
      if (GFX.airy) plate.scale.set(1.06);
      plate.rotation = !GFX.airy && inp.era <= 0 ? (f % 2 ? 0.035 : -0.025) : 0;
      plates.addChild(plate);
      // The level's name sprayed on the slab face under it, at the far end (skipped where a hall swallows the slab).
      const halls: [number, number][] = inp.buildings.filter(b => isHall(b.type) && b.position.floor === f)
        .map(b => [slotX(b.position.x), slotX(b.position.x) + roomSlots(b.type) * SLOT_W]);
      // Hebrew reads right to left: the level sits on the right, the name to its left.
      const text = inp.rtl ? `${zone.name} · ${level}` : `${level} · ${zone.name.toUpperCase()}`;
      const paint = mix(zone.color, 0xf0e6d0, 0.45);
      const skey = `stencil|${text}|${paint}|${wear}`;
      const stex = cachedTexture(skey, () => paintStencil(text, paint, wear, hashString(skey), inp.rtl));
      const sw = stex.width / SS;
      let sx1 = slotX(grid.ext[f].e) - 16, sx0 = sx1 - sw;
      // [plan4:polish] A stairwell or vent stack at the end of the floor stands over the slab: the name moves west of it (and of any column it then meets).
      const cols = (inp.infra ?? [])
        .filter(i => i.kind !== 'bulkhead' && f >= i.floor && f < i.floor + Math.max(1, i.floors ?? 1))
        .map(i => [slotX(i.x), slotX(i.x) + SLOT_W] as [number, number])
        .sort((a, b) => b[0] - a[0]);
      let moved = false;
      for (const [c0, c1] of cols) if (sx1 > c0 - 3 && sx0 < c1 + 3) { sx1 = c0 - 6; sx0 = sx1 - sw; moved = true; }
      if ((!moved || sx0 >= ROOMS_X) && !halls.some(([a, b]) => sx1 > a && sx0 < b)) {
        const st = new Sprite(stex);
        st.anchor.set(1, 0.44);
        st.scale.set(1 / SS);
        const sy = top + ROOM_H + (GFX.airy ? 11 : 8.8); // [airy2:D1] painted on the deck, above the railing
        st.position.set(sx1, sy);
        st.alpha = 0.72;
        st.tint = lightTint(0.95, sy);
        stencils.addChild(st);
      }
      // [Danger C5] The memorial plaque: the names of the fallen, stencilled on the slab at the entrance end of the first level.
      if (f === 0 && inp.memorial) {
        const mtext = inp.memorial;
        const mkey = `memorial|${mtext}|${wear}`;
        const mtex = cachedTexture(mkey, () => paintStencil(mtext, 0xe6d6a8, wear, hashString(mkey), inp.rtl));
        const mx0 = ROOMS_X + 14;
        if (!halls.some(([a, b]) => mx0 + mtex.width / SS > a && mx0 < b)) {
          const ms = new Sprite(mtex);
          ms.anchor.set(0, 0.44);
          ms.scale.set(1 / SS);
          const my = top + ROOM_H + (GFX.airy ? 11 : 8.8);
          ms.position.set(mx0, my);
          ms.alpha = 0.85;
          ms.tint = lightTint(0.95, my);
          stencils.addChild(ms);
        }
      }
      // Halls of the level above pass through this level's columns.
      const hallsAbove: [number, number][] = inp.buildings.filter(b => isHall(b.type) && b.position.floor === f - 1)
        .map(b => [slotX(b.position.x), slotX(b.position.x) + roomSlots(b.type) * SLOT_W]);
      above = placeProps(props, f, grid, inp.era, inp.lamps, inp.ambient, hallsAbove, above);
    }
    root.addChild(stencils, props, plates);
  };
  fill();
  if (!fontsReady) {
    fontWaiters.push(() => {
      if (root.destroyed) return;
      // Plates painted with fallback fonts: drop them and repaint.
      for (const k of [...texCache.keys()]) { texCache.get(k)!.destroy(true); texCache.delete(k); }
      fill();
    });
  }
  return root;
}

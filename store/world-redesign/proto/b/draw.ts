import { Container, Graphics } from 'pixi.js';
import { T } from './tokens';
import { SH, ZF, Z_BASE, hash2, key, mix, mul, poly, rng, sx, sy, zf } from './iso';
import {
  BANDS, F, LEVELS, NX, NY, R, REG_ATRIUM, REG_CAVE, REG_CORR, REG_DIST, REG_SURF, REG_TUNNEL, V,
  bandLevel, cell, cells, computeColumns, dwellings, idx, inside, rampTop, region, stairs, stairZ,
  type Columns, type Dwelling,
} from './map';

const C = T.color;
const S = T.shade;
const DENS = T.detail.density;

type DrawFn = (g: Graphics) => void;
interface Prim { k: number; l: number; d: DrawFn }

/** Collects drawing primitives with a depth key and a level, then bakes them into per-(level, key bucket) Graphics. */
export class Geo {
  prims: Prim[] = [];
  add(l: number, k: number, d: DrawFn): void { this.prims.push({ l, k, d }); }
  build(parent: DepthSorter): Graphics[] {
    const b = T.depth.bucket;
    const groups = new Map<string, { l: number; bi: number; p: Prim[] }>();
    for (const p of this.prims) {
      const bi = Math.floor(p.k / b);
      const id = `${p.l}:${bi}`;
      let gr = groups.get(id);
      if (!gr) { gr = { l: p.l, bi, p: [] }; groups.set(id, gr); }
      gr.p.push(p);
    }
    const out: Graphics[] = [];
    for (const gr of groups.values()) {
      gr.p.sort((a, c) => a.k - c.k);
      const g = new Graphics();
      for (const p of gr.p) p.d(g);
      g.zIndex = gr.bi * b;
      (g as Graphics & { level: number }).level = gr.l;
      parent.group(gr.bi * b).addChild(g);
      out.push(g);
    }
    return out;
  }
}

/**
 * Depth sorting without re-batching the whole world every frame: the world is split into coarse depth slabs, each its own
 * Pixi render group (its batched geometry is cached). A slab holds the fine static chunks and the people currently inside its
 * key range, sorted by zIndex. A person's zIndex is snapped to the chunk grid, so the slab only re-sorts (and re-batches only
 * itself) when someone crosses a chunk boundary.
 */
export class DepthSorter {
  groups = new Map<number, Container>();
  constructor(public root: Container, private span = 3) { root.sortableChildren = true; }
  group(k: number): Container {
    const gi = Math.floor(k / this.span);
    let g = this.groups.get(gi);
    if (!g) {
      g = new Container({ isRenderGroup: true });
      g.sortableChildren = true;
      g.zIndex = gi * this.span;
      this.groups.set(gi, g);
      this.root.addChild(g);
    }
    return g;
  }
  place(obj: Container, k: number): void {
    const b = T.depth.bucket;
    const zq = Math.floor(k / b) * b + b * 0.5;
    const g = this.group(zq);
    if (obj.parent !== g) g.addChild(obj);
    if (obj.zIndex !== zq) obj.zIndex = zq;
  }
}

// ----------------------------------------------------------------------------------------------------------- helpers
const quad = (g: Graphics, pts: number[][], color: number, alpha = 1): void => { g.poly(poly(pts)).fill({ color, alpha }); };
const line3 = (g: Graphics, a: number[], b: number[], color: number, width = 1, alpha = 1): void => {
  g.moveTo(sx(a[0], a[1]), sy(a[0], a[1], a[2])).lineTo(sx(b[0], b[1]), sy(b[0], b[1], b[2])).stroke({ color, width, alpha });
};
const dot3 = (g: Graphics, p: number[], r: number, color: number, alpha = 1): void => {
  g.circle(sx(p[0], p[1]), sy(p[0], p[1], p[2]), r).fill({ color, alpha });
};

interface BoxOpts { top?: number; left?: number; right?: number; rim?: boolean; cutTop?: boolean; alpha?: number }
/** Axis-aligned box: top, +y (left on screen) and +x (right on screen) faces. */
export function boxDraw(g: Graphics, x: number, y: number, z: number, w: number, d: number, h: number, color: number, o: BoxOpts = {}): void {
  const a = o.alpha ?? 1;
  const zt = z + h;
  quad(g, [[x, y + d, zt], [x + w, y + d, zt], [x + w, y + d, z], [x, y + d, z]], o.left ?? mul(color, S.left), a);
  quad(g, [[x + w, y, zt], [x + w, y + d, zt], [x + w, y + d, z], [x + w, y, z]], o.right ?? mul(color, S.right), a);
  quad(g, [[x, y, zt], [x + w, y, zt], [x + w, y + d, zt], [x, y + d, zt]], o.top ?? (o.cutTop ? mix(color, 0xe8dcc4, 0.45) : mul(color, S.top * 1.08)), a);
  if (o.rim) {
    line3(g, [x, y + d, zt], [x + w, y + d, zt], S.rimColor, S.rimWidth, S.rimAlpha * 1.4);
    line3(g, [x + w, y, zt], [x + w, y + d, zt], S.rimColor, S.rimWidth, S.rimAlpha);
  }
}
function box(geo: Geo, l: number, x: number, y: number, z: number, w: number, d: number, h: number, color: number, o: BoxOpts = {}): void {
  geo.add(l, key(x + w / 2, y + d / 2, z) + 0.02, g => boxDraw(g, x, y, z, w, d, h, color, o));
}
/** Upright cylinder (barrels, tanks, trunks). */
export function cylDraw(g: Graphics, cx: number, cy: number, z: number, r: number, h: number, color: number, topColor?: number): void {
  const x = sx(cx, cy), y0 = sy(cx, cy, z), y1 = sy(cx, cy, z + h);
  const rx = (r * T.tile.w) / Math.SQRT2, ry = (r * T.tile.w) / 2 / Math.SQRT2;
  g.ellipse(x, y0, rx, ry).fill(mul(color, 0.62));
  g.rect(x - rx, y1, rx * 2, y0 - y1).fill(mul(color, 0.72));
  g.rect(x + rx * 0.25, y1, rx * 0.75, y0 - y1).fill({ color: mul(color, 0.5), alpha: 0.9 });
  g.rect(x - rx * 0.62, y1, rx * 0.16, y0 - y1).fill({ color: mul(color, 1.05), alpha: 0.55 });
  g.ellipse(x, y1, rx, ry).fill(topColor ?? mul(color, 1.0));
}
function cyl(geo: Geo, l: number, cx: number, cy: number, z: number, r: number, h: number, color: number, topColor?: number): void {
  geo.add(l, key(cx, cy, z) + 0.05, g => cylDraw(g, cx, cy, z, r, h, color, topColor));
}

// ---------------------------------------------------------------------------------------------------- face details
type Pt = (u: number, v: number) => number[];

function faceDetails(g: Graphics, pt: Pt, band: number, hU: number, r: () => number, glow: Graphics): void {
  const n = Math.round(DENS * Math.max(1, hU) * 7);
  const sp = C.strataSpeck[band];
  for (let i = 0; i < n; i++) {
    const p = pt(r(), r());
    const dark = r() < 0.45;
    g.rect(sx(p[0], p[1]) - 0.7, sy(p[0], p[1], p[2]) - 0.7, 1.2 + r() * 1.6, 1.2 + r()).fill({ color: dark ? mul(C.strata[band], 0.55) : sp, alpha: 0.35 + r() * 0.4 });
  }
  if (band === 1 || band === 2 || band === 0) {
    const lines = Math.round(DENS * (1 + r() * 2));
    for (let i = 0; i < lines; i++) {
      const v = r();
      const p0 = pt(0, v), p1 = pt(0.5, v + (r() - 0.5) * 0.06), p2 = pt(1, v + (r() - 0.5) * 0.06);
      g.moveTo(sx(p0[0], p0[1]), sy(p0[0], p0[1], p0[2])).lineTo(sx(p1[0], p1[1]), sy(p1[0], p1[1], p1[2])).lineTo(sx(p2[0], p2[1]), sy(p2[0], p2[1], p2[2]))
        .stroke({ color: mul(C.strata[band], i % 2 ? 1.25 : 0.7), width: 1, alpha: 0.45 });
    }
  }
  if ((band === 2 || band === 3) && r() < 0.55 * DENS) {
    let u = r(), v = 0.3 + r() * 0.6;
    const p = pt(u, v);
    g.moveTo(sx(p[0], p[1]), sy(p[0], p[1], p[2]));
    for (let k = 0; k < 4; k++) { u += (r() - 0.5) * 0.3; v -= 0.08 + r() * 0.12; const q = pt(Math.min(1, Math.max(0, u)), Math.max(0, v)); g.lineTo(sx(q[0], q[1]), sy(q[0], q[1], q[2])); }
    g.stroke({ color: 0x0b0c10, width: 1, alpha: 0.5 });
  }
  if (band === 4) {
    const veins = Math.round(DENS * (1 + r() * 1.5));
    for (let i = 0; i < veins; i++) {
      const col = r() < 0.6 ? 0x4fb07c : 0xd9b24c;
      let u = r(), v = r();
      const p = pt(u, v);
      g.moveTo(sx(p[0], p[1]), sy(p[0], p[1], p[2]));
      for (let k = 0; k < 3; k++) { u = Math.min(1, Math.max(0, u + (r() - 0.5) * 0.35)); v = Math.min(1, Math.max(0, v + (r() - 0.5) * 0.4)); const q = pt(u, v); g.lineTo(sx(q[0], q[1]), sy(q[0], q[1], q[2])); }
      g.stroke({ color: col, width: 1.4, alpha: 0.85 });
    }
  }
  if (band === 5) {
    const cr = Math.round(DENS * r() * 3);
    for (let i = 0; i < cr; i++) {
      const p = pt(r(), r() * 0.8);
      const x = sx(p[0], p[1]), y = sy(p[0], p[1], p[2]);
      const s = 2 + r() * 4;
      g.poly([x, y - s * 1.8, x + s * 0.6, y, x - s * 0.6, y]).fill({ color: 0x8a6cff, alpha: 0.85 });
      glow.poly([x, y - s * 1.8, x + s * 0.6, y, x - s * 0.6, y]).fill({ color: 0x6a4cff, alpha: 0.35 });
    }
  }
  if (band === 6 && r() < 0.35 * DENS) {
    let u = r(), v = r() * 0.9;
    const p = pt(u, v);
    glow.moveTo(sx(p[0], p[1]), sy(p[0], p[1], p[2]));
    g.moveTo(sx(p[0], p[1]), sy(p[0], p[1], p[2]));
    const pts: number[][] = [];
    for (let k = 0; k < 4; k++) { u = Math.min(1, Math.max(0, u + (r() - 0.5) * 0.5)); v = Math.min(1, Math.max(0, v + (r() - 0.3) * 0.35)); pts.push(pt(u, v)); }
    for (const q of pts) { glow.lineTo(sx(q[0], q[1]), sy(q[0], q[1], q[2])); g.lineTo(sx(q[0], q[1]), sy(q[0], q[1], q[2])); }
    glow.stroke({ color: 0xff4a12, width: 1.6, alpha: 0.5 });
    g.stroke({ color: 0xff7a30, width: 1, alpha: 0.9 });
  }
}

type Mat = 'rock' | 'concrete' | 'metro' | 'shored';
function faceMaterial(nx: number, ny: number, band: number): Mat {
  if (!inside(nx, ny) || band < 1 || band > 3) return 'rock';
  if (cells[band][idx(nx, ny)] === R) return 'rock';
  const rg = region[idx(nx, ny)];
  if (rg === REG_ATRIUM) return 'concrete';
  if (rg === REG_CORR || rg === REG_TUNNEL) return 'metro';
  if (rg === REG_DIST) return 'shored';
  return 'rock';
}

function drawVerticalFace(g: Graphics, glow: Graphics, dir: 'x' | 'y', x: number, y: number, z0: number, z1: number, band: number, mat: Mat, isTop: boolean, contact: boolean, seed: number): void {
  const pt: Pt = dir === 'x' ? (u, v) => [x + 1, y + u, z0 + v * (z1 - z0)] : (u, v) => [x + u, y + 1, z0 + v * (z1 - z0)];
  const shade = dir === 'x' ? S.right : S.left;
  const r = rng(seed);
  let base: number = C.strata[band];
  if (mat === 'concrete') base = mix(C.concrete, C.strata[band], 0.25);
  if (mat === 'metro') base = C.metroTile;
  const col = mul(base, shade * (0.94 + hash2(x, y, band) * 0.12));
  quad(g, [pt(0, 1), pt(1, 1), pt(1, 0), pt(0, 0)], col);
  const h = z1 - z0;
  if (mat === 'rock' || mat === 'shored') faceDetails(g, pt, band, h, r, glow);
  if (band === 0 && h > 0) quad(g, [pt(0, 1), pt(1, 1), pt(1, 0), pt(0, 0)], mul(C.soil, shade), 0.85);
  if (mat === 'concrete') {
    const seam = mul(base, shade * 0.62);
    line3(g, pt(0, 0), pt(0, 1), seam, 1, 0.6);
    const mid = pt(0, 0.5), mid2 = pt(1, 0.5);
    line3(g, mid, mid2, seam, 1, 0.35);
    if (r() < 0.6) { const u = 0.2 + r() * 0.6; line3(g, pt(u, 0.95), pt(u + 0.02, 0.35 + r() * 0.3), C.rust, 2, 0.45); }
    if (band === 1 || band === 2 || band === 3) {
      // hazard stripe just above the floor line of each level
      const zb = z0, zt = z0 + 0.14;
      if (zt < z1) {
        quad(g, [pt(0, 0.14 / h), pt(1, 0.14 / h), pt(1, 0), pt(0, 0)], mul(C.hazardK, shade));
        for (let k = 0; k < 4; k++) {
          const u0 = k * 0.25, u1 = u0 + 0.12;
          quad(g, [[...pt(u0 + 0.06, 0).slice(0, 2), zt], [...pt(u1 + 0.06, 0).slice(0, 2), zt], [...pt(u1, 0).slice(0, 2), zb], [...pt(u0, 0).slice(0, 2), zb]], mul(C.hazardY, shade));
        }
      }
    }
  }
  if (mat === 'metro') {
    const grout = mul(C.metroGrout, shade);
    for (let k = 1; k < 4; k++) line3(g, pt(k / 4, 0), pt(k / 4, 1), grout, 1, 0.5);
    const rows = Math.max(1, Math.round(h / 0.22));
    for (let k = 1; k < rows; k++) line3(g, pt(0, k / rows), pt(1, k / rows), grout, 1, 0.45);
    const tb = Math.min(1, 1.05 / h), tt = Math.min(1, 1.25 / h);
    quad(g, [pt(0, tt), pt(1, tt), pt(1, tb), pt(0, tb)], mul(C.metroTrim, shade));
    quad(g, [pt(0, 0.5 / h), pt(1, 0.5 / h), pt(1, 0), pt(0, 0)], 0x1a1612, 0.35);
    for (let k = 0; k < 5; k++) { const p = pt(r(), r() * 0.5); g.rect(sx(p[0], p[1]), sy(p[0], p[1], p[2]), 2 + r() * 3, 1.5).fill({ color: 0x2b2620, alpha: 0.35 }); }
  }
  if (mat === 'shored' && (dir === 'y' ? x : y) % 3 === 0) {
    const zt = Math.min(z1, z0 + 1.9);
    const v1 = (zt - z0) / h;
    quad(g, [pt(0.42, v1), pt(0.56, v1), pt(0.56, 0), pt(0.42, 0)], mul(C.timber, shade));
    line3(g, pt(0.42, 0), pt(0.42, v1), 0x1a120a, 1, 0.6);
  }
  // ambient occlusion where the face meets a floor
  if (contact) {
    const a = Math.min(1, S.aoHeight / h);
    quad(g, [pt(0, a), pt(1, a), pt(1, 0), pt(0, 0)], 0x000000, S.aoAlpha * 0.5);
    quad(g, [pt(0, a * 0.4), pt(1, a * 0.4), pt(1, 0), pt(0, 0)], 0x000000, S.aoAlpha * 0.6);
  }
  if (isTop) line3(g, pt(0, 1), pt(1, 1), S.rimColor, S.rimWidth, S.rimAlpha);
  if (dir === 'x') line3(g, pt(1, 0), pt(1, 1), 0x000000, 1, 0.22);
}

// ------------------------------------------------------------------------------------------------------- top faces
function drawTop(g: Graphics, cols: Columns, x: number, y: number): void {
  const i = idx(x, y);
  const z = cols.top[i];
  const kind = cols.kind[i];
  const r = rng(i * 31 + 7);
  const pt = (u: number, v: number): number[] => [x + u, y + v, z];
  const rg = region[i];
  if (kind === 'ramp') return; // drawn by the stair pass
  let col: number;
  if (kind === 'ground') {
    col = mix(C.ground, C.groundAlt, hash2(x >> 1, y >> 1, 2) * 0.8 + hash2(x, y, 9) * 0.2);
  } else if (kind === 'cut') {
    const b = Math.max(0, Math.min(6, bandOfTop(z)));
    col = mul(C.cutTop[b], 0.92 + hash2(x, y, 4) * 0.16);
  } else if (rg === REG_ATRIUM) col = hash2(x, y, 5) < 0.5 ? C.concrete : C.concreteDark;
  else if (rg === REG_CORR || rg === REG_TUNNEL) col = mul(C.metroFloor, 0.92 + hash2(x, y, 6) * 0.14);
  else if (rg === REG_DIST) col = mul(C.earth, 0.9 + hash2(x, y, 6) * 0.2);
  else if (rg === REG_CAVE) col = mul(C.cave, 0.9 + hash2(x, y, 6) * 0.2);
  else col = C.concreteDark;
  quad(g, [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)], col);
  if (kind === 'ground') {
    const n = Math.round(DENS * 5);
    for (let k = 0; k < n; k++) { const p = pt(r(), r()); g.rect(sx(p[0], p[1]), sy(p[0], p[1], p[2]), 1.5, 1.2).fill({ color: r() < 0.5 ? C.ash : 0x3a352f, alpha: 0.5 }); }
    if (r() < 0.45 * DENS) {
      const p = pt(r(), r());
      const X0 = sx(p[0], p[1]), Y0 = sy(p[0], p[1], p[2]);
      for (let k = 0; k < 4; k++) g.moveTo(X0 + k * 1.5 - 2, Y0).lineTo(X0 + k * 2 - 4 + r() * 2, Y0 - 3 - r() * 4).stroke({ color: C.deadGrass, width: 1, alpha: 0.75 });
    }
    if (r() < 0.2 * DENS) { const p = pt(0.2 + r() * 0.6, 0.2 + r() * 0.6); g.ellipse(sx(p[0], p[1]), sy(p[0], p[1], p[2]), 4 + r() * 4, 2 + r() * 2).fill({ color: 0x4d4a45, alpha: 0.8 }); }
  } else if (kind === 'cut') {
    for (let k = 1; k < 3; k++) line3(g, pt(k / 3, 0), pt(k / 3 + 0.1, 1), mul(col, 0.8), 1, 0.35);
    const n = Math.round(DENS * 3);
    for (let k = 0; k < n; k++) { const p = pt(r(), r()); g.rect(sx(p[0], p[1]), sy(p[0], p[1], p[2]), 1.4, 1.2).fill({ color: mul(col, 1.35), alpha: 0.5 }); }
  } else {
    // floors: seams on the back edges, stains, region detail
    line3(g, pt(0, 0), pt(1, 0), mul(col, 0.7), 1, S.seamAlpha * 2);
    line3(g, pt(0, 0), pt(0, 1), mul(col, 0.7), 1, S.seamAlpha * 2);
    if (r() < 0.3 * DENS) { const p = pt(0.2 + r() * 0.6, 0.2 + r() * 0.6); g.ellipse(sx(p[0], p[1]), sy(p[0], p[1], p[2]), 6 + r() * 8, 3 + r() * 3).fill({ color: 0x15130f, alpha: 0.22 }); }
    if (rg === REG_DIST && y >= 12 && y < 15) {
      for (let k = 0; k < 3; k++) quad(g, [pt(0, k / 3 + 0.02), pt(1, k / 3 + 0.02), pt(1, (k + 1) / 3 - 0.02), pt(0, (k + 1) / 3 - 0.02)], mul(C.plank, 0.85 + hash2(x, y * 3 + k, 1) * 0.3));
    }
    if ((rg === REG_CORR || rg === REG_TUNNEL) && y === 13) {
      for (let k = 0; k < 2; k++) quad(g, [pt(k * 0.5 + 0.1, 0.08), pt(k * 0.5 + 0.28, 0.08), pt(k * 0.5 + 0.28, 0.92), pt(k * 0.5 + 0.1, 0.92)], C.sleeper);
      for (const v of [0.3, 0.7]) { line3(g, pt(0, v), pt(1, v), mul(C.rail, 0.55), 3, 1); line3(g, pt(0, v - 0.02), pt(1, v - 0.02), C.rail, 1.2, 0.9); }
    }
    if (rg === REG_ATRIUM && (x + y) % 7 === 0 && z < -6) {
      line3(g, pt(0.1, 0.5), pt(0.9, 0.5), C.hazardY, 2, 0.35);
    }
    if (rg === REG_CAVE && r() < 0.3) { const p = pt(0.5, 0.5); g.ellipse(sx(p[0], p[1]), sy(p[0], p[1], p[2]), 10, 5).fill({ color: 0x1b2a40, alpha: 0.85 }); g.ellipse(sx(p[0], p[1]) - 2, sy(p[0], p[1], p[2]) - 1, 5, 1.5).fill({ color: 0x6fb8d8, alpha: 0.35 }); }
  }
  // rim on edges that drop away in front
  const tx = inside(x + 1, y) ? cols.top[idx(x + 1, y)] : -99;
  const ty = inside(x, y + 1) ? cols.top[idx(x, y + 1)] : -99;
  if (tx < z - 0.05) line3(g, pt(1, 0), pt(1, 1), S.rimColor, S.rimWidth, S.rimAlpha * (kind === 'floor' ? 0.6 : 1));
  if (ty < z - 0.05) line3(g, pt(0, 1), pt(1, 1), S.rimColor, S.rimWidth, S.rimAlpha * (kind === 'floor' ? 0.8 : 1.3));
}
function bandOfTop(z: number): number {
  for (const [z0, z1, b] of BANDS) if (z - 1e-3 >= z0 && z - 1e-3 < z1) return b;
  return 1;
}

// ------------------------------------------------------------------------------------------------- columns pass
function columnsPass(geo: Geo, glow: Graphics, cols: Columns): void {
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = idx(x, y);
    const top = cols.top[i];
    const ntx = inside(x + 1, y) ? cols.top[idx(x + 1, y)] : -Infinity;
    const nty = inside(x, y + 1) ? cols.top[idx(x, y + 1)] : -Infinity;
    for (const [b0, b1, band] of BANDS) {
      const z0 = Math.max(b0, Z_BASE), z1 = Math.min(b1, top);
      if (z1 <= z0 + 1e-4) continue;
      const lv = bandLevel(band);
      const isTop = Math.abs(z1 - top) < 1e-4;
      for (const dir of ['x', 'y'] as const) {
        const nt = dir === 'x' ? ntx : nty;
        const e0 = Math.max(z0, nt);
        if (z1 <= e0 + 1e-4) continue;
        const contact = Math.abs(e0 - nt) < 1e-4 && nt > Z_BASE;
        const nx = dir === 'x' ? x + 1 : x, ny = dir === 'x' ? y : y + 1;
        const mat = faceMaterial(nx, ny, band);
        const k = dir === 'x' ? key(x + 1, y + 0.5, e0) : key(x + 0.5, y + 1, e0);
        const seed = i * 13 + band * 7 + (dir === 'x' ? 1 : 2);
        geo.add(lv, k - 0.05, g => drawVerticalFace(g, glow, dir, x, y, e0, z1, band, mat, isTop, contact, seed));
      }
    }
    const kind = cols.kind[i];
    if (kind !== 'ramp') geo.add(kind === 'ground' ? 0 : cols.topLevel[i], key(x + 0.5, y + 0.5, top) - 0.1, g => drawTop(g, cols, x, y));
  }
}

// ---------------------------------------------------------------------------------------------- slabs & railings
function railing(geo: Geo, l: number, ax: number, ay: number, bx: number, by: number, z: number): void {
  const k = key((ax + bx) / 2, (ay + by) / 2, z) + 0.03;
  geo.add(l, k, g => {
    const h = 0.55;
    for (const t of [0, 0.5]) {
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      line3(g, [px, py, z], [px, py, z + h], mul(C.railing, 0.7), 1.6, 1);
    }
    line3(g, [ax, ay, z + h], [bx, by, z + h], C.railing, 1.8, 1);
    line3(g, [ax, ay, z + h * 0.5], [bx, by, z + h * 0.5], mul(C.railing, 0.75), 1, 0.9);
  });
}
function isStairEntry(l: number, x: number, y: number, nx: number, ny: number): boolean {
  for (const s of stairs) {
    if (s.kind !== 'steps') continue;
    if (nx >= s.x0 && nx < s.x1 && ((s.from === l && ny === s.y0 && y === s.y0 - 1) || (s.to === l && ny === s.y1 - 1 && y === s.y1))) return true;
    if (x >= s.x0 && x < s.x1 && ((s.from === l && y === s.y0 && ny === s.y0 - 1) || (s.to === l && y === s.y1 - 1 && ny === s.y1))) return true;
  }
  return false;
}
function slabsPass(geo: Geo, cols: Columns, slice: number): void {
  const th = 0.22;
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = idx(x, y);
    const list = cols.slabs[i].slice();
    // the lowest floor in an atrium column also gets railings toward the void when it is a balcony level (handled via slabs)
    for (const l of list) {
      if (l < slice) continue;
      const z = zf(l);
      const pt = (u: number, v: number, dz = 0): number[] => [x + u, y + v, z + dz];
      geo.add(l, key(x + 0.5, y + 0.5, z) - 0.02, g => {
        quad(g, [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)], mul(C.grating, 0.95 + hash2(x, y, l) * 0.1));
        for (let k = 1; k < 4; k++) { line3(g, pt(k / 4, 0), pt(k / 4, 1), C.gratingLine, 1, 0.45); line3(g, pt(0, k / 4), pt(1, k / 4), C.gratingLine, 1, 0.3); }
      });
      // thickness on open front edges
      const openX = cell(l, x + 1, y) !== F && !(inside(x + 1, y) && cols.top[idx(x + 1, y)] >= z - 0.01);
      const openY = cell(l, x, y + 1) !== F && !(inside(x, y + 1) && cols.top[idx(x, y + 1)] >= z - 0.01);
      if (openX) geo.add(l, key(x + 1, y + 0.5, z - th) - 0.01, g => {
        quad(g, [pt(1, 0), pt(1, 1), pt(1, 1, -th), pt(1, 0, -th)], mul(C.steelDark, S.right));
        line3(g, pt(1, 0), pt(1, 1), S.rimColor, 1, 0.3);
      });
      if (openY) geo.add(l, key(x + 0.5, y + 1, z - th) - 0.01, g => {
        quad(g, [pt(0, 1), pt(1, 1), pt(1, 1, -th), pt(0, 1, -th)], mul(C.hazardK, S.left));
        for (let k = 0; k < 4; k++) quad(g, [pt(k / 4 + 0.07, 1), pt(k / 4 + 0.17, 1), pt(k / 4 + 0.12, 1, -th), pt(k / 4 + 0.02, 1, -th)], mul(C.hazardY, S.left * 0.9));
        line3(g, pt(0, 1), pt(1, 1), S.rimColor, 1, 0.35);
      });
      // railings toward void (all four sides)
      const sides: [number, number, number[], number[]][] = [[1, 0, [x + 1, y], [x + 1, y + 1]], [0, 1, [x, y + 1], [x + 1, y + 1]], [-1, 0, [x, y], [x, y + 1]], [0, -1, [x, y], [x + 1, y]]];
      for (const [dx, dy, a, b] of sides) {
        const c = cell(l, x + dx, y + dy);
        if (c !== V) continue;
        if (isStairEntry(l, x, y, x + dx, y + dy)) continue;
        railing(geo, l, a[0], a[1], b[0], b[1], z);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------- stairs & ramp
function stairsPass(geo: Geo, slice: number): void {
  for (const s of stairs) {
    if (s.from < slice && s.kind === 'ramp') continue;
    if (s.from < slice) continue;
    const l = s.from;
    if (s.kind === 'ramp') {
      for (let y = s.y0; y < s.y1; y++) for (let x = s.x0; x < s.x1; x++) {
        const [zt, zb] = rampTop(x, y);
        geo.add(0, key(x + 0.5, y + 0.5, zb) - 0.1, g => {
          quad(g, [[x, y, zt], [x + 1, y, zt], [x + 1, y + 1, zb], [x, y + 1, zb]], mul(C.concreteDark, 0.95 + hash2(x, y, 3) * 0.1));
          line3(g, [x + 0.3, y, zt], [x + 0.3, y + 1, zb], 0x2a2724, 2, 0.4);
          line3(g, [x + 0.7, y, zt], [x + 0.7, y + 1, zb], 0x2a2724, 2, 0.4);
          if (y === s.y0) for (let k = 0; k < 3; k++) line3(g, [x + k / 3, y + 0.05, zt], [x + k / 3 + 0.18, y + 0.3, zt - 0.1], C.hazardY, 2, 0.6);
        });
      }
      continue;
    }
    const n = 8;
    const len = s.y1 - s.y0;
    const z0 = zf(s.from), z1 = zf(s.to);
    for (let k = 0; k < n; k++) {
      const a0 = s.y0 + (k * len) / n, a1 = s.y0 + ((k + 1) * len) / n;
      const zt = z0 - ((k + 1) * (z0 - z1)) / (n + 1);
      geo.add(l, key((s.x0 + s.x1) / 2, (a0 + a1) / 2, zt - 0.3), g => {
        boxDraw(g, s.x0 + 0.08, a0, zt - 0.1, s.x1 - s.x0 - 0.16, a1 - a0, 0.1, C.steel, { top: mul(C.grating, 1.12), rim: true });
      });
    }
    // stringers (per cell, so they sort with people) and railings on both sides
    for (let y = s.y0; y < s.y1; y++) {
      const za = stairZ(s, y), zb = stairZ(s, y + 1);
      for (const xs of [s.x0 + 0.08, s.x1 - 0.08]) {
        const front = xs > s.x0 + 0.5;
        geo.add(l, key(xs, y + 0.5, zb - 0.4) + (front ? 0.2 : -0.2), g => {
          quad(g, [[xs, y, za + 0.02], [xs, y + 1, zb + 0.02], [xs, y + 1, zb - 0.38], [xs, y, za - 0.38]], mul(C.steelDark, front ? S.right : S.left));
          line3(g, [xs, y, za + 0.6], [xs, y + 1, zb + 0.6], C.railing, 1.8, 1);
          line3(g, [xs, y + 0.5, (za + zb) / 2], [xs, y + 0.5, (za + zb) / 2 + 0.6], mul(C.railing, 0.7), 1.4, 1);
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------- dwellings
function wallSeg(geo: Geo, l: number, x: number, y: number, w: number, d: number, z: number, h: number, d0: Dwelling, along: 'x' | 'y'): void {
  const col = d0.color;
  geo.add(l, key(x + w / 2, y + d / 2, z) + (h < 0.6 ? 0.25 : -0.1), g => {
    boxDraw(g, x, y, z, w, d, h, col, { top: mix(col, 0xf0e2c8, 0.5) });
    // material lines on the visible face
    const face = along === 'x' ? (u: number, v: number) => [x + u * w, y + d, z + v * h] : (u: number, v: number) => [x + w, y + u * d, z + v * h];
    const fc = mul(col, (along === 'x' ? S.left : S.right) * 0.7);
    if (d0.mat === 'corrugated') for (let k = 1; k < 8; k++) line3(g, face(k / 8, 0), face(k / 8, 1), fc, 1, 0.55);
    if (d0.mat === 'container') {
      for (let k = 1; k < 4; k++) line3(g, face(k / 4, 0.05), face(k / 4, 0.95), fc, 2, 0.5);
      if (hash2(x * 3, y * 5, 1) < 0.5) quad(g, [face(0.1, 0.5), face(0.5, 0.45), face(0.45, 0.1), face(0.15, 0.15)], C.rust, 0.45);
    }
    if (d0.mat === 'brick') {
      const rows = Math.max(1, Math.round(h / 0.14));
      for (let k = 1; k < rows; k++) line3(g, face(0, k / rows), face(1, k / rows), fc, 1, 0.45);
      for (let k = 0; k < rows; k++) for (let m = 0; m < 3; m++) { const u = (m + (k % 2) * 0.5) / 3; if (u < 1) line3(g, face(u, k / rows), face(u, (k + 1) / rows), fc, 1, 0.35); }
    }
    if (d0.mat === 'tarp') { line3(g, face(0, 0.7), face(0.5, 0.55), fc, 1, 0.5); line3(g, face(0.5, 0.55), face(1, 0.7), fc, 1, 0.5); }
  });
}

function dwellingPass(geo: Geo, glow: Graphics): void {
  const l = 3, z = zf(3), hFull = 1.55, hStub = 0.34, t = 0.12;
  for (const d of dwellings) {
    // back walls (-y edge, -x edge)
    for (let x = d.x0; x < d.x1; x++) {
      const isDoor = d.face === 'N' && x === d.doorX;
      if (isDoor) {
        wallSeg(geo, l, x, d.y0, 1, t, z + 1.2, hFull - 1.2, d, 'x');
        box(geo, l, x - 0.02, d.y0 - 0.02, z, 0.08, t + 0.04, 1.25, 0x2c2622);
        box(geo, l, x + 0.94, d.y0 - 0.02, z, 0.08, t + 0.04, 1.25, 0x2c2622);
      } else wallSeg(geo, l, x, d.y0, 1, t, z, hFull, d, 'x');
    }
    for (let y = d.y0; y < d.y1; y++) wallSeg(geo, l, d.x0, y, t, 1, z, hFull, d, 'y');
    // front stubs (+y edge, +x edge): the cutaway
    for (let x = d.x0; x < d.x1; x++) {
      const isDoor = d.face === 'S' && x === d.doorX;
      if (isDoor) {
        box(geo, l, x, d.y1 - t - 0.02, z, 0.08, t + 0.04, 1.3, 0x2c2622);
        box(geo, l, x + 0.92, d.y1 - t - 0.02, z, 0.08, t + 0.04, 1.3, 0x2c2622);
      } else wallSeg(geo, l, x, d.y1 - t, 1, t, z, hStub, d, 'x');
    }
    for (let y = d.y0; y < d.y1; y++) wallSeg(geo, l, d.x1 - t, y, t, 1, z, hStub, d, 'y');
    // interiors
    const back = d.face === 'S' ? d.y0 : d.y1 - 1;
    const by = d.face === 'S' ? d.y0 + 0.15 : d.y1 - 0.85;
    const r = rng(d.x0 * 17 + d.y0);
    // rug
    geo.add(l, key(d.x0 + 1.5, (d.y0 + d.y1) / 2, z) - 0.05, g => quad(g, [[d.x0 + 0.6, d.y0 + 1.2, z + 0.01], [d.x0 + 2.2, d.y0 + 1.2, z + 0.01], [d.x0 + 2.2, d.y0 + 2.6, z + 0.01], [d.x0 + 0.6, d.y0 + 2.6, z + 0.01]], mul(d.color, 0.55), 0.8));
    if (d.kind === 'home' || d.kind === 'tv') {
      box(geo, l, d.x0 + 0.2, by, z, 0.7, 0.65, 0.28, 0x5a4636);
      box(geo, l, d.x0 + 0.24, by + 0.05, z + 0.28, 0.62, 0.55, 0.08, d.kind === 'tv' ? 0x3d5a7a : 0x8a3e36);
      box(geo, l, d.x0 + 0.27, by + 0.05, z + 0.36, 0.2, 0.3, 0.07, 0xd8d0c0);
      box(geo, l, d.x0 + 1.4, d.y0 + 1.5, z, 0.7, 0.6, 0.45, 0x6b4a2e, { top: 0x8a6440 });
      box(geo, l, d.x0 + 1.55, d.y0 + 1.6, z + 0.45, 0.14, 0.14, 0.12, 0xc9b38a);
      box(geo, l, d.x1 - 1.05, back + (d.face === 'S' ? 0.15 : 0.55), z, 0.8, 0.3, 1.2, 0x4a3828);
      for (let k = 0; k < 4; k++) box(geo, l, d.x1 - 1.0 + r() * 0.6, back + (d.face === 'S' ? 0.2 : 0.6), z + 0.4 + (k % 2) * 0.4, 0.12, 0.15, 0.16, [0xb04a3a, 0x3a6aa0, 0xd8b04a, 0x6aa04a][k]);
      if (d.kind === 'tv') {
        box(geo, l, d.x0 + 1.0, d.y0 + 0.2, z, 0.5, 0.4, 0.35, 0x2a2a2e);
        geo.add(l, key(d.x0 + 1.25, d.y0 + 0.4, z + 0.35) + 0.01, g => boxDraw(g, d.x0 + 1.05, d.y0 + 0.25, z + 0.35, 0.4, 0.3, 0.32, 0x3a3a40));
        const p = [d.x0 + 1.25, d.y0 + 0.55, z + 0.5];
        glow.ellipse(sx(p[0], p[1]), sy(p[0], p[1], p[2]), 6, 5).fill({ color: 0x7fc8ff, alpha: 0.6 });
      }
    }
    if (d.kind === 'workshop') {
      box(geo, l, d.x0 + 0.2, d.y0 + 0.15, z, 2.6, 0.6, 0.55, 0x5a5048, { top: 0x7a6e60 });
      box(geo, l, d.x0 + 0.6, d.y0 + 0.25, z + 0.55, 0.3, 0.25, 0.2, 0x3a4048);
      box(geo, l, d.x0 + 1.4, d.y0 + 0.2, z + 0.55, 0.5, 0.3, 0.12, 0x8a6a3a);
      box(geo, l, d.x1 - 1.0, d.y0 + 1.6, z, 0.75, 0.6, 0.6, 0x5a6a3a);
      geo.add(l, key(d.x1 - 0.6, d.y0 + 1.9, z + 0.6) + 0.01, g => { for (let k = 0; k < 4; k++) line3(g, [d.x1 - 0.25, d.y0 + 1.65 + k * 0.13, z + 0.12], [d.x1 - 0.25, d.y0 + 1.65 + k * 0.13, z + 0.5], 0x2a3020, 1.5, 0.8); });
      box(geo, l, d.x0 + 0.25, d.y0 + 1.7, z, 0.6, 0.6, 0.5, 0x6a6a70);
      cyl(geo, l, d.x0 + 2.4, d.y0 + 2.4, z, 0.22, 0.75, 0x3a6a8a, 0x4a7a9a);
    }
    if (d.kind === 'garden') {
      for (let k = 0; k < 2; k++) {
        const px = d.x0 + 0.25 + k * 1.4;
        box(geo, l, px, d.y0 + 0.9, z, 1.1, 2.5, 0.3, 0x5a4030, { top: 0x3a2a1e });
        geo.add(l, key(px + 0.55, d.y0 + 2.1, z + 0.3) + 0.02, g => {
          const rr = rng(px * 31);
          for (let m = 0; m < 9; m++) {
            const p = [px + 0.2 + rr() * 0.7, d.y0 + 1.05 + rr() * 2.2, z + 0.3];
            const X0 = sx(p[0], p[1]), Y0 = sy(p[0], p[1], p[2]);
            g.circle(X0, Y0 - 4, 4 + rr() * 3).fill(mix(0x3f7a3a, 0x8ac060, rr()));
            g.circle(X0 + 2, Y0 - 7, 2.5).fill({ color: 0xa8d878, alpha: 0.7 });
          }
        });
      }
      for (let k = 0; k < 2; k++) {
        const px = d.x0 + 0.4 + k * 1.4;
        box(geo, l, px, d.y0 + 1.2, z + 1.45, 0.8, 0.12, 0.06, 0x2a2a30);
        const a = [px + 0.05, d.y0 + 1.32, z + 1.45], b = [px + 0.75, d.y0 + 1.32, z + 1.45];
        glow.moveTo(sx(a[0], a[1]), sy(a[0], a[1], a[2])).lineTo(sx(b[0], b[1]), sy(b[0], b[1], b[2])).stroke({ color: 0xe08aff, width: 3, alpha: 0.85 });
      }
    }
    if (d.kind === 'forge') {
      box(geo, l, d.x0 + 1.6, d.y0 + 0.2, z, 1.2, 1.0, 1.15, 0x6a3a2c, { top: 0x4a2a22 });
      cyl(geo, l, d.x0 + 2.2, d.y0 + 0.55, z + 1.15, 0.18, 0.75, 0x3a3436);
      const m = [[d.x0 + 1.9, d.y0 + 1.2, z + 0.25], [d.x0 + 2.5, d.y0 + 1.2, z + 0.25], [d.x0 + 2.5, d.y0 + 1.2, z + 0.75], [d.x0 + 1.9, d.y0 + 1.2, z + 0.75]];
      geo.add(l, key(d.x0 + 2.2, d.y0 + 1.25, z) + 0.01, g => { quad(g, m, 0xff7a2a); quad(g, [m[0], m[1], [m[1][0], m[1][1], z + 0.45], [m[0][0], m[0][1], z + 0.45]], 0xffd070); });
      glow.poly(poly(m)).fill({ color: 0xff6a20, alpha: 0.85 });
      box(geo, l, d.x0 + 0.6, d.y0 + 1.9, z, 0.35, 0.25, 0.35, 0x2a2a2e, { top: 0x4a4a52 });
      box(geo, l, d.x0 + 0.45, d.y0 + 1.86, z + 0.35, 0.65, 0.33, 0.12, 0x2a2a2e, { top: 0x5a5a62 });
      box(geo, l, d.x0 + 0.2, d.y1 - 0.9, z, 0.7, 0.7, 0.2, 0x1e1c1c, { top: 0x2a2626 });
    }
  }
}

// ------------------------------------------------------------------------------------------------- props
function rubble(geo: Geo, l: number, x0: number, x1: number, y0: number, y1: number, z: number, seed: number, maxH: number): void {
  const r = rng(seed);
  const n = Math.round((x1 - x0) * (y1 - y0) * 9 * Math.max(0.4, DENS));
  for (let i = 0; i < n; i++) {
    const cx = x0 + r() * (x1 - x0), cy = y0 + r() * (y1 - y0);
    const centre = 1 - Math.abs((cx - (x0 + x1) / 2) / ((x1 - x0) / 2));
    const zz = z + r() * maxH * centre * 0.8;
    const w = 0.15 + r() * 0.45, d = 0.15 + r() * 0.4, h = 0.12 + r() * 0.35;
    const col = r() < 0.25 ? 0x6a6660 : mix(C.strata[3], C.concrete, r());
    box(geo, l, cx - w / 2, cy - d / 2, zz, w, d, h, col, { rim: r() < 0.3 });
  }
}
function crate(geo: Geo, l: number, x: number, y: number, z: number, s = 0.45, col = 0x7a5a36): void {
  box(geo, l, x, y, z, s, s, s * 0.85, col, { top: mul(col, 1.15) });
  geo.add(l, key(x + s / 2, y + s / 2, z) + 0.03, g => {
    line3(g, [x, y + s, z], [x + s, y + s, z + s * 0.85], mul(col, 0.5), 1, 0.7);
    line3(g, [x + s, y, z], [x + s, y + s, z + s * 0.85], mul(col, 0.4), 1, 0.7);
  });
}
function stall(geo: Geo, l: number, x: number, y: number, z: number, tarp: number): void {
  for (const [px, py] of [[x, y], [x + 1.9, y], [x, y + 0.9], [x + 1.9, y + 0.9]]) box(geo, l, px, py, z, 0.06, 0.06, 1.35, 0x3a3028);
  box(geo, l, x + 0.15, y + 0.55, z, 1.7, 0.45, 0.55, 0x6a5038, { top: 0x8a6a48 });
  const rr = rng(x * 7 + y);
  for (let k = 0; k < 5; k++) box(geo, l, x + 0.25 + k * 0.32, y + 0.62, z + 0.55, 0.2, 0.2, 0.12 + rr() * 0.1, [0xc0503a, 0xd8b04a, 0x6aa04a, 0xc8c0a8, 0x5a7ac0][k]);
  geo.add(l, key(x + 1, y + 0.5, z + 1.3) + 0.4, g => {
    const pts = [[x - 0.1, y - 0.1, z + 1.45], [x + 2.05, y - 0.1, z + 1.45], [x + 2.05, y + 1.1, z + 1.25], [x - 0.1, y + 1.1, z + 1.25]];
    quad(g, pts, tarp);
    for (let k = 1; k < 5; k++) line3(g, [x - 0.1 + k * 0.43, y - 0.1, z + 1.45], [x - 0.1 + k * 0.43, y + 1.1, z + 1.25], mul(tarp, 0.7), 2, 0.6);
    quad(g, [[x - 0.1, y + 1.1, z + 1.25], [x + 2.05, y + 1.1, z + 1.25], [x + 2.05, y + 1.1, z + 1.1], [x - 0.1, y + 1.1, z + 1.1]], mul(tarp, 0.6));
  });
}
function sandbags(geo: Geo, l: number, x: number, y: number, z: number, n: number, alongX: boolean): void {
  for (let k = 0; k < n; k++) for (let row = 0; row < 2; row++) {
    const ox = alongX ? k * 0.42 + row * 0.2 : 0, oy = alongX ? 0 : k * 0.42 + row * 0.2;
    box(geo, l, x + ox, y + oy, z + row * 0.17, alongX ? 0.4 : 0.3, alongX ? 0.3 : 0.4, 0.17, mul(C.sandbag, 0.9 + ((k + row) % 3) * 0.06));
  }
}

function propsPass(geo: Geo, glow: Graphics, slice: number): void {
  const z3 = zf(3), z2 = zf(2), z1 = zf(1);
  if (slice === 0) {
    // surface: hatch frame over the ramp, fallen door, sandbags, ruins, dead tree, car, mast
    box(geo, 0, 8.8, 2.7, 0, 0.22, 0.3, 1.6, C.steel, { rim: true });
    box(geo, 0, 11.0, 2.7, 0, 0.22, 0.3, 1.6, C.steel, { rim: true });
    geo.add(0, key(10, 2.85, 1.6) + 0.1, g => {
      boxDraw(g, 8.8, 2.7, 1.6, 2.42, 0.3, 0.26, C.steel, { rim: true });
      for (let k = 0; k < 6; k++) quad(g, [[8.8 + k * 0.4 + 0.1, 3.0, 1.86], [8.8 + k * 0.4 + 0.25, 3.0, 1.86], [8.8 + k * 0.4 + 0.15, 3.0, 1.6], [8.8 + k * 0.4, 3.0, 1.6]], C.hazardY, 0.9);
    });
    geo.add(0, key(13, 1.4, 0) + 0.05, g => {
      const p = [[12.0, 0.7, 0.05], [14.0, 0.9, 0.35], [13.9, 2.1, 0.32], [11.9, 1.9, 0.02]];
      quad(g, p, mul(C.rust, 1.05));
      quad(g, [p[3], p[2], [13.9, 2.1, 0.12], [11.9, 1.9, -0.1]], mul(C.rust, 0.6));
      for (let k = 0; k < 5; k++) line3(g, [12.1 + k * 0.38, 0.75, 0.08 + k * 0.06], [12.0 + k * 0.38, 1.9, 0.05 + k * 0.06], 0x3a1e10, 2, 0.6);
      dot3(g, [13, 1.4, 0.25], 6, 0x2a1a10, 0.8);
    });
    sandbags(geo, 0, 7.3, 2.6, 0, 4, false);
    sandbags(geo, 0, 11.6, 3.4, 0, 3, false);
    // ruined walls with jagged tops
    const rw = rng(99);
    for (let k = 0; k < 9; k++) box(geo, 0, 2 + k * 0.45, 1.1, 0, 0.45, 0.35, 0.6 + rw() * 1.4 * (1 - Math.abs(k - 3) / 6), 0x7a6a5a, { cutTop: true, rim: true });
    for (let k = 0; k < 6; k++) box(geo, 0, 17.6, 2.0 + k * 0.45, 0, 0.35, 0.45, 0.4 + rw() * 1.1, 0x6f655a, { cutTop: true, rim: true });
    for (let k = 0; k < 7; k++) box(geo, 0, 28 + k * 0.45, 1.4, 0, 0.45, 0.35, 0.3 + rw() * 1.8, 0x77695c, { cutTop: true, rim: true });
    rubble(geo, 0, 2, 6, 1.6, 3.2, 0, 11, 0.4);
    rubble(geo, 0, 26, 33, 2, 4, 0, 12, 0.5);
    // dead tree
    geo.add(0, key(15.5, 1.5, 0) + 0.05, g => {
      cylDraw(g, 15.5, 1.5, 0, 0.11, 1.6, 0x3a2e24);
      const bx = sx(15.5, 1.5), by = sy(15.5, 1.5, 1.6);
      const br = rng(5);
      const branch = (x0: number, y0: number, a: number, len: number, w: number, depth: number): void => {
        const x1 = x0 + Math.cos(a) * len, y1 = y0 - Math.sin(a) * len;
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: 0x2e241c, width: w, cap: 'round' });
        if (depth > 0) { branch(x1, y1, a + 0.4 + br() * 0.3, len * 0.7, w * 0.65, depth - 1); branch(x1, y1, a - 0.5 - br() * 0.3, len * 0.65, w * 0.65, depth - 1); }
      };
      branch(bx, by + 6, Math.PI / 2, 26, 4, 3);
    });
    // rusted car
    box(geo, 0, 21.4, 2.2, 0.12, 2.6, 1.2, 0.55, 0x6a4a34, { rim: true });
    box(geo, 0, 22.1, 2.3, 0.67, 1.3, 1.0, 0.42, 0x5a3e2c, { top: 0x4a3426 });
    geo.add(0, key(22.7, 2.8, 0.7) + 0.2, g => {
      quad(g, [[22.1, 3.3, 0.7], [23.4, 3.3, 0.7], [23.4, 3.3, 1.05], [22.1, 3.3, 1.05]], 0x141a22, 0.9);
      for (const [wx, wy] of [[21.9, 3.4], [23.5, 3.4]]) g.ellipse(sx(wx, wy), sy(wx, wy, 0.2), 9, 7).fill(0x15130f);
    });
    // antenna mast with a blinking light (light defined in map.ts)
    box(geo, 0, 6.4, 4.4, 0, 0.12, 0.12, 3.2, C.steelDark);
    geo.add(0, key(6.5, 4.5, 2) + 0.1, g => { for (let k = 1; k < 6; k++) line3(g, [6.25, 4.5, k * 0.55], [6.75, 4.5, k * 0.55 + 0.2], C.steel, 1, 0.8); });
    // barrels and crates near the hatch
    cyl(geo, 0, 7.6, 5.6, 0, 0.2, 0.5, C.rust);
    cyl(geo, 0, 8.1, 5.9, 0, 0.2, 0.5, 0x4a5a3a);
    crate(geo, 0, 13.3, 5.2, 0);
    crate(geo, 0, 13.8, 5.6, 0, 0.4);
    // crater rim: broken slab ends hanging over the atrium
    for (let x = 3; x < 15; x++) if (hash2(x, 1, 8) < 0.55) box(geo, 0, x, 6.55, -0.25, 1, 0.45 + hash2(x, 2, 8) * 0.35, 0.25, 0x6a645c, { rim: true });
  }
  // atrium level 1 / 2 balconies
  if (slice <= 1) {
    crate(geo, 1, 4.2, 7.2, z1);
    crate(geo, 1, 4.6, 7.25, z1, 0.35);
    cyl(geo, 1, 6.6, 7.4, z1, 0.18, 0.45, 0x3a5a7a);
    box(geo, 1, 8, 7.05, z1, 1.6, 0.5, 0.18, 0x6a4a3a, { top: 0x8a5a48 });
    box(geo, 1, 13.5, 7.1, z1, 0.4, 0.3, 1.3, C.steelDark);
    geo.add(1, key(9, 7.1, z1 + 1.2), g => {
      line3(g, [4, 7.05, z1 + 1.5], [12, 7.05, z1 + 1.5], C.rope, 1, 0.8);
      const cols = [0xc8b8a0, 0x8a3a30, 0x3a5a8a, 0xb8a040, 0x5a7a4a];
      for (let k = 0; k < 9; k++) { const x = 4.4 + k * 0.85; quad(g, [[x, 7.06, z1 + 1.5], [x + 0.4, 7.06, z1 + 1.5], [x + 0.38, 7.06, z1 + 1.0 + (k % 3) * 0.1], [x + 0.02, 7.06, z1 + 1.05]], cols[k % 5], 0.95); }
    });
  }
  if (slice <= 2) {
    for (let k = 0; k < 3; k++) box(geo, 2, 4 + k * 0.9, 7.15, z2, 0.75, 0.5, 0.12, [0x5a4a6a, 0x6a5a3a, 0x3a5a5a][k], { top: [0x7a6a8a, 0x8a7a5a, 0x5a7a7a][k] });
    cyl(geo, 2, 9.6, 7.4, z2, 0.22, 0.6, 0x4a6a8a);
    cyl(geo, 2, 10.1, 7.5, z2, 0.22, 0.6, 0x4a6a8a);
    crate(geo, 2, 13.6, 7.2, z2);
    for (let k = 0; k < 2; k++) cyl(geo, 2, 11.4 + k * 0.9, 13.4, z2, 0.15, 0.3, 0x6a4a3a, 0x4a6a3a);
  }
  // atrium floor
  cyl(geo, 3, 8.5, 15.5, z3, 0.3, 0.72, C.rust, 0x2a1408);
  glow.ellipse(sx(8.5, 15.5), sy(8.5, 15.5, z3 + 0.72), 13, 6.5).fill({ color: 0xff8a30, alpha: 0.9 });
  for (const [bx, by, w, d] of [[7.0, 14.3, 0.9, 0.35], [9.6, 16.2, 0.35, 0.9], [7.2, 16.6, 0.9, 0.35]]) box(geo, 3, bx, by, z3, w, d, 0.3, 0x5a4030, { top: 0x7a5a40 });
  stall(geo, 3, 6, 10, z3, C.tarp[0]);
  stall(geo, 3, 10, 17, z3, C.tarp[1]);
  cyl(geo, 3, 13.5, 17.5, z3, 0.42, 1.3, 0x5a6672, 0x6a7682);
  crate(geo, 3, 12.6, 9.2, z3);
  crate(geo, 3, 13.1, 9.3, z3, 0.4, 0x5a6a3a);
  crate(geo, 3, 12.8, 9.35, z3 + 0.38, 0.38);
  crate(geo, 3, 3.3, 17.6, z3);
  crate(geo, 3, 3.3, 15.4, z3, 0.5, 0x4a5a6a);
  // corridor: pipes along the back wall, benches, vent
  for (let x = 15; x < 20; x++) {
    geo.add(3, key(x + 0.5, 12.1, z3) - 0.02, g => {
      boxDraw(g, x, 12.02, z3 + 1.55, 1, 0.14, 0.14, 0x5a6470);
      boxDraw(g, x, 12.02, z3 + 1.75, 1, 0.1, 0.1, 0x7a5a3a);
    });
  }
  box(geo, 3, 16, 12.15, z3, 1.4, 0.35, 0.3, 0x3a4a3a, { top: 0x4a5a4a });
  box(geo, 3, 18.4, 12.05, z3, 0.6, 0.12, 0.6, 0x3a3e44);
  // district: street lamp posts, laundry, barrels
  for (const [px, py] of [[22.6, 12.3], [27.4, 14.7], [32.6, 12.3]]) {
    box(geo, 3, px - 0.05, py - 0.05, z3, 0.1, 0.1, 2.0, 0x2a2a2e);
    box(geo, 3, px - 0.15, py - 0.15, z3 + 2.0, 0.3, 0.3, 0.08, 0x3a3a40);
  }
  cyl(geo, 3, 23.5, 12.4, z3, 0.18, 0.45, 0x3a5a7a);
  cyl(geo, 3, 28.4, 14.6, z3, 0.18, 0.45, C.rust);
  crate(geo, 3, 33.2, 14.2, z3);
  crate(geo, 3, 20.2, 14.3, z3, 0.4);
  // dark edge: rubble, barrier, beyond the rubble a mine cart and a lantern
  rubble(geo, 3, 37.6, 40.4, 12, 15, z3, 21, 1.4);
  for (let y = 12; y < 15; y++) box(geo, 3, 36.2, y + 0.1, z3, 0.12, 0.8, 0.7, C.hazardY, { top: C.hazardK });
  box(geo, 3, 36.1, 12.05, z3 + 1.65, 0.5, 0.1, 0.3, 0x5a1a14);
  box(geo, 3, 42.4, 12.6, z3, 1.0, 0.6, 0.5, 0x4a3a2c, { rim: true });
  crate(geo, 3, 43.0, 13.2, z3, 0.4);
  // cave crystals
  const cr = rng(77);
  for (let k = 0; k < 9; k++) {
    const cx = 26 + cr() * 7, cy = 22.4 + cr() * 2.6;
    if (cells[3][idx(Math.floor(cx), Math.floor(cy))] !== F) continue;
    const h = 0.4 + cr() * 0.9;
    geo.add(3, key(cx, cy, z3) + 0.05, g => {
      const X0 = sx(cx, cy), Y0 = sy(cx, cy, z3), Yt = sy(cx, cy, z3 + h);
      g.poly([X0 - 5, Y0, X0, Yt, X0 + 1, Y0 + 2]).fill(0x4ab8d8);
      g.poly([X0 + 1, Y0 + 2, X0, Yt, X0 + 6, Y0 - 1]).fill(0x2a7898);
      g.poly([X0 + 3, Y0, X0 + 8, Y0 - (Y0 - Yt) * 0.55, X0 + 9, Y0 + 1]).fill(0x5ad0f0);
    });
    glow.poly([sx(cx, cy) - 4, sy(cx, cy, z3), sx(cx, cy), sy(cx, cy, z3 + h), sx(cx, cy) + 5, sy(cx, cy, z3)]).fill({ color: 0x40d8ff, alpha: 0.45 });
  }
}

// -------------------------------------------------------------------------------------------- ghost outlines
function ghostPass(ghost: Graphics, slice: number): void {
  for (let l = 0; l < slice; l++) {
    const z = zf(l);
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      const c = cells[l][idx(x, y)];
      const solid = l === 0 ? c === 4 : c === F;
      if (!solid) continue;
      const nb = (dx: number, dy: number): boolean => {
        if (!inside(x + dx, y + dy)) return false;
        const cc = cells[l][idx(x + dx, y + dy)];
        return l === 0 ? cc === 4 : cc === F;
      };
      if (!nb(1, 0)) line3(ghost, [x + 1, y, z], [x + 1, y + 1, z], 0x7fd8ff, 1, 0.35);
      if (!nb(-1, 0)) line3(ghost, [x, y, z], [x, y + 1, z], 0x7fd8ff, 1, 0.35);
      if (!nb(0, 1)) line3(ghost, [x, y + 1, z], [x + 1, y + 1, z], 0x7fd8ff, 1, 0.35);
      if (!nb(0, -1)) line3(ghost, [x, y, z], [x + 1, y, z], 0x7fd8ff, 1, 0.35);
      if (l > 0 && (x + y) % 2 === 0) quad(ghost, [[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]], 0x7fd8ff, 0.035);
    }
  }
}

export interface StaticScene { chunks: Graphics[]; glow: Graphics; ghost: Graphics; cols: Columns }

export function buildStatic(parent: DepthSorter, glowParent: Container, ghostParent: Container, slice: number): StaticScene {
  const geo = new Geo();
  const glow = new Graphics();
  glow.blendMode = 'add';
  const cols = computeColumns(slice);
  columnsPass(geo, glow, cols);
  slabsPass(geo, cols, slice);
  stairsPass(geo, slice);
  dwellingPass(geo, glow);
  propsPass(geo, glow, slice);
  const chunks = geo.build(parent);
  glowParent.addChild(glow);
  const ghost = new Graphics();
  ghostPass(ghost, slice);
  ghostParent.addChild(ghost);
  return { chunks, glow, ghost, cols };
}

export { LEVELS, REG_SURF, SH, ZF };

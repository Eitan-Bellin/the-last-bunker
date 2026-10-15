/**
 * Procedural content of the parallax planes, per stratum (style guide sections 2-3; ported from prototype A's layers.ts):
 *  - far (p 0.40): the cavern void in the stratum's far colour, colossal pillars, distant terraced districts as clusters of lit
 *    windows, haze bands; slow lifts on the far cliffs (live).
 *  - back (p 0.68): the cavern back wall with rim-lit ribs, backlit house clusters, the metro viaduct in the strata that carry it,
 *    with a passing train (live); haze between back and mid.
 *  - mid (p 0.88, lit by the lightmap): galleries and pipes behind each hub, shanties behind districts, crystal spires behind caves
 *    and pockets. Built once per layout (it is small).
 *  - fore (p 1.32): a ragged black rock lip along the stratum seams (the gallery bands, where no room is), outcrops; silhouettes with
 *    a faint rim.
 * Far/back/fore are chunked (ChunkManager, BACKDROP.chunk plane units, BACKDROP.maxBuilds per frame). Content is authored in plane
 * units: a world point (x, y) is at (x * p, y * p). Every colour is a stratum palette colour, multiplied by the layer tint and faded
 * toward the stratum fog colour by LAYERS[i].fog x fog.density. Window lights scale with `setWindowsLit` (population, night).
 */
import { Container, Graphics, Sprite } from 'pixi.js';
import { DETAIL, LAYER_HAZE, STRATA, TEMPERATURE, type Hex, type LayerTokens, type StratumId } from '../tokens';
import { BACKDROP, baseTier, type RenderTier } from '../tokensRender';
import { ChunkManager } from './chunks';
import { cityTextures, hash01, hexMix } from './lighting';
import type { ParallaxInfo, ParallaxPlane } from './layers';
import type { CityLayout, Rect } from './layoutTypes';

function mulHex(a: Hex, b: Hex): Hex {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** A palette colour as seen on a layer of a stratum: layer tint, then the stratum fog. */
function onLayer(c: Hex, s: StratumId, L: LayerTokens, extraFog = 0): Hex {
  const f = STRATA[s].fog;
  return hexMix(mulHex(c, L.tint), f.color, Math.min(1, L.fog * f.density + extraFog));
}

interface Band { s: StratumId; y0: number; y1: number }

interface Train { c: Container; x0: number; x1: number; y: number }
interface Lift { dot: Sprite; y0: number; y1: number; sp: number; ph: number }

export class Backdrop {
  private far: ChunkManager;
  private back: ChunkManager;
  private fore: ChunkManager;
  private seen = new Set<number>();
  private midC = new Container();
  private bands: Band[] = [];
  private bounds: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private tier: RenderTier;
  private windowsLit = 0.6;
  private trains: Train[] = [];
  private lifts: Lift[] = [];
  private liveFar = new Container();
  private liveBack = new Container();
  private vr: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private layout: CityLayout | null = null;

  private planes: { far: ParallaxPlane; back: ParallaxPlane; mid: ParallaxPlane; fore: ParallaxPlane };

  constructor(planes: { far: ParallaxPlane; back: ParallaxPlane; mid: ParallaxPlane; fore: ParallaxPlane }, tier: RenderTier) {
    this.planes = planes;
    this.tier = tier;
    const opts = { size: BACKDROP.chunk, maxBuilds: BACKDROP.maxBuilds, parkAfterMs: BACKDROP.parkAfterMs };
    this.far = new ChunkManager({ build: (cx, cy, x0, y0, x1, y1) => this.buildFar(cx, cy, x0, y0, x1, y1) }, opts);
    this.back = new ChunkManager({ build: (cx, cy, x0, y0, x1, y1) => this.buildBack(cx, cy, x0, y0, x1, y1) }, opts);
    this.fore = new ChunkManager({ build: (cx, cy, x0, y0, x1, y1) => this.buildFore(cx, cy, x0, y0, x1, y1) }, opts);
    planes.far.content.addChild(this.far.container);
    planes.back.content.addChild(this.back.container);
    planes.fore.content.addChild(this.fore.container);
    planes.mid.content.addChild(this.midC);
    planes.far.live.addChild(this.liveFar);
    planes.back.live.addChild(this.liveBack);
  }

  private get density(): number {
    return DETAIL[baseTier(this.tier)].density;
  }

  setTier(tier: RenderTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.far.clear();
    this.back.clear();
    this.fore.clear();
    if (this.layout) this.buildLive(this.layout);
    for (const p of [this.planes.far, this.planes.back]) p.invalidate();
  }

  /** Share of far/back windows lit (DAY_NIGHT.farWindowsLit x population); a real change rebuilds the far/back chunks. */
  setWindowsLit(share: number): void {
    if (Math.abs(share - this.windowsLit) < 0.08) return;
    this.windowsLit = share;
    this.far.clear();
    this.back.clear();
    this.planes.far.invalidate();
    this.planes.back.invalidate();
  }

  setLayout(layout: CityLayout): void {
    this.layout = layout;
    this.bands = layout.strata.map(s => ({ s: s.s, y0: s.y0, y1: s.y1 })).sort((a, b) => a.y0 - b.y0);
    // [world:C2] Strata with a storey the player can see (not hidden): the fore lip only stands at seams the player has dug down to; over the
    // undiscovered dark its lit rim read as stray wire lines in front of the fog.
    this.seen.clear();
    for (const a of layout.areas) if (a.kind === 'storey' && a.state !== 'hidden') this.seen.add(a.s);
    this.bounds = layout.bounds;
    const B = layout.bounds;
    for (const [m, plane] of [[this.far, this.planes.far], [this.back, this.planes.back], [this.fore, this.planes.fore]] as const) {
      const p = plane.p, pad = Math.max(B.w, B.h) * 0.5;
      m.clear();
      m.setExtent({ x: (B.x - pad) * p, y: (B.y - pad) * p, w: (B.w + pad * 2) * p, h: (B.h + pad * 2) * p });
      plane.invalidate();
    }
    this.buildMid(layout);
    this.buildLive(layout);
  }

  /**
   * The first and last underground bands' fills run on past their edges (BACKDROP.bandOverrun world units): with parallax a plane's
   * band does not line up with the play plane's ground, and an open cavern near the top must never show an empty gap. Above ground
   * the surface renderer paints over it.
   */
  private extendFill(g: Graphics, b: Band, p: number, x0: number, y0: number, x1: number, y1: number, col: Hex): void {
    let first: Band | null = null, last: Band | null = null;
    for (const x of this.bands) if (x.s !== 0) { if (!first) first = x; last = x; }
    const o = BACKDROP.bandOverrun * p;
    if (b === first) {
      const a = Math.max(y0, b.y0 * p - o), z = Math.min(y1, b.y0 * p);
      if (z > a) g.rect(x0, a, x1 - x0, z - a).fill(col);
    }
    if (b === last) {
      const a = Math.max(y0, b.y1 * p), z = Math.min(y1, b.y1 * p + o);
      if (z > a) g.rect(x0, a, x1 - x0, z - a).fill(col);
    }
  }

  /** Bands of underground strata overlapping a plane-unit y range (the first/last band reach on by BACKDROP.bandOverrun). */
  private bandsIn(p: number, y0: number, y1: number, fn: (b: Band, by0: number, by1: number) => void): void {
    const o = BACKDROP.bandOverrun * p;
    let first: Band | null = null, last: Band | null = null;
    for (const b of this.bands) if (b.s !== 0) { if (!first) first = b; last = b; }
    for (const b of this.bands) {
      const by0 = b.y0 * p, by1 = b.y1 * p;
      const ty0 = b === first ? by0 - o : by0, ty1 = b === last ? by1 + o : by1;
      if (ty1 <= y0 || ty0 >= y1) continue;
      fn(b, Math.min(Math.max(by0, y0), by1), Math.max(Math.min(by1, y1), by0));
    }
  }

  // ------------------------------------------------------------------ far

  private buildFar(cx: number, cy: number, x0: number, y0: number, x1: number, y1: number): Container | null {
    const L = this.planes.far.token, p = L.p, d = this.density, F = BACKDROP.far;
    const c = new Container();
    const g = new Graphics();
    const glow = new Container();
    let any = false;
    const tx = cityTextures();
    this.bandsIn(p, y0, y1, (b, by0, by1) => {
      if (b.s === 0) return; // above ground: the sky belongs to the surface renderer
      any = true;
      const P = STRATA[b.s].palette, fog = STRATA[b.s].fog;
      const top = b.y0 * p, bot = b.y1 * p;
      this.extendFill(g, b, p, x0, y0, x1, y1, onLayer(P.farBase, b.s, L));
      if (by1 <= by0) return; // the chunk only sees the overrun
      g.rect(x0, by0, x1 - x0, by1 - by0).fill(onLayer(P.farBase, b.s, L));
      const np = Math.round(F.pillarsPerChunk * d + hash01(cx * 7 + b.s, cy) * 0.99);
      for (let i = 0; i < np; i++) {
        const x = x0 + hash01(cx * 31 + i, cy * 17 + b.s) * (x1 - x0);
        const w = F.pillarW[0] + (F.pillarW[1] - F.pillarW[0]) * hash01(cx + i * 3, cy + 5);
        const pinch = 0.35 + hash01(cx * 3 + i, cy * 7) * 0.3;
        const mid = top + (bot - top) * (0.3 + hash01(i + cx, cy * 11) * 0.4);
        const col = onLayer(hexMix(P.rockDark, P.farBase, 0.5), b.s, L, -0.1);
        g.poly([x - w, top, x + w, top, x + w * pinch, mid, x + w * 1.1, bot, x - w * 1.1, bot, x - w * pinch, mid]).fill(col);
      }
      if (hash01(cx * 13 + b.s, cy * 3) < F.clusterChance) {
        const ccx = x0 + (0.2 + 0.6 * hash01(cx, cy * 19 + b.s)) * (x1 - x0);
        const ccy = top + (bot - top) * (0.35 + 0.4 * hash01(cx * 5, cy + b.s));
        const cw = 80 + 120 * hash01(cx * 9, cy * 9);
        g.poly([ccx - cw, ccy, ccx + cw, ccy, ccx + cw * 0.8, ccy + 30, ccx - cw * 0.9, ccy + 26]).fill(onLayer(P.builtDark, b.s, L));
        for (let k = 0; k < 6; k++) {
          const bw = 10 + 22 * hash01(k, cx * 41), bh = 10 + 34 * hash01(k * 3, cy * 41);
          const bx = ccx - cw + hash01(k * 7, cx + cy) * (cw * 2 - bw);
          g.rect(bx, ccy - bh, bw, bh).fill(onLayer(P.builtDark, b.s, L, 0.05));
        }
        const nw = Math.round(F.windowsPerCluster * d);
        for (let k = 0; k < nw; k++) {
          if (hash01(k * 13, cx * 7 + cy) > this.windowsLit) continue;
          const wx = ccx - cw + hash01(k, cx * 3 + 1) * cw * 2, wy = ccy - 6 - hash01(k * 5, cy * 3 + 1) * 34;
          const col = TEMPERATURE.inhabited[k % TEMPERATURE.inhabited.length];
          g.rect(wx, wy, 3, 4).fill(col);
          const s = new Sprite(tx.soft);
          s.anchor.set(0.5);
          s.position.set(wx + 1.5, wy + 2);
          s.width = s.height = BACKDROP.windowHalo;
          s.tint = col;
          s.alpha = BACKDROP.windowAlpha;
          s.blendMode = 'add';
          glow.addChild(s);
        }
      }
      for (let k = 0; k < F.hazePerChunk; k++) {
        const s = new Sprite(tx.soft);
        s.anchor.set(0.5);
        s.position.set(x0 + hash01(cx * 5 + k, cy) * (x1 - x0), top + (bot - top) * hash01(cx, cy * 5 + k));
        s.width = (x1 - x0) * 2.5;
        s.height = BACKDROP.hazeH[0] + (BACKDROP.hazeH[1] - BACKDROP.hazeH[0]) * hash01(k, cx);
        s.tint = fog.color;
        s.alpha = fog.haze * LAYER_HAZE.betweenFarAndBack;
        glow.addChild(s);
      }
    });
    if (!any) {
      g.destroy();
      glow.destroy();
      c.destroy();
      return null;
    }
    c.addChild(g, glow);
    return c;
  }

  // ------------------------------------------------------------------ back

  private buildBack(cx: number, cy: number, x0: number, y0: number, x1: number, y1: number): Container | null {
    const L = this.planes.back.token, p = L.p, d = this.density, K = BACKDROP.back;
    const c = new Container();
    const g = new Graphics();
    const glow = new Container();
    const tx = cityTextures();
    let any = false;
    this.bandsIn(p, y0, y1, (b, by0, by1) => {
      if (b.s === 0) return;
      any = true;
      const P = STRATA[b.s].palette, fog = STRATA[b.s].fog;
      const top = b.y0 * p, bot = b.y1 * p;
      this.extendFill(g, b, p, x0, y0, x1, y1, onLayer(P.rockDark, b.s, L));
      if (by1 <= by0) return; // the chunk only sees the overrun
      g.rect(x0, by0, x1 - x0, by1 - by0).fill(onLayer(P.rockDark, b.s, L));
      const nr = Math.round(K.ribsPerChunk * d);
      for (let i = 0; i < nr; i++) {
        const x = x0 + hash01(cx * 19 + i, cy * 3 + b.s) * (x1 - x0);
        const y = top + (bot - top) * hash01(i * 7 + cx, cy * 13);
        const w = 60 + 220 * hash01(i, cx * 5 + cy), h = 18 + 70 * hash01(i * 3, cy * 5);
        g.poly([x - w, y + h, x - w * 0.6, y, x + w * 0.5, y - h * 0.2, x + w, y + h]).fill(onLayer(hexMix(P.rock, P.rockDark, hash01(i, cx)), b.s, L));
        g.moveTo(x - w * 0.6, y).lineTo(x + w * 0.5, y - h * 0.2).stroke({ width: 1.5, color: onLayer(P.rockRim, b.s, L), alpha: K.ribRimAlpha });
      }
      if (hash01(cx * 23 + b.s, cy * 7) < K.clusterChance) {
        const ccx = x0 + (0.25 + 0.5 * hash01(cx * 3, cy + b.s * 7)) * (x1 - x0);
        const base = top + (bot - top) * (0.55 + 0.3 * hash01(cx, cy * 29));
        const halo = new Sprite(tx.soft);
        halo.anchor.set(0.5);
        halo.position.set(ccx, base - 90);
        halo.width = BACKDROP.clusterHalo[0];
        halo.height = BACKDROP.clusterHalo[1];
        halo.tint = STRATA[b.s].light.key;
        halo.alpha = BACKDROP.clusterHaloAlpha * this.windowsLit;
        halo.blendMode = 'add';
        glow.addChild(halo);
        for (let tier = 0; tier < 3; tier++) {
          const ty = base - tier * 80, tw = 200 * (1 - tier * 0.18);
          g.poly([ccx - tw, ty, ccx + tw, ty, ccx + tw * 0.9, ty + 22, ccx - tw * 0.9, ty + 22]).fill(onLayer(P.builtDark, b.s, L));
          let x = ccx - tw + 6, k = 0;
          while (x < ccx + tw - 20 && k < K.housesPerCluster) {
            const bw = 18 + 34 * hash01(k + tier * 9, cx * 11), bh = 22 + 54 * hash01(k * 5 + tier, cy * 11);
            const col = onLayer(hexMix(P.built, P.builtDark, 0.6), b.s, L, tier * 0.1);
            g.rect(x, ty - bh, bw, bh).fill(col);
            for (let wi = 0; wi < 2; wi++) {
              if (hash01(k * 31 + wi, tier + cx * 3) > K.windowChance * this.windowsLit * 1.6) continue;
              const wx = x + 4 + hash01(k, wi + cy) * (bw - 10), wy = ty - bh + 6 + hash01(wi, k + cx) * (bh - 14);
              const wc = TEMPERATURE.inhabited[(k + wi) % TEMPERATURE.inhabited.length];
              g.rect(wx, wy, 4, 5).fill(wc);
              const s = new Sprite(tx.soft);
              s.anchor.set(0.5);
              s.position.set(wx + 2, wy + 2.5);
              s.width = s.height = BACKDROP.windowHalo;
              s.tint = wc;
              s.alpha = BACKDROP.windowAlpha;
              s.blendMode = 'add';
              glow.addChild(s);
            }
            x += bw + 2 + 8 * hash01(k, tier);
            k++;
          }
        }
      }
      if (BACKDROP.viaductStrata.includes(b.s)) {
        const vy = top + (bot - top) * 0.72;
        if (vy >= y0 - 40 && vy <= y1 + 40) {
          const col = onLayer(STRATA[3].palette.metal, b.s, L);
          g.rect(x0, vy, x1 - x0, 12).fill(col);
          for (let x = Math.ceil(x0 / 110) * 110; x < x1; x += 110) {
            g.rect(x, vy + 12, 14, bot - vy).fill(col);
            g.poly([x + 14, vy + 12, x + 110, vy + 12, x + 110, vy + 40, x + 62, vy + 22, x + 14, vy + 40]).fill(col);
          }
        }
      }
      const hz = new Sprite(tx.soft);
      hz.anchor.set(0.5);
      hz.position.set((x0 + x1) / 2, top + (bot - top) * hash01(cx, cy * 3 + 1));
      hz.width = (x1 - x0) * 2.4;
      hz.height = BACKDROP.hazeH[1];
      hz.tint = fog.color;
      hz.alpha = fog.haze * LAYER_HAZE.betweenBackAndMid;
      glow.addChild(hz);
    });
    if (!any) {
      g.destroy();
      glow.destroy();
      c.destroy();
      return null;
    }
    c.addChild(glow, g);
    // Windows and haze over the wall, halos under: reorder so the cluster halo glows behind the houses.
    c.swapChildren(glow, g);
    return c;
  }

  // ------------------------------------------------------------------ fore

  private buildFore(cx: number, cy: number, x0: number, y0: number, x1: number, y1: number): Container | null {
    const L = this.planes.fore.token, p = L.p, K = BACKDROP.fore;
    if (!K.enabled) return null;
    const seams: { y: number; s: StratumId }[] = [];
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i];
      if (b.s === 0 || !this.seen.has(b.s + 1)) continue;
      seams.push({ y: b.y1 * p, s: b.s });
    }
    const g = new Graphics();
    let any = false;
    for (const sm of seams) {
      if (sm.y < y0 - 200 || sm.y > y1 + 200) continue;
      any = true;
      const rim = STRATA[sm.s].palette.rockRim;
      const pts: number[] = [x0, sm.y + 60];
      let x = x0, i = 0;
      while (x <= x1) {
        pts.push(x, sm.y + (hash01(cx * 97 + i, cy) - 0.5) * 30);
        x += K.lipStep[0] + (K.lipStep[1] - K.lipStep[0]) * hash01(i, cx * 7);
        i++;
      }
      pts.push(x1, sm.y + (hash01(cx * 97 + i, cy) - 0.5) * 30, x1, sm.y + 60);
      g.poly(pts).fill(L.tint);
      for (let j = 2; j < pts.length - 4; j += 2) g.moveTo(pts[j], pts[j + 1]).lineTo(pts[j + 2], pts[j + 3]).stroke({ width: 2, color: rim, alpha: K.rimAlpha });
      if (hash01(cx * 5, cy + sm.s) < K.outcropChance) {
        const ox = x0 + hash01(cx, cy * 3 + sm.s) * (x1 - x0), w = 40 + 60 * hash01(cx * 3, cy), h = 40 + 50 * hash01(cy, cx * 3);
        g.poly([ox - w, sm.y + 10, ox - w * 0.2, sm.y - h, ox + w * 0.4, sm.y - h * 0.7, ox + w, sm.y + 10]).fill(L.tint);
        g.moveTo(ox - w * 0.2, sm.y - h).lineTo(ox + w * 0.4, sm.y - h * 0.7).stroke({ width: 2, color: rim, alpha: K.rimAlpha });
      }
    }
    if (!any) {
      g.destroy();
      return null;
    }
    return g;
  }

  // ------------------------------------------------------------------ mid (one build per layout)

  private buildMid(layout: CityLayout): void {
    for (const ch of this.midC.removeChildren()) ch.destroy({ children: true });
    const L = this.planes.mid.token, p = L.p, K = BACKDROP.mid;
    const g = new Graphics();
    for (const hub of layout.hubs) {
      const P = STRATA[hub.s].palette;
      const r = hub.rect, hx = (r.x + r.w / 2) * p, w = r.w * p * 0.9;
      for (let k = 0; k < K.galleryRings; k++) {
        const y = (r.y + r.h * (0.25 + 0.22 * k)) * p;
        g.rect(hx - w / 2, y, w, 8).fill(onLayer(P.builtDark, hub.s, L));
        for (let x = hx - w / 2 + 10; x < hx + w / 2; x += 26) g.rect(x, y - 18, 2, 18).fill(onLayer(P.metal, hub.s, L));
        g.rect(hx - w / 2, y - 18, w, 2).fill(onLayer(P.metal, hub.s, L));
      }
      for (let k = 0; k < 2; k++) {
        const y = (r.y + r.h * (0.12 + 0.3 * k)) * p, th = k ? 14 : 22;
        g.rect(hx - w * 0.8, y, w * 1.6, th).fill(onLayer(P.metal, hub.s, L));
        g.rect(hx - w * 0.8, y, w * 1.6, 3).fill(onLayer(P.rockRim, hub.s, L));
      }
    }
    for (const a of layout.areas) {
      const P = STRATA[a.s].palette;
      let ax0 = Infinity, ax1 = -Infinity, ay0 = Infinity, ay1 = -Infinity;
      for (let i = 0; i < a.poly.length; i += 2) {
        ax0 = Math.min(ax0, a.poly[i]); ax1 = Math.max(ax1, a.poly[i]);
        ay0 = Math.min(ay0, a.poly[i + 1]); ay1 = Math.max(ay1, a.poly[i + 1]);
      }
      if (a.kind === 'district') {
        const n = Math.round(K.shacksPerDistrict * this.density);
        for (let i = 0; i < n; i++) {
          const x = (ax0 + (i + 0.5) * ((ax1 - ax0) / n)) * p + (hash01(i, 3) - 0.5) * 20;
          const base = (ay0 + (ay1 - ay0) * (0.35 + 0.15 * (i % 3))) * p;
          const w = 40 + 30 * hash01(i, 5), h = 34 + 46 * hash01(i, 6);
          const col = onLayer(hexMix(P.builtDark, P.rockDark, 0.3 + 0.4 * hash01(i, 7)), a.s, L, 0.12);
          g.rect(x, base - h, w, h).fill(col);
          g.poly([x - 4, base - h, x + w + 4, base - h, x + w / 2, base - h - 14]).fill(onLayer(P.builtDark, a.s, L, 0.12));
          g.rect(x, base, w, 6).fill(onLayer(P.metal, a.s, L));
          g.rect(x + 4, base + 6, 3, 110).fill(onLayer(P.metal, a.s, L));
          g.rect(x + w - 7, base + 6, 3, 110).fill(onLayer(P.metal, a.s, L));
        }
      } else if (a.kind === 'pocket' || a.s === 5) {
        const n = Math.round(K.crystalsPerCave * this.density);
        for (let i = 0; i < n; i++) {
          const x = (ax0 + (ax1 - ax0) * (i + 0.5) / n) * p, y = ay1 * p;
          g.poly([x - 12, y, x + 12, y, x + (hash01(i, 9) - 0.5) * 10, y - 60 - 80 * hash01(i, 10)]).fill(onLayer(STRATA[5].palette.accent, a.s, L, 0.3));
        }
      }
    }
    this.midC.addChild(g);
  }

  // ------------------------------------------------------------------ live (train, lifts)

  private buildLive(layout: CityLayout): void {
    for (const ch of this.liveFar.removeChildren()) ch.destroy({ children: true });
    for (const ch of this.liveBack.removeChildren()) ch.destroy({ children: true });
    this.trains = [];
    this.lifts = [];
    if (!DETAIL[baseTier(this.tier)].backLife) return;
    const B = layout.bounds, tx = cityTextures();
    const bp = this.planes.back.p, fp = this.planes.far.p;
    // Every lift rail in one Graphics, then every car dot (additive): two batches for all of them, not two per lift.
    const rails = new Graphics();
    const dots: Sprite[] = [];
    for (const b of this.bands) {
      if (b.s === 0) continue;
      if (BACKDROP.viaductStrata.includes(b.s)) {
        const L = this.planes.back.token, P = STRATA[3].palette;
        const c = new Container();
        const g = new Graphics();
        for (let k = 0; k < 4; k++) {
          g.roundRect(k * 74, -24, 70, 22, 4).fill(onLayer(P.metal, b.s, L, -0.1));
          for (let w = 0; w < 6; w++) g.rect(k * 74 + 6 + w * 10.5, -18, 6, 6).fill(STRATA[3].light.key);
        }
        const glow = new Sprite(tx.soft);
        glow.anchor.set(0.5);
        glow.position.set(150, -14);
        glow.width = 360;
        glow.height = 60;
        glow.tint = STRATA[3].light.key;
        glow.alpha = BACKDROP.trainGlowAlpha;
        glow.blendMode = 'add';
        c.addChild(glow, g);
        const vy = (b.y0 + (b.y1 - b.y0) * 0.72) * bp;
        c.y = vy;
        this.liveBack.addChild(c);
        this.trains.push({ c, x0: (B.x - 600) * bp, x1: (B.x + B.w + 600) * bp, y: vy });
      }
      for (let i = 0; i < 3; i++) {
        const x = (B.x + B.w * hash01(i, b.s * 7)) * fp;
        const y0 = (b.y0 + (b.y1 - b.y0) * 0.15) * fp, y1 = (b.y0 + (b.y1 - b.y0) * 0.85) * fp;
        rails.rect(x - 1, y0, 2, y1 - y0).fill(onLayer(STRATA[b.s].palette.metal, b.s, this.planes.far.token));
        const dot = new Sprite(tx.soft);
        dot.anchor.set(0.5);
        dot.x = x;
        dot.width = dot.height = 16;
        dot.tint = STRATA[b.s].light.key;
        dot.blendMode = 'add';
        dots.push(dot);
        const [a, z] = BACKDROP.liftSpeed;
        this.lifts.push({ dot, y0, y1, sp: a + (z - a) * hash01(i, b.s), ph: hash01(b.s, i) * 6 });
      }
    }
    if (dots.length) this.liveFar.addChild(rails, ...dots);
    else rails.destroy();
  }

  // ------------------------------------------------------------------ per frame

  update(pi: ParallaxInfo, t: number, now: number): void {
    const P = this.planes, ov = BACKDROP.cachedGrow;
    const fb = this.far.stats.viewBuilds, bb = this.back.stats.viewBuilds;
    if (P.far.visible || P.far.mode === 'merged') this.far.update(P.far.viewRect(this.vr, pi, P.far.mode === 'live' ? 0 : ov), now);
    if (P.back.visible) this.back.update(P.back.viewRect(this.vr, pi, P.back.mode === 'live' ? 0 : ov), now);
    if (P.fore.visible) this.fore.update(P.fore.viewRect(this.vr, pi, 0), now);
    // A cached plane shows new chunks only after a bake.
    if (this.far.stats.viewBuilds !== fb) { P.far.invalidate(); if (P.far.mode === 'merged') P.back.invalidate(); }
    if (this.back.stats.viewBuilds !== bb) P.back.invalidate();
    for (let i = 0; i < this.trains.length; i++) {
      const tr = this.trains[i];
      const span = tr.x1 - tr.x0;
      tr.c.x = tr.x0 + ((t * BACKDROP.trainSpeed) % span);
    }
    for (let i = 0; i < this.lifts.length; i++) {
      const l = this.lifts[i];
      l.dot.y = l.y0 + (l.y1 - l.y0) * (0.5 + 0.5 * Math.sin(t * l.sp * 6 + l.ph));
    }
  }

  /** Builds every chunk in view now (lab screenshots, the perf runner). */
  settle(pi: ParallaxInfo): void {
    const P = this.planes;
    this.far.update(P.far.viewRect(this.vr, pi, BACKDROP.cachedGrow), performance.now(), true);
    this.back.update(P.back.viewRect(this.vr, pi, BACKDROP.cachedGrow), performance.now(), true);
    this.fore.update(P.fore.viewRect(this.vr, pi, 0), performance.now(), true);
  }

  get chunkStats(): { far: ChunkManager['stats']; back: ChunkManager['stats']; fore: ChunkManager['stats'] } {
    return { far: this.far.stats, back: this.back.stats, fore: this.fore.stats };
  }

  destroy(): void {
    this.far.destroy();
    this.back.destroy();
    this.fore.destroy();
    this.midC.destroy({ children: true });
  }
}

/**
 * [world:C1] The rock: the cut face of the earth around the city (style guide 2 rock, 6 "the cut edge").
 *
 * Chunked (512 u, src/world/render/chunks.ts) and baked: each chunk is a small render-to-texture cache (Pixi `cacheAsTexture`, at the
 * tier's DETAIL.rockRes) holding
 *   1. the stratum's painted rock tile (rock-<kit>), with banding strips (band-<kit>) at the strata seams and now and then inside a stratum;
 *   2. every cavity of the layout ERASED from it (overlapping or touching holes need no polygon union: erase is order-free);
 *   3. under that, the cut's ambient-occlusion band (UNIFY.cutEdge.aoWidth at aoAlpha), which therefore only shows INSIDE the holes;
 *   4. an erase frame around the chunk, so strokes never spill into a neighbour (seamless chunks).
 * Over the cache sits a crisp live rim: the light lip of the cut (UNIFY.cutEdge rim, stratum rockRim) on every cut edge that faces rock,
 * never on the seam where two cavities meet.
 */
import { Container, Graphics, Rectangle } from 'pixi.js';
import { WORLD_KIT_IDS, rockBandId, rockTileId } from '../../tokensAssets';
import { DETAIL, UNIFY, type StratumId } from '../../tokens';
import { baseTier, type RenderTier } from '../../tokensRender';
import { ChunkManager, type ChunkSource } from '../chunks';
import type { Cavity, CityLayout, Rect } from '../layoutTypes';
import { inPoly, polyArea, polyBounds } from '../../model/outline';
import { hash2, palette, tile } from './kit';

const CHUNK = 512;
/** How far strokes may reach past a chunk before its erase frame trims them. */
const SPILL = 48;
/** Height of the topsoil (the surface kit) under the ground line, and the banding strip's height. */
const SOIL = 64;
const BAND_H = 100;
/** Neighbouring chunks overlap this much (world units), hiding the bilinear seam at a cache texture's edge. */
const OVERLAP = 3;
/** The rock face is the darkest made surface after the fore silhouettes: its painted tile is pulled down this much (the lightmap's section
 * fill and the stratum ambient light it back up), so the lit city reads as islands in dark earth. */
const ROCK_TINT = 0x9a948e;

interface CavityInfo { c: Cavity; b: { x0: number; y0: number; x1: number; y1: number }; cw: boolean }

/** [world:C2] World units the rock extends past the layout bounds on each side. */
const ROCK_SIDE_RUN = 2400;

export class RockLayer implements ChunkSource {
  readonly manager: ChunkManager;
  readonly container = new Container();
  private cav: CavityInfo[] = [];
  private bands: { s: StratumId; y0: number; y1: number }[] = [];
  private res: number;
  private extent: Rect;

  constructor(layout: CityLayout, quality: RenderTier) {
    this.res = DETAIL[baseTier(quality)].rockRes;
    this.cav = layout.cavities.map(c => ({ c, b: polyBounds(c.poly), cw: polyArea(c.poly) >= 0 }));
    this.bands = layout.strata.filter(s => s.s > 0).map(s => ({ s: s.s, y0: s.y0, y1: s.y1 }));
    const B = layout.bounds;
    // [world:C2 tech-artist] The rock runs on ROCK_SIDE_RUN past the layout bounds each side: zoomed out (or panned to a far wing), the camera
    // sees past the bounds, and without the classic underground there was a hard seam onto the parallax planes. Chunks build only near the view.
    this.extent = { x: B.x - ROCK_SIDE_RUN, y: 0, w: B.w + ROCK_SIDE_RUN * 2, h: B.y + B.h + ROCK_SIDE_RUN }; // (and below the bounds)
    this.manager = new ChunkManager(this, { size: CHUNK, maxBuilds: 2, parkAfterMs: 4000, keep: 0.6 }); // [world:C2] parked after 4 s (was 12): two texture caches a chunk
    this.manager.setExtent(this.extent);
    this.container.label = 'shell:rock';
    this.container.eventMode = 'none';
    this.container.addChild(this.manager.container);
  }

  update(view: Rect, now: number): void {
    this.manager.update(view, now);
  }

  /** Builds every chunk now (tools and shots). */
  settle(view: Rect, now: number): void {
    this.manager.update(view, now, true);
  }

  private stratumAt(y: number): StratumId {
    for (const b of this.bands) if (y >= b.y0 && y < b.y1) return b.s;
    return y < 0 ? 1 : 6;
  }

  build(cx: number, cy: number, x0: number, y0: number, x1: number, y1: number): Container | null {
    const near = this.cav.filter(k => k.b.x1 > x0 - SPILL && k.b.x0 < x1 + SPILL && k.b.y1 > y0 - SPILL && k.b.y0 < y1 + SPILL);
    // A chunk wholly inside one cavity has no rock.
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) / 2, (y0 + y1) / 2]];
    if (near.some(k => corners.every(([x, y]) => inPoly(k.c.poly, x, y)))) return null;

    const chunk = new Container();
    chunk.label = `rock:${cx},${cy}`;
    const baked = new Container();

    // 3. ambient occlusion inside the holes (drawn first: the rock goes over its outer half).
    const ao = new Graphics();
    const rim = new Graphics();
    const U = UNIFY.cutEdge;
    for (const k of near) this.edges(k, near, x0 - SPILL, y0 - SPILL, x1 + SPILL, y1 + SPILL, (pts) => {
      // A soft band: three nested strokes centred on the cut (the outer half is hidden under the rock).
      for (const [w, a] of [[U.aoWidth * 2, U.aoAlpha * 0.38], [U.aoWidth * 1.3, U.aoAlpha * 0.34], [U.aoWidth * 0.6, U.aoAlpha * 0.4]] as const) {
        ao.poly(pts, false).stroke({ width: w, color: 0x000000, alpha: a, join: 'round', cap: 'round' });
      }
    });

    // 1 + 2. the rock with the holes erased, in a cache of its own (the erase must not reach the AO under it).
    const rock = new Container();
    // Chunks overlap by OVERLAP units: the cache texture's border texels never blend with the erased frame inside the view.
    const hasRock = this.paintRock(rock, x0 - OVERLAP, y0 - OVERLAP, x1 + OVERLAP, y1 + OVERLAP);
    if (!hasRock) return null;
    const holes = new Graphics();
    for (const k of near) holes.poly(k.c.poly).fill(0xffffff);
    holes.blendMode = 'erase';
    rock.addChild(holes);
    // [world:C2 tech-artist] The cache covers the chunk only: without boundsArea it took the bounds of every whole cavity polygon near the
    // chunk (the hub, the floor strips), 1024x2048 px per cache in the game (2 caches a chunk, 16 MB), 236 MB more GPU memory at e55.
    const area = new Rectangle(x0 - OVERLAP, y0 - OVERLAP, x1 - x0 + OVERLAP * 2, y1 - y0 + OVERLAP * 2);
    rock.boundsArea = area;
    rock.cacheAsTexture({ resolution: this.res, antialias: false });

    // 4. trim everything to the chunk.
    const frame = new Graphics();
    const fx0 = x0 - OVERLAP, fy0 = y0 - OVERLAP, fx1 = x1 + OVERLAP, fy1 = y1 + OVERLAP;
    frame.rect(fx0 - SPILL * 2, fy0 - SPILL * 2, fx1 - fx0 + SPILL * 4, SPILL * 2).fill(0xffffff);
    frame.rect(fx0 - SPILL * 2, fy1, fx1 - fx0 + SPILL * 4, SPILL * 2).fill(0xffffff);
    frame.rect(fx0 - SPILL * 2, fy0, SPILL * 2, fy1 - fy0).fill(0xffffff);
    frame.rect(fx1, fy0, SPILL * 2, fy1 - fy0).fill(0xffffff);
    frame.blendMode = 'erase';
    baked.addChild(ao, rock, frame);
    baked.boundsArea = area;
    baked.cacheAsTexture({ resolution: this.res, antialias: false });

    // The crisp rim over the cache: only the segments whose middle lies in this chunk (each drawn once).
    for (const k of near) {
      const P = palette(k.c.s);
      this.edges(k, near, x0, y0, x1, y1, (pts) => {
        rim.poly(pts, false).stroke({ width: U.rimWidth, color: P.rockRim, alpha: U.rimAlpha, join: 'round', cap: 'round' });
      }, true);
    }
    chunk.addChild(baked, rim);
    return chunk;
  }

  signature(): string {
    return '';
  }

  /** The rock tile per stratum band in the chunk, the topsoil, and banding strips. False when the chunk is all above ground. */
  private paintRock(into: Container, x0: number, y0: number, x1: number, y1: number): boolean {
    const top = Math.max(0, y0);
    if (top >= y1) return false;
    const w = x1 - x0;
    // Topsoil: ash soil just under the ground line.
    if (top < SOIL) into.addChild(tile(rockTileId('surface'), x0, top, w, Math.min(y1, SOIL) - top, { tint: ROCK_TINT }));
    for (const b of this.bands) {
      const a = Math.max(top, b.y0, SOIL), z = Math.min(y1, b.y1);
      if (z <= a) continue;
      into.addChild(tile(rockTileId(WORLD_KIT_IDS[b.s]), x0, a, w, z - a, { tint: ROCK_TINT }));
    }
    // Banding: across every seam (the lower stratum's band, centred on it) and, inside a stratum, now and then.
    const seams: { y: number; s: StratumId; a: number }[] = [{ y: SOIL, s: 1, a: 0.9 }];
    for (const b of this.bands) if (b.s > 1) seams.push({ y: b.y0, s: b.s, a: 1 });
    for (const b of this.bands) {
      for (let y = b.y0 + 260; y < b.y1 - 160; y += 380) seams.push({ y: y + Math.round(hash2(b.s, y) * 120) - 60, s: b.s, a: 0.55 + 0.3 * hash2(y, b.s) });
    }
    for (const sm of seams) {
      const by = sm.y - BAND_H / 2;
      if (by + BAND_H <= top || by >= y1) continue;
      const a = Math.max(by, top), z = Math.min(by + BAND_H, y1);
      const band = tile(rockBandId(WORLD_KIT_IDS[sm.s]), x0, a, w, z - a, { oy: by - Math.round(hash2(sm.y, 3) * 64), alpha: sm.a, tint: ROCK_TINT });
      band.tilePosition.x = -(x0 + Math.round(hash2(sm.y, 7) * 400));
      into.addChild(band);
    }
    return true;
  }

  /**
   * Walks the cut edges of a cavity that face rock (not another cavity) and lie in the box, as polylines. With `own`, only segments whose
   * middle is inside the box (no double drawing across chunks).
   */
  private edges(k: CavityInfo, near: CavityInfo[], bx0: number, by0: number, bx1: number, by1: number, draw: (pts: number[]) => void, own = false): void {
    const p = k.c.poly, n = p.length / 2;
    let run: number[] = [];
    const flush = () => { if (run.length >= 4) draw(run); run = []; };
    const sign = k.cw ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[((i + 1) % n) * 2], by = p[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-3) continue;
      const steps = Math.max(1, Math.ceil(len / 10));
      for (let j = 0; j < steps; j++) {
        const sx = ax + ((bx - ax) * j) / steps, sy = ay + ((by - ay) * j) / steps;
        const ex = ax + ((bx - ax) * (j + 1)) / steps, ey = ay + ((by - ay) * (j + 1)) / steps;
        const mx = (sx + ex) / 2, my = (sy + ey) / 2;
        const inBox = own ? mx >= bx0 && mx < bx1 && my >= by0 && my < by1 : mx > bx0 && mx < bx1 && my > by0 && my < by1;
        // Outward normal (clockwise polygon, y down): (dy, -dx).
        const nx = (sign * (ey - sy)) / (len / steps), ny = (sign * -(ex - sx)) / (len / steps);
        const ox = mx + nx * 2.5, oy = my + ny * 2.5;
        let faces = inBox && my > 0.5;
        if (faces) for (const o of near) if (o !== k && o.b.x0 <= ox && o.b.x1 >= ox && o.b.y0 <= oy && o.b.y1 >= oy && inPoly(o.c.poly, ox, oy)) { faces = false; break; }
        if (!faces) { flush(); continue; }
        if (!run.length) run.push(sx, sy);
        run.push(ex, ey);
      }
    }
    flush();
  }

  destroy(): void {
    this.manager.destroy();
    this.container.destroy({ children: true });
  }
}

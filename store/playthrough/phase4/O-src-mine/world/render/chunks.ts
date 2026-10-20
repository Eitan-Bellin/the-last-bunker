/**
 * A generic chunk manager, generalised from `src/rendering/frontChunks.ts` (plan4:ST-7): content in square chunks (512 units by
 * default) built lazily the first time they come near the view, at most `maxBuilds` per frame (the ones in view first, nearest the
 * middle first), shown only while in view, and given back after `parkAfterMs` outside the keep window (one view around the view).
 *
 * The manager knows nothing of what a chunk holds: a `ChunkSource` builds it (and may say what it depends on with a signature, so
 * `invalidate()` drops only the chunks whose signature changed). Coordinates are whatever space the parent container is in: world
 * units for the play plane, plane units for a parallax plane. No allocation per frame once the chunk table exists.
 */
import { Container } from 'pixi.js';
import type { Rect } from './layoutTypes';

/**
 * [world:M1] A parked chunk's texture caches (`cacheAsTexture`) are destroyed, not handed back to Pixi's TexturePool: the pool never gives
 * memory back, so every chunk ever built stayed on the GPU (86 rock caches of 1 MB at e55 desktop, most of the city's extra memory).
 */
export function freeCaches(o: Container): void {
  const rg = (o as unknown as { renderGroup?: { isCachedAsTexture?: boolean; texture?: { destroy(all?: boolean): void } | null } | null }).renderGroup;
  if (rg?.isCachedAsTexture && rg.texture) {
    const t = rg.texture;
    rg.texture = null;
    t.destroy(true);
  }
  for (const ch of o.children) freeCaches(ch);
}

export interface ChunkSource {
  /** Builds the content of one chunk (or null when it is empty). `x0..x1, y0..y1` is the chunk rectangle. */
  build(cx: number, cy: number, x0: number, y0: number, x1: number, y1: number): Container | null;
  /** What the chunk's look depends on; a changed signature rebuilds it on `invalidate()`. */
  signature?(cx: number, cy: number): string;
}

interface Chunk {
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sig: string;
  built: boolean;
  content: Container | null;
  shown: boolean;
  lastSeen: number;
}

export interface ChunkOptions {
  size?: number;
  maxBuilds?: number;
  parkAfterMs?: number;
  /** Keep window around the view, as a fraction of the view size per side. */
  keep?: number;
}

export class ChunkManager {
  readonly container = new Container();
  private chunks: Chunk[] = [];
  private index = new Map<number, Chunk>();
  private size: number;
  private maxBuilds: number;
  private parkAfterMs: number;
  private keep: number;
  readonly stats = { chunks: 0, built: 0, shown: 0, builds: 0, viewBuilds: 0 };

  private source: ChunkSource;

  constructor(source: ChunkSource, opts: ChunkOptions = {}) {
    this.source = source;
    this.size = opts.size ?? 512;
    this.maxBuilds = opts.maxBuilds ?? 2;
    this.parkAfterMs = opts.parkAfterMs ?? 8000;
    this.keep = opts.keep ?? 0.75;
    this.container.eventMode = 'none';
  }

  /** The area the chunks cover (rebuilds the table; chunks still inside keep their content). */
  setExtent(r: Rect): void {
    const S = this.size;
    const cx0 = Math.floor(r.x / S), cx1 = Math.floor((r.x + r.w - 1e-6) / S);
    const cy0 = Math.floor(r.y / S), cy1 = Math.floor((r.y + r.h - 1e-6) / S);
    const next: Chunk[] = [];
    const nextIndex = new Map<number, Chunk>();
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cx * 131071 + cy;
        let c = this.index.get(key);
        if (c) this.index.delete(key);
        else c = { cx, cy, x0: cx * S, y0: cy * S, x1: (cx + 1) * S, y1: (cy + 1) * S, sig: '', built: false, content: null, shown: false, lastSeen: 0 };
        next.push(c);
        nextIndex.set(key, c);
      }
    }
    for (const c of this.index.values()) this.drop(c);
    this.chunks = next;
    this.index = nextIndex;
    this.stats.chunks = next.length;
  }

  /** Drops chunks whose signature changed (or every chunk in `r`, or all of them when the source has no signature). */
  invalidate(r?: Rect): void {
    for (const c of this.chunks) {
      if (!c.built) continue;
      if (r && (c.x1 <= r.x || c.x0 >= r.x + r.w || c.y1 <= r.y || c.y0 >= r.y + r.h)) continue;
      if (this.source.signature && !r) {
        if (this.source.signature(c.cx, c.cy) === c.sig) continue;
      }
      this.drop(c);
    }
  }

  private drop(c: Chunk): void {
    if (c.content) {
      freeCaches(c.content);
      c.content.destroy({ children: true });
    }
    c.content = null;
    c.built = false;
    c.shown = false;
  }

  private build(c: Chunk, now: number): void {
    c.built = true;
    c.lastSeen = now;
    c.sig = this.source.signature?.(c.cx, c.cy) ?? '';
    const content = this.source.build(c.cx, c.cy, c.x0, c.y0, c.x1, c.y1);
    c.content = content;
    if (content) {
      content.visible = false;
      this.container.addChild(content);
    }
    this.stats.builds++;
  }

  /** Per frame: build what came near (a few a frame), show what is in `view`, give back what stayed away. */
  update(view: Rect, now: number, buildAll = false): void {
    const vx0 = view.x, vy0 = view.y, vx1 = view.x + view.w, vy1 = view.y + view.h;
    const kw = view.w * this.keep, kh = view.h * this.keep;
    const zx0 = vx0 - kw, zx1 = vx1 + kw, zy0 = vy0 - kh, zy1 = vy1 + kh;
    const mx = (vx0 + vx1) / 2, my = (vy0 + vy1) / 2;
    const builds = buildAll ? 1e9 : this.maxBuilds;
    for (let n = 0; n < builds; n++) {
      let best: Chunk | null = null;
      let bestD = Infinity;
      for (let i = 0; i < this.chunks.length; i++) {
        const c = this.chunks[i];
        if (c.built) continue;
        const inView = c.x1 > vx0 && c.x0 < vx1 && c.y1 > vy0 && c.y0 < vy1;
        if (!inView && !(c.x1 > zx0 && c.x0 < zx1 && c.y1 > zy0 && c.y0 < zy1)) continue;
        const d = Math.abs((c.x0 + c.x1) / 2 - mx) + Math.abs((c.y0 + c.y1) / 2 - my) * 1.5 + (inView ? 0 : 1e7);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best) break;
      this.build(best, now);
      if (best.x1 > vx0 && best.x0 < vx1 && best.y1 > vy0 && best.y0 < vy1) this.stats.viewBuilds++;
    }
    let built = 0, shown = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (!c.built) continue;
      const inView = c.x1 > vx0 && c.x0 < vx1 && c.y1 > vy0 && c.y0 < vy1;
      const inZone = c.x1 > zx0 && c.x0 < zx1 && c.y1 > zy0 && c.y0 < zy1;
      if (inZone) c.lastSeen = now;
      else if (now - c.lastSeen > this.parkAfterMs) {
        this.drop(c);
        continue;
      }
      built++;
      if (inView !== c.shown) {
        c.shown = inView;
        if (c.content) c.content.visible = inView;
      }
      if (inView) shown++;
    }
    this.stats.built = built;
    this.stats.shown = shown;
  }

  clear(): void {
    for (const c of this.chunks) this.drop(c);
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}

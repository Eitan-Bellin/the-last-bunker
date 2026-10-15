/**
 * [world:M1] The foreground plane's content (layer `fore`, parallax 1.32; style guide 3: "never over a room's centre", 11: "don't put a
 * foreground silhouette over a room or a badge"). Phase 2c switched the backdrop's seam lip off because at 1.32 it drifted over the dig
 * face, its sign and the rooms. This one keeps clear by construction AND by check:
 *  - it stands only where no room is: in the side rock past the outermost edges and districts (outcrops rising from below, pipe pairs
 *    hanging from above), and along the service-gallery bands (a pipe pair, a sagging cable) between strata the player has reached;
 *  - every frame each silhouette's PROJECTED box (where parallax puts it now) is tested against the keep-clear boxes (every storey that
 *    is not hidden, the hubs, the edges with their signs, the districts, the dig face; padded CITY.fore.keepClear) and fades out while it
 *    overlaps one.
 * It lives in the renderer's fore plane, which decides when it shows at all: High only, zoom >= 0.85 (DETAIL.foreMinZoom; Medium and
 * Low have no fore layer). Authored in world units under a root scaled by the plane's p (the plane's content is in plane units).
 */
import { Container, Sprite } from 'pixi.js';
import { CITY, LAYERS } from '../../tokens';
import { polyBounds } from '../../model/outline';
import type { CityLayout, Rect } from '../layoutTypes';
import { sprite } from './kit';

const F = CITY.fore;
const P_FORE = LAYERS.find(l => l.id === 'fore')?.p ?? 1.32;

interface Item { s: Sprite; x0: number; y0: number; x1: number; y1: number; a: number }
interface Box { x0: number; y0: number; x1: number; y1: number }

export class ForeSilhouettes {
  readonly root = new Container();
  private items: Item[] = [];
  private keep: Box[] = [];
  private plane: Container | null = null;
  private tried = 0;
  private last = -1;

  constructor(layout: CityLayout) {
    this.root.label = 'shell:fore';
    this.root.eventMode = 'none';
    this.root.scale.set(P_FORE);
    if (import.meta.env.DEV) (globalThis as unknown as { __fore?: unknown }).__fore = this; // shots and probes
    const pad = F.keepClear;
    let cx0 = Infinity, cx1 = -Infinity;
    for (const a of layout.areas) {
      if (a.kind === 'surface' || a.kind === 'pocket' || a.kind === 'gallery') continue;
      if (a.state === 'hidden' && a.kind !== 'storey') continue;
      const b = polyBounds(a.poly);
      if (a.kind === 'storey' && a.state === 'hidden') continue;
      this.keep.push({ x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad });
      // (The dig face's row spans the whole world: it keeps clear, but it does not say where the city ends.)
      if (a.kind === 'storey' && a.state !== 'revealed') continue;
      cx0 = Math.min(cx0, b.x0);
      cx1 = Math.max(cx1, b.x1);
    }
    for (const h of layout.hubs) this.keep.push({ x0: h.rect.x - pad, y0: h.rect.y - pad, x1: h.rect.x + h.rect.w + pad, y1: h.rect.y + h.rect.h + pad });
    for (const c of layout.cavities) if (c.id.startsWith('c:dig:') || c.id === 'c:hatch') { const b = polyBounds(c.poly); this.keep.push({ x0: b.x0 - pad, y0: b.y0 - pad - 40, x1: b.x1 + pad, y1: b.y1 + pad }); }
    if (!isFinite(cx0)) return;
    // Strata the player can see (a storey not hidden), and the seams between two of them.
    const seen = new Set<number>();
    for (const a of layout.areas) if (a.kind === 'storey' && a.state !== 'hidden') seen.add(a.s);
    const bands = layout.strata.filter(b => b.s > 0 && seen.has(b.s));
    const add = (id: 'fore-outcrop' | 'fore-pipes' | 'fore-cable' | 'fore-pipe-h', x: number, y: number, k: number, flip = false): void => {
      if (this.items.length >= F.maxItems) return;
      // Near-black silhouettes (the fore plane is outside the lightmap): the painted rim survives the tint as a faint edge.
      const s = sprite(id, x, y, { flip, scale: k, tint: F.tint });
      const b = s.getLocalBounds();
      const sx = s.scale.x, sy = s.scale.y;
      const xa = x + b.minX * sx, xb = x + b.maxX * sx, ya = y + b.minY * sy, yb = y + b.maxY * sy;
      s.alpha = 0;
      this.root.addChild(s);
      this.items.push({ s, x0: Math.min(xa, xb), y0: Math.min(ya, yb), x1: Math.max(xa, xb), y1: Math.max(ya, yb), a: 0 });
    };
    const side = F.sideRun;
    for (const b of bands) {
      // The side rock: an outcrop rising from below at each side, a pipe pair hanging from the stratum's top on the far west.
      add('fore-outcrop', cx0 - side * 0.7, b.y1, 0.62, (b.s & 1) === 0);
      add('fore-outcrop', cx1 + side * 0.7, b.y1, 0.55, (b.s & 1) === 1);
      if (b.s % 2 === 0) add('fore-pipes', cx0 - side * 0.35, b.y0 + 10, 0.6);
      else add('fore-pipes', cx1 + side * 0.35, b.y0 + 10, 0.6);
    }
    for (const b of bands) {
      if (!seen.has(b.s + 1)) continue;
      // The seam (the service gallery band): a pipe pair running in from the west rock, a cable sagging across on the east.
      const y = b.y1;
      add('fore-pipe-h', cx0 - side - 300, y, 0.62);
      add('fore-cable', cx1 + 60, y - 10, 0.7);
    }
  }

  /** Finds the renderer's fore plane above `from` (by its label) and joins its content. */
  private attach(from: Container): void {
    for (let p: Container | null = from; p; p = p.parent) {
      for (const ch of p.children) {
        if (ch.label === 'plane:fore') {
          this.plane = ch as Container;
          this.plane.addChild(this.root);
          return;
        }
      }
    }
  }

  /** `now` in ms (performance.now): the fade-in eases by elapsed time, not per frame. */
  update(from: Container, view: Rect, now: number): void {
    if (!this.items.length) return;
    const dt = this.last < 0 ? 1 / 60 : Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.plane) {
      if (this.tried++ % 30 === 0) this.attach(from);
      if (!this.plane) return;
    }
    if (!this.plane.visible) return;
    // Where parallax puts an authored point now: W = c + pk (x - c), c = the view centre, k = the plane's scale.
    const pk = P_FORE * this.plane.scale.x;
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    const ease = 1 - Math.exp(-dt / F.fadeTau);
    const vx0 = view.x - 60, vy0 = view.y - 60, vx1 = view.x + view.w + 60, vy1 = view.y + view.h + 60;
    for (const it of this.items) {
      const x0 = cx + pk * (it.x0 - cx), x1 = cx + pk * (it.x1 - cx), y0 = cy + pk * (it.y0 - cy), y1 = cy + pk * (it.y1 - cy);
      const onScreen = x1 > vx0 && x0 < vx1 && y1 > vy0 && y0 < vy1;
      let target = 0;
      if (onScreen) {
        target = 1;
        for (const k of this.keep) if (x1 > k.x0 && x0 < k.x1 && y1 > k.y0 && y0 < k.y1) { target = 0; break; }
      }
      // Out at once (never over a room, not even for a frame), in with a short ease.
      it.a = target === 0 ? 0 : it.a + (1 - it.a) * ease;
      if (1 - it.a < 0.02) it.a = target;
      it.s.alpha = it.a;
      it.s.visible = it.a > 0.01;
    }
  }

  destroy(): void {
    // [world:M1 review] Drop the DEV probe handle, or it keeps the destroyed plane (and its layout) alive.
    if (import.meta.env.DEV) { const g = globalThis as unknown as { __fore?: unknown }; if (g.__fore === this) delete g.__fore; }
    this.root.parent?.removeChild(this.root);
    this.root.destroy({ children: true });
    this.items = [];
    this.plane = null;
  }
}

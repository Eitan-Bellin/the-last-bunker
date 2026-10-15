/**
 * [world:M1] "New" discovery pins (architecture 1.5, CitySystem): an area logic has revealed (`revealedAreaIds`) that is not in
 * `state.city.seen` gets a small pulsing marker with an additive glow, in the world (Pixi, no DOM). When its anchor has been inside the
 * camera view for `PINS.seenAfter` s the host marks it seen (CitySystem.markSeen) and the pin fades out.
 *
 * Also the one-off "found" flash of a pocket tap. Cheap by construction:
 *  - the pin set is rebuilt only when the host's key (layout sig, floors, seen/found counts) moves;
 *  - visibility is one point-in-rect per pin, `PINS.checkHz` times a second;
 *  - the layer is hidden under the far map, like the labels (LOD), and nothing animates while it is.
 * Pure Pixi; colours and sizes from tokensRender PINS.
 */
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { PINS } from '../tokensRender';
import type { CityLayout, Rect } from './layoutTypes';

interface Pin {
  id: string;
  x: number;
  y: number;
  root: Container;
  glow: Sprite;
  ring: Graphics;
  born: number;
  /** Seconds the anchor has been in view. */
  shown: number;
  /** Time the pin was marked seen (fading out), or -1. */
  gone: number;
  phase: number;
}

interface Flash { s: Sprite; t0: number }

/** Where a pin for an area id stands: its label point, else its polygon's box centre; `s:<n>` uses the stratum's hub (or band). Null = none. */
export function pinAnchor(layout: CityLayout, id: string): { x: number; y: number } | null {
  const a = layout.areas.find(ar => ar.id === id);
  if (a) {
    if (a.label) return { x: a.label.x, y: a.label.y };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < a.poly.length; i += 2) {
      x0 = Math.min(x0, a.poly[i]); x1 = Math.max(x1, a.poly[i]);
      y0 = Math.min(y0, a.poly[i + 1]); y1 = Math.max(y1, a.poly[i + 1]);
    }
    return Number.isFinite(x0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : null;
  }
  if (id.startsWith('s:')) {
    const s = Number(id.slice(2));
    const hub = layout.hubs.find(h => h.s === s);
    if (hub) return { x: hub.rect.x + hub.rect.w / 2, y: hub.rect.y + hub.rect.h * 0.3 };
    const band = layout.strata.find(b => b.s === s);
    const fr = layout.frames.find(f => f.s === s);
    if (band && fr) return { x: (fr.hubL + fr.hubR) / 2, y: (band.y0 + band.y1) / 2 };
  }
  return null;
}

export class DiscoveryPins {
  readonly layer = new Container();
  private readonly pins = new Map<string, Pin>();
  private readonly flashes: Flash[] = [];
  private checkAt = -1;
  private readonly seenOut: string[] = [];
  private glowTex: Texture;

  constructor(glowTex: Texture) {
    this.glowTex = glowTex;
    this.layer.label = 'city:pins';
    this.layer.eventMode = 'none';
    this.layer.isRenderGroup = true;
  }

  get count(): number {
    return this.pins.size;
  }

  /** The pins wanted now (id + anchor). Pins not listed fade out; new ones fade in. */
  set(targets: readonly { id: string; x: number; y: number }[], t: number): void {
    const want = new Set<string>();
    for (const tg of targets) {
      want.add(tg.id);
      const p = this.pins.get(tg.id);
      if (p) {
        p.x = tg.x; p.y = tg.y;
        if (p.gone >= 0) { p.gone = -1; p.born = t; }
        continue;
      }
      this.pins.set(tg.id, this.make(tg.id, tg.x, tg.y, t));
    }
    for (const p of this.pins.values()) if (!want.has(p.id) && p.gone < 0) p.gone = t;
  }

  private make(id: string, x: number, y: number, t: number): Pin {
    const root = new Container();
    const glow = new Sprite(this.glowTex);
    glow.anchor.set(0.5);
    glow.tint = PINS.glow;
    glow.blendMode = 'add';
    const ring = new Graphics().circle(0, 0, PINS.r).stroke({ color: PINS.color, width: 1.5 });
    const dot = new Graphics()
      .moveTo(0, -PINS.r).lineTo(PINS.r * 0.8, 0).lineTo(0, PINS.r).lineTo(-PINS.r * 0.8, 0).closePath().fill(PINS.color)
      .circle(0, 0, PINS.r * 0.35).fill(PINS.core);
    root.addChild(glow, ring, dot);
    root.alpha = 0;
    this.layer.addChild(root);
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return { id, x, y, root, glow, ring, born: t, shown: 0, gone: -1, phase: ((h >>> 0) % 1000) / 1000 };
  }

  /** A one-off glow where a pocket was found (fades over PINS.fade * 3). */
  flash(x: number, y: number, t: number): void {
    const s = new Sprite(this.glowTex);
    s.anchor.set(0.5);
    s.tint = PINS.glow;
    s.blendMode = 'add';
    s.position.set(x, y);
    s.width = s.height = PINS.findGlowD;
    this.layer.addChild(s);
    this.flashes.push({ s, t0: t });
  }

  /**
   * Per frame. `view` is the world rect on screen, `zoom` the world scale, `covers` the far map. Returns the ids whose anchor has now been in
   * view long enough (the host marks them seen), or null. The returned array is reused.
   */
  update(view: Rect, zoom: number, t: number, dt: number, covers: boolean): string[] | null {
    this.layer.visible = !covers && (this.pins.size > 0 || this.flashes.length > 0);
    if (!this.layer.visible) return null;
    // Flashes.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i], k = (t - f.t0) / (PINS.fade * 3);
      if (k >= 1) { f.s.destroy(); this.flashes.splice(i, 1); continue; }
      f.s.alpha = PINS.glowAlpha * (1 - k) * Math.min(1, k * 8);
      f.s.width = f.s.height = PINS.findGlowD * (0.6 + 0.6 * k);
    }
    // A constant-ish screen size: world size r at zoom 1, clamped to [minScreen, maxScreen] px.
    const px = Math.max(PINS.minScreen, Math.min(PINS.maxScreen, PINS.r * zoom));
    const sc = px / (PINS.r * Math.max(zoom, 1e-3));
    const check = t - this.checkAt >= 1 / PINS.checkHz;
    const step = check ? (this.checkAt < 0 ? 0 : t - this.checkAt) : 0;
    if (check) this.checkAt = t;
    const ix = view.w * PINS.viewInset, iy = view.h * PINS.viewInset;
    const out = this.seenOut;
    out.length = 0;
    for (const p of this.pins.values()) {
      if (p.gone >= 0) {
        const k = (t - p.gone) / PINS.fade;
        if (k >= 1) { p.root.destroy({ children: true }); this.pins.delete(p.id); continue; }
        p.root.alpha = 1 - k;
      } else {
        p.root.alpha = Math.min(1, (t - p.born) / PINS.fade);
        if (check) {
          const inView = p.x >= view.x + ix && p.x <= view.x + view.w - ix && p.y >= view.y + iy && p.y <= view.y + view.h - iy;
          p.shown = inView ? p.shown + step : 0;
          if (p.shown >= PINS.seenAfter) out.push(p.id);
        }
      }
      const u = ((t / PINS.pulse + p.phase) % 1);
      p.root.position.set(p.x, p.y - (PINS.lift + Math.sin((t / PINS.pulse + p.phase) * Math.PI * 2) * PINS.bob) * sc);
      p.root.scale.set(sc);
      p.ring.scale.set(1 + (PINS.ringScale - 1) * u);
      p.ring.alpha = 1 - u;
      p.glow.width = p.glow.height = PINS.glowD * (0.85 + 0.15 * Math.sin(u * Math.PI * 2));
      p.glow.alpha = PINS.glowAlpha;
    }
    if (out.length) for (const id of out) { const p = this.pins.get(id); if (p) p.gone = t; }
    return out.length ? out : null;
  }

  destroy(): void {
    this.pins.clear();
    this.flashes.length = 0;
    this.layer.destroy({ children: true });
  }
}

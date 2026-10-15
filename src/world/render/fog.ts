/**
 * Fog of war (style guide section 5): a low-resolution texture (one texel = FOG.cell world units, upscaled bilinear for soft organic
 * edges) holding the darkness over the city's areas, drawn from the layout's area polygons:
 *  - hidden    -> undiscovered: near-black at FOG.states.undiscovered.alpha, slowly mottled and drifting;
 *  - glimpsed  -> 'known' memory look (darkened, cool wash); an `edge` area instead starts FOG.hintStart open (the dark-edge hint);
 *  - digging   -> the glimpsed look fading out with the dig's progress;
 *  - revealed  -> no fog.
 * A change of state tweens over FOG.reveal.time with out-cubic easing; `reveal(x, y, r)` adds a growing erase brush (a tap). One or two
 * jittered copies of the texture breathe around the edge (TIER_RENDER.fogHalos). The texture is redrawn only when something changed or,
 * on tiers whose fog animates, at TIER_RENDER.fogHz for the drift. The area mask is blurred by FOG.edge.softCells while it is drawn.
 */
import { BlurFilter, Container, Graphics, RenderTexture, Sprite, Texture, TilingSprite, type Renderer } from 'pixi.js';
import { DETAIL, FOG } from '../tokens';
import { FOG_RENDER, TIER_RENDER, baseTier, type RenderTier } from '../tokensRender';
import { cityTextures, hash01, hexMix } from './lighting';
import type { AreaState, CityArea, CityLayout } from './layoutTypes';

interface FogArea {
  id: string;
  kind: string;
  g: Graphics;
  state: AreaState;
  progress: number;
  /** Current look, the look tweened from and to. */
  a: number; c: number;
  fa: number; fc: number;
  ta: number; tc: number;
  t: number;
}

interface Brush { s: Sprite; x: number; y: number; r: number; t: number }

const outCubic = (x: number): number => 1 - Math.pow(1 - x, 3);

/** The 'known' memory look as one overlay: out = P * (1 - darken) * (1 - tintA) + tint * tintA  ->  alpha and premultiplied colour. */
function knownLook(): { a: number; c: number } {
  const k = FOG.states.known;
  const a = 1 - (1 - k.darken) * (1 - k.tintAlpha);
  const s = k.tintAlpha / a;
  return { a, c: hexMix(0x000000, k.tint, s) };
}

function noiseTexture(): Texture {
  const size = FOG_RENDER.noiseTex, cells = FOG_RENDER.noiseCells;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const lat = (x: number, y: number, p: number): number => hash01(((x % p) + p) % p, (((y % p) + p) % p) + p * 31);
  const val = (x: number, y: number, p: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lat(xi, yi, p), b = lat(xi + 1, yi, p), cc = lat(xi, yi + 1, p), d = lat(xi + 1, yi + 1, p);
    return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0, amp = 0.5, tot = 0, p = cells;
      for (let o = 0; o < 3; o++) {
        s += val((x / size) * p, (y / size) * p, p) * amp;
        tot += amp;
        amp *= 0.5;
        p *= 2;
      }
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round((s / tot) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = Texture.from(c);
  t.source.style.addressMode = 'repeat';
  return t;
}

export class FogLayer {
  /** On stage, world coordinates, above the glow layer. */
  readonly layer = new Container();
  private rt: RenderTexture;
  private root = new Container();
  private areaC = new Container();
  private brushC = new Container();
  private noise: TilingSprite;
  private blur: BlurFilter;
  private main: Sprite;
  private halos: Sprite[] = [];
  private areas = new Map<string, FogArea>();
  private list: FogArea[] = [];
  private brushes: Brush[] = [];
  private geomSig = '';
  private ox = 0;
  private oy = 0;
  private cell: number = FOG.cell;
  private texW = 1;
  private texH = 1;
  private dirty = true;
  private lastDraw = -1;
  private tier: RenderTier = 'high';
  private known = knownLook();
  readonly hiddenIds: string[] = [];
  readonly darkIds: string[] = [];
  /** Stats for the lab. */
  readonly stats = { areas: 0, redraws: 0, texW: 0, texH: 0 };

  constructor(tier: RenderTier) {
    this.layer.eventMode = 'none';
    this.rt = RenderTexture.create({ width: 4, height: 4, resolution: 1 });
    this.main = new Sprite(this.rt);
    for (let i = 0; i < 2; i++) {
      const h = new Sprite(this.rt);
      this.halos.push(h);
      this.layer.addChild(h);
    }
    this.layer.addChild(this.main);
    this.noise = new TilingSprite({ texture: noiseTexture(), width: 4, height: 4 });
    this.noise.blendMode = 'erase';
    this.blur = new BlurFilter({ strength: FOG.edge.softCells * FOG_RENDER.blurPerCell, quality: 2, resolution: 'inherit' });
    this.areaC.filters = [this.blur];
    this.root.addChild(this.areaC, this.noise, this.brushC);
    this.setTier(tier);
  }

  setTier(tier: RenderTier): void {
    this.tier = tier;
    const n = TIER_RENDER[tier].fogHalos;
    for (let i = 0; i < this.halos.length; i++) this.halos[i].visible = i < n;
    this.noise.visible = tier !== 'lite';
    this.dirty = true;
  }

  // ------------------------------------------------------------------ layout

  /** Geometry is rebuilt only when the set of polygons changed; states tween. */
  setLayout(layout: CityLayout): void {
    let sig = `${layout.bounds.x},${layout.bounds.y},${layout.bounds.w},${layout.bounds.h}|`;
    for (const a of layout.areas) sig += `${a.id}:${a.poly.length}:${a.poly[0] | 0}:${a.poly[1] | 0}:${a.poly[a.poly.length - 2] | 0};`;
    if (sig !== this.geomSig) {
      this.geomSig = sig;
      this.rebuild(layout);
    }
    for (const a of layout.areas) this.setState(a.id, a.state, a.progress ?? 0, false);
    this.collectVisibility();
  }

  private rebuild(layout: CityLayout): void {
    const B = layout.bounds, m = FOG_RENDER.margin;
    const w = B.w + m * 2, h = B.h + m * 2;
    this.cell = Math.max(FOG.cell, Math.ceil(Math.max(w, h) / FOG_RENDER.maxTex));
    this.ox = B.x - m;
    this.oy = B.y - m;
    this.makeTarget(Math.ceil(w / this.cell), Math.ceil(h / this.cell));
    const old = this.areas;
    this.areas = new Map();
    this.list = [];
    for (const a of old.values()) a.g.destroy();
    this.areaC.removeChildren();
    for (const a of layout.areas) {
      const g = new Graphics();
      const pts = new Array<number>(a.poly.length);
      for (let i = 0; i < a.poly.length; i += 2) {
        pts[i] = (a.poly[i] - this.ox) / this.cell;
        pts[i + 1] = (a.poly[i + 1] - this.oy) / this.cell;
      }
      g.poly(pts).fill(0xffffff);
      const prev = old.get(a.id);
      const look = this.lookOf(a.kind, a.state, a.progress ?? 0);
      const fa: FogArea = {
        id: a.id, kind: a.kind, g, state: a.state, progress: a.progress ?? 0,
        a: prev ? prev.a : look.a, c: prev ? prev.c : look.c, fa: look.a, fc: look.c, ta: look.a, tc: look.c, t: 1,
      };
      if (prev) { fa.ta = look.a; fa.tc = look.c; fa.fa = prev.a; fa.fc = prev.c; fa.t = prev.a === look.a && prev.c === look.c ? 1 : 0; }
      g.tint = fa.c;
      g.alpha = fa.a;
      g.visible = fa.a > 0.002;
      this.areaC.addChild(g);
      this.areas.set(a.id, fa);
      this.list.push(fa);
    }
    this.stats.areas = this.list.length;
    this.dirty = true;
  }

  private lookOf(kind: string, state: AreaState, progress: number): { a: number; c: number } {
    const U = FOG.states.undiscovered;
    if (state === 'hidden') return { a: U.alpha, c: U.color };
    if (state === 'revealed') return { a: 0, c: this.known.c };
    const edge = FOG_RENDER.edgeKinds.includes(kind);
    const base = edge ? { a: U.alpha * (1 - FOG.hintStart), c: U.color } : this.known;
    if (state === 'digging') return { a: base.a * (1 - Math.max(0, Math.min(1, progress))), c: base.c };
    return base;
  }

  /** Changes one area's state (a CitySystem event, a dig step); `instant` skips the reveal tween. */
  setState(id: string, state: AreaState, progress = 0, instant = false): void {
    const a = this.areas.get(id);
    if (!a) return;
    if (a.state === state && Math.abs(a.progress - progress) < 0.001 && !instant) return;
    a.state = state;
    a.progress = progress;
    const look = this.lookOf(a.kind, state, progress);
    a.fa = a.a;
    a.fc = a.c;
    a.ta = look.a;
    a.tc = look.c;
    a.t = instant ? 1 : 0;
    if (instant) { a.a = look.a; a.c = look.c; }
    this.dirty = true;
    this.collectVisibility();
  }

  stateOf(id: string): AreaState | null {
    return this.areas.get(id)?.state ?? null;
  }

  private collectVisibility(): void {
    this.hiddenIds.length = 0;
    this.darkIds.length = 0;
    for (const a of this.list) {
      if (a.state === 'hidden') this.hiddenIds.push(a.id);
      else if (a.state !== 'revealed') this.darkIds.push(a.id);
    }
  }

  /** A growing erase brush (a tap or a story beat), radius in world units (FOG.reveal.*). */
  reveal(x: number, y: number, r: number = FOG.reveal.radius): void {
    let b: Brush;
    if (this.brushes.length >= FOG_RENDER.maxBrushes) {
      b = this.brushes.shift()!;
    } else {
      const s = new Sprite(cityTextures().soft);
      s.anchor.set(0.5);
      s.blendMode = 'erase';
      this.brushC.addChild(s);
      b = { s, x, y, r, t: 0 };
    }
    b.x = x; b.y = y; b.r = r; b.t = 0;
    this.brushes.push(b);
    this.dirty = true;
  }

  /** Clears the tap brushes (a new game, a debug reset). */
  clearBrushes(): void {
    for (const b of this.brushes) b.s.destroy();
    this.brushes.length = 0;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ per frame

  update(renderer: Renderer, t: number, dt: number): void {
    const T = FOG.reveal.time;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (a.t >= 1) continue;
      a.t = Math.min(1, a.t + dt / T);
      const k = outCubic(a.t);
      a.a = a.fa + (a.ta - a.fa) * k;
      a.c = hexMix(a.fc, a.tc, k);
      a.g.alpha = a.a;
      a.g.tint = a.c;
      a.g.visible = a.a > 0.002;
      this.dirty = true;
    }
    for (let i = 0; i < this.brushes.length; i++) {
      const b = this.brushes[i];
      if (b.t >= 1) continue;
      b.t = Math.min(1, b.t + dt / T);
      const k = outCubic(b.t), s0 = FOG_RENDER.brushStart;
      b.s.x = (b.x - this.ox) / this.cell;
      b.s.y = (b.y - this.oy) / this.cell;
      b.s.width = b.s.height = (b.r * 2 * (s0 + (1 - s0) * k)) / this.cell;
      b.s.alpha = s0 + (1 - s0) * k;
      this.dirty = true;
    }
    const bt = baseTier(this.tier);
    const animated = DETAIL[bt].fogAnimated && TIER_RENDER[this.tier].fogHz > 0 && this.tier !== 'lite';
    const U = FOG.states.undiscovered;
    if (animated) {
      // Drift the mottling; the breathing halos follow the clock.
      this.noise.tilePosition.x = ((t * U.drift) / this.cell) % 4096;
      this.noise.tilePosition.y = ((t * U.drift * 0.6) / this.cell) % 4096;
      const E = FOG.edge, J = FOG_RENDER.haloJitter;
      const b = Math.sin(t * E.breathSpeed * Math.PI * 2) * 0.5 + 0.5;
      const d = J.base + J.amp * b;
      this.halos[0].position.set(this.ox + d, this.oy + d);
      this.halos[1].position.set(this.ox - d, this.oy - d * 0.6);
      this.halos[0].alpha = this.halos[1].alpha = E.breathAlpha * (0.6 + 0.4 * b);
      if (t - this.lastDraw >= 1 / TIER_RENDER[this.tier].fogHz) this.dirty = true;
    }
    if (this.dirty) this.draw(renderer, t);
  }

  private draw(renderer: Renderer, t: number): void {
    this.dirty = false;
    this.lastDraw = t;
    this.stats.redraws++;
    renderer.render({ container: this.root, target: this.rt, clear: true, clearColor: [0, 0, 0, 0] });
  }

  private makeTarget(w: number, h: number): void {
    this.rt.destroy(true);
    this.texW = Math.max(1, w);
    this.texH = Math.max(1, h);
    this.rt = RenderTexture.create({ width: this.texW, height: this.texH, resolution: 1 });
    this.stats.texW = this.texW;
    this.stats.texH = this.texH;
    for (const s of [this.main, ...this.halos]) {
      s.texture = this.rt;
      s.scale.set(this.cell);
      s.position.set(this.ox, this.oy);
    }
    // Static halos (tiers whose fog does not animate keep them here).
    const J = FOG_RENDER.haloJitter;
    this.halos[0].position.set(this.ox + J.base, this.oy + J.base);
    this.halos[1].position.set(this.ox - J.base, this.oy - J.base * 0.6);
    this.halos[0].alpha = this.halos[1].alpha = FOG.edge.breathAlpha * 0.8;
    this.noise.width = this.texW;
    this.noise.height = this.texH;
    const U = FOG.states.undiscovered;
    // One noise cell spans U.noiseScale world units.
    const texel = FOG_RENDER.noiseTex / FOG_RENDER.noiseCells;
    this.noise.tileScale.set(U.noiseScale / this.cell / texel);
    this.noise.alpha = U.noiseAlpha * FOG_RENDER.mottle;
    this.dirty = true;
  }

  /** After a lost GL context: the texture's content is gone; make a new one and redraw. */
  restore(): void {
    this.makeTarget(this.texW, this.texH);
  }

  /** Point-in-polygon over the areas (taps). */
  static contains(a: CityArea, x: number, y: number): boolean {
    const p = a.poly;
    let inside = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  destroy(): void {
    this.rt.destroy(true);
    this.root.destroy({ children: true });
    this.layer.destroy({ children: true });
  }
}

/**
 * [plan4:BL-6] RoomComposer: builds the front of a room from a declarative spec (roomSpecs.ts) out of reusable parts (roomParts.ts)
 * and bakes it into ONE texture per room type and tier, the same size and role as a room painting.
 *
 * Why Canvas 2D and not Pixi Graphics: the bake needs no renderer, it runs in one go on first use (about 6 to 10 ms for a 3-slot room),
 * and the result is an ordinary canvas-backed Texture that ArtLibrary hands out under the room's normal key (`rooms/<type>-<tier>`).
 * Everything that already works for paintings then works unchanged: paintedRoom.ts (lamp glows, particles, flicker, power dimming), the
 * lamp-pool tint of people (lightStrip.ts), roomSet.ts seats and beds, workSpots.ts, mirroring, the memory sweep and the placement ghost.
 *
 * Three art tiers (doc 02 section 4.1), all reachable through the same key:
 *   A  fully procedural (a spec with no sprites),
 *   B  procedural plus stamped kit sprites (`Painter.stamp`, only when the kit sprite is already decoded; the bake never waits for one),
 *   C  a painted PNG: `PAINTED_TYPES` in art/registry.ts decides, and a painting that fails to load falls back to this bake.
 * The room's three look levels (tier 0 salvaged, 1 restored, 2 advanced) differ in wear, light fixture, palette and the number of props,
 * never in geometry, so a room keeps its silhouette when it is upgraded.
 *
 * Contract (3-mobile-performance 7.3): the bake is one-off and synchronous but small; it makes no GPU calls except the texture upload;
 * one sprite per room at run time (plus the usual painted-room glows); memory per texture 0.3 to 0.5 MB (the swept working set stays under 8 MB).
 * Node-safe: nothing here touches the DOM unless a canvas is asked for, so the registry can run a "dry" pass (lights and fx only) at load.
 */
import type { FxSpot, LightSpot } from '../art/registry';

/** Units to texture pixels. 3 keeps a 3-slot room at 414x300 (0.5 MB); the paintings are 720x522 and are shown far above their own pixel density anyway. */
export const COMPOSE_SCALE = 3;
const ROOM_H = 100;
const SLOT_W = 46;
const DEPTH_X = 12;
const DEPTH_TOP = 9;
const DEPTH_BOTTOM = 16;

export type ComposeTier = 0 | 1 | 2;
export type Rgb = number;

// ---- small colour helpers (kept local so this module stays free of Pixi and safe to import in Node) ----

export function shade(c: Rgb, f: number): Rgb {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
/** Pulls a colour toward its own grey (art bible: saturation is reserved for alerts, fire and screens). */
export function mute(c: Rgb, k: number): Rgb {
  const l = Math.round(0.3 * ((c >> 16) & 255) + 0.59 * ((c >> 8) & 255) + 0.11 * (c & 255));
  return mix(c, (l << 16) | (l << 8) | l, k);
}
export const css = (c: Rgb, a = 1): string => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function lcg(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---- spec types ----

export interface RoomPalette {
  wall: Rgb;
  floor: Rgb;
  accent: Rgb;
  /** Colour of the main lamp. */
  light: Rgb;
}

/** A work spot for workSpots.ts: `[x, face, activity?, depth?]`, x a fraction of the width. */
export type ComposedSpot = readonly [x: number, face: 1 | -1, act?: string, depth?: number];

export interface RoomSpec {
  /** Width in slots when the building type is not defined yet (the registry prefers the real definition). */
  slots: number;
  pal: RoomPalette;
  /** Draws the room's furniture between the shell and the light pass. Called with a dry painter first (lights and fx only). */
  build(p: Painter): void;
  /** Extra darkness per tier (0 salvaged, 1 restored, 2 advanced): rooms that should read dim or bright. Default 0. */
  dim?: number;
  /** An open-air room of the surface row (solar field, mast, tower): a dusk sky and broken ground instead of walls, a ceiling and a floor. */
  outdoor?: boolean;
  /**
   * [plan4:BL-7] A district (a natural cavern at the east end of a floor, 4 slots): rock walls, a rough ceiling and an uneven floor instead of the
   * steel-and-plaster shell, and the picture is keyed `districts/<type>-<tier>` instead of `rooms/...` (see composedKey in art/registry.ts).
   */
  district?: boolean;
  /** [plan4:BL-7] Where people may walk in a district whose floor is not flat (the same fields as workSpots.ts' RoomDef): a ledge, a water edge. */
  walk?: { range?: readonly [number, number]; dy?: number; block?: readonly (readonly [number, number])[] };
}

export interface ComposeResult {
  canvas: HTMLCanvasElement;
  /** Mean brightness 0..1 and mean colour 0..255 of the finished picture (for ArtLibrary's balance bookkeeping). */
  lum: number;
  rgb: [number, number, number];
}

export interface ComposedMeta {
  lights: LightSpot[];
  fx: FxSpot[];
  spots: ComposedSpot[];
  beds: { x: number; y: number; head: -1 | 1 }[];
  seats: { x: number; y: number; face: 1 | -1; kind: 'sit' | 'eat' }[];
  /** [plan4:BL-7] The spec's `walk` (districts only). */
  walk?: RoomSpec['walk'];
}

type Ctx2D = CanvasRenderingContext2D;

/** A do-nothing stand-in for a 2D context, used by the dry pass (anything is callable and chainable). */
const SINK: Ctx2D = new Proxy(function () { /* sink */ } as unknown as Ctx2D, {
  get: () => SINK,
  set: () => true,
  apply: () => SINK,
});

interface LightCut { x: number; y: number; rx: number; ry: number; a: number }
interface ConeCut { x: number; y: number; w0: number; w1: number; yb: number; a: number }
interface WarmAdd { x: number; y: number; rx: number; ry: number; color: Rgb; a: number }

let noiseTile: HTMLCanvasElement | null = null;
/** A tileable cloud-noise tile (grey, mid 128) used to mottle every surface like brush work; made once. */
function noisePattern(ctx: Ctx2D): CanvasPattern | null {
  if (!noiseTile) {
    const n = 96;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    const img = g.createImageData(n, n);
    const r = lcg(90210);
    // Three tileable octaves of value noise on lattices of 6, 12 and 24 cells.
    const oct = (cells: number) => {
      const lat = new Float32Array(cells * cells);
      for (let i = 0; i < lat.length; i++) lat[i] = r();
      return (x: number, y: number) => {
        const fx = (x / n) * cells, fy = (y / n) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (i: number, j: number) => lat[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
        const a = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
        const b = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
        return a * (1 - sy) + b * sy;
      };
    };
    const o1 = oct(6), o2 = oct(12), o3 = oct(24);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = 0.5 * o1(x, y) + 0.3 * o2(x, y) + 0.2 * o3(x, y);
        const k = Math.max(0, Math.min(255, Math.round(128 + (v - 0.5) * 120)));
        const i = (y * n + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = k;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    noiseTile = c;
  }
  return ctx.createPattern(noiseTile, 'repeat');
}

/**
 * The drawing surface handed to a spec's `build`: everything is in room units (the room is `W` x 100, the back wall box is
 * `inL..inR` x `inT..inB`), origin top-left. Draw helpers do nothing in a dry pass; layout calls (`fx`, `lamp`, `spot`, `bed`, `seat`)
 * work in both passes and must not depend on `vr` (the visual noise stream), only on `rnd`.
 */
export class Painter {
  readonly c: Ctx2D;
  readonly dry: boolean;
  readonly W: number;
  readonly H = ROOM_H;
  readonly inL: number;
  readonly inR: number;
  readonly inT = DEPTH_TOP;
  readonly inB = ROOM_H - DEPTH_BOTTOM;
  /** Where things on the back wall stand (their feet). */
  readonly yb = ROOM_H - DEPTH_BOTTOM + 3;
  readonly tier: ComposeTier;
  readonly type: string;
  readonly pal: RoomPalette;
  /** Layout stream: identical in the dry and the real pass. */
  readonly rnd: () => number;
  /** Visual stream: only used by drawing, skipped in the dry pass. */
  readonly vr: () => number;
  readonly meta: ComposedMeta = { lights: [], fx: [], spots: [], beds: [], seats: [] };
  readonly cuts: LightCut[] = [];
  readonly cones: ConeCut[] = [];
  readonly warm: WarmAdd[] = [];
  /** Kit sprite lookup for tier B (returns an image only when it is already decoded). */
  stampSource: ((key: string) => CanvasImageSource | null) | null = null;

  constructor(type: string, W: number, tier: ComposeTier, pal: RoomPalette, c: Ctx2D | null) {
    this.type = type;
    this.W = W;
    this.tier = tier;
    this.pal = pal;
    this.dry = !c;
    this.c = c ?? SINK;
    // A one-slot room (a mast, a tower) has no room for the full side walls: they narrow so the back wall keeps some width.
    const dx = W < 60 ? DEPTH_X / 2 : DEPTH_X;
    this.inL = dx;
    this.inR = W - dx;
    const seed = hashStr(`${type}|${tier}`);
    this.rnd = lcg(seed);
    this.vr = lcg(seed ^ 0x9e3779b9);
  }

  // ---------------------------------------------------------------- primitives

  rect(x: number, y: number, w: number, h: number, col: Rgb, a = 1): void {
    if (this.dry) return;
    const c = this.c;
    c.fillStyle = css(col, a);
    c.fillRect(x, y, w, h);
  }

  /** A vertical (default) or horizontal gradient rectangle; stops are [position 0..1, colour, alpha?]. */
  rectG(x: number, y: number, w: number, h: number, stops: readonly (readonly [number, Rgb, number?])[], horizontal = false): void {
    if (this.dry) return;
    const c = this.c;
    const g = horizontal ? c.createLinearGradient(x, 0, x + w, 0) : c.createLinearGradient(0, y, 0, y + h);
    for (const [t, col, a] of stops) g.addColorStop(t, css(col, a ?? 1));
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
  }

  poly(pts: readonly number[], col: Rgb, a = 1): void {
    if (this.dry) return;
    const c = this.c;
    c.fillStyle = css(col, a);
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath();
    c.fill();
  }

  /** A polygon filled with a vertical gradient between y0 and y1. */
  polyG(pts: readonly number[], y0: number, y1: number, stops: readonly (readonly [number, Rgb, number?])[]): void {
    if (this.dry) return;
    const c = this.c;
    const g = c.createLinearGradient(0, y0, 0, y1);
    for (const [t, col, a] of stops) g.addColorStop(t, css(col, a ?? 1));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath();
    c.fill();
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, col: Rgb, a = 1): void {
    if (this.dry) return;
    const c = this.c;
    c.fillStyle = css(col, a);
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fill();
  }

  ell(cx: number, cy: number, rx: number, ry: number, col: Rgb, a = 1): void {
    if (this.dry) return;
    const c = this.c;
    c.fillStyle = css(col, a);
    c.beginPath();
    c.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
    c.fill();
  }

  line(x0: number, y0: number, x1: number, y1: number, col: Rgb, w = 0.6, a = 1): void {
    if (this.dry) return;
    const c = this.c;
    c.strokeStyle = css(col, a);
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
  }

  /** A sagging cable between two points. */
  wire(x0: number, y0: number, x1: number, y1: number, sag: number, col: Rgb, w = 0.9, a = 1): void {
    if (this.dry) return;
    const c = this.c;
    c.strokeStyle = css(col, a);
    c.lineWidth = w;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x0, y0);
    c.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + sag, x1, y1);
    c.stroke();
  }

  /** A soft elliptical blob (radial falloff): shadows, stains, glows baked into the picture. */
  soft(cx: number, cy: number, rx: number, ry: number, col: Rgb, a: number, mode: GlobalCompositeOperation = 'source-over'): void {
    if (this.dry) return;
    const c = this.c;
    c.save();
    c.globalCompositeOperation = mode;
    c.translate(cx, cy);
    c.scale(rx, ry);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, css(col, a));
    g.addColorStop(0.55, css(col, a * 0.42));
    g.addColorStop(1, css(col, 0));
    c.fillStyle = g;
    c.fillRect(-1, -1, 2, 2);
    c.restore();
  }

  /** Contact shadow under something standing on the floor. */
  shadow(cx: number, y: number, rx: number, a = 0.4): void {
    this.soft(cx, y, rx * 1.15, Math.max(1.6, rx * 0.2), 0x000000, a);
  }

  /** Clips the next draw calls to a rectangle (call `unclip` after). */
  clip(x: number, y: number, w: number, h: number): void {
    if (this.dry) return;
    const c = this.c;
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
  }
  unclip(): void {
    if (this.dry) return;
    this.c.restore();
  }

  /**
   * A front-facing solid with a lit top face and a darker side (cabinets, crates, machines), lit from above and a little from the left.
   * (x, bottom) is the front-bottom-left corner, `d` how far the top recedes.
   */
  box(x: number, bottom: number, w: number, h: number, col: Rgb, d = 5, o: { top?: Rgb; side?: Rgb; shadow?: boolean; noside?: boolean } = {}): void {
    if (this.dry) return;
    const top = bottom - h;
    if (o.shadow !== false) this.shadow(x + w / 2, bottom + 0.5, w * 0.55, 0.38);
    this.poly([x, top, x + w, top, x + w + d * 0.6, top - d, x + d * 0.6, top - d], o.top ?? shade(col, 1.22));
    if (!o.noside) this.poly([x + w, top, x + w + d * 0.6, top - d, x + w + d * 0.6, bottom - d, x + w, bottom], o.side ?? shade(col, 0.62));
    this.rectG(x, top, w, h, [[0, shade(col, 1.06)], [1, shade(col, 0.82)]]);
    this.rect(x, top, w, 0.5, 0xffffff, 0.16);
    this.rect(x, top, 0.5, h, 0xffffff, 0.08);
  }

  /** An upright cylinder seen from the front (tank, drum, barrel). */
  cyl(cx: number, bottom: number, r: number, h: number, col: Rgb, topCol?: Rgb): void {
    if (this.dry) return;
    const ry = r * 0.3;
    this.shadow(cx, bottom + 0.5, r * 1.05, 0.38);
    this.ell(cx, bottom, r, ry, shade(col, 0.6));
    this.rectG(cx - r, bottom - h, r * 2, h, [[0, shade(col, 0.62)], [0.28, shade(col, 1.12)], [0.6, col], [1, shade(col, 0.55)]], true);
    this.ell(cx, bottom - h, r, ry, topCol ?? shade(col, 1.25));
    this.ell(cx, bottom - h, r * 0.78, ry * 0.7, shade(col, 0.9), 0.6);
  }

  /** Speckle: n dots of `col` over a rectangle (grime, rust, concrete grain, cloth). */
  speckle(x: number, y: number, w: number, h: number, col: Rgb, n: number, a = 0.3, size = 0.45): void {
    if (this.dry) return;
    const c = this.c;
    c.fillStyle = css(col, a);
    for (let i = 0; i < n; i++) c.fillRect(x + this.vr() * w, y + this.vr() * h, size, size);
  }

  rivets(x: number, y: number, w: number, n: number, col: Rgb = 0x000000, a = 0.35): void {
    if (this.dry) return;
    for (let i = 0; i < n; i++) this.ell(x + (w * (i + 0.5)) / n, y, 0.45, 0.45, col, a);
  }

  /** Diagonal hazard stripes in a rectangle. */
  stripes(x: number, y: number, w: number, h: number, c1: Rgb, c2: Rgb, period = 6): void {
    if (this.dry) return;
    this.clip(x, y, w, h);
    this.rect(x, y, w, h, c2);
    for (let sx = x - h; sx < x + w + h; sx += period) this.poly([sx, y + h, sx + period / 2, y + h, sx + period / 2 + h, y, sx + h, y], c1);
    this.unclip();
  }

  // ---------------------------------------------------------------- wear

  stain(x: number, y: number, r: number, col: Rgb = 0x000000, a = 0.3): void {
    this.soft(x, y, r, r * (0.6 + this.vr() * 0.5), col, a);
  }

  /** A rust/water streak running down from (x, y). */
  streak(x: number, y: number, len: number, col: Rgb = 0x5a3a20, a = 0.35): void {
    if (this.dry) return;
    const c = this.c;
    const g = c.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, css(col, a));
    g.addColorStop(1, css(col, 0));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - 0.9, y);
    c.lineTo(x + 0.9, y);
    c.lineTo(x + 0.3 + this.vr() * 0.5, y + len);
    c.lineTo(x - 0.3, y + len);
    c.closePath();
    c.fill();
  }

  crack(x: number, y: number, len: number, a = 0.5): void {
    if (this.dry) return;
    const c = this.c;
    c.strokeStyle = css(0x000000, a);
    c.lineWidth = 0.4;
    c.beginPath();
    c.moveTo(x, y);
    let cx = x, cy = y;
    for (let i = 0; i < 6; i++) {
      cx += (this.vr() - 0.5) * len * 0.35;
      cy += len / 6;
      c.lineTo(cx, cy);
    }
    c.stroke();
  }

  /** Chalk tally marks (groups of four with a slash), a wall counter. */
  tally(x: number, y: number, groups: number, col: Rgb = 0xd8d2c0): void {
    if (this.dry) return;
    for (let g = 0; g < groups; g++) {
      const gx = x + g * 6;
      for (let i = 0; i < 4; i++) this.line(gx + i * 1.1, y, gx + i * 1.1, y + 4.5, col, 0.35, 0.7);
      this.line(gx - 0.4, y + 3.6, gx + 4, y + 0.9, col, 0.35, 0.7);
    }
  }

  // ---------------------------------------------------------------- signs and pictograms

  /**
   * An enamel signage plate with a pictogram (no text: rooms are mirrored for every second neighbour and the game is bilingual).
   * `col` is the plate's colour, `ink` the pictogram's.
   */
  plate(cx: number, cy: number, w: number, h: number, icon: IconName, col: Rgb, ink: Rgb = 0xe8e0c8): void {
    if (this.dry) return;
    const x = cx - w / 2, y = cy - h / 2;
    this.shadow(cx, y + h + 0.8, w * 0.5, 0.2);
    this.roundRect(x - 0.7, y - 0.7, w + 1.4, h + 1.4, 1.2, 0x15110e, 0.85);
    this.rectG(x, y, w, h, [[0, shade(col, 1.12)], [1, shade(col, 0.82)]]);
    this.rect(x + 0.6, y + 0.6, w - 1.2, 0.5, 0xffffff, 0.18);
    this.c.strokeStyle = css(ink, 0.7);
    this.c.lineWidth = 0.35;
    this.c.strokeRect(x + 1.2, y + 1.2, w - 2.4, h - 2.4);
    this.rivets(x + 0.6, y + 0.6, w - 1.2, 2, 0x000000, 0.4);
    this.rivets(x + 0.6, y + h - 0.6, w - 1.2, 2, 0x000000, 0.4);
    this.speckle(x, y, w, h, 0x000000, Math.round(w * h * 0.15), 0.18);
    this.icon(icon, cx, cy, Math.min(w, h) * 0.34, ink);
  }

  icon(name: IconName, cx: number, cy: number, s: number, col: Rgb, a = 0.92): void {
    if (this.dry) return;
    const c = this.c;
    c.save();
    c.translate(cx, cy);
    c.scale(s, s);
    c.fillStyle = css(col, a);
    c.strokeStyle = css(col, a);
    c.lineWidth = 0.16;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    ICONS[name](c);
    c.restore();
  }

  // ---------------------------------------------------------------- light

  /**
   * A ceiling or wall fixture that lights the room: draws the fixture, cuts its pool into the darkness of the light pass and records
   * the live glow spot (so paintedRoom.ts flickers it with the power). Positions in units; returns nothing.
   */
  lamp(kind: 'bulb' | 'tube' | 'led' | 'desk' | 'flood', x: number, y: number, o: { color?: Rgb; r?: number; flicker?: number; pool?: number; w?: number; live?: boolean; cone?: number } = {}): void {
    const col = o.color ?? this.pal.light;
    const r = o.r ?? 30;
    const live = o.live !== false;
    if (!this.dry) {
      if (kind === 'bulb') {
        this.line(x, 0, x, y - 3, 0x1a1a1a, 0.5);
        this.poly([x - 2.6, y - 3, x + 2.6, y - 3, x + 1.8, y - 0.5, x - 1.8, y - 0.5], 0x23221f);
        this.ell(x, y + 0.6, 2, 2.1, mix(col, 0xffffff, 0.45));
        this.ell(x, y + 0.6, 3.6, 3.6, col, 0.28);
      } else if (kind === 'tube') {
        const w = o.w ?? 22;
        this.line(x - w / 2 + 3, y - 4, x - w / 2 + 3, y - 0.5, 0x222222, 0.4);
        this.line(x + w / 2 - 3, y - 4, x + w / 2 - 3, y - 0.5, 0x222222, 0.4);
        this.roundRect(x - w / 2, y - 1, w, 2.8, 1, 0x2a2b2d);
        this.roundRect(x - w / 2 + 1, y + 0.2, w - 2, 1.6, 0.8, mix(col, 0xffffff, 0.6));
      } else if (kind === 'led') {
        const w = o.w ?? 26;
        this.roundRect(x - w / 2, y - 0.6, w, 2, 1, 0x3a3d42);
        this.roundRect(x - w / 2 + 0.6, y + 0.2, w - 1.2, 1, 0.5, mix(col, 0xffffff, 0.75));
      } else if (kind === 'desk') {
        this.line(x, y, x + 3, y - 6, 0x2a2a2a, 0.7);
        this.line(x + 3, y - 6, x + 7, y - 4.5, 0x2a2a2a, 0.7);
        this.poly([x + 5, y - 5.6, x + 9.2, y - 4.2, x + 8, y - 1.8, x + 4, y - 3.2], 0x2f4a34);
        this.ell(x + 6.6, y - 2.6, 1.6, 0.9, mix(col, 0xffffff, 0.5));
      } else {
        this.box(x - 3.5, y + 3, 7, 5, 0x3a3a3a, 2, { shadow: false });
        this.ell(x, y + 0.3, 2.4, 1.8, mix(col, 0xffffff, 0.6));
      }
    }
    const pool = o.pool ?? 1;
    const falls = kind === 'desk' ? 0.55 : 1;
    this.cuts.push({ x, y: Math.min(this.inB - 14, y + r * 0.55), rx: r * 0.95 * pool, ry: r * 0.8 * pool, a: 0.95 * falls });
    this.cuts.push({ x, y: this.H - 9, rx: r * 1.05 * pool, ry: r * 0.3 * pool, a: 0.9 * falls });
    if (kind !== 'desk' && (o.cone ?? 1) > 0) this.cones.push({ x, y: y + 1, w0: 6, w1: r * 1.7 * pool, yb: this.H - 3, a: 0.5 * (o.cone ?? 1) });
    this.warm.push({ x, y: y + r * 0.5, rx: r * 0.85 * pool, ry: r * 0.7 * pool, color: col, a: 0.3 * falls });
    this.warm.push({ x, y: this.H - 8, rx: r * 1.05 * pool, ry: r * 0.26 * pool, color: col, a: 0.32 * falls });
    if (live) this.meta.lights.push({ x: x / this.W, y: y / this.H, r: (r * 0.62) / this.W, color: col, flicker: o.flicker ?? 0.25 });
  }

  /** A small lit thing (screen, indicator panel, fire, candle): a pool in the darkness and, with `live`, a glow spot of its own. */
  glow(x: number, y: number, r: number, col: Rgb, o: { a?: number; live?: boolean; flicker?: number } = {}): void {
    this.cuts.push({ x, y, rx: r, ry: r * 0.85, a: o.a ?? 0.8 });
    this.warm.push({ x, y, rx: r * 0.9, ry: r * 0.8, color: col, a: (o.a ?? 0.8) * 0.2 });
    if (o.live) this.meta.lights.push({ x: x / this.W, y: y / this.H, r: (r * 0.7) / this.W, color: col, flicker: o.flicker ?? 0 });
  }

  // ---------------------------------------------------------------- live effects, spots, set data (layout calls: both passes)

  /** A live effect for paintedRoom.ts anchored in units (converted to the picture's fractions). `work` ties it to the room being staffed. */
  fx(kind: FxSpot['kind'], x: number, y: number, o: { color?: Rgb; size?: number; w?: number; h?: number; to?: number; ring?: number; rate?: number; a?: number; amp?: number; band?: boolean; work?: boolean; n?: number } = {}): void {
    const s: FxSpot = { kind, x: x / this.W, y: y / this.H };
    if (o.color !== undefined) s.color = o.color;
    if (o.size !== undefined) s.size = o.size / this.W;
    if (o.w !== undefined) s.w = o.w / this.W;
    if (o.h !== undefined) s.h = o.h / this.H;
    if (o.to !== undefined) s.to = o.to / this.H;
    if (o.ring !== undefined) s.ring = o.ring / this.W;
    if (o.rate !== undefined) s.rate = o.rate;
    if (o.a !== undefined) s.a = o.a;
    if (o.amp !== undefined) s.amp = o.amp;
    if (o.band !== undefined) s.band = o.band;
    if (o.work) s.work = true;
    if (o.n !== undefined) s.n = o.n;
    this.meta.fx.push(s);
  }

  /** Where a survivor stands to work: `x` a FRACTION of the room's width (workSpots.ts' own unit), `face` the side the equipment is on. */
  spot(x: number, face: 1 | -1, act?: string, depth?: number): void {
    this.meta.spots.push([x, face, act, depth]);
  }
  /** A mattress to sleep on (y = mattress top in units, head = side of the pillow). */
  bed(x: number, y: number, head: -1 | 1): void {
    this.meta.beds.push({ x: x / this.W, y: y / this.H, head });
  }
  /** A place to sit or eat (y = seat surface). */
  seat(x: number, y: number, face: 1 | -1, kind: 'sit' | 'eat' = 'sit'): void {
    this.meta.seats.push({ x: x / this.W, y: y / this.H, face, kind });
  }

  /** Tier B: stamps a kit sprite (only if it is decoded already; returns whether it was drawn so the caller can draw a fallback). */
  stamp(key: string, x: number, y: number, w: number, h: number, a = 1): boolean {
    if (this.dry) return true;
    const img = this.stampSource?.(key);
    if (!img) return false;
    this.c.save();
    this.c.globalAlpha = a;
    this.c.drawImage(img, x, y, w, h);
    this.c.restore();
    return true;
  }

  /** Picks by tier: `t(a, b, c)` returns the value for the room's level. */
  t<T>(a: T, b: T, c: T): T {
    return this.tier === 0 ? a : this.tier === 1 ? b : c;
  }
}

// ---------------------------------------------------------------- pictograms (drawn in a -1..1 box)

export type IconName =
  | 'bolt' | 'book' | 'cog' | 'drop' | 'mushroom' | 'shield' | 'cross' | 'sun' | 'wind' | 'tower' | 'wrench' | 'recycle' | 'coin'
  | 'apple' | 'flame' | 'bio' | 'block' | 'cup' | 'chevrons' | 'fish' | 'truck' | 'steam' | 'bed' | 'eye' | 'star'
  // [plan4:BL-7] wave 3: data center, forum, seed lab, vault, geothermal vent
  | 'chip' | 'columns' | 'leaf' | 'vault' | 'vent' | 'anvil';

const ICONS: Record<IconName, (c: Ctx2D) => void> = {
  bolt: c => { c.beginPath(); c.moveTo(0.25, -1); c.lineTo(-0.55, 0.12); c.lineTo(-0.05, 0.12); c.lineTo(-0.3, 1); c.lineTo(0.6, -0.2); c.lineTo(0.08, -0.2); c.closePath(); c.fill(); },
  book: c => { c.beginPath(); c.moveTo(-0.95, -0.55); c.quadraticCurveTo(-0.45, -0.8, 0, -0.45); c.quadraticCurveTo(0.45, -0.8, 0.95, -0.55); c.lineTo(0.95, 0.65); c.quadraticCurveTo(0.45, 0.4, 0, 0.75); c.quadraticCurveTo(-0.45, 0.4, -0.95, 0.65); c.closePath(); c.fill(); },
  cog: c => {
    c.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; c.lineTo(Math.cos(a - 0.2) * 0.72, Math.sin(a - 0.2) * 0.72); c.lineTo(Math.cos(a - 0.14) * 0.98, Math.sin(a - 0.14) * 0.98); c.lineTo(Math.cos(a + 0.14) * 0.98, Math.sin(a + 0.14) * 0.98); c.lineTo(Math.cos(a + 0.2) * 0.72, Math.sin(a + 0.2) * 0.72); }
    c.closePath(); c.fill();
    c.globalAlpha = 0.9; c.fillStyle = 'rgba(0,0,0,0.55)'; c.beginPath(); c.arc(0, 0, 0.32, 0, Math.PI * 2); c.fill();
  },
  drop: c => { c.beginPath(); c.moveTo(0, -1); c.bezierCurveTo(0.9, 0.1, 0.8, 0.95, 0, 0.95); c.bezierCurveTo(-0.8, 0.95, -0.9, 0.1, 0, -1); c.fill(); },
  mushroom: c => { c.beginPath(); c.ellipse(0, -0.2, 0.95, 0.7, 0, Math.PI, 0); c.closePath(); c.fill(); c.fillRect(-0.28, -0.2, 0.56, 0.95); },
  shield: c => { c.beginPath(); c.moveTo(0, -1); c.lineTo(0.85, -0.7); c.lineTo(0.8, 0.1); c.quadraticCurveTo(0.6, 0.7, 0, 1); c.quadraticCurveTo(-0.6, 0.7, -0.8, 0.1); c.lineTo(-0.85, -0.7); c.closePath(); c.fill(); },
  cross: c => { c.fillRect(-0.3, -0.95, 0.6, 1.9); c.fillRect(-0.95, -0.3, 1.9, 0.6); },
  sun: c => { c.beginPath(); c.arc(0, 0, 0.5, 0, Math.PI * 2); c.fill(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; c.beginPath(); c.moveTo(Math.cos(a) * 0.72, Math.sin(a) * 0.72); c.lineTo(Math.cos(a) * 1, Math.sin(a) * 1); c.lineWidth = 0.2; c.stroke(); } },
  wind: c => { c.lineWidth = 0.2; for (const [y, l] of [[-0.55, 0.9], [0, 1], [0.55, 0.7]] as const) { c.beginPath(); c.moveTo(-1, y); c.lineTo(l - 0.3, y); c.arc(l - 0.3, y - 0.22, 0.22, Math.PI / 2, -Math.PI * 0.6, true); c.stroke(); } },
  tower: c => { c.beginPath(); c.moveTo(-0.35, 1); c.lineTo(-0.2, -0.3); c.lineTo(0.2, -0.3); c.lineTo(0.35, 1); c.closePath(); c.fill(); c.fillRect(-0.6, -0.8, 1.2, 0.5); c.fillRect(-0.75, -0.9, 1.5, 0.15); },
  wrench: c => { c.save(); c.rotate(-0.8); c.fillRect(-0.18, -0.4, 0.36, 1.4); c.beginPath(); c.arc(0, -0.55, 0.5, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(-0.16, -1.1, 0.32, 0.55); c.restore(); },
  recycle: c => {
    c.lineWidth = 0.34;
    c.lineCap = 'butt';
    for (let i = 0; i < 3; i++) {
      const a0 = (i / 3) * Math.PI * 2 - Math.PI / 2 + 0.25, a1 = a0 + 1.55;
      c.beginPath(); c.arc(0, 0, 0.68, a0, a1); c.stroke();
      const ex = Math.cos(a1) * 0.68, ey = Math.sin(a1) * 0.68, tx = -Math.sin(a1), ty = Math.cos(a1);
      c.beginPath(); c.moveTo(ex + tx * 0.52, ey + ty * 0.52); c.lineTo(ex - Math.cos(a1) * 0.45, ey - Math.sin(a1) * 0.45); c.lineTo(ex + Math.cos(a1) * 0.45, ey + Math.sin(a1) * 0.45); c.closePath(); c.fill();
    }
  },
  coin: c => { c.beginPath(); c.arc(0, 0, 0.9, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.arc(0, 0, 0.62, 0, Math.PI * 2); c.lineWidth = 0.12; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.stroke(); c.fillRect(-0.12, -0.42, 0.24, 0.84); },
  apple: c => { c.beginPath(); c.arc(-0.28, 0.1, 0.62, 0, Math.PI * 2); c.arc(0.28, 0.1, 0.62, 0, Math.PI * 2); c.fill(); c.fillRect(-0.06, -0.85, 0.12, 0.5); c.beginPath(); c.ellipse(0.32, -0.62, 0.3, 0.14, -0.5, 0, Math.PI * 2); c.fill(); },
  flame: c => { c.beginPath(); c.moveTo(0, -1); c.bezierCurveTo(0.2, -0.45, 0.85, -0.2, 0.7, 0.4); c.bezierCurveTo(0.6, 0.9, 0.2, 1, 0, 1); c.bezierCurveTo(-0.5, 1, -0.8, 0.6, -0.65, 0.1); c.bezierCurveTo(-0.55, -0.2, -0.2, -0.3, 0, -1); c.fill(); },
  bio: c => { c.lineWidth = 0.22; for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 - Math.PI / 2; c.beginPath(); c.arc(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.48, 0, Math.PI * 2); c.stroke(); } c.beginPath(); c.arc(0, 0, 0.17, 0, Math.PI * 2); c.fill(); },
  block: c => { c.fillRect(-0.9, -0.1, 0.85, 0.85); c.fillRect(0.05, -0.1, 0.85, 0.85); c.fillRect(-0.4, -0.95, 0.85, 0.8); },
  cup: c => { c.beginPath(); c.moveTo(-0.6, -0.5); c.lineTo(0.5, -0.5); c.lineTo(0.4, 0.7); c.quadraticCurveTo(0, 0.95, -0.5, 0.7); c.closePath(); c.fill(); c.lineWidth = 0.2; c.beginPath(); c.arc(0.55, 0, 0.3, -1.2, 1.2); c.stroke(); },
  chevrons: c => { c.lineWidth = 0.32; for (const y of [-0.5, 0.05, 0.6]) { c.beginPath(); c.moveTo(-0.75, y + 0.35); c.lineTo(0, y - 0.25); c.lineTo(0.75, y + 0.35); c.stroke(); } },
  fish: c => { c.beginPath(); c.ellipse(-0.1, 0, 0.8, 0.45, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.moveTo(0.55, 0); c.lineTo(1, -0.45); c.lineTo(1, 0.45); c.closePath(); c.fill(); },
  truck: c => { c.fillRect(-1, -0.55, 1.2, 0.9); c.beginPath(); c.moveTo(0.3, -0.25); c.lineTo(0.7, -0.25); c.lineTo(1, 0.1); c.lineTo(1, 0.35); c.lineTo(0.3, 0.35); c.closePath(); c.fill(); c.beginPath(); c.arc(-0.5, 0.5, 0.26, 0, Math.PI * 2); c.arc(0.55, 0.5, 0.26, 0, Math.PI * 2); c.fill(); },
  steam: c => { c.lineWidth = 0.22; for (const x of [-0.55, 0, 0.55]) { c.beginPath(); c.moveTo(x, 0.9); c.bezierCurveTo(x - 0.3, 0.4, x + 0.3, 0.1, x, -0.4); c.bezierCurveTo(x - 0.2, -0.7, x + 0.1, -0.85, x, -1); c.stroke(); } },
  bed: c => { c.fillRect(-1, 0.1, 2, 0.4); c.fillRect(-1, -0.6, 0.25, 1.1); c.fillRect(0.75, 0.1, 0.25, 0.6); c.beginPath(); c.ellipse(-0.45, -0.05, 0.28, 0.2, 0, 0, Math.PI * 2); c.fill(); },
  eye: c => { c.beginPath(); c.moveTo(-1, 0); c.quadraticCurveTo(0, -0.95, 1, 0); c.quadraticCurveTo(0, 0.95, -1, 0); c.fill(); c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.arc(0, 0, 0.32, 0, Math.PI * 2); c.fill(); },
  chip: c => {
    c.fillRect(-0.55, -0.55, 1.1, 1.1);
    c.lineWidth = 0.18;
    for (const k of [-0.33, 0, 0.33]) { c.beginPath(); c.moveTo(k, -0.55); c.lineTo(k, -0.95); c.moveTo(k, 0.55); c.lineTo(k, 0.95); c.moveTo(-0.55, k); c.lineTo(-0.95, k); c.moveTo(0.55, k); c.lineTo(0.95, k); c.stroke(); }
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(-0.28, -0.28, 0.56, 0.56);
  },
  columns: c => { c.fillRect(-0.95, -0.9, 1.9, 0.28); c.fillRect(-0.95, 0.62, 1.9, 0.28); for (const x of [-0.7, -0.23, 0.23, 0.7]) c.fillRect(x - 0.1, -0.62, 0.2, 1.24); c.beginPath(); c.moveTo(-1, -0.9); c.lineTo(0, -1.15); c.lineTo(1, -0.9); c.closePath(); c.fill(); },
  leaf: c => { c.beginPath(); c.moveTo(-0.85, 0.85); c.bezierCurveTo(-1, -0.3, -0.2, -0.95, 0.95, -0.9); c.bezierCurveTo(1, 0.2, 0.3, 0.9, -0.85, 0.85); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 0.14; c.beginPath(); c.moveTo(-0.8, 0.8); c.lineTo(0.45, -0.45); c.stroke(); },
  vault: c => { c.beginPath(); c.arc(0, 0, 0.95, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.arc(0, 0, 0.62, 0, Math.PI * 2); c.fill(); c.fillStyle = c.strokeStyle; for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 - Math.PI / 2; c.fillRect(Math.cos(a) * 0.3 - 0.07, Math.sin(a) * 0.3 - 0.07, 0.14, 0.14); c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 0.55, Math.sin(a) * 0.55); c.lineWidth = 0.14; c.stroke(); } },
  anvil: c => { c.beginPath(); c.moveTo(-1, -0.45); c.lineTo(0.55, -0.45); c.lineTo(1, -0.7); c.lineTo(1, -0.1); c.lineTo(0.45, -0.1); c.lineTo(0.35, 0.3); c.lineTo(0.7, 0.3); c.lineTo(0.7, 0.75); c.lineTo(-0.7, 0.75); c.lineTo(-0.7, 0.3); c.lineTo(-0.35, 0.3); c.lineTo(-0.3, -0.1); c.lineTo(-1, -0.1); c.closePath(); c.fill(); },
  vent: c => { c.beginPath(); c.moveTo(-0.9, 0.95); c.lineTo(-0.35, -0.1); c.lineTo(0.35, -0.1); c.lineTo(0.9, 0.95); c.closePath(); c.fill(); c.lineWidth = 0.2; for (const x of [-0.4, 0.05, 0.5]) { c.beginPath(); c.moveTo(x, -0.3); c.bezierCurveTo(x - 0.3, -0.55, x + 0.3, -0.7, x, -1); c.stroke(); } },
  star: c => { c.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 0.45 : 1; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); },
};

// ---------------------------------------------------------------- shell (back wall, ceiling, floor, side walls)

function drawShell(p: Painter, spec: RoomSpec): void {
  if (p.dry) return;
  const { W, H, inL, inR, inT, inB, tier } = p;
  const wallC = mute(spec.pal.wall, p.t(0.35, 0.18, 0.05));
  const wall = p.t(shade(wallC, 0.86), wallC, shade(mix(wallC, 0xb8bcc0, 0.22), 1.08));
  const floor = p.t(shade(spec.pal.floor, 0.85), spec.pal.floor, mix(spec.pal.floor, 0x8a8e94, 0.2));
  const acc = spec.pal.accent;
  // Back wall: plaster above, a darker panelled wainscot below.
  p.rectG(inL, inT, inR - inL, inB - inT, [[0, shade(wall, 1.14)], [0.6, wall], [1, shade(wall, 0.78)]]);
  const wains = inB - 27;
  p.rectG(inL, wains, inR - inL, inB - wains, [[0, shade(wall, 0.74)], [1, shade(wall, 0.58)]]);
  p.rect(inL, wains, inR - inL, 1, 0xffffff, 0.14);
  p.rect(inL, wains + 1, inR - inL, 1, 0x000000, 0.25);
  for (let x = inL + 23; x < inR - 4; x += 23) {
    p.rect(x, inT, 0.8, inB - inT, 0x000000, 0.28);
    p.rect(x + 0.8, inT, 0.5, inB - inT, 0xffffff, 0.06);
  }
  p.rivets(inL + 2, inT + 3, inR - inL - 4, Math.round((inR - inL) / 8), 0x000000, 0.22);
  // Accent band: faded and broken when salvaged, crisp when restored, a lit trim when advanced.
  const ay = inT + (inB - inT) * 0.5;
  if (tier === 0) {
    for (let x = inL; x < inR; x += 9) if (p.vr() > 0.35) p.rect(x, ay, 5 + p.vr() * 4, 2.6, acc, 0.3);
  } else if (tier === 1) {
    p.rect(inL, ay, inR - inL, 3, acc, 0.55);
    p.rect(inL, ay + 3, inR - inL, 0.6, 0x000000, 0.3);
  } else {
    p.rect(inL, ay, inR - inL, 1.4, mix(acc, 0xffffff, 0.35), 0.8);
  }
  // Ceiling: a dark slab with beams running to the back wall.
  p.polyG([0, 0, W, 0, inR, inT, inL, inT], 0, inT, [[0, shade(wall, 0.3)], [1, shade(wall, 0.5)]]);
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    p.line(W * t, 0, inL + (inR - inL) * t, inT, 0x000000, 0.7, 0.35);
  }
  p.rect(inL, inT, inR - inL, 2.5, 0x000000, 0.3);
  // Pipes along the top of the back wall: salvaged rooms have more of them and rustier.
  const pipes = p.t(3, 2, 1);
  for (let i = 0; i < pipes; i++) {
    const y = inT + 3 + i * 3.3;
    const col = i === 0 ? p.t(0x6a5648, 0x56606a, 0x8a9096) : p.t(0x4e463e, 0x4a4e54, 0x6a6e74);
    p.rectG(inL, y, inR - inL, 2.4, [[0, shade(col, 1.25)], [0.5, col], [1, shade(col, 0.55)]]);
    for (let x = inL + 10; x < inR; x += 26) p.rect(x, y - 0.4, 1.4, 3.2, 0x1a1a1a, 0.6);
  }
  // Floor: darker toward the back, tile joints running to the vanishing point.
  p.polyG([inL, inB, inR, inB, W, H, 0, H], inB, H, [[0, shade(floor, 0.62)], [0.5, shade(floor, 0.86)], [1, shade(floor, 1.06)]]);
  const vx = W / 2;
  for (let i = -4; i <= 4; i++) {
    const bx = vx + i * (W / 5);
    p.line(vx + (bx - vx) * 0.27, inB, bx, H, 0x000000, 0.5, 0.22);
  }
  for (const t of [0.22, 0.5, 0.82]) {
    const y = inB + (H - inB) * t;
    p.line(inL * (1 - t), y, inR + (W - inR) * t, y, 0x000000, 0.5, 0.25);
  }
  // Side walls, darker toward the viewer.
  p.polyG([0, 0, inL, inT, inL, inB, 0, H], 0, H, [[0, shade(wall, 0.7)], [1, shade(wall, 0.42)]]);
  p.polyG([inR, inT, W, 0, W, H, inR, inB], 0, H, [[0, shade(wall, 0.58)], [1, shade(wall, 0.36)]]);
  p.line(inL, inT, inL, inB, 0xffffff, 0.5, 0.1);
  // Ambient occlusion where the wall meets the floor and the ceiling.
  p.rectG(inL, inB - 14, inR - inL, 14, [[0, 0x000000, 0], [1, 0x000000, 0.34]]);
  p.rectG(inL, inB, inR - inL, 5, [[0, 0x000000, 0.4], [1, 0x000000, 0]]);
  p.rectG(inL, inT, inR - inL, 8, [[0, 0x000000, 0.35], [1, 0x000000, 0]]);
  // Wear: stains and rust runs, plenty when salvaged, a few when restored, almost none when advanced.
  const wear = p.t(7, 3, 1);
  for (let i = 0; i < wear; i++) {
    const sx = inL + 6 + p.vr() * (inR - inL - 12);
    p.stain(sx, inT + 12 + p.vr() * (inB - inT - 24), 6 + p.vr() * 9, p.vr() > 0.5 ? 0x2a1c10 : 0x000000, 0.22);
    if (p.vr() > 0.4) p.streak(sx, inT + 8, 14 + p.vr() * 22, 0x6a4020, 0.3);
  }
  if (tier === 0) {
    p.crack(inL + 8 + p.vr() * (inR - inL - 20), inT + 14, 22);
    for (let i = 0; i < 3; i++) p.stain(8 + p.vr() * (W - 16), H - 5 - p.vr() * 5, 9, 0x000000, 0.18); // grime on the floor
  }
  // Floor drain and a puddle of lamp light is added by the light pass.
  p.ell(W * (0.3 + p.vr() * 0.4), H - 7, 5, 1.4, 0x000000, 0.28);
}

/** The open-air variant of the shell: a dusk sky with a low sun and a ruined skyline, concrete ground in front. */
function drawSky(p: Painter, spec: RoomSpec): void {
  if (p.dry) return;
  const { W, H, inB, tier } = p;
  const haze = p.t(0.35, 0.18, 0.0);
  p.rectG(0, 0, W, inB + 2, [[0, mix(0x1c2840, 0x4a4236, haze)], [0.55, mix(0x4a5c78, 0x7a6a58, haze)], [1, mix(0xc09468, 0x9a7c5e, haze)]]);
  const sx = W * 0.3;
  p.soft(sx, inB - 22, 44, 34, 0xffd49a, 0.55);
  p.ell(sx, inB - 22, 6.5, 6.5, 0xfff0d2, 0.95);
  // Two layers of broken skyline, the far one hazier.
  for (const [layer, col, base, amp] of [[0, 0x6a6460, inB - 6, 22], [1, 0x3a3836, inB, 30]] as const) {
    let x = layer ? -4 : -10;
    while (x < W) {
      const w = 6 + p.vr() * 12, h = 6 + p.vr() * amp;
      p.rect(x, base - h, w, h + 6, col, layer ? 0.96 : 0.7);
      if (p.vr() > 0.5) p.rect(x + w * 0.2, base - h - 3, w * 0.35, 3, col, layer ? 0.96 : 0.7);
      for (let wy = base - h + 3; wy < base - 3; wy += 5) if (p.vr() > 0.78) p.rect(x + 1.5 + p.vr() * (w - 4), wy, 1.2, 1.4, 0xe8b868, layer ? 0.5 : 0.2);
      x += w + p.vr() * 3;
    }
  }
  // The pad: concrete and rubble, with a darker edge toward the viewer.
  p.polyG([0, inB, W, inB, W, H, 0, H], inB, H, [[0, 0x5a544c], [0.4, 0x433e38], [1, 0x2c2825]]);
  p.rect(0, inB, W, 1, 0xffffff, 0.12);
  for (let i = 0; i < 5; i++) p.line(p.vr() * W, inB + 2, p.vr() * W, H, 0x000000, 0.4, 0.2);
  p.speckle(0, inB, W, H - inB, 0x000000, 140, 0.35, 0.7);
  p.speckle(0, inB, W, H - inB, 0x8a8478, 60, 0.25, 0.7);
  // Steel edge posts like every other room, so the row reads as a set.
  p.polyG([0, 0, 6, 0, 6, H, 0, H], 0, H, [[0, 0x2a2b2f], [1, 0x1c1d20]]);
  p.polyG([W - 6, 0, W, 0, W, H, W - 6, H], 0, H, [[0, 0x2a2b2f], [1, 0x1c1d20]]);
  void spec;
  void tier;
}

/**
 * [plan4:BL-7] The cavern variant of the shell (districts): a back wall of rock with strata and boulders, a jagged ceiling with stalactites,
 * an uneven floor, side walls of broken rock. `pal.wall` is the rock, `pal.floor` the ground, `pal.accent` tints the strata.
 * One draw, the same budget as the room shell; the spec then adds its own features (vents, a vault door, shelves) on top.
 */
function drawCavern(p: Painter, spec: RoomSpec): void {
  if (p.dry) return;
  const { W, H, inB } = p;
  const rock = mute(spec.pal.wall, 0.2);
  const ground = spec.pal.floor;
  // Back wall: lit a little from above, sinking into darkness at the floor.
  p.rectG(0, 0, W, inB + 4, [[0, shade(rock, 1.05)], [0.5, shade(rock, 0.85)], [1, shade(rock, 0.55)]]);
  // Strata: long horizontal bands that wander a little, slightly lighter and darker alternately.
  for (let i = 0; i < 9; i++) {
    const y = 10 + i * 8.5 + p.vr() * 3;
    const pts: number[] = [];
    for (let x = 0; x <= W; x += 14) pts.push(x, y + Math.sin(x * 0.07 + i * 1.7) * 1.8 + p.vr() * 0.8);
    const thick = 1.4 + p.vr() * 2.6;
    const band: number[] = [...pts];
    for (let k = pts.length - 2; k >= 0; k -= 2) band.push(pts[k], pts[k + 1] + thick);
    p.poly(band, i % 2 ? mix(rock, spec.pal.accent, 0.16) : shade(rock, 0.62), 0.38);
  }
  // Boulders and chips of the wall: soft blobs, lit on the upper left.
  for (let i = 0; i < 22; i++) {
    const bx = p.vr() * W, by = 8 + p.vr() * (inB - 14), r = 3 + p.vr() * 9;
    p.ell(bx, by, r, r * 0.7, shade(rock, 0.55 + p.vr() * 0.2), 0.45);
    p.ell(bx - r * 0.25, by - r * 0.2, r * 0.6, r * 0.38, shade(rock, 1.15), 0.2);
  }
  p.speckle(0, 0, W, inB, 0x000000, 260, 0.35, 0.7);
  p.speckle(0, 0, W, inB, mix(rock, 0xffffff, 0.35), 90, 0.22, 0.6);
  for (let i = 0; i < 4; i++) p.crack(10 + p.vr() * (W - 20), 8 + p.vr() * 20, 24 + p.vr() * 14, 0.5);
  // Ceiling: a heavy jagged mass with stalactites.
  const ceil: number[] = [0, 0, W, 0];
  for (let x = W; x >= 0; x -= 9) ceil.push(x, 7 + p.vr() * 9 + (x > W * 0.15 && x < W * 0.85 ? 0 : 5));
  p.polyG(ceil, 0, 18, [[0, shade(rock, 0.28)], [1, shade(rock, 0.5)]]);
  for (let i = 0; i < 9; i++) {
    const sx = 14 + (i * (W - 28)) / 8 + (p.vr() - 0.5) * 8, len = 5 + p.vr() * 11, w = 2 + p.vr() * 2.4;
    p.poly([sx - w, 9, sx + w, 9, sx + (p.vr() - 0.5) * 1.2, 9 + len], shade(rock, 0.4));
    p.poly([sx - w, 9, sx - w * 0.1, 9, sx + (p.vr() - 0.5) * 1.2, 9 + len], shade(rock, 0.7), 0.7);
  }
  // Floor: packed earth and rubble, darker toward the back where it meets the wall, with a crooked edge.
  const edge: number[] = [0, H, W, H];
  for (let x = W; x >= 0; x -= 8) edge.push(x, inB - 1 + Math.sin(x * 0.11) * 1.6 + p.vr() * 2);
  p.polyG(edge, inB - 3, H, [[0, shade(ground, 0.5)], [0.35, shade(ground, 0.8)], [1, shade(ground, 1.05)]]);
  p.rectG(0, inB - 6, W, 8, [[0, 0x000000, 0], [1, 0x000000, 0.3]]);
  p.speckle(0, inB, W, H - inB, 0x000000, 150, 0.4, 0.8);
  p.speckle(0, inB, W, H - inB, mix(ground, 0xffffff, 0.3), 70, 0.25, 0.7);
  for (let i = 0; i < 10; i++) p.ell(p.vr() * W, inB + 2 + p.vr() * (H - inB - 4), 1.2 + p.vr() * 3, 0.8 + p.vr() * 1.2, shade(ground, 0.55 + p.vr() * 0.5), 0.8);
  // Side walls: broken rock closing in toward the viewer.
  const left: number[] = [0, 0];
  for (let y = 0; y <= H; y += 8) left.push(6 + p.vr() * 7 + (1 - Math.abs(y - H / 2) / (H / 2)) * 4, y);
  left.push(0, H);
  p.polyG(left, 0, H, [[0, shade(rock, 0.4)], [1, shade(rock, 0.22)]]);
  const right: number[] = [W, 0];
  for (let y = 0; y <= H; y += 8) right.push(W - 6 - p.vr() * 7 - (1 - Math.abs(y - H / 2) / (H / 2)) * 4, y);
  right.push(W, H);
  p.polyG(right, 0, H, [[0, shade(rock, 0.34)], [1, shade(rock, 0.2)]]);
  // Wear by tier: raw caverns carry loose rubble; a developed one is swept, with only a few stones left.
  const rubble = p.t(9, 4, 2);
  for (let i = 0; i < rubble; i++) {
    const rx = 12 + p.vr() * (W - 24), ry = inB + 3 + p.vr() * 9, r = 1.4 + p.vr() * 2.6;
    p.shadow(rx, ry + 1, r, 0.3);
    p.ell(rx, ry, r, r * 0.7, shade(ground, 0.7 + p.vr() * 0.4));
    p.ell(rx - r * 0.2, ry - r * 0.25, r * 0.5, r * 0.3, 0xffffff, 0.12);
  }
}

// ---------------------------------------------------------------- light pass and finish

function lightPass(p: Painter, spec: RoomSpec, w: number, h: number): void {
  const S = COMPOSE_SCALE;
  const c = p.c;
  const dark = Math.max(0.3, Math.min(0.85, p.t(0.52, 0.42, 0.32) + (spec.dim ?? 0)));
  const lm = document.createElement('canvas');
  lm.width = w;
  lm.height = h;
  const lc = lm.getContext('2d')!;
  lc.scale(S, S);
  lc.fillStyle = css(0x120e0c, dark);
  lc.fillRect(0, 0, w / S, h / S);
  lc.globalCompositeOperation = 'destination-out';
  const pool = (x: number, y: number, rx: number, ry: number, a: number) => {
    lc.save();
    lc.translate(x, y);
    lc.scale(rx, ry);
    const g = lc.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(0.5, `rgba(0,0,0,${a * 0.6})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.fillRect(-1, -1, 2, 2);
    lc.restore();
  };
  for (const k of p.cuts) pool(k.x, k.y, k.rx, k.ry, k.a);
  for (const k of p.cones) {
    const g = lc.createLinearGradient(0, k.y, 0, k.yb);
    g.addColorStop(0, `rgba(0,0,0,${k.a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath();
    lc.moveTo(k.x - k.w0 / 2, k.y);
    lc.lineTo(k.x + k.w0 / 2, k.y);
    lc.lineTo(k.x + k.w1 / 2, k.yb);
    lc.lineTo(k.x - k.w1 / 2, k.yb);
    lc.closePath();
    lc.fill();
  }
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(lm, 0, 0);
  c.restore();
  // Warm tint of each lamp pool, added on top (lamp colour only where light falls).
  for (const k of p.warm) p.soft(k.x, k.y, k.rx, k.ry, k.color, k.a, 'lighter');
}

function finish(p: Painter, w: number, h: number): { lum: number; rgb: [number, number, number] } {
  const c = p.c;
  const S = COMPOSE_SCALE;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  // Brush-work mottling.
  const pat = noisePattern(c);
  if (pat) {
    c.globalCompositeOperation = 'soft-light';
    c.globalAlpha = 0.5;
    c.fillStyle = pat;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'overlay';
    c.globalAlpha = 0.14;
    c.save();
    c.translate(37, 11);
    c.scale(0.55, 0.55);
    c.fillStyle = pat;
    c.fillRect(-80, -24, w / 0.55 + 160, h / 0.55 + 48);
    c.restore();
  }
  // A soft bloom: the picture again, half size and blurred by the resample, screened on top at low strength.
  const sm = document.createElement('canvas');
  sm.width = Math.max(8, Math.round(w / 3));
  sm.height = Math.max(8, Math.round(h / 3));
  const sc = sm.getContext('2d')!;
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(c.canvas, 0, 0, sm.width, sm.height);
  c.globalCompositeOperation = 'screen';
  c.globalAlpha = 0.16;
  c.drawImage(sm, 0, 0, w, h);
  // Vignette.
  c.globalAlpha = 1;
  const vg = c.createRadialGradient(w / 2, h * 0.55, h * 0.3, w / 2, h * 0.55, Math.max(w, h) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(4,4,10,0.4)');
  c.fillStyle = vg;
  c.fillRect(0, 0, w, h);
  c.restore();
  // Film grain and the measurement, from one pass over the pixels.
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  const gr = lcg(hashStr(p.type) + p.tier);
  const amp = p.t(15, 11, 8);
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < d.length; i += 4) {
    const n = (gr() - 0.5) * amp;
    const r = d[i] + n, g = d[i + 1] + n, b = d[i + 2] + n;
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    sr += d[i]; sg += d[i + 1]; sb += d[i + 2];
  }
  c.putImageData(img, 0, 0);
  const px = d.length / 4;
  const rgb: [number, number, number] = [sr / px, sg / px, sb / px];
  void S;
  return { lum: (0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]) / 255, rgb };
}

// ---------------------------------------------------------------- public API

const SPEC_TABLE = new Map<string, RoomSpec>();
/** Debug switch: `?nocomposed` makes every room fall back to the old live-drawn stand-in (roomArt.ts), for an A/B perf and look check. Never touches the save. */
let disabled = false;
try {
  disabled = typeof location !== 'undefined' && /[?&]nocomposed\b/.test(location.search);
} catch {
  // no location (Node tools): composed rooms stay on
}
/** Registers the specs (roomSpecs.ts calls this once; kept as a function so the import graph stays acyclic). */
export function registerRoomSpecs(specs: Record<string, RoomSpec>): void {
  if (!disabled) for (const [k, v] of Object.entries(specs)) SPEC_TABLE.set(k, v);
}
export const hasComposedSpec = (type: string): boolean => SPEC_TABLE.has(type);
/** Room types drawn in code. [plan4:BL-7] Districts are listed apart (composedDistrictTypes): their pictures are `districts/...`, not `rooms/...`. */
export const composedTypes = (): string[] => [...SPEC_TABLE].filter(([, v]) => !v.district).map(([k]) => k);
export const composedDistrictTypes = (): string[] => [...SPEC_TABLE].filter(([, v]) => v.district).map(([k]) => k);
export const composedSpec = (type: string): RoomSpec | undefined => SPEC_TABLE.get(type);

const metaCache = new Map<string, ComposedMeta>();
/** Lights, fx, work spots, beds and seats of a room type and tier, from a dry pass (no canvas). */
export function composedMeta(type: string, tier: ComposeTier, slots: number): ComposedMeta | null {
  const key = `${type}|${tier}|${slots}`;
  const hit = metaCache.get(key);
  if (hit) return hit;
  const spec = SPEC_TABLE.get(type);
  if (!spec) return null;
  const p = new Painter(type, slots * SLOT_W, tier, spec.pal, null);
  spec.build(p);
  if (spec.walk) p.meta.walk = spec.walk;
  metaCache.set(key, p.meta);
  return p.meta;
}

/** Bakes the room into a canvas (browser only). `slots` is the width in floor slots. */
export function composeRoom(type: string, tier: ComposeTier, slots: number, stampSource?: (key: string) => CanvasImageSource | null): ComposeResult | null {
  const spec = SPEC_TABLE.get(type);
  if (!spec || typeof document === 'undefined') return null;
  const W = slots * SLOT_W;
  const w = Math.round(W * COMPOSE_SCALE), h = Math.round(ROOM_H * COMPOSE_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  // willReadFrequently keeps this canvas on the CPU: the bake reads its pixels back once (grain, brightness) and a GPU canvas would stall on that.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.scale(COMPOSE_SCALE, COMPOSE_SCALE);
  const p = new Painter(type, W, tier, spec.pal, ctx);
  p.stampSource = stampSource ?? null;
  if (spec.outdoor) drawSky(p, spec);
  else if (spec.district) drawCavern(p, spec);
  else drawShell(p, spec);
  spec.build(p);
  lightPass(p, spec, w, h);
  const m = finish(p, w, h);
  if (spec.walk) p.meta.walk = spec.walk;
  metaCache.set(`${type}|${tier}|${slots}`, p.meta);
  return { canvas, lum: m.lum, rgb: m.rgb };
}

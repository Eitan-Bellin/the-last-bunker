/**
 * [plan4:BL-6] Reusable parts of the RoomComposer: furniture, machines and fixtures drawn onto a `Painter` (roomComposer.ts).
 * All coordinates are room units; `yb` is the y of the part's feet. Parts register their own live effects (blinking lamps, screens,
 * needles) so a spec only says where things stand. Nothing here touches the DOM: with a dry painter the draw calls vanish and only the
 * layout calls (fx, spot, bed, seat) remain.
 */
import { mix, mute, shade, type Painter, type Rgb } from './roomComposer';

export const STEEL = 0x6a7078;
export const WOOD = 0x8a6a46;
export const CLOTH = 0x6a6a58;

/** A wooden or cardboard crate with plank lines. */
export function crate(p: Painter, x: number, yb: number, s: number, col: Rgb = WOOD): void {
  p.box(x, yb, s, s * 0.8, col, 4);
  p.line(x + 0.5, yb - s * 0.4, x + s - 0.5, yb - s * 0.4, shade(col, 0.55), 0.45, 0.8);
  p.line(x + 0.5, yb - 0.8, x + s - 0.5, yb - s * 0.8 + 0.8, shade(col, 0.6), 0.4, 0.7);
  p.speckle(x, yb - s * 0.8, s, s * 0.8, 0x000000, Math.round(s * 1.2), 0.2);
}

/** A steel drum with two ribs and a painted band. */
export function barrel(p: Painter, cx: number, yb: number, r: number, h: number, col: Rgb, band?: Rgb): void {
  p.cyl(cx, yb, r, h, col);
  p.rect(cx - r, yb - h * 0.3, r * 2, 0.7, 0x000000, 0.3);
  p.rect(cx - r, yb - h * 0.7, r * 2, 0.7, 0x000000, 0.3);
  if (band) p.rect(cx - r, yb - h * 0.62, r * 2, h * 0.16, band, 0.7);
}

/** Open steel shelving: uprights and shelf boards. Returns the shelf surface y of each tier (top of the board), lowest first. */
export function rack(p: Painter, x: number, yb: number, w: number, h: number, tiers: number, col: Rgb = STEEL): number[] {
  const ys: number[] = [];
  p.shadow(x + w / 2, yb + 0.5, w * 0.52, 0.3);
  const step = (h - 2) / tiers;
  for (const ux of [x, x + w - 1.4]) p.rectG(ux, yb - h, 1.4, h, [[0, shade(col, 1.2)], [1, shade(col, 0.6)]], true);
  for (let i = 0; i < tiers; i++) {
    const y = yb - 1.6 - i * step;
    p.rectG(x, y, w, 1.5, [[0, shade(col, 1.15)], [1, shade(col, 0.6)]]);
    ys.push(y);
  }
  p.rect(x, yb - h, w, 1.2, shade(col, 0.9));
  return ys;
}

/** A tiny indicator lamp that blinks (live `blink` effect, tied to the room being staffed when `work`). */
export function led(p: Painter, x: number, y: number, col: Rgb, o: { rate?: number; work?: boolean; size?: number } = {}): void {
  p.ell(x, y, 0.8, 0.8, 0x101010);
  p.ell(x, y, 0.55, 0.55, mix(col, 0xffffff, 0.25));
  p.glow(x, y, 3.2, col, { a: 0.55 });
  p.fx('blink', x, y, { color: col, size: o.size ?? 0.9, rate: o.rate ?? 2.2 + p.rnd() * 2, work: o.work });
}

/** A lit screen or panel: bezel, dim face with scan lines, and a live `screen` effect on top. */
export function screenPanel(p: Painter, x: number, y: number, w: number, h: number, col: Rgb, o: { band?: boolean; work?: boolean; bars?: boolean } = {}): void {
  p.roundRect(x - 1, y - 1, w + 2, h + 2, 1, 0x141416);
  p.rect(x, y, w, h, mix(0x0a1214, col, 0.22));
  if (o.bars) {
    const n = Math.max(3, Math.floor(w / 1.8));
    for (let i = 0; i < n; i++) {
      const bh = (0.25 + 0.7 * ((i * 37 % 11) / 11)) * (h - 1.6);
      p.rect(x + 0.8 + i * ((w - 1.6) / n), y + h - 0.8 - bh, (w - 1.6) / n - 0.5, bh, col, 0.8);
    }
  } else {
    for (let ly = y + 1.2; ly < y + h - 0.6; ly += 1.5) p.rect(x + 0.8, ly, w * (0.35 + 0.5 * (((ly * 13) | 0) % 7) / 7), 0.45, col, 0.55);
  }
  p.rect(x, y, w, h * 0.38, 0xffffff, 0.05);
  p.glow(x + w / 2, y + h / 2, Math.max(w, h) * 0.95, col, { a: 0.5 });
  p.fx('screen', x + w / 2, y + h / 2, { w, h, color: col, band: o.band ?? false, work: o.work });
}

/** A round dial with a quivering needle (live `needle` effect). */
export function gauge(p: Painter, x: number, y: number, r: number, o: { a?: number; amp?: number } = {}): void {
  p.ell(x, y, r + 0.7, r + 0.7, 0x16161a);
  p.ell(x, y, r, r, 0xd6ceb6);
  p.ell(x, y, r * 0.82, r * 0.82, 0xe6e0cc);
  for (let i = 0; i < 7; i++) {
    const a = -2.3 + i * 0.77;
    p.line(x + Math.sin(a) * r * 0.6, y - Math.cos(a) * r * 0.6, x + Math.sin(a) * r * 0.8, y - Math.cos(a) * r * 0.8, 0x2a2420, 0.25, 0.8);
  }
  p.rect(x - r * 0.12, y + r * 0.3, r * 0.24, r * 0.2, 0xb02a20, 0.8);
  p.fx('needle', x, y, { size: r * 0.75, a: o.a ?? 0.8, amp: o.amp ?? 0.12 });
}

/** A paper notice pinned to the wall (lines of "writing", no readable text). */
export function notice(p: Painter, x: number, y: number, w: number, h: number, ink: Rgb = 0x4a3a2c): void {
  p.shadow(x + w / 2, y + h + 0.6, w * 0.5, 0.18);
  p.rect(x, y, w, h, 0xd8cfb4);
  p.rect(x, y, w, 0.5, 0xffffff, 0.2);
  for (let ly = y + 2; ly < y + h - 1; ly += 2.1) p.rect(x + 1.2, ly, (w - 2.4) * (0.5 + 0.5 * (((ly * 7) | 0) % 5) / 5), 0.55, ink, 0.55);
  p.ell(x + w / 2, y + 0.9, 0.55, 0.55, 0xa02820);
}

/** A stack of sandbags, `rows` high, `n` wide in the bottom row. */
export function sandbags(p: Painter, x: number, yb: number, n: number, rows: number, col: Rgb = 0x9a8a62): void {
  p.shadow(x + (n * 7) / 2, yb + 0.5, n * 4, 0.4);
  for (let r = 0; r < rows; r++) {
    const m = n - r;
    for (let i = 0; i < m; i++) {
      const bx = x + r * 3.5 + i * 7;
      const by = yb - r * 4.2;
      const c = shade(col, 0.88 + ((i * 3 + r * 5) % 4) * 0.06);
      p.ell(bx + 3.5, by - 2.1, 3.7, 2.3, c);
      p.ell(bx + 3, by - 2.8, 2.6, 1.2, shade(c, 1.15), 0.7);
      p.line(bx + 1, by - 2.2, bx + 6, by - 2.2, shade(c, 0.6), 0.3, 0.6);
    }
  }
}

/** A wooden desk or counter: top, front panel, drawer. */
export function desk(p: Painter, x: number, yb: number, w: number, h: number, col: Rgb = WOOD): void {
  p.shadow(x + w / 2, yb + 0.5, w * 0.55, 0.38);
  p.poly([x - 1, yb - h, x + w + 1, yb - h, x + w + 3, yb - h - 3, x + 1, yb - h - 3], shade(col, 1.25));
  p.rectG(x - 1, yb - h, w + 2, 2.2, [[0, shade(col, 1.1)], [1, shade(col, 0.75)]]);
  p.rectG(x + 1, yb - h + 2.2, w - 2, h - 2.2, [[0, shade(col, 0.8)], [1, shade(col, 0.5)]]);
  p.rect(x + w * 0.62, yb - h + 3.4, w * 0.3, h * 0.38, shade(col, 0.62));
  p.rect(x + w * 0.74, yb - h + 3.4 + h * 0.15, w * 0.06, 0.8, 0xc8b88a, 0.8);
  p.speckle(x, yb - h, w, h, 0x000000, Math.round(w * 1.5), 0.16);
}

/** A simple chair seen from the side/front: seat, back, legs. `face` is the way it looks. */
export function chair(p: Painter, x: number, yb: number, face: 1 | -1, col: Rgb = 0x5a4a3a, h = 9): void {
  p.shadow(x, yb + 0.5, 4.5, 0.3);
  p.rect(x - 3 * face - 0.5, yb - h, 0.9, h, shade(col, 0.6));
  p.rect(x + 3 * face - 0.5, yb - h, 0.9, h, shade(col, 0.6));
  p.rect(x - 3.6, yb - h, 7.2, 1.3, shade(col, 1.1));
  p.rect(x - 3.6 * face - (face > 0 ? 0 : 0.9), yb - h - 8, 0.9, 8, shade(col, 0.9));
  p.rect(x - 3.6 * face - (face > 0 ? 0 : 3), yb - h - 8, 3, 2.4, shade(col, 1.0));
}

/** A bookshelf full of spines; returns nothing. Colours are muted so only a few catch the eye. */
export function bookshelf(p: Painter, x: number, yb: number, w: number, h: number, tiers = 4, wood: Rgb = 0x5a4430): void {
  p.shadow(x + w / 2, yb + 0.5, w * 0.55, 0.38);
  p.rectG(x, yb - h, w, h, [[0, shade(wood, 0.7)], [1, shade(wood, 0.45)]]);
  const th = (h - 2) / tiers;
  const spines = [0x7a3a32, 0x3a5a52, 0x8a7a3e, 0x3a4a6a, 0x6a4a6a, 0x8a5a38, 0x4a5a3a, 0x9a9486];
  for (let t = 0; t < tiers; t++) {
    const ty = yb - 1.5 - t * th;
    let bx = x + 1.2;
    while (bx < x + w - 2) {
      const bw = 1.1 + p.vr() * 1.5;
      const bh = th * (0.6 + p.vr() * 0.32);
      if (p.vr() > 0.08) {
        const c = mute(spines[Math.floor(p.vr() * spines.length)], 0.28);
        p.rectG(bx, ty - bh, bw, bh, [[0, shade(c, 1.15)], [1, shade(c, 0.7)]], true);
        p.rect(bx + bw * 0.3, ty - bh * 0.65, bw * 0.4, 0.4, 0xd8c890, 0.5);
      }
      bx += bw + 0.15;
    }
    p.rectG(x, ty, w, 1.3, [[0, shade(wood, 1.1)], [1, shade(wood, 0.6)]]);
  }
  p.rect(x - 0.6, yb - h, 0.9, h, shade(wood, 0.9));
  p.rect(x + w - 0.3, yb - h, 0.9, h, shade(wood, 0.75));
}

/** A bunk bed of `tiers` mattresses against the back wall; registers beds (mattress tops) for sleepers. */
export function bunk(p: Painter, x: number, yb: number, tiers: number, sheet: Rgb, o: { w?: number; head?: -1 | 1; sleep?: boolean } = {}): void {
  const w = o.w ?? 36, head = o.head ?? -1;
  const h = tiers * 24 + 8;
  p.shadow(x + w / 2, yb + 0.5, w * 0.58, 0.35);
  for (const px of [x, x + w - 2.2]) p.rectG(px, yb - h, 2.2, h, [[0, 0x80858c], [1, 0x4a4e54]], true);
  for (let i = 0; i < tiers; i++) {
    const top = yb - 11 - i * 24;
    p.rectG(x, top + 2.5, w, 3, [[0, 0x7a7f86], [1, 0x484c52]]);
    p.rectG(x + 1, top - 3, w - 2, 5.5, [[0, shade(sheet, 1.2)], [1, shade(sheet, 0.8)]]);
    p.rect(x + 1, top - 3, w - 2, 0.6, 0xffffff, 0.12);
    const px = head < 0 ? x + 2 : x + w - 12;
    p.roundRect(px, top - 6, 10, 4, 2, 0xcfc8b4);
    p.line(x + w * 0.5, top - 3, x + w * 0.5, top + 2, shade(sheet, 0.6), 0.4, 0.5);
    if (o.sleep !== false) p.bed(x + w / 2, top - 3, head);
  }
  p.rect(x, yb - h, w, 1.4, 0x5a5e64);
}

/** A tall steel locker with vents and a handle. */
export function locker(p: Painter, x: number, yb: number, w: number, h: number, col: Rgb = 0x5a6258): void {
  p.box(x, yb, w, h, col, 3);
  for (let i = 0; i < 4; i++) p.rect(x + 1.2, yb - h + 3 + i * 1.7, w - 2.4, 0.6, 0x000000, 0.4);
  p.rect(x + w - 2.6, yb - h * 0.5, 0.8, 4, 0xc8c0a8, 0.8);
  p.speckle(x, yb - h, w, h, 0x000000, Math.round(w * 2), 0.18);
}

/** A round hatch wheel on a blast door. */
export function wheel(p: Painter, cx: number, cy: number, r: number, col: Rgb = 0xa83a2e): void {
  p.ell(cx, cy, r, r, shade(col, 0.55));
  p.ell(cx, cy, r * 0.82, r * 0.82, shade(col, 0.28));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    p.line(cx, cy, cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86, shade(col, 1.05), 0.9);
  }
  p.ell(cx, cy, r * 0.22, r * 0.22, shade(col, 1.2));
}

/** A heavy steel door in a hazard-striped frame (blast door or airlock). */
export function blastDoor(p: Painter, x: number, yb: number, w: number, h: number, o: { wheel?: boolean; col?: Rgb; hazard?: boolean } = {}): void {
  const col = o.col ?? 0x5c6066;
  p.shadow(x + w / 2, yb + 0.5, w * 0.6, 0.4);
  p.rect(x - 3, yb - h - 3, w + 6, h + 3, 0x24262a);
  if (o.hazard !== false) p.stripes(x - 3, yb - h - 3, w + 6, 3, 0xc8a02a, 0x1a1a1a, 5);
  p.rectG(x, yb - h, w, h, [[0, shade(col, 1.1)], [1, shade(col, 0.72)]]);
  for (let y = yb - h + 7; y < yb - 4; y += 11) p.rect(x + 2, y, w - 4, 1.2, 0x000000, 0.32);
  p.rivets(x + 2, yb - h + 2.5, w - 4, 5, 0x000000, 0.4);
  p.rect(x + w * 0.5 - 0.4, yb - h, 0.8, h, 0x000000, 0.35);
  if (o.wheel) wheel(p, x + w * 0.5 + (w > 24 ? w * 0.22 : 0), yb - h * 0.52, Math.min(6.5, w * 0.24));
  p.speckle(x, yb - h, w, h, 0x000000, Math.round(w * 4), 0.2);
  p.streak(x + w * 0.3, yb - h + 2, h * 0.5, 0x5a3a1c, 0.25);
}

/** A cable run: parallel sagging wires between two points. */
export function cables(p: Painter, x0: number, y0: number, x1: number, y1: number, n = 3, sag = 5): void {
  const cols = [0x1c1c1e, 0x6a2a22, 0x2a2a2e, 0x8a6a22, 0x22323a];
  for (let i = 0; i < n; i++) p.wire(x0 + i * 1.1, y0, x1 + i * 0.6, y1, sag + i * 1.1, cols[i % cols.length], 1);
}

/** A vertical pipe with flanges and a valve wheel; col is the pipe's paint. */
export function pipeV(p: Painter, x: number, y0: number, y1: number, col: Rgb = 0x56606a, valve = false): void {
  p.rectG(x - 1.6, y0, 3.2, y1 - y0, [[0, shade(col, 0.6)], [0.3, shade(col, 1.25)], [0.7, col], [1, shade(col, 0.5)]], true);
  for (let y = y0 + 6; y < y1 - 3; y += 15) p.rect(x - 2.3, y, 4.6, 1.4, shade(col, 0.55));
  if (valve) {
    const vy = (y0 + y1) / 2;
    p.rect(x - 2.6, vy - 1.4, 5.2, 2.8, shade(col, 0.5));
    p.ell(x + 3.4, vy, 2.5, 2.5, 0xa83a2e);
    p.ell(x + 3.4, vy, 0.8, 0.8, 0x2a1210);
  }
}

/** A wall-mounted ladder or maintenance rungs. */
export function ladder(p: Painter, x: number, yb: number, h: number, col: Rgb = 0x6a6e74): void {
  for (const lx of [x, x + 7]) p.rectG(lx, yb - h, 1.2, h, [[0, shade(col, 1.2)], [1, shade(col, 0.6)]], true);
  for (let y = yb - 4; y > yb - h + 2; y -= 5) p.rect(x, y, 8.2, 0.9, shade(col, 1.0));
}

/** A hanging string of small lights (live `twinkle` on each bulb). */
export function stringLights(p: Painter, x0: number, x1: number, y: number, n: number, cols: readonly Rgb[], sag = 5): void {
  p.wire(x0, y, x1, y, sag, 0x1e1c1a, 0.5);
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const x = x0 + (x1 - x0) * t;
    const yy = y + sag * 0.5 * (1 - Math.pow(2 * t - 1, 2)) * 2;
    const c = cols[i % cols.length];
    p.ell(x, yy + 1, 1, 1.3, c);
    p.glow(x, yy + 1, 5, c, { a: 0.4 });
    p.fx('twinkle', x, yy + 1, { color: c, size: 0.9 });
  }
}

/** A potted shoot or tuft of green in a jar/can (kept dull: saturation is for alerts). */
export function sprout(p: Painter, x: number, yb: number, s = 1, col: Rgb = 0x5a7a4a): void {
  p.rect(x - 2 * s, yb - 4 * s, 4 * s, 4 * s, 0x6a5a4a);
  for (let i = -1; i <= 1; i++) p.ell(x + i * 2.2 * s, yb - 6.5 * s - Math.abs(i) * 0.3, 1.3 * s, 2.6 * s, shade(col, 0.9 + 0.15 * i));
}

/** A conical ceiling light shade plus its pool: for rooms that want a hanging lamp of a particular colour. */
export function hangingShade(p: Painter, x: number, y: number, col: Rgb, light: Rgb): void {
  p.line(x, 0, x, y, 0x1a1a1a, 0.5);
  p.poly([x - 1.2, y, x + 1.2, y, x + 4.5, y + 3.5, x - 4.5, y + 3.5], col);
  p.ell(x, y + 3.6, 3.4, 0.9, mix(light, 0xffffff, 0.45));
}

const WARM = 0xffd49a;
/** Lamp colour: the room's own light pulled toward tungsten (one light source for the whole bunker, doc style book rule 1). */
export const lampCol = (p: Painter): Rgb => mix(p.pal.light, WARM, 0.55);

/** A sheet of glass: faint tint, a frame and a diagonal glint. */
export function glassPane(p: Painter, x: number, y: number, w: number, h: number, tint: Rgb = 0x9ad0e0, frame: Rgb = 0x4a4e54): void {
  p.rect(x, y, w, h, tint, 0.14);
  p.poly([x + w * 0.15, y, x + w * 0.35, y, x + w * 0.1, y + h, x - w * 0.1 + w * 0.0, y + h].map((v, i) => (i % 2 ? Math.min(y + h, Math.max(y, v)) : Math.min(x + w, Math.max(x, v)))), 0xffffff, 0.08);
  p.rect(x - 0.7, y, 0.9, h, frame);
  p.rect(x + w - 0.2, y, 0.9, h, frame);
  p.rect(x - 0.7, y - 0.7, w + 1.6, 1.1, frame);
  p.rect(x - 0.7, y + h - 0.4, w + 1.6, 1.1, shade(frame, 0.7));
}

/** A fabric awning with stripes, sagging a little at the front edge. */
export function awning(p: Painter, x: number, y: number, w: number, h: number, c1: Rgb, c2: Rgb): void {
  const n = Math.max(3, Math.round(w / 5));
  for (let i = 0; i < n; i++) {
    const x0 = x + (i * w) / n, x1 = x + ((i + 1) * w) / n;
    p.poly([x0, y, x1, y, x1 + 0.6, y + h, x0 + 0.6, y + h], i % 2 ? c2 : c1);
  }
  p.rectG(x, y, w, h, [[0, 0x000000, 0.0], [1, 0x000000, 0.28]]);
  p.rect(x, y, w, 0.6, 0xffffff, 0.14);
  for (let i = 0; i < n; i++) p.ell(x + ((i + 0.5) * w) / n, y + h + 0.3, w / n / 2.1, 0.9, i % 2 ? c2 : c1);
}

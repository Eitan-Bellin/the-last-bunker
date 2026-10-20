/**
 * [world:C1] Pure geometry helpers for the city layout: deterministic noise, ragged (organic) outlines, arches and polygon maths.
 * Node-safe (no Pixi, no DOM). Every random-looking edge is a pure function of a seed and a world coordinate, so a layout is the same
 * every time it is built (and a chunk of rock re-baked later lines up with its neighbours).
 */

/** Hash of two numbers to [0, 1). */
export function hash2(a: number, b: number): number {
  let h = Math.imul((a | 0) + 0x27d4eb2d, 0x165667b1) ^ Math.imul((b | 0) + 0x61c88647, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** A string to a 31-bit seed. */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) & 0x7fffffff;
}

/** Smooth 1-D value noise in [0, 1] at `t` (lattice spacing 1), two octaves. */
export function noise1(seed: number, t: number): number {
  const v = (x: number): number => {
    const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
    const a = hash2(seed, i), b = hash2(seed, i + 1);
    return a + (b - a) * s;
  };
  return v(t) * 0.68 + v(t * 2.7 + 17.3) * 0.32;
}

/**
 * A ragged edge from (x0, y0) to (x1, y1), pushed OUTWARD (to the left of the walking direction in a y-down frame, i.e. the outer side of a
 * clockwise polygon) by 0..amp with noise of wavelength `wave`. Returns the points after the start (start excluded, end included).
 */
export function raggedEdge(x0: number, y0: number, x1: number, y1: number, amp: number, seed: number, wave = 26, step = 9): number[] {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  const out: number[] = [];
  if (len < 1e-6) return out;
  // Outer normal of a clockwise polygon in screen space (y down): rotate the direction by -90 degrees.
  const nx = dy / len, ny = -dx / len;
  const n = Math.max(1, Math.round(len / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    // The two ends stay on the line (k fades to 0) so neighbouring edges meet.
    const k = i === n ? 0 : Math.sin(Math.PI * t) ** 0.35;
    const along = (x0 * 0.0131 + y0 * 0.0173) + (t * len) / wave;
    const off = amp * k * noise1(seed, along);
    out.push(x0 + dx * t + nx * off, y0 + dy * t + ny * off);
  }
  return out;
}

/** A clockwise (screen space, y down) polygon from corner points, each side made ragged outward by `amps[i]` (0 = straight). */
export function raggedPoly(corners: readonly number[], amps: readonly number[] | number, seed: number, wave = 26): number[] {
  const n = corners.length / 2;
  const out: number[] = [corners[0], corners[1]];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const amp = typeof amps === 'number' ? amps : amps[i] ?? 0;
    const x0 = corners[i * 2], y0 = corners[i * 2 + 1], x1 = corners[j * 2], y1 = corners[j * 2 + 1];
    const pts = amp > 0 ? raggedEdge(x0, y0, x1, y1, amp, seed + i * 7919, wave) : [x1, y1];
    out.push(...pts);
  }
  // The last point closes onto the first: drop the duplicate.
  out.length -= 2;
  return out;
}

/** A clockwise rect polygon. */
export function rectPoly(x0: number, y0: number, x1: number, y1: number): number[] {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

/**
 * A segmental arch from (x0, y) to (x1, y) rising `rise` at the middle, as `n` + 1 points left to right (y down: the crown is at y - rise).
 */
export function archPoints(x0: number, x1: number, y: number, rise: number, n = 14): number[] {
  const out: number[] = [];
  const half = (x1 - x0) / 2, cx = (x0 + x1) / 2;
  // Circle through the two springers and the crown.
  const r = (half * half + rise * rise) / (2 * Math.max(1e-6, rise));
  const cy = y - rise + r;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const dx = x - cx;
    out.push(x, cy - Math.sqrt(Math.max(0, r * r - dx * dx)));
  }
  return out;
}

/** An organic closed blob (clockwise) inscribed in the box, `k` = how lumpy (0..0.4). */
export function blobPoly(x0: number, y0: number, x1: number, y1: number, seed: number, k = 0.22, n = 22, flatBottom = false): number[] {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // Clockwise in y-down screen space = increasing angle with y = sin.
    const a = (i / n) * Math.PI * 2 - Math.PI;
    const w = 1 - k + k * 2 * noise1(seed, i * 0.9);
    let y = cy + Math.sin(a) * ry * w;
    if (flatBottom && y > cy) y = Math.min(y1, cy + (y - cy) * 1.4);
    out.push(cx + Math.cos(a) * rx * w, Math.min(y1, y));
  }
  return out;
}

/** Axis-aligned bounds of a flat polygon. */
export function polyBounds(p: readonly number[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < x0) x0 = p[i];
    if (p[i] > x1) x1 = p[i];
    if (p[i + 1] < y0) y0 = p[i + 1];
    if (p[i + 1] > y1) y1 = p[i + 1];
  }
  return { x0, y0, x1, y1 };
}

/** Even-odd point in polygon. */
export function inPoly(p: readonly number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if (p[i + 1] > y !== p[j + 1] > y && x < ((p[j] - p[i]) * (y - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
  }
  return inside;
}

/** Signed area (positive = clockwise in y-down screen space). */
export function polyArea(p: readonly number[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] * p[i + 1] - p[i] * p[j + 1]);
  return a / 2;
}

/** Rounds every coordinate to 1/8 unit (keeps signatures and saves short, and the layout byte-stable across runs). */
export function q8(p: number[]): number[] {
  for (let i = 0; i < p.length; i++) p[i] = Math.round(p[i] * 8) / 8;
  return p;
}

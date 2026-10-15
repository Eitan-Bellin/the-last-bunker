import type { RGB } from './tokens';
import { euler, type V3 } from './math';

/** Material ids understood by the fragment shader (shaders.ts). */
export const MAT = {
  ROCK: 0, CONCRETE: 1, METAL: 2, WOOD: 3, TIN: 4, TILE: 5, EMISSIVE: 6, DIRT: 7, GLOW: 8, FIGURE: 9, ASH: 10, CUT: 11,
} as const;

/** Floats per vertex: position 3, normal 3, colour 3, material 1, ambient occlusion 1. */
export const STRIDE = 11;

/**
 * Growable vertex/index buffer writer. Everything in the scene is generated through it; `reset()` keeps the
 * storage so the per-frame people mesh allocates nothing after warm-up.
 */
export class Mesh {
  v = new Float32Array(4096 * STRIDE);
  i = new Uint32Array(8192);
  nv = 0;
  ni = 0;

  reset(): void {
    this.nv = 0;
    this.ni = 0;
  }

  get triangles(): number {
    return this.ni / 3;
  }

  private growV(n: number): void {
    if ((this.nv + n) * STRIDE <= this.v.length) return;
    const nv = new Float32Array(Math.max(this.v.length * 2, (this.nv + n) * STRIDE));
    nv.set(this.v);
    this.v = nv;
  }

  private growI(n: number): void {
    if (this.ni + n <= this.i.length) return;
    const ni = new Uint32Array(Math.max(this.i.length * 2, this.ni + n));
    ni.set(this.i);
    this.i = ni;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: RGB, mat: number, ao: number): number {
    this.growV(1);
    const o = this.nv * STRIDE, v = this.v;
    v[o] = x; v[o + 1] = y; v[o + 2] = z;
    v[o + 3] = nx; v[o + 4] = ny; v[o + 5] = nz;
    v[o + 6] = c[0]; v[o + 7] = c[1]; v[o + 8] = c[2];
    v[o + 9] = mat; v[o + 10] = ao;
    return this.nv++;
  }

  /** A quad a-b-c-d; the winding is fixed up so its front faces along `n`. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, col: RGB, mat: number, ao: [number, number, number, number] = [1, 1, 1, 1]): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const i0 = this.vert(a[0], a[1], a[2], n[0], n[1], n[2], col, mat, ao[0]);
    const i1 = this.vert(b[0], b[1], b[2], n[0], n[1], n[2], col, mat, ao[1]);
    const i2 = this.vert(c[0], c[1], c[2], n[0], n[1], n[2], col, mat, ao[2]);
    const i3 = this.vert(d[0], d[1], d[2], n[0], n[1], n[2], col, mat, ao[3]);
    this.growI(6);
    const I = this.i;
    let k = this.ni;
    if (!flip) { I[k++] = i0; I[k++] = i1; I[k++] = i2; I[k++] = i0; I[k++] = i2; I[k++] = i3; }
    else { I[k++] = i0; I[k++] = i2; I[k++] = i1; I[k++] = i0; I[k++] = i3; I[k++] = i2; }
    this.ni = k;
  }

  tri(a: V3, b: V3, c: V3, col: RGB, mat: number, ao: [number, number, number] = [1, 1, 1], hint?: V3): void {
    if (hint) {
      const px = b[0] - a[0], py = b[1] - a[1], pz = b[2] - a[2], qx = c[0] - a[0], qy = c[1] - a[1], qz = c[2] - a[2];
      if ((py * qz - pz * qy) * hint[0] + (pz * qx - px * qz) * hint[1] + (px * qy - py * qx) * hint[2] < 0) { const t = b; b = c; c = t; }
    }
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, col, mat, ao[0]);
    const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, col, mat, ao[1]);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, col, mat, ao[2]);
    this.growI(3);
    this.i[this.ni++] = i0; this.i[this.ni++] = i1; this.i[this.ni++] = i2;
  }

  /**
   * An oriented box: centre `c`, full-length edge vectors ex, ey, ez (mutually orthogonal).
   * `aoBottom` darkens the vertices on the -ey side (cheap contact shadow). `skip` drops faces: 'px','nx','py','ny','pz','nz'.
   */
  obox(c: V3, ex: V3, ey: V3, ez: V3, col: RGB, mat: number, aoBottom = 0.62, skip = ''): void {
    const P = (sx: number, sy: number, sz: number): V3 => [
      c[0] + (ex[0] * sx + ey[0] * sy + ez[0] * sz) / 2,
      c[1] + (ex[1] * sx + ey[1] * sy + ez[1] * sz) / 2,
      c[2] + (ex[2] * sx + ey[2] * sy + ez[2] * sz) / 2,
    ];
    const N = (v: V3, s: number): V3 => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [(v[0] / l) * s, (v[1] / l) * s, (v[2] / l) * s];
    };
    const ab = aoBottom;
    const ao = (sy: number) => (sy < 0 ? ab : 1);
    if (!skip.includes('px')) this.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), N(ex, 1), col, mat, [ao(-1), 1, 1, ao(-1)]);
    if (!skip.includes('nx')) this.quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), N(ex, -1), col, mat, [ao(-1), ao(-1), 1, 1]);
    if (!skip.includes('py')) this.quad(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), N(ey, 1), col, mat);
    if (!skip.includes('ny')) this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), N(ey, -1), col, mat, [ab, ab, ab, ab]);
    if (!skip.includes('pz')) this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), N(ez, 1), col, mat, [ao(-1), ao(-1), 1, 1]);
    if (!skip.includes('nz')) this.quad(P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), N(ez, -1), col, mat, [ao(-1), 1, 1, ao(-1)]);
  }

  /** Axis-aligned box from min/max corners. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: RGB, mat: number, aoBottom = 0.62, skip = ''): void {
    this.obox([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [x1 - x0, 0, 0], [0, y1 - y0, 0], [0, 0, z1 - z0], col, mat, aoBottom, skip);
  }

  /** Box centred at c with size s, rotated by euler angles (radians). */
  rbox(c: V3, s: V3, rx: number, ry: number, rz: number, col: RGB, mat: number, aoBottom = 0.62): void {
    const r = euler(rx, ry, rz);
    this.obox(c, [r[0] * s[0], r[3] * s[0], r[6] * s[0]], [r[1] * s[1], r[4] * s[1], r[7] * s[1]], [r[2] * s[2], r[5] * s[2], r[8] * s[2]], col, mat, aoBottom);
  }

  /** A square-section beam from p0 to p1 (ropes, rails, branches, stringers). `up` picks the roll. */
  beam(p0: V3, p1: V3, w: number, h: number, col: RGB, mat: number, up: V3 = [0, 1, 0]): void {
    const d: V3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1e-6;
    const f: V3 = [d[0] / L, d[1] / L, d[2] / L];
    let sx = f[1] * up[2] - f[2] * up[1], sy = f[2] * up[0] - f[0] * up[2], sz = f[0] * up[1] - f[1] * up[0];
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-4) { sx = 1; sy = 0; sz = 0; sl = 1; }
    sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * f[2] - sz * f[1], uy = sz * f[0] - sx * f[2], uz = sx * f[1] - sy * f[0];
    const c: V3 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    this.obox(c, [f[0] * L, f[1] * L, f[2] * L], [ux * h, uy * h, uz * h], [sx * w, sy * w, sz * w], col, mat, 1);
  }

  /** Vertical cylinder (or along x / z), optional caps. `r1` tapers the top. */
  cylinder(c: V3, r: number, h: number, seg: number, col: RGB, mat: number, axis: 'x' | 'y' | 'z' = 'y', caps = true, r1 = r, aoBottom = 0.7): void {
    const map = (a: number, b: number, t: number): V3 =>
      axis === 'y' ? [c[0] + a, c[1] + t, c[2] + b] : axis === 'x' ? [c[0] + t, c[1] + a, c[2] + b] : [c[0] + a, c[1] + b, c[2] + t];
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const n = map(Math.cos(am), Math.sin(am), 0);
      const nn: V3 = [n[0] - map(0, 0, 0)[0], n[1] - map(0, 0, 0)[1], n[2] - map(0, 0, 0)[2]];
      this.quad(
        map(Math.cos(a0) * r, Math.sin(a0) * r, 0), map(Math.cos(a1) * r, Math.sin(a1) * r, 0),
        map(Math.cos(a1) * r1, Math.sin(a1) * r1, h), map(Math.cos(a0) * r1, Math.sin(a0) * r1, h),
        nn, col, mat, [aoBottom, aoBottom, 1, 1],
      );
      if (caps) {
        const top = map(0, 0, h), bot = map(0, 0, 0);
        const ax: V3 = [top[0] - bot[0], top[1] - bot[1], top[2] - bot[2]];
        const al = Math.hypot(ax[0], ax[1], ax[2]);
        const an: V3 = [ax[0] / al, ax[1] / al, ax[2] / al];
        if (r1 > 0.001) this.tri(top, map(Math.cos(a0) * r1, Math.sin(a0) * r1, h), map(Math.cos(a1) * r1, Math.sin(a1) * r1, h), col, mat, [1, 1, 1], an);
        this.tri(bot, map(Math.cos(a1) * r, Math.sin(a1) * r, 0), map(Math.cos(a0) * r, Math.sin(a0) * r, 0), col, mat, [aoBottom, aoBottom, aoBottom], [-an[0], -an[1], -an[2]]);
      }
    }
  }

  /** Low-poly sphere. */
  sphere(c: V3, r: number, col: RGB, mat: number, lat = 5, lon = 8, sy = 1): void {
    for (let a = 0; a < lat; a++) {
      const t0 = (a / lat) * Math.PI, t1 = ((a + 1) / lat) * Math.PI;
      for (let b = 0; b < lon; b++) {
        const p0 = (b / lon) * Math.PI * 2, p1 = ((b + 1) / lon) * Math.PI * 2;
        const P = (t: number, p: number): V3 => [c[0] + r * Math.sin(t) * Math.cos(p), c[1] + r * sy * Math.cos(t), c[2] + r * Math.sin(t) * Math.sin(p)];
        const tm = (t0 + t1) / 2, pm = (p0 + p1) / 2;
        const n: V3 = [Math.sin(tm) * Math.cos(pm), Math.cos(tm), Math.sin(tm) * Math.sin(pm)];
        if (a === 0) this.tri(P(t0, p0), P(t1, p1), P(t1, p0), col, mat, [1, 1, 1], n);
        else if (a === lat - 1) this.tri(P(t0, p0), P(t0, p1), P(t1, p0), col, mat, [0.7, 0.7, 0.7], n);
        else this.quad(P(t0, p0), P(t0, p1), P(t1, p1), P(t1, p0), n, col, mat);
      }
    }
  }
}

export function shadeRGB(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

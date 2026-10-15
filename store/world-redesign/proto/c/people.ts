import { tokens, type RGB } from './tokens';
import { MAT, Mesh, shadeRGB } from './mesh';
import { rng, type V3 } from './math';
import { DESTINATIONS, NODES, findPath, isClimb } from './nav';

/**
 * Survivors: low-poly box figures that walk the nav graph (stairs, ramp, bridge) with a leg/arm swing.
 * All figures are rebuilt into one dynamic mesh each frame (one draw call). In the real game these would be
 * the existing pre-rendered 3D sprite atlases drawn as camera-facing billboards.
 */
const rnd = rng(4242);

function pickDest(not: string): string {
  const total = DESTINATIONS.reduce((s, d) => s + d[1], 0);
  for (let tries = 0; tries < 8; tries++) {
    let r = rnd() * total;
    for (const [n, w] of DESTINATIONS) {
      r -= w;
      if (r <= 0) { if (n !== not) return n; break; }
    }
  }
  return not === 'fTable' ? 'dWork' : 'fTable';
}

export class Walker {
  node: string;
  path: string[] = [];
  seg = 0;
  t = 0;
  pause: number;
  phase = rnd() * 6;
  pos: V3;
  yaw = rnd() * 6;
  walking = false;
  lanternPos: V3 = [0, 0, 0];
  readonly outfit: RGB;
  readonly trousers: RGB;
  readonly skin: RGB;
  readonly hat: RGB;
  readonly pack: boolean;
  readonly lantern: boolean;
  readonly speed: number;
  readonly scale: number;

  constructor(start: string, i: number) {
    const T = tokens.people;
    this.node = start;
    this.pos = [...NODES[start]] as V3;
    this.pause = 0.5 + rnd() * 3;
    this.outfit = T.outfits[i % T.outfits.length];
    this.trousers = T.trousers[(i * 3) % T.trousers.length];
    this.skin = T.skins[(i * 7 + 1) % T.skins.length];
    this.hat = rnd() < 0.4 ? shadeRGB(T.outfits[(i + 3) % T.outfits.length], 0.7) : [0.06, 0.045, 0.035];
    this.pack = rnd() < 0.5;
    this.lantern = i === 0 || i === 4;
    this.speed = T.speed * (0.85 + rnd() * 0.3);
    this.scale = 0.92 + rnd() * 0.14;
  }

  update(dt: number): void {
    if (!this.walking) {
      this.pause -= dt;
      if (this.pause <= 0) {
        // lantern carriers favour the dark edge and the surface
        const dest = this.lantern && rnd() < 0.5 ? (rnd() < 0.6 ? 'dig' : 'sFire') : pickDest(this.node);
        this.path = findPath(this.node, dest);
        this.seg = 0;
        this.t = 0;
        this.walking = this.path.length > 1;
        if (!this.walking) this.pause = 1;
      }
      return;
    }
    const a = NODES[this.path[this.seg]], b = NODES[this.path[this.seg + 1]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 0.01;
    const climb = isClimb(this.path[this.seg], this.path[this.seg + 1]);
    const v = this.speed * (climb ? tokens.people.stairSpeedFactor : 1);
    this.t += (v * dt) / L;
    this.phase += v * dt * tokens.people.stride;
    if (this.t >= 1) {
      this.seg++;
      this.t = 0;
      if (this.seg >= this.path.length - 1) {
        this.node = this.path[this.path.length - 1];
        this.walking = false;
        this.pause = tokens.people.pauseMin + rnd() * (tokens.people.pauseMax - tokens.people.pauseMin);
        this.pos = [...NODES[this.node]] as V3;
        return;
      }
    }
    const A = NODES[this.path[this.seg]], B = NODES[this.path[this.seg + 1]];
    this.pos = [A[0] + (B[0] - A[0]) * this.t, A[1] + (B[1] - A[1]) * this.t, A[2] + (B[2] - A[2]) * this.t];
    const dx = B[0] - A[0], dz = B[2] - A[2];
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      const target = Math.atan2(dx, dz);
      let d = target - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 10);
    }
  }

  build(m: Mesh, time: number): void {
    const s = this.scale;
    const walk = this.walking ? 1 : 0;
    const swing = Math.sin(this.phase) * 0.6 * walk;
    const idle = walk ? 0 : Math.sin(time * 1.3 + this.phase) * 0.05;
    const bob = walk ? Math.abs(Math.sin(this.phase)) * 0.045 : 0;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const px = this.pos[0], py = this.pos[1] + bob, pz = this.pos[2];
    const part = (pivot: V3, ang: number, c: V3, sz: V3, col: RGB, mat: number = MAT.FIGURE, ao = 0.75): V3 => {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const rx = (v: V3): V3 => [v[0], v[1] * ca - v[2] * sa, v[1] * sa + v[2] * ca];
      const ry = (v: V3): V3 => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
      const lc = rx([c[0] * s, c[1] * s, c[2] * s]);
      const w = ry([pivot[0] * s + lc[0], pivot[1] * s + lc[1], pivot[2] * s + lc[2]]);
      const center: V3 = [px + w[0], py + w[1], pz + w[2]];
      m.obox(center, ry(rx([sz[0] * s, 0, 0])), ry(rx([0, sz[1] * s, 0])), ry(rx([0, 0, sz[2] * s])), col, mat, ao);
      return center;
    };
    const boot: RGB = [0.05, 0.04, 0.035];
    for (const side of [-1, 1]) {
      const a = swing * side;
      part([0.1 * side, 0.9, 0], a, [0, -0.42, 0], [0.15, 0.84, 0.17], this.trousers, MAT.FIGURE, 0.55);
      part([0.1 * side, 0.9, 0], a, [0, -0.85, 0.05], [0.16, 0.1, 0.27], boot, MAT.FIGURE, 0.5);
    }
    const lean = 0.06 * walk;
    part([0, 0.9, 0], lean, [0, 0.32, 0], [0.41, 0.64, 0.25], this.outfit);
    part([0, 0.9, 0], lean, [0, 0.05, 0], [0.43, 0.1, 0.27], shadeRGB(this.trousers, 0.6));
    if (this.pack) part([0, 0.9, 0], lean, [0, 0.36, -0.2], [0.32, 0.42, 0.16], shadeRGB(this.outfit, 0.55));
    for (const side of [-1, 1]) {
      const a = -swing * side * 0.85 + idle * side;
      const holding = this.lantern && side === 1;
      const aa = holding ? -0.35 : a;
      part([0.27 * side, 1.44, 0], aa, [0, -0.29, 0], [0.11, 0.6, 0.12], shadeRGB(this.outfit, 0.82));
      part([0.27 * side, 1.44, 0], aa, [0, -0.63, 0], [0.09, 0.1, 0.1], this.skin);
      if (holding) {
        part([0.27 * side, 1.44, 0], aa, [0, -0.72, 0.02], [0.05, 0.06, 0.05], [0.03, 0.03, 0.03]);
        this.lanternPos = part([0.27 * side, 1.44, 0], aa, [0, -0.86, 0.02], [0.13, 0.17, 0.13], [2.8, 1.7, 0.7], MAT.EMISSIVE, 1);
      }
    }
    part([0, 1.56, 0], idle * 0.5, [0, 0.12, 0.01], [0.2, 0.23, 0.22], this.skin);
    part([0, 1.56, 0], idle * 0.5, [0, 0.25, -0.01], [0.23, 0.07, 0.25], this.hat);
  }
}

export function makeWalkers(): Walker[] {
  const starts = ['fTable', 'dWork', 'l2Front', 'dGarden', 'pH4', 'c2', 'fGen', 'dig', 'lk', 'sFire'];
  const out: Walker[] = [];
  for (let i = 0; i < tokens.people.count; i++) out.push(new Walker(starts[i % starts.length], i));
  return out;
}

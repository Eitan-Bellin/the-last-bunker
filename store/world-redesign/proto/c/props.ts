import { tokens, type RGB } from './tokens';
import { MAT, Mesh, mixRGB, shadeRGB } from './mesh';
import { rng, type V3 } from './math';
import { cavernCeil, depthAt } from './terrain';

export interface Halo { p: V3; c: RGB; size: number; light: number }
export interface Cone { apex: V3; len: number; radius: number; light: number; c: RGB }
export interface Particle { p: V3; kind: number; seed: number }
export interface Extras { halos: Halo[]; cones: Cone[]; particles: Particle[] }

const P = tokens.palette;
const lightIndex = (id: string) => tokens.lights.findIndex((l) => l.id === id);

function railing(m: Mesh, a: V3, b: V3, h = 1.05, spacing = 1.25, top: RGB = P.safety, post: RGB = shadeRGB(P.metal, 0.8)): void {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const n = Math.max(1, Math.round(L / spacing));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    m.box(x - 0.035, y, z - 0.035, x + 0.035, y + h, z + 0.035, post, MAT.METAL, 0.8);
  }
  m.beam([a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], 0.07, 0.06, top, MAT.METAL);
  m.beam([a[0], a[1] + h * 0.5, a[2]], [b[0], b[1] + h * 0.5, b[2]], 0.04, 0.04, post, MAT.METAL);
}

/** A flight of steps from (xTop,yTop) down to (xBot,yBot) between z0 and z1, with stringers and hand rails. */
function stairs(m: Mesh, xTop: number, yTop: number, xBot: number, yBot: number, z0: number, z1: number, tread: RGB, mat: number, rails = true): void {
  const n = Math.max(2, Math.round(Math.abs(yTop - yBot) / 0.24));
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const xa = xTop + (xBot - xTop) * t0, xb = xTop + (xBot - xTop) * t1;
    const y = yTop + (yBot - yTop) * t0;
    m.box(Math.min(xa, xb), y - 0.09, z0 + 0.05, Math.max(xa, xb), y, z1 - 0.05, shadeRGB(tread, 0.9 + 0.2 * (k % 2)), mat, 0.85);
  }
  const s = shadeRGB(P.metal, 0.75);
  m.beam([xTop, yTop - 0.15, z0 + 0.04], [xBot, yBot - 0.15, z0 + 0.04], 0.08, 0.32, s, MAT.METAL, [0, 0, 1]);
  m.beam([xTop, yTop - 0.15, z1 - 0.04], [xBot, yBot - 0.15, z1 - 0.04], 0.08, 0.32, s, MAT.METAL, [0, 0, 1]);
  if (rails) {
    for (const z of [z0 + 0.04, z1 - 0.04]) {
      m.beam([xTop, yTop + 1.0, z], [xBot, yBot + 1.0, z], 0.06, 0.06, P.safety, MAT.METAL);
      const n2 = Math.max(2, Math.round(Math.abs(xTop - xBot) / 1.4));
      for (let k = 0; k <= n2; k++) {
        const t = k / n2;
        const x = xTop + (xBot - xTop) * t, y = yTop + (yBot - yTop) * t;
        m.box(x - 0.03, y, z - 0.03, x + 0.03, y + 1.0, z + 0.03, s, MAT.METAL, 1);
      }
    }
  }
}

function lampCage(m: Mesh, p: V3, hang = 0.5, warm: RGB = P.window): void {
  m.beam([p[0], p[1] + hang + 0.2, p[2]], [p[0], p[1] + 0.15, p[2]], 0.03, 0.03, P.metal, MAT.METAL);
  m.box(p[0] - 0.22, p[1] + 0.08, p[2] - 0.22, p[0] + 0.22, p[1] + 0.16, p[2] + 0.22, shadeRGB(P.metal, 0.6), MAT.METAL, 1);
  m.box(p[0] - 0.12, p[1] - 0.1, p[2] - 0.12, p[0] + 0.12, p[1] + 0.08, p[2] + 0.12, warm, MAT.EMISSIVE, 1);
}

/** A tin shack: solid body, slanted roof, a lit window and a door on the front (+z) face. */
function shack(m: Mesh, x0: number, x1: number, y: number, z0: number, z1: number, h: number, wall: RGB, rnd: () => number, lit = true): void {
  m.box(x0, y, z0, x1, y + h, z1, wall, MAT.TIN, 0.55);
  // base course of stacked blocks
  m.box(x0 - 0.05, y, z0 - 0.05, x1 + 0.05, y + 0.45, z1 + 0.05, shadeRGB(P.concreteWall, 0.6), MAT.CONCRETE, 0.5);
  // roof
  const over = 0.35;
  m.rbox([(x0 + x1) / 2, y + h + 0.25, (z0 + z1) / 2], [x1 - x0 + over * 2, 0.12, z1 - z0 + over * 2], -0.12, 0, 0, shadeRGB(P.rust, 0.9 + rnd() * 0.3), MAT.TIN, 0.9);
  // door
  const dx = x0 + (x1 - x0) * (0.25 + rnd() * 0.15);
  m.box(dx - 0.45, y + 0.02, z1, dx + 0.45, y + 2.0, z1 + 0.06, shadeRGB(P.wood, 0.7), MAT.WOOD, 0.8);
  // window
  const wx = x0 + (x1 - x0) * 0.72;
  m.box(wx - 0.5, y + 1.15, z1, wx + 0.5, y + 1.95, z1 + 0.05, lit ? P.window : shadeRGB(P.window, 0.05), lit ? MAT.EMISSIVE : MAT.METAL, 1);
  m.box(wx - 0.6, y + 1.05, z1 + 0.04, wx + 0.6, y + 1.12, z1 + 0.12, shadeRGB(P.wood, 0.8), MAT.WOOD, 1);
  m.box(wx - 0.03, y + 1.15, z1 + 0.05, wx + 0.03, y + 1.95, z1 + 0.08, shadeRGB(P.wood, 0.5), MAT.WOOD, 1);
  // stove pipe
  m.cylinder([x0 + 0.5, y + h, z0 + 0.6], 0.12, 1.1, 6, shadeRGB(P.metal, 0.7), MAT.METAL);
}

function crate(m: Mesh, x: number, y: number, z: number, s: number, rnd: () => number): void {
  m.rbox([x, y + s / 2, z], [s, s, s], 0, (rnd() - 0.5) * 0.6, 0, shadeRGB(P.wood, 0.75 + rnd() * 0.4), MAT.WOOD, 0.5);
}

function barrel(m: Mesh, x: number, y: number, z: number, col: RGB): void {
  m.cylinder([x, y, z], 0.32, 0.95, 8, col, MAT.METAL);
}

function ruin(m: Mesh, x: number, z: number, w: number, d: number, floors: number, rnd: () => number): void {
  const fh = 3.3;
  const col = shadeRGB(P.concreteWall, 0.32 + rnd() * 0.12);
  const cols = 3 + Math.floor(rnd() * 2), rows = 2 + Math.floor(rnd() * 2);
  const heights: number[][] = [];
  for (let a = 0; a <= cols; a++) {
    heights.push([]);
    for (let b = 0; b <= rows; b++) {
      const edge = Math.min(a, cols - a, b, rows - b) === 0;
      const hgt = (floors - (rnd() < 0.5 ? rnd() * floors * 0.7 : 0)) * fh * (edge ? 1 : 0.9);
      heights[a].push(hgt);
      m.box(x + (a / cols) * w - 0.35, 0, z - (b / rows) * d - 0.35, x + (a / cols) * w + 0.35, hgt, z - (b / rows) * d + 0.35, col, MAT.CONCRETE, 0.6);
    }
  }
  for (let f = 1; f <= floors; f++) {
    for (let a = 0; a < cols; a++)
      for (let b = 0; b < rows; b++) {
        const need = f * fh;
        if (Math.min(heights[a][b], heights[a + 1][b], heights[a][b + 1], heights[a + 1][b + 1]) < need - 0.1 && rnd() < 0.7) continue;
        if (rnd() < 0.18) continue;
        m.box(x + (a / cols) * w, need - 0.3, z - ((b + 1) / rows) * d, x + ((a + 1) / cols) * w, need, z - (b / rows) * d, col, MAT.CONCRETE, 0.8);
        // a fallen slab leaning down
        if (rnd() < 0.08) m.rbox([x + ((a + 0.5) / cols) * w, need - 1.4, z - ((b + 0.5) / rows) * d], [w / cols, 0.3, d / rows], 0.5, 0, 0.4, col, MAT.CONCRETE);
      }
  }
}

function deadTree(m: Mesh, x: number, z: number, h: number, rnd: () => number): void {
  const bark = [0.08, 0.06, 0.05] as RGB;
  m.cylinder([x, 0, z], 0.22, h, 6, bark, MAT.WOOD, 'y', false, 0.08);
  for (let k = 0; k < 5; k++) {
    const y = h * (0.45 + rnd() * 0.45), a = rnd() * Math.PI * 2, L = 1.0 + rnd() * 1.8;
    m.beam([x, y, z], [x + Math.cos(a) * L, y + 0.6 + rnd() * 1.2, z + Math.sin(a) * L * 0.6], 0.07, 0.07, bark, MAT.WOOD);
  }
}

function catenary(a: V3, b: V3, sag: number, n: number): V3[] {
  const out: V3[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

export function buildProps(m: Mesh, mobile: boolean): Extras {
  const rnd = rng(1337);
  const halos: Halo[] = [];
  const cones: Cone[] = [];
  const particles: Particle[] = [];
  const pk = mobile ? tokens.detail.mobileParticles : 1;
  const metal = P.metal, dark = shadeRGB(P.metal, 0.55);

  // lights: every point light gets a halo and, if asked, a cone
  tokens.lights.forEach((l, i) => {
    if (l.halo > 0) halos.push({ p: l.pos, c: l.color, size: l.halo, light: i });
    if (l.cone) cones.push({ apex: [l.pos[0], l.pos[1] - 0.1, l.pos[2]], len: l.cone, radius: l.cone * 0.42, light: i, c: l.color });
  });

  // ---------------------------------------------------------------- surface
  // the ruined entrance block over the ramp
  const cw = P.concreteWall;
  m.box(30, 0, -8, 40, 3.4, -7.4, cw, MAT.CONCRETE, 0.5);
  m.box(30, -0.6, -7.4, 30.6, 3.4, 0, cw, MAT.CONCRETE, 0.5);
  m.box(39.4, 0, -7.4, 40, 3.4, -5.4, cw, MAT.CONCRETE, 0.5);
  m.box(39.4, 0, -2.6, 40, 3.4, 0, cw, MAT.CONCRETE, 0.5);
  m.box(39.4, 2.6, -5.4, 40, 3.4, -2.6, cw, MAT.CONCRETE, 1);
  m.box(29.8, 3.4, -8.2, 35.4, 3.9, 0.1, shadeRGB(cw, 0.85), MAT.CONCRETE, 0.8);
  m.box(37.6, 3.4, -8.2, 40.2, 3.9, 0.1, shadeRGB(cw, 0.85), MAT.CONCRETE, 0.8);
  m.rbox([36.4, 2.1, -4.6], [2.5, 0.4, 5.6], 0, 0, 0.75, shadeRGB(cw, 0.75), MAT.CONCRETE, 0.8);
  for (let k = 0; k < 7; k++) m.beam([35.4, 3.6, -7.5 + k], [35.9 + rnd() * 0.6, 3.3 + rnd() * 0.9, -7.5 + k + rnd() * 0.3], 0.03, 0.03, P.rust, MAT.METAL);
  m.box(38, -0.25, -7.4, 39.4, 0.02, 0, shadeRGB(P.concreteFloor, 0.9), MAT.CONCRETE, 1);
  // hazard stripes over the door (inside face) and the blast door left open outside
  for (let k = 0; k < 6; k++) m.box(39.36, 2.62, -5.4 + k * 0.47, 39.42, 2.95, -5.4 + (k + 1) * 0.47, k % 2 ? [0.03, 0.03, 0.03] : P.safety, MAT.METAL, 1);
  m.rbox([41.5, 1.35, -1.9], [0.32, 2.7, 2.6], 0, -0.9, 0, shadeRGB(metal, 0.9), MAT.METAL, 0.6);
  m.box(38.8, 2.85, -4.15, 39.2, 3.15, -3.85, [3.0, 0.35, 0.15], MAT.EMISSIVE, 1);
  // sandbags
  for (let k = 0; k < 9; k++) m.rbox([41 + (k % 3) * 0.75, 0.2 + Math.floor(k / 3) * 0.32, -7.2 + Math.floor(k / 3) * 0.1], [0.72, 0.3, 0.45], 0, rnd() * 0.2, 0, [0.3, 0.27, 0.2], MAT.DIRT, 0.6);
  // ramp slab, rails and cables
  m.beam([24, -6.45, -3.5], [38, -0.45, -3.5], 7, 0.9, shadeRGB(P.concreteFloor, 1.05), MAT.CONCRETE, [0, 1, 0]);
  m.beam([24, -5.0, -6.9], [38, 1.0, -6.9], 0.08, 0.08, P.safety, MAT.METAL);
  for (let k = 0; k < 4; k++) m.beam([24, -3.4 + k * 0.12, -6.85], [30, -0.9 + k * 0.12, -6.85], 0.05, 0.05, k % 2 ? [0.05, 0.05, 0.05] : [0.25, 0.08, 0.05], MAT.METAL);
  lampCage(m, tokens.lights[lightIndex('ramp')].pos, 0.4);
  // barrel fire
  const fire = tokens.lights[lightIndex('fire')].pos;
  m.cylinder([fire[0], 0, fire[2]], 0.4, 1.0, 9, shadeRGB(P.rust, 0.8), MAT.METAL);
  m.cylinder([fire[0], 0.95, fire[2]], 0.34, 0.06, 9, P.forge, MAT.EMISSIVE);
  for (let k = 0; k < 4; k++) m.rbox([fire[0] + (rnd() - 0.5) * 1.8, 0.2, fire[2] + 0.9 + rnd() * 0.5], [0.9, 0.35, 0.4], 0, rnd() * 3, 0, [0.22, 0.2, 0.18], MAT.WOOD);
  for (let k = 0; k < 14 * pk; k++) particles.push({ p: [fire[0] + (rnd() - 0.5) * 0.4, 1.0, fire[2] + (rnd() - 0.5) * 0.4], kind: 2, seed: rnd() });
  // ruins on the horizon
  const ruins: [number, number, number, number, number][] = [
    [-62, -28, 14, 8, 5], [-38, -44, 18, 10, 7], [-8, -27, 10, 7, 3], [10, -56, 16, 12, 9], [46, -34, 12, 9, 4],
    [-22, -82, 22, 12, 10], [32, -92, 22, 12, 13], [-80, -70, 16, 12, 8], [70, -60, 16, 10, 6], [-110, -45, 20, 10, 6],
  ];
  for (const r of ruins) ruin(m, r[0], r[1], r[2], r[3], r[4], rnd);
  // dead trees, poles, wrecks, rubble
  for (const t of [[-48, -9], [-30, -12], [-14, -10.5], [6, -13], [22, -9.5], [48, -12]]) deadTree(m, t[0], t[1], 4 + rnd() * 3, rnd);
  const poles: V3[] = [];
  for (let k = 0; k < 6; k++) {
    const x = -66 + k * 22, z = -14;
    m.box(x - 0.12, 0, z - 0.12, x + 0.12, 7.5 - (k === 3 ? 2.5 : 0), z + 0.12, [0.12, 0.09, 0.07], MAT.WOOD, 0.7);
    m.box(x - 0.9, 6.8 - (k === 3 ? 2.5 : 0), z - 0.08, x + 0.9, 6.95 - (k === 3 ? 2.5 : 0), z + 0.08, [0.12, 0.09, 0.07], MAT.WOOD, 1);
    poles.push([x, 6.9 - (k === 3 ? 2.5 : 0), z]);
  }
  for (let k = 0; k < poles.length - 1; k++) {
    if (k === 2) continue;
    for (const off of [-0.8, 0.8]) {
      const pts = catenary([poles[k][0] + off, poles[k][1], poles[k][2]], [poles[k + 1][0] + off, poles[k + 1][1], poles[k + 1][2]], 1.3, 10);
      for (let q = 0; q < pts.length - 1; q++) m.beam(pts[q], pts[q + 1], 0.03, 0.03, [0.02, 0.02, 0.02], MAT.METAL);
    }
  }
  // wrecked car
  m.rbox([18, 0.6, -10], [4.2, 0.9, 1.9], 0, 0.3, 0.06, shadeRGB(P.rust, 0.85), MAT.METAL, 0.4);
  m.rbox([17.8, 1.35, -10], [2.2, 0.7, 1.7], 0, 0.3, 0.06, shadeRGB(P.rust, 0.7), MAT.METAL, 0.8);
  m.rbox([-20, 0.55, -7], [4, 0.8, 1.8], 0, -0.4, -0.12, shadeRGB(P.tinTeal, 0.7), MAT.METAL, 0.4);
  for (let k = 0; k < tokens.detail.surfaceRubble; k++) {
    const x = -76 + rnd() * 124, z = -1 - rnd() * 14;
    if (x > 28 && x < 48 && z > -8.5) continue;
    if (x > 15 && x < 21 && z < -8) continue;
    const s = 0.2 + rnd() * 0.8;
    m.rbox([x, s * 0.25, z], [s * 1.4, s * 0.6, s], rnd() * 2, rnd() * 3, rnd() * 2, shadeRGB(rnd() < 0.5 ? P.concreteWall : P.ash, 0.5 + rnd() * 0.4), rnd() < 0.5 ? MAT.CONCRETE : MAT.ROCK, 0.5);
  }
  for (let k = 0; k < tokens.detail.ash * pk; k++) particles.push({ p: [-76 + rnd() * 126, rnd() * 14, -1 - rnd() * 20], kind: 1, seed: rnd() });

  // ---------------------------------------------------------------- atrium
  const slab = shadeRGB(P.concreteWall, 0.85);
  m.box(19, -6.35, -12, 24, -6, 0, slab, MAT.CONCRETE, 0.7);
  m.box(4, -6.35, -12, 19, -6, -9, slab, MAT.CONCRETE, 0.7);
  m.box(4, -11.35, -12, 9, -11, 0, slab, MAT.CONCRETE, 0.7);
  m.box(9, -11.35, -12, 24, -11, -9, slab, MAT.CONCRETE, 0.7);
  // safety edges
  m.box(4, -6.36, -9.04, 19, -6.2, -8.96, P.safety, MAT.METAL, 1);
  m.box(9, -11.36, -9.04, 24, -11.2, -8.96, P.safety, MAT.METAL, 1);
  railing(m, [4.1, -6, -9.1], [16.3, -6, -9.1]);
  railing(m, [19.1, -6, -8.9], [19.1, -6, -0.15]);
  railing(m, [19.1, -6, -0.15], [23.9, -6, -0.15]);
  railing(m, [9.1, -11, -7.3], [9.1, -11, -0.15]);
  railing(m, [4.1, -11, -0.15], [9.1, -11, -0.15]);
  railing(m, [9.1, -11, -9.1], [13.9, -11, -9.1]);
  railing(m, [15.4, -11, -9.1], [23.9, -11, -9.1]);
  stairs(m, 17, -6, 9, -11, -9, -7.5, shadeRGB(metal, 1.1), MAT.METAL);
  stairs(m, 14, -11, 22, -16, -9, -7.5, shadeRGB(metal, 1.1), MAT.METAL);
  // columns
  for (const c of [[19.25, -0.5, -16, -6.35], [8.75, -0.5, -16, -11.35], [23.5, -9.3, -16, -11.35], [4.6, -9.3, -11, -6.35], [23.5, -0.5, -11, -6.35]] as const)
    m.box(c[0] - 0.28, c[2], c[1] - 0.28, c[0] + 0.28, c[3], c[1] + 0.28, shadeRGB(P.concreteWall, 0.95), MAT.CONCRETE, 0.55);
  // chandelier
  const ch = tokens.lights[lightIndex('chandelier')].pos;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    m.beam([ch[0], -2.0, ch[2]], [ch[0] + Math.cos(a) * 1.3, ch[1] + 0.05, ch[2] + Math.sin(a) * 1.3], 0.03, 0.03, dark, MAT.METAL);
  }
  for (let k = 0; k < 12; k++) {
    const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
    m.beam([ch[0] + Math.cos(a0) * 1.3, ch[1], ch[2] + Math.sin(a0) * 1.3], [ch[0] + Math.cos(a1) * 1.3, ch[1], ch[2] + Math.sin(a1) * 1.3], 0.09, 0.09, dark, MAT.METAL);
    if (k % 2 === 0) {
      const b: V3 = [ch[0] + Math.cos(a0) * 1.3, ch[1] - 0.15, ch[2] + Math.sin(a0) * 1.3];
      m.box(b[0] - 0.08, b[1] - 0.1, b[2] - 0.08, b[0] + 0.08, b[1] + 0.06, b[2] + 0.08, P.window, MAT.EMISSIVE, 1);
      halos.push({ p: b, c: tokens.lights[lightIndex('chandelier')].color, size: 0.35, light: lightIndex('chandelier') });
    }
  }
  // generator
  m.box(17.4, -16, -11.9, 21.6, -13.5, -9.7, shadeRGB(P.tinTeal, 0.8), MAT.METAL, 0.45);
  m.box(17.8, -13.5, -11.6, 20.2, -13.0, -10.0, dark, MAT.METAL, 0.8);
  m.box(17.6, -14.6, -9.69, 19.4, -14.35, -9.65, [0.3, 2.2, 0.6], MAT.EMISSIVE, 1);
  m.cylinder([21.0, -13.5, -11.4], 0.2, 11.5, 8, shadeRGB(P.rust, 0.9), MAT.METAL, 'y', false);
  for (let k = 0; k < 3; k++) m.cylinder([17.4, -15.2 + k * 0.45, -10.8 + k * 0.3], 0.12, -3.4, 6, shadeRGB(metal, 0.9), MAT.METAL, 'x', false);
  // water tanks under the left landing
  m.cylinder([5.6, -16, -10.6], 1.0, 3.2, 12, shadeRGB(P.tin, 0.95), MAT.TIN);
  m.cylinder([5.6, -16, -7.9], 0.9, 2.8, 12, shadeRGB(P.tin, 0.85), MAT.TIN);
  // the commons: long tables and benches
  for (const tz of [-3.2, -5.6]) {
    m.box(10.2, -15.25, tz - 0.45, 16.2, -15.12, tz + 0.45, shadeRGB(P.wood, 1.1), MAT.WOOD, 0.8);
    for (const lx of [10.5, 15.9]) m.box(lx - 0.06, -16, tz - 0.35, lx + 0.06, -15.25, tz + 0.35, dark, MAT.METAL, 0.8);
    for (const bz of [tz - 0.85, tz + 0.85]) m.box(10.4, -15.6, bz - 0.17, 16.0, -15.5, bz + 0.17, shadeRGB(P.wood, 0.8), MAT.WOOD, 0.6);
  }
  for (let k = 0; k < 5; k++) m.box(11 + k * 1.1, -15.12, -3.4, 11.25 + k * 1.1, -14.95, -3.15, shadeRGB(P.tin, 1.2), MAT.METAL, 1);
  // banners
  m.box(19.6, -10.6, -11.98, 21.4, -6.9, -11.9, P.cloth, MAT.DIRT, 1);
  m.box(20.2, -8.4, -11.9, 20.8, -7.8, -11.86, P.safety, MAT.METAL, 1);
  m.box(12.4, -5.7, -11.98, 14.2, -2.6, -11.9, shadeRGB(P.safety, 0.55), MAT.DIRT, 1);
  // crates and barrels on the floor
  crate(m, 22.6, -16, -2.4, 1.1, rnd); crate(m, 22.9, -14.9, -2.6, 0.8, rnd); crate(m, 21.4, -16, -1.6, 0.9, rnd);
  barrel(m, 7.6, -16, -2.2, shadeRGB(P.tinRed, 0.9)); barrel(m, 8.3, -16, -1.4, shadeRGB(P.tinTeal, 0.9));
  // L1 lamp and L2 crates
  lampCage(m, tokens.lights[lightIndex('l1lamp')].pos, 1.2);
  crate(m, 6, -6, -10.8, 1, rnd); crate(m, 7.2, -6, -11.2, 0.8, rnd);
  for (let k = 0; k < 40 * pk; k++) particles.push({ p: [ch[0] + (rnd() - 0.5) * 7, -15 + rnd() * 11, ch[2] + (rnd() - 0.5) * 7], kind: 0, seed: rnd() });

  // ---------------------------------------------------------------- service corridor
  m.cylinder([-14, -12.55, -5.3], 0.2, 18, 8, shadeRGB(P.rust, 0.85), MAT.METAL, 'x', false);
  m.cylinder([-14, -12.95, -4.75], 0.13, 18, 6, shadeRGB(metal, 1.1), MAT.METAL, 'x', false);
  m.box(-14, -12.35, -3.4, 4, -12.3, -2.6, dark, MAT.METAL, 1);
  m.box(-14, -14.65, -5.99, 4, -14.45, -5.95, shadeRGB(P.safety, 0.8), MAT.METAL, 1);
  for (const lx of [-2, -10]) lampCage(m, [lx, -12.6, -3], 0.25, lx === -10 ? [1.6, 1.9, 2.4] : P.window);
  m.box(-7, -16, -5.95, -4.6, -13.2, -5.75, shadeRGB(metal, 0.9), MAT.METAL, 0.6);
  m.box(-6.95, -15.9, -5.76, -4.65, -13.3, -5.7, shadeRGB(P.tinTeal, 0.75), MAT.METAL, 0.6);
  m.box(-5.95, -13.8, -5.72, -5.65, -13.5, -5.66, [2.8, 0.25, 0.1], MAT.EMISSIVE, 1);
  crate(m, -12, -16, -4.8, 0.9, rnd); crate(m, 1.5, -16, -5.2, 0.7, rnd);
  for (let k = 0; k < 18 * pk; k++) particles.push({ p: [-12 + rnd() * 14, -15.8 + rnd() * 3.5, -1 - rnd() * 4.5], kind: 0, seed: rnd() });

  // ---------------------------------------------------------------- the living district (cavern)
  shack(m, -20, -16, -16, -10, -5, 3.0, shadeRGB(P.tin, 0.95), rnd);
  shack(m, -40, -35, -16, -8, -4.5, 2.9, shadeRGB(P.tinTeal, 1.0), rnd);
  // static window glows (no light slot needed)
  for (const w of [[-20, -16, -16, -5], [-40, -35, -16, -4.5], [-40, -36, -11.5, -11]])
    halos.push({ p: [w[0] + (w[1] - w[0]) * 0.72, w[2] + 1.55, w[3] + 0.15], c: [1, 0.6, 0.3], size: 0.9, light: -1 });
  // workshop: open front
  const wsCol = shadeRGB(P.tinRed, 0.9);
  m.box(-25, -16, -12, -20, -12.9, -11.8, wsCol, MAT.TIN, 0.5);
  m.box(-25, -16, -11.8, -24.8, -12.9, -6, wsCol, MAT.TIN, 0.5);
  m.box(-20.2, -16, -11.8, -20, -12.9, -6, wsCol, MAT.TIN, 0.5);
  m.rbox([-22.5, -12.7, -8.9], [5.6, 0.12, 6.8], -0.1, 0, 0, shadeRGB(P.rust, 1.0), MAT.TIN, 0.9);
  m.box(-24.4, -16, -10.4, -22.6, -15.0, -8.6, shadeRGB(P.concreteWall, 0.7), MAT.CONCRETE, 0.5);
  m.box(-24.2, -15.02, -10.2, -22.8, -14.92, -8.8, P.forge, MAT.EMISSIVE, 1);
  m.box(-24.0, -13.9, -10.0, -23.0, -13.5, -9.0, dark, MAT.METAL, 1);
  m.cylinder([-23.5, -13.5, -9.5], 0.18, 0.7, 6, dark, MAT.METAL, 'y', false);
  m.box(-21.9, -16, -8.0, -21.3, -15.4, -7.6, dark, MAT.METAL, 0.6);
  m.box(-22.1, -15.4, -8.05, -21.1, -15.15, -7.55, shadeRGB(metal, 1.2), MAT.METAL, 1);
  m.box(-23.8, -15.05, -11.6, -20.5, -14.9, -10.9, shadeRGB(P.wood, 1.0), MAT.WOOD, 0.8);
  for (let k = 0; k < 5; k++) m.beam([-24 + k * 0.7, -13.6, -11.75], [-24 + k * 0.7 + 0.1, -14.6, -11.75], 0.05, 0.05, shadeRGB(metal, 1.2), MAT.METAL);
  for (let k = 0; k < tokens.detail.sparks * pk; k++) particles.push({ p: [-23.5 + (rnd() - 0.5) * 1.0, -14.9, -9.5 + (rnd() - 0.5) * 1.0], kind: 2, seed: rnd() });
  // platform on stilts, two houses, stairs
  m.box(-41, -11.8, -14, -29, -11.5, -9.5, shadeRGB(P.wood, 0.95), MAT.WOOD, 0.8);
  for (const sx of [-40.6, -35, -29.4]) {
    m.cylinder([sx, -16, -9.8], 0.12, 4.2, 6, dark, MAT.METAL, 'y', false);
    m.cylinder([sx, -16, -13.5], 0.12, 4.2, 6, dark, MAT.METAL, 'y', false);
  }
  m.beam([-40.6, -15.8, -9.8], [-35, -12, -9.8], 0.06, 0.06, dark, MAT.METAL);
  m.beam([-29.4, -15.8, -9.8], [-35, -12, -9.8], 0.06, 0.06, dark, MAT.METAL);
  railing(m, [-40.9, -11.5, -9.6], [-34.8, -11.5, -9.6], 1.0, 1.3, shadeRGB(P.wood, 0.8), shadeRGB(P.wood, 0.6));
  railing(m, [-33.2, -11.5, -9.6], [-29.3, -11.5, -9.6], 1.0, 1.3, shadeRGB(P.wood, 0.8), shadeRGB(P.wood, 0.6));
  shack(m, -40, -36, -11.5, -14, -11, 2.8, shadeRGB(P.tinRed, 1.0), rnd);
  shack(m, -33, -30, -11.5, -14, -11.2, 2.5, shadeRGB(P.tin, 0.8), rnd, false);
  m.beam([-30.6, -8.7, -12.5], [-30.4, -6.4, -12.4], 0.05, 0.05, dark, MAT.METAL);
  m.rbox([-30.3, -7.0, -12.1], [0.9, 0.9, 0.08], 0.5, 0.4, 0, shadeRGB(P.tin, 1.1), MAT.METAL, 1);
  stairs(m, -34, -11.5, -27, -16, -9.5, -8, shadeRGB(P.wood, 1.0), MAT.WOOD);
  lampCage(m, tokens.lights[lightIndex('platform')].pos, Math.max(0.3, cavernCeil(-35) - tokens.lights[lightIndex('platform')].pos[1] - 0.2));
  // rope bridge to the lookout ledge
  const bz0 = -10.9, bz1 = -9.7;
  const sagY = (t: number) => -11.5 - 0.35 * Math.sin(Math.PI * t);
  for (let k = 0; k < 24; k++) {
    const t = (k + 0.5) / 24, x = -29 + 10 * t;
    m.box(x - 0.16, sagY(t) - 0.08, bz0, x + 0.16, sagY(t), bz1, shadeRGB(P.wood, 0.8 + rnd() * 0.4), MAT.WOOD, 0.9);
  }
  for (const z of [bz0, bz1]) {
    const top = catenary([-29, -10.5, z], [-19, -10.5, z], 0.45, 12);
    for (let q = 0; q < top.length - 1; q++) m.beam(top[q], top[q + 1], 0.04, 0.04, [0.32, 0.26, 0.16], MAT.WOOD);
    for (let q = 1; q < top.length - 1; q += 2) m.beam(top[q], [top[q][0], sagY(q / 12), z], 0.025, 0.025, [0.32, 0.26, 0.16], MAT.WOOD);
  }
  // lookout ledge: a rock shelf on a pillar
  m.box(-19.2, -12.2, -14.6, -15.8, -11.5, -9.0, shadeRGB(P.caveWall, 0.9), MAT.ROCK, 0.7);
  m.box(-18.8, -16, -14.6, -16.6, -12.2, -12.4, shadeRGB(P.caveWall, 0.8), MAT.ROCK, 0.5);
  railing(m, [-19.1, -11.5, -9.1], [-15.9, -11.5, -9.1], 1.0, 1.0, shadeRGB(P.wood, 0.8), shadeRGB(P.wood, 0.6));
  m.cylinder([-16.6, -11.5, -13.5], 0.6, 1.4, 10, shadeRGB(P.tinTeal, 0.9), MAT.TIN);
  const lk = tokens.lights[lightIndex('lookout')].pos;
  m.box(lk[0] - 0.05, -11.5, lk[2] - 0.05, lk[0] + 0.05, lk[1] + 0.2, lk[2] + 0.05, dark, MAT.METAL, 1);
  lampCage(m, lk, 0.1, [1.7, 2.0, 2.6]);
  // garden under grow lights
  m.box(-32, -16, -2.6, -28, -15.5, -0.6, shadeRGB(P.wood, 0.7), MAT.WOOD, 0.5);
  m.box(-31.9, -15.52, -2.5, -28.1, -15.45, -0.7, shadeRGB(P.caveFloor, 0.6), MAT.DIRT, 1);
  for (let k = 0; k < 36; k++) {
    const x = -31.7 + (k % 12) * 0.31 + rnd() * 0.1, z = -2.25 + Math.floor(k / 12) * 0.62, h = 0.25 + rnd() * 0.3;
    const g = shadeRGB(P.plant, 1.1 + rnd() * 0.8);
    m.rbox([x, -15.45 + h / 2, z], [0.32, h, 0.05], 0, rnd() * 3, (rnd() - 0.5) * 0.4, g, MAT.DIRT, 0.5);
    m.rbox([x, -15.45 + h / 2, z], [0.05, h, 0.32], 0, rnd() * 3, (rnd() - 0.5) * 0.4, g, MAT.DIRT, 0.5);
  }
  for (const gx of [-31.9, -28.1]) m.box(gx - 0.04, -16, -1.65, gx + 0.04, -13.5, -1.55, dark, MAT.METAL, 1);
  m.box(-31.9, -13.7, -1.75, -28.1, -13.55, -1.45, [2.6, 0.7, 2.2], MAT.EMISSIVE, 1);
  // string lights across the cavern
  const strands: [V3, V3][] = [[[-15.5, cavernCeil(-16) - 0.6, -7], [-41, cavernCeil(-40) - 0.4, -6.5]], [[-16, cavernCeil(-17) - 0.8, -12.8], [-30, cavernCeil(-30) - 0.6, -4.5]]];
  for (const [a, b] of strands) {
    const pts = catenary(a, b, 1.6, 26);
    for (let q = 0; q < pts.length - 1; q++) m.beam(pts[q], pts[q + 1], 0.02, 0.02, [0.03, 0.03, 0.03], MAT.METAL);
    const nb = Math.round(tokens.detail.stringBulbs / 2);
    for (let q = 1; q <= nb; q++) {
      const p = pts[Math.round((q / (nb + 1)) * (pts.length - 1))];
      const bc: RGB = q % 3 === 0 ? [2.4, 1.0, 0.5] : [2.6, 1.7, 0.8];
      m.box(p[0] - 0.06, p[1] - 0.16, p[2] - 0.06, p[0] + 0.06, p[1] - 0.04, p[2] + 0.06, bc, MAT.EMISSIVE, 1);
      halos.push({ p: [p[0], p[1] - 0.1, p[2]], c: [1.0, 0.7, 0.4], size: 0.45, light: -1 });
    }
  }
  // clutter
  crate(m, -15.6, -16, -6, 0.9, rnd); crate(m, -26, -16, -5.2, 0.8, rnd); crate(m, -33, -16, -5.4, 1.0, rnd); crate(m, -32.7, -15, -5.6, 0.7, rnd);
  barrel(m, -19.6, -16, -3.2, shadeRGB(P.tinRed, 0.8)); barrel(m, -34.2, -16, -1.8, shadeRGB(metal, 1.1)); barrel(m, -26.4, -16, -10.8, shadeRGB(P.tinTeal, 0.8));
  // laundry line between the shacks
  const ll = catenary([-35, -13.4, -5], [-20, -13.2, -5.4], 0.5, 12);
  for (let q = 0; q < ll.length - 1; q++) m.beam(ll[q], ll[q + 1], 0.015, 0.015, [0.05, 0.05, 0.05], MAT.METAL);
  for (let q = 1; q < ll.length - 1; q += 2) {
    const c: RGB = [[0.55, 0.5, 0.42], [0.4, 0.13, 0.08], [0.15, 0.2, 0.3]][q % 3] as RGB;
    m.box(ll[q][0] - 0.3, ll[q][1] - 0.75, ll[q][2] - 0.02, ll[q][0] + 0.3, ll[q][1], ll[q][2] + 0.02, c, MAT.DIRT, 1);
  }
  // glowing lichen on the cavern walls (the district's identity in the dark)
  for (let k = 0; k < 60; k++) {
    const x = -41 + rnd() * 26;
    const y = -15.6 + rnd() * (cavernCeil(x) + 15.2);
    const d = depthAt(x, y);
    if (d < 10) continue;
    const s = 0.05 + rnd() * 0.1;
    const c: RGB = rnd() < 0.6 ? [0.12, 0.55, 0.42] : [0.35, 0.6, 0.18];
    for (let q = 0; q < 3; q++) m.box(x + (rnd() - 0.5) * 0.6 - s, y + (rnd() - 0.5) * 0.5 - s, -d - 0.02, x + (rnd() - 0.5) * 0.6 + s, y + (rnd() - 0.5) * 0.5 + s, -d + 0.08, c, MAT.GLOW, 1);
  }
  for (let k = 0; k < 50 * pk; k++) particles.push({ p: [-41 + rnd() * 26, -15.8 + rnd() * 7, -1 - rnd() * 12], kind: 0, seed: rnd() });

  // ---------------------------------------------------------------- the dark edge
  for (const fx of [-44, -47.2]) {
    m.box(fx - 0.15, -16, -5.6, fx + 0.15, -12.3, -5.3, shadeRGB(P.wood, 0.7), MAT.WOOD, 0.6);
    m.box(fx - 0.15, -16, -0.7, fx + 0.15, -12.3, -0.4, shadeRGB(P.wood, 0.7), MAT.WOOD, 0.6);
    m.box(fx - 0.2, -12.5, -5.8, fx + 0.2, -12.15, -0.2, shadeRGB(P.wood, 0.6), MAT.WOOD, 0.8);
  }
  // the blockage
  for (let k = 0; k < tokens.detail.rubblePieces; k++) {
    const u = rnd() * 2 - 1;
    const x = -51.5 + u * 3.2;
    const hmax = 3.7 * (1 - u * u * 0.85);
    const s = 0.3 + rnd() * 0.85;
    const y = -16 + rnd() * hmax;
    if (y > -12.6 && x < -51) continue; // a crack at the top lets the light through
    m.rbox([x, y, -0.5 - rnd() * 5.2], [s * (1 + rnd()), s * (0.5 + rnd() * 0.5), s * (0.8 + rnd())], rnd() * 3, rnd() * 3, rnd() * 3,
      shadeRGB(k % 4 === 0 ? P.concreteWall : P.caveWall, 0.45 + rnd() * 0.45), k % 4 === 0 ? MAT.CONCRETE : MAT.ROCK, 0.5);
  }
  // barrier and dig tools
  m.box(-46.6, -16, -5.5, -46.4, -15.2, -5.3, dark, MAT.METAL, 0.6);
  m.box(-46.6, -16, -4.0, -46.4, -15.2, -3.8, dark, MAT.METAL, 0.6);
  for (let k = 0; k < 4; k++) m.box(-46.65, -15.3, -5.6 + k * 0.45, -46.35, -15.0, -5.6 + (k + 1) * 0.45, k % 2 ? [0.03, 0.03, 0.03] : P.safety, MAT.METAL, 1);
  m.beam([-48.6, -16, -4.4], [-48.9, -14.6, -4.6], 0.05, 0.05, shadeRGB(P.wood, 1.1), MAT.WOOD);
  m.rbox([-48.9, -14.65, -4.6], [0.5, 0.08, 0.12], 0, 0, 0.3, shadeRGB(metal, 1.2), MAT.METAL);
  m.box(-47.9, -16, -1.5, -47.6, -15.65, -1.2, [2.4, 1.3, 0.5], MAT.EMISSIVE, 1);
  halos.push({ p: [-47.75, -15.8, -1.35], c: [1, 0.6, 0.3], size: 0.6, light: -1 });

  // ---------------------------------------------------------------- hidden: the old metro platform
  const tileC = shadeRGB(P.tile, 0.9);
  m.box(-77, -17, -9, -58, -16, -4.5, tileC, MAT.TILE, 0.6);
  m.box(-77, -16.02, -4.7, -58, -15.98, -4.5, P.safety, MAT.METAL, 1);
  for (const rz of [-3.0, -1.6]) m.box(-77, -16.95, rz - 0.05, -58, -16.82, rz + 0.05, shadeRGB(metal, 1.3), MAT.METAL, 1);
  for (let x = -76.6; x < -58; x += 0.8) m.box(x - 0.12, -17, -3.6, x + 0.12, -16.95, -1.0, [0.12, 0.08, 0.06], MAT.WOOD, 0.8);
  for (const cx of [-73, -67, -61]) m.box(cx - 0.3, -16, -8.6, cx + 0.3, -11, -8.0, shadeRGB(P.tile, 0.8), MAT.TILE, 0.5);
  m.box(-77.5, -16.8, -4.3, -67.5, -13.8, -0.5, shadeRGB(P.tinTeal, 0.55), MAT.METAL, 0.5);
  m.box(-77, -15.2, -0.48, -68, -14.5, -0.44, [0.12, 0.5, 0.45], MAT.EMISSIVE, 1);
  m.box(-70, -13.6, -8.98, -64, -13.0, -8.92, [0.5, 1.2, 1.1], MAT.EMISSIVE, 1);
  for (let k = 0; k < 20 * pk; k++) particles.push({ p: [-74 + rnd() * 16, -16.5 + rnd() * 5, -1 - rnd() * 7], kind: 0, seed: rnd() });

  // ---------------------------------------------------------------- hidden: the crystal pocket
  for (let k = 0; k < 18; k++) {
    const x = -31 + rnd() * 10;
    const top = rnd() < 0.3;
    const y = top ? -21.6 - rnd() * 0.5 : -27.2 + Math.abs(x + 26) * 0.18;
    const h = 0.6 + rnd() * 1.6;
    const c = mixRGB(P.crystalA, P.crystalB, rnd());
    m.rbox([x, y + (top ? -h / 2 : h / 2), -1.5 - rnd() * 5.5], [0.25 + rnd() * 0.2, h, 0.25 + rnd() * 0.2], (rnd() - 0.5) * 0.8, rnd() * 3, (rnd() - 0.5) * 0.8, shadeRGB(c, 0.6), MAT.GLOW, 1);
  }
  for (let k = 0; k < 14 * pk; k++) particles.push({ p: [-30 + rnd() * 8, -26.5 + rnd() * 4, -1 - rnd() * 6], kind: 0, seed: rnd() });

  // the tunnel beyond the rubble: dust in the teal light
  for (let k = 0; k < 16 * pk; k++) particles.push({ p: [-57 + rnd() * 8, -15.8 + rnd() * 3.5, -1 - rnd() * 4.5], kind: 0, seed: rnd() });

  const dustLeft = Math.max(0, tokens.detail.dust * pk - particles.filter((p) => p.kind === 0).length);
  for (let k = 0; k < dustLeft; k++) particles.push({ p: [-40 + rnd() * 64, -15.8 + rnd() * 10, -1 - rnd() * 10], kind: 0, seed: rnd() });

  return { halos, cones, particles };
}

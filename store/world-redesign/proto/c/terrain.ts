import { tokens, type RGB } from './tokens';
import { MAT, Mesh, mixRGB, shadeRGB } from './mesh';
import { noise3, lerp, smooth, type V3 } from './math';

/**
 * The rock mass: a 1 m grid over the cross-section (x right, y up), each cell either solid rock or a cavity with its own depth
 * (how far back its back wall is). The front face z = 0 is the cut. Natural caves get their vertices jittered by noise, so the
 * voxel steps turn into rough rock; built rooms stay crisp.
 */
export const GX0 = -80, GX1 = 52, GY0 = -32, GY1 = 0;
export const SKY_DEPTH = 16;
const W = GX1 - GX0, H = GY1 - GY0;

export const K = { SOLID: 0, BUILT: 1, CAVE: 2, TILE: 3, CORR: 4, SKY: 8, VOID: 9 } as const;

const depth = new Float32Array(W * H);
const kind = new Uint8Array(W * H);

function idx(i: number, j: number): number { return j * W + i; }

export function cellKind(i: number, j: number): number {
  if (j >= H) return K.SKY;
  if (i < 0 || i >= W || j < 0) return K.VOID;
  return kind[idx(i, j)];
}
export function cellDepth(i: number, j: number): number {
  if (j >= H || i < 0 || i >= W || j < 0) return SKY_DEPTH;
  return depth[idx(i, j)];
}
const solid = (i: number, j: number) => cellKind(i, j) === K.SOLID;
/** Back-wall depth of the cavity at world (x, y), or 0 inside rock. */
export function depthAt(x: number, y: number): number {
  const i = Math.floor(x) - GX0, j = Math.floor(y) - GY0;
  return cellKind(i, j) === K.SOLID ? 0 : cellDepth(i, j);
}

function carve(x0: number, x1: number, y0: number, y1: number, fn: (x: number, y: number) => [number, number] | null): void {
  for (let x = Math.floor(x0); x < Math.ceil(x1); x++)
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const i = x - GX0, j = y - GY0;
      if (i < 0 || i >= W || j < 0 || j >= H) continue;
      const r = fn(x + 0.5, y + 0.5);
      if (!r) continue;
      depth[idx(i, j)] = r[0];
      kind[idx(i, j)] = r[1];
    }
}

export function rampFloor(x: number): number {
  if (x >= 38) return 0;
  if (x <= 24) return -6;
  return -6 + ((x - 24) * 6) / 14;
}

export function cavernCeil(x: number): number {
  let c = -6.6 + 1.3 * Math.sin(x * 0.23) + 1.8 * (noise3(x * 0.18, 3.1, 0.7) - 0.5);
  c = lerp(c, -12, smooth(-16, -14, x));
  c = lerp(c, -12, 1 - smooth(-42, -38, x));
  return c;
}

function carveAll(): void {
  depth.fill(0);
  kind.fill(K.SOLID);
  // ramp from the surface hatch down to the atrium's top level
  carve(23, 41, -8, 0, (x, y) => {
    const f = rampFloor(x);
    const ceil = x >= 30 ? 0 : Math.min(f + 3.4, -0.6);
    return y > f - 0.5 && y < ceil ? [7, K.BUILT] : null;
  });
  // three-storey atrium
  carve(4, 24, -16, -2, () => [12, K.BUILT]);
  // service corridor
  carve(-14, 4, -16, -12, () => [6, K.CORR]);
  // the living district: a natural cavern
  carve(-42, -14, -16, -3, (x, y) => (y < cavernCeil(x) ? [Math.round(14.5 + 3 * (noise3(x * 0.15, y * 0.2, 9) - 0.5)), K.CAVE] : null));
  // the dark edge: an old tunnel, blocked
  carve(-58, -42, -16, -11, (x, y) => (y < -12 + 0.8 * (noise3(x * 0.3, 1, 4) - 0.3) ? [6, K.CAVE] : null));
  // hidden: the old metro platform beyond the rubble
  carve(-77, -58, -17, -11, () => [9, K.TILE]);
  // hidden: a crystal pocket under the district
  carve(-34, -18, -29, -20, (x, y) => {
    const e = ((x + 26) / 6.5) ** 2 + ((y + 24.5) / 3.3) ** 2 + 0.6 * (noise3(x * 0.4, y * 0.4, 2) - 0.5);
    return e < 1 ? [8, K.CAVE] : null;
  });
}

/** Colour of the cut face at height y (strata) with a little noise. */
function strataColor(x: number, y: number): RGB {
  const s = tokens.palette.strata;
  const yy = y + 1.2 * (noise3(x * 0.08, y * 0.1, 5) - 0.5);
  for (let k = 0; k < s.length - 1; k++) {
    if (yy <= s[k].y && yy >= s[k + 1].y) {
      const t = (s[k].y - yy) / (s[k].y - s[k + 1].y);
      return mixRGB(s[k].c, s[k + 1].c, smooth(0, 1, t));
    }
  }
  return yy > s[0].y ? s[0].c : s[s.length - 1].c;
}

function surfaceOf(k: number, face: 'floor' | 'ceil' | 'wall' | 'back', x: number, y: number): [RGB, number] {
  const P = tokens.palette;
  const v = 0.9 + 0.2 * noise3(x * 0.3, y * 0.3, 1);
  switch (k) {
    case K.SKY: return [shadeRGB(P.ash, v), MAT.ASH];
    case K.BUILT:
      if (face === 'floor') return [shadeRGB(P.concreteFloor, v), MAT.CONCRETE];
      return [shadeRGB(P.concreteWall, face === 'ceil' ? 0.7 * v : v), MAT.CONCRETE];
    case K.CORR:
      if (face === 'floor') return [shadeRGB(P.concreteFloor, 0.85 * v), MAT.CONCRETE];
      return [shadeRGB(P.corridorWall, face === 'ceil' ? 0.7 * v : v), MAT.CONCRETE];
    case K.TILE:
      if (face === 'floor') return [shadeRGB(P.concreteFloor, 0.7 * v), MAT.CONCRETE];
      return [shadeRGB(P.tile, face === 'ceil' ? 0.6 : v), MAT.TILE];
    default:
      if (face === 'floor') return [shadeRGB(P.caveFloor, v), MAT.DIRT];
      return [shadeRGB(mixRGB(P.caveWall, strataColor(x, y), 0.45), v * (face === 'ceil' ? 0.8 : 1)), MAT.ROCK];
  }
}

/** Is grid vertex (i,j) touching a natural cave (so it gets jittered)? */
function caveVertex(i: number, j: number): boolean {
  return cellKind(i - 1, j - 1) === K.CAVE || cellKind(i, j - 1) === K.CAVE || cellKind(i - 1, j) === K.CAVE || cellKind(i, j) === K.CAVE;
}
function floorVertex(i: number, j: number): boolean {
  return solid(i - 1, j - 1) && solid(i, j - 1) && !solid(i - 1, j) && !solid(i, j);
}

function jit(x: number, y: number, z: number): V3 {
  const i = Math.round(x) - GX0, j = Math.round(y) - GY0;
  if (Math.abs(x - Math.round(x)) > 1e-3 || Math.abs(y - Math.round(y)) > 1e-3 || !caveVertex(i, j)) return [x, y, z];
  const a = tokens.detail.caveJitter;
  const dx = (noise3(x * 0.47, y * 0.47, z * 0.47) - 0.5) * 2 * a;
  const dy = floorVertex(i, j) ? 0 : (noise3(x * 0.47 + 19, y * 0.47, z * 0.47) - 0.5) * 2 * a;
  const dz = z < -0.01 ? (noise3(x * 0.47, y * 0.47 + 37, z * 0.47) - 0.5) * 2 * a * 1.4 : 0;
  return [x + dx, y + dy, z + dz];
}

function aoAt(x: number, y: number, z: number, d: number): number {
  const i = Math.round(x) - GX0, j = Math.round(y) - GY0;
  let n = 0;
  if (solid(i - 1, j - 1)) n++;
  if (solid(i, j - 1)) n++;
  if (solid(i - 1, j)) n++;
  if (solid(i, j)) n++;
  let ao = 1 - 0.14 * n;
  if (z <= -d + 0.01) ao *= 0.72;
  return Math.max(0.32, ao);
}

/** A face whose corners are jittered and whose normal follows the jittered shape (sign kept from `n`). */
function face(m: Mesh, a: V3, b: V3, c: V3, d: V3, n: V3, col: RGB, mat: number, dep: number, front = false): void {
  const A = jit(...a), B = jit(...b), C = jit(...c), D = jit(...d);
  const e1: V3 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], e2: V3 = [D[0] - B[0], D[1] - B[1], D[2] - B[2]];
  let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  if (nx * n[0] + ny * n[1] + nz * n[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const ao = front ? [1, 1, 1, 1] as [number, number, number, number] : [aoAt(...a, dep), aoAt(...b, dep), aoAt(...c, dep), aoAt(...d, dep)] as [number, number, number, number];
  m.quad(A, B, C, D, [nx, ny, nz], col, mat, ao);
}

/** Is a solid cell next to a built room (so its cut face shows the concrete shell)? */
function shell(i: number, j: number): boolean {
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      const k = cellKind(i + a, j + b);
      if (k === K.BUILT || k === K.CORR || k === K.TILE) return true;
    }
  return false;
}

export function buildTerrain(m: Mesh): void {
  carveAll();
  const P = tokens.palette;
  // Pass 0: the cut face first, so the depth test rejects most of what lies behind it (early-z on weak GPUs).
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (cellKind(i, j) !== K.SOLID) continue;
      const x = GX0 + i, y = GY0 + j;
      const sh = shell(i, j);
      const col = sh ? shadeRGB(P.concreteCut, 0.92 + 0.12 * noise3(x * 0.5, y * 0.5, 3)) : strataColor(x + 0.5, y + 0.5);
      face(m, [x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0], [0, 0, 1], col, sh ? MAT.CONCRETE : MAT.CUT, 0, true);
    }
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = GX0 + i, y = GY0 + j;
      const k = cellKind(i, j);
      if (k === K.SOLID) {
        // faces toward empty neighbours
        const nb: [number, number, V3, 'floor' | 'ceil' | 'wall'][] = [[0, 1, [0, 1, 0], 'floor'], [0, -1, [0, -1, 0], 'ceil'], [1, 0, [1, 0, 0], 'wall'], [-1, 0, [-1, 0, 0], 'wall']];
        for (const [di, dj, n, f] of nb) {
          const nk = cellKind(i + di, j + dj);
          if (nk === K.SOLID) continue;
          if (nk === K.VOID && dj !== 0) continue;
          const d = cellDepth(i + di, j + dj);
          const [c, mat] = nk === K.VOID ? [shadeRGB(strataColor(x, y), 0.8), MAT.ROCK] as [RGB, number] : surfaceOf(nk, f, x, y);
          if (dj === 1) face(m, [x, y + 1, 0], [x + 1, y + 1, 0], [x + 1, y + 1, -d], [x, y + 1, -d], n, c, mat, d);
          else if (dj === -1) face(m, [x, y, 0], [x, y, -d], [x + 1, y, -d], [x + 1, y, 0], n, c, mat, d);
          else if (di === 1) face(m, [x + 1, y, 0], [x + 1, y, -d], [x + 1, y + 1, -d], [x + 1, y + 1, 0], n, c, mat, d);
          else face(m, [x, y, 0], [x, y + 1, 0], [x, y + 1, -d], [x, y, -d], n, c, mat, d);
        }
        continue;
      }
      if (k === K.SKY || k === K.VOID) continue;
      const d = cellDepth(i, j);
      // back wall
      const [bc, bm] = surfaceOf(k, 'back', x, y);
      face(m, [x, y, -d], [x + 1, y, -d], [x + 1, y + 1, -d], [x, y + 1, -d], [0, 0, 1], bc, bm, d);
      // steps in depth between neighbouring cavities: a face toward the deeper one
      const nb: [number, number, V3, 'floor' | 'ceil' | 'wall'][] = [[0, 1, [0, -1, 0], 'ceil'], [0, -1, [0, 1, 0], 'floor'], [1, 0, [-1, 0, 0], 'wall'], [-1, 0, [1, 0, 0], 'wall']];
      for (const [di, dj, , f] of nb) {
        const nk = cellKind(i + di, j + dj);
        if (nk === K.SOLID || nk === K.VOID) continue;
        const nd = cellDepth(i + di, j + dj);
        if (nd >= d) continue;
        // this cell is deeper: the neighbour's back rock shows as a face toward this cell
        const [c, mat] = surfaceOf(k, f, x, y);
        const z0 = -nd, z1 = -d;
        if (dj === 1) face(m, [x, y + 1, z0], [x, y + 1, z1], [x + 1, y + 1, z1], [x + 1, y + 1, z0], [0, -1, 0], c, mat, d);
        else if (dj === -1) face(m, [x, y, z0], [x + 1, y, z0], [x + 1, y, z1], [x, y, z1], [0, 1, 0], c, mat, d);
        else if (di === 1) face(m, [x + 1, y, z0], [x + 1, y + 1, z0], [x + 1, y + 1, z1], [x + 1, y, z1], [-1, 0, 0], c, mat, d);
        else face(m, [x, y, z0], [x, y, z1], [x, y + 1, z1], [x, y + 1, z0], [1, 0, 0], c, mat, d);
      }
    }
  // Sky cells over a shallower cavity (the ramp): the ground surface behind it.
  for (let i = 0; i < W; i++) {
    const k = cellKind(i, H - 1);
    if (k === K.SOLID) continue;
    const d = cellDepth(i, H - 1);
    if (d >= SKY_DEPTH) continue;
    const x = GX0 + i;
    m.quad([x, 0, -d], [x + 1, 0, -d], [x + 1, 0, -SKY_DEPTH], [x, 0, -SKY_DEPTH], [0, 1, 0], shadeRGB(P.ash, 0.9), MAT.ASH);
  }
  // the far ground and the ground beside the block
  const ash = shadeRGB(P.ash, 0.85);
  m.quad([-400, 0, -SKY_DEPTH], [400, 0, -SKY_DEPTH], [400, 0, -260], [-400, 0, -260], [0, 1, 0], ash, MAT.ASH);
  m.quad([-400, 0, 0], [GX0, 0, 0], [GX0, 0, -SKY_DEPTH], [-400, 0, -SKY_DEPTH], [0, 1, 0], ash, MAT.ASH);
  m.quad([GX1, 0, 0], [400, 0, 0], [400, 0, -SKY_DEPTH], [GX1, 0, -SKY_DEPTH], [0, 1, 0], ash, MAT.ASH);
}

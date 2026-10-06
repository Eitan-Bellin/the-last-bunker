/**
 * Graphics phase 1 (3D people): the procedural character rig for tools/people3d.ts.
 *
 * Bodies are built from signed-distance primitives (tapered capsules, ellipsoids, rounded boxes) hung on a
 * skeleton and blended smoothly within each body part, so joints read as flesh and cloth instead of cut-out
 * limbs. Units are metres; the character faces +X, up is +Y and its right (near) side faces the viewer (+Z).
 * Animations are key poses on named channels with eased Hermite curves, per-channel lag for overlapping
 * motion, and 2-bone IK that keeps planted feet on the floor.
 */

export type V3 = [number, number, number];
type M3 = number[]; // row-major 3x3

export interface Bone {
  R: M3;
  t: V3;
}

// --- tiny 3D maths ---
const mul = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const app = (R: M3, v: V3): V3 => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rz = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const rx = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const ry = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const child = (p: Bone, off: V3, R: M3): Bone => ({ R: mul(p.R, R), t: add(app(p.R, off), p.t) });
export const point = (b: Bone, v: V3): V3 => add(app(b.R, v), b.t);
export const dir = (b: Bone, v: V3): V3 => app(b.R, v);

// --- bodies ---
export type BodyId = 'man' | 'woman' | 'child' | 'elder';

export interface Body {
  id: BodyId;
  thigh: number; shin: number; ankleH: number; hipDrop: number; hipW: number;
  abd: number; chestLen: number; neck: number; upper: number; fore: number; shW: number; shY: number;
  /** Radius scales: head, limbs, torso (x = depth, z = width). */
  headS: number; limbS: number; torsoS: number; torsoZ: number;
  female: boolean;
  /** Posture added to every pose (elders stoop). */
  posture: Partial<Record<string, number>>;
}

export const BODIES: Record<BodyId, Body> = {
  man: { id: 'man', thigh: 0.43, shin: 0.41, ankleH: 0.085, hipDrop: 0.07, hipW: 0.09, abd: 0.2, chestLen: 0.26, neck: 0.07, upper: 0.29, fore: 0.25, shW: 0.185, shY: 0.21, headS: 1.05, limbS: 1.06, torsoS: 1, torsoZ: 1, female: false, posture: {} },
  woman: { id: 'woman', thigh: 0.41, shin: 0.385, ankleH: 0.08, hipDrop: 0.07, hipW: 0.092, abd: 0.19, chestLen: 0.235, neck: 0.062, upper: 0.27, fore: 0.235, shW: 0.162, shY: 0.19, headS: 1.0, limbS: 0.92, torsoS: 0.9, torsoZ: 0.9, female: true, posture: {} },
  child: { id: 'child', thigh: 0.27, shin: 0.25, ankleH: 0.06, hipDrop: 0.05, hipW: 0.065, abd: 0.14, chestLen: 0.17, neck: 0.045, upper: 0.19, fore: 0.16, shW: 0.125, shY: 0.135, headS: 0.95, limbS: 0.7, torsoS: 0.7, torsoZ: 0.68, female: false, posture: {} },
  elder: { id: 'elder', thigh: 0.42, shin: 0.4, ankleH: 0.085, hipDrop: 0.07, hipW: 0.088, abd: 0.2, chestLen: 0.25, neck: 0.07, upper: 0.285, fore: 0.245, shW: 0.175, shY: 0.2, headS: 1.03, limbS: 0.94, torsoS: 1.02, torsoZ: 0.95, female: false, posture: { sp: 0.13, cl: 0.08, nk: 0.16, hd: -0.12, py: -0.025, sF_N: 0.08, sF_F: 0.05, eF_N: 0.3, eF_F: 0.3 } },
};

export function rootHeight(b: Body): number {
  return b.ankleH + b.shin + b.thigh + b.hipDrop;
}

// --- primitives ---
export const Region = { Skin: 0, Top: 1, Bottom: 2, Gear: 3, Hold: 7 } as const;
export type Region = (typeof Region)[keyof typeof Region];

export interface Prim {
  type: 0 | 1 | 2; // 0 round cone a→b, 1 ellipsoid, 2 rounded box
  a: V3; b: V3; c: V3; r1: number; r2: number; round: number;
  group: number; region: Region; col: V3;
  /** Optional clip plane (world): keep the side where dot(p, n) > w. */
  plane?: [number, number, number, number];
}

export const GROUP_K = [0.05, 0.03, 0.025, 0.025, 0.02, 0.02, 0.012, 0.004, 0.01, 0.01, 0.01, 0.01, 0.004, 0.004, 0.004, 0.004];
export const G = { torso: 0, head: 1, armN: 2, armF: 3, legN: 4, legF: 5, face: 6, detail: 7, gear0: 8, gear1: 9, gear2: 10, gear3: 11, att0: 12, att1: 13, att2: 14, att3: 15 } as const;

const grey = (v: number): V3 => [v, v, v];
export const hex = (h: number): V3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** Local primitive description: points in the bone's frame. */
export interface LP {
  bone: string; type: 0 | 1 | 2; a: V3; b?: V3; c?: V3; r1: number; r2?: number; round?: number;
  group: number; region: Region; col: V3; plane?: [V3, V3]; // plane: point, normal (local)
}

/** Turns local primitives into world primitives using the posed bones. */
export function place(lps: LP[], bones: Record<string, Bone>): Prim[] {
  return lps.map(l => {
    const bn = bones[l.bone];
    const p: Prim = { type: l.type, a: point(bn, l.a), b: [0, 0, 0], c: [0, 0, 0], r1: l.r1, r2: l.r2 ?? l.r1, round: l.round ?? 0, group: l.group, region: l.region, col: l.col };
    if (l.type === 0) p.b = point(bn, l.b!);
    else { p.b = dir(bn, l.b!); p.c = dir(bn, l.c!); }
    if (l.plane) {
      const pt = point(bn, l.plane[0]), n = dir(bn, l.plane[1]);
      p.plane = [n[0], n[1], n[2], n[0] * pt[0] + n[1] * pt[1] + n[2] * pt[2]];
    }
    return p;
  });
}

const cone = (bone: string, a: V3, b: V3, r1: number, r2: number, group: number, region: Region, col: V3): LP => ({ bone, type: 0, a, b, r1, r2, group, region, col });
const ell = (bone: string, c: V3, r: V3, group: number, region: Region, col: V3, plane?: [V3, V3]): LP => ({ bone, type: 1, a: c, b: [r[0], 0, 0], c: [0, r[1], 0], r1: r[2], group, region, col, plane });
const box = (bone: string, c: V3, h: V3, round: number, group: number, region: Region, col: V3): LP => ({ bone, type: 2, a: c, b: [h[0], 0, 0], c: [0, h[1], 0], r1: h[2], round, group, region, col });

/** Albedo of the tinted regions (the game multiplies these by the outfit / skin colour). */
const SKIN = grey(1);
const CLOTH = grey(0.96), CLOTH_D = grey(0.84), PANTS = grey(0.95);
const BOOT = hex(0x3a2c22), SOLE = hex(0x1e1814), BELT = hex(0x2e2620), BUCKLE = hex(0x8a8070);

export interface Dress {
  /** Sleeves to the wrist (else rolled to the elbow). */
  longSleeves: boolean;
}

/** The body's primitives in bone space. `grip` 0..1 per hand: open hand → fist. */
export function bodyPrims(b: Body, gripN: number, gripF: number): LP[] {
  const L: LP[] = [];
  const hs = b.headS, ls = b.limbS, ts = b.torsoS, tz = b.torsoZ;
  // Pelvis and trousers' seat.
  L.push(ell('root', [-0.012 * ts, -0.02, 0], [0.112 * ts, 0.11 * ts, (b.female ? 0.172 : 0.158) * tz], G.torso, Region.Bottom, PANTS));
  // Belt with a buckle.
  L.push(ell('root', [0.0, 0.055 * ts, 0], [0.114 * ts, 0.026 * ts, (b.female ? 0.152 : 0.158) * tz], G.detail, Region.Gear, BELT));
  L.push(box('root', [0.112 * ts, 0.055 * ts, 0.0], [0.006, 0.016 * ts, 0.022 * ts], 0.004, G.detail, Region.Gear, BUCKLE));
  // Belly and chest under the shirt.
  const belly = b.id === 'elder' ? 1.12 : 1;
  L.push(ell('spine', [0.004, b.abd * 0.5, 0], [0.104 * ts * belly, b.abd * 0.62, (b.female ? 0.13 : 0.148) * tz], G.torso, Region.Top, CLOTH));
  L.push(ell('chest', [-0.004, b.chestLen * 0.46, 0], [0.118 * ts, b.chestLen * 0.6, 0.165 * tz], G.torso, Region.Top, CLOTH));
  // Shoulder girdle / upper back: makes the shoulders broad and round.
  L.push(ell('chest', [-0.012, b.chestLen * 0.8, 0], [0.095 * ts, 0.07 * ts, (b.shW + 0.02) * (b.female ? 0.98 : 1)], G.torso, Region.Top, CLOTH));
  if (b.female) {
    for (const s of [1, -1]) L.push(ell('chest', [0.07 * ts, b.chestLen * 0.45, s * 0.058 * tz], [0.058 * ts, 0.055 * ts, 0.056 * tz], G.torso, Region.Top, CLOTH));
  }
  // Collar.
  L.push(ell('chest', [0.004, b.chestLen * 0.98, 0], [0.066 * ts, 0.022, 0.07 * tz], G.detail, Region.Top, CLOTH_D));
  // Neck and head.
  L.push(cone('neck', [0, -0.03, 0], [0.012, b.neck + 0.03, 0], 0.052 * hs * (b.female ? 0.88 : 1), 0.048 * hs, G.head, Region.Skin, SKIN));
  L.push(ell('head', [-0.008 * hs, 0.115 * hs, 0], [0.101 * hs, 0.116 * hs, 0.087 * hs], G.head, Region.Skin, SKIN));
  L.push(ell('head', [0.042 * hs, 0.058 * hs, 0], [0.068 * hs, 0.068 * hs, (b.female ? 0.062 : 0.068) * hs], G.head, Region.Skin, SKIN));
  L.push(ell('head', [0.08 * hs, 0.022 * hs, 0], [0.03 * hs, 0.028 * hs, 0.038 * hs], G.head, Region.Skin, SKIN));
  L.push(ell('head', [0.087 * hs, 0.128 * hs, 0], [0.022 * hs, 0.014 * hs, 0.062 * hs], G.head, Region.Skin, SKIN));
  // Nose, ears, eyes, brows, mouth.
  L.push(cone('head', [0.094 * hs, 0.108 * hs, 0], [0.118 * hs, 0.074 * hs, 0], 0.012 * hs, 0.017 * hs, G.face, Region.Skin, SKIN));
  for (const s of [1, -1]) {
    L.push(ell('head', [-0.012 * hs, 0.092 * hs, s * 0.086 * hs], [0.022 * hs, 0.032 * hs, 0.012 * hs], G.face, Region.Skin, SKIN));
    // (Plan 2026-10 M4: eyes, brows and mouth are no longer part of the render; the game draws them as a face overlay
    // at 4x the resolution, with a mood and a blink, see src/rendering/faces.ts.)
  }
  // Arms: deltoid, sleeve, rolled cuff, bare forearm, hand.
  for (const [s, g, grip] of [['N', G.armN, gripN], ['F', G.armF, gripF]] as const) {
    L.push(ell(`sh${s}`, [-0.004, -0.012, 0], [0.06 * ls, 0.064 * ls, 0.058 * ls], g, Region.Top, CLOTH));
    L.push(cone(`sh${s}`, [0, -0.02, 0], [0, -b.upper, 0], 0.056 * ls, 0.046 * ls, g, Region.Top, CLOTH));
    L.push(ell(`el${s}`, [0, -0.028, 0], [0.047 * ls, 0.026 * ls, 0.047 * ls], G.detail, Region.Top, CLOTH_D));
    L.push(cone(`el${s}`, [0, 0, 0], [0, -b.fore, 0], 0.044 * ls, 0.031 * ls, g, Region.Skin, SKIN));
    L.push(ell(`el${s}`, [0.004, -b.fore * 0.32, 0], [0.039 * ls, b.fore * 0.3, 0.041 * ls], g, Region.Skin, SKIN));
    // Hand: palm, fingers (curl with the grip) and thumb.
    const hl = ls * (b.id === 'child' ? 1.15 : 1);
    L.push(ell(`wr${s}`, [0.002, -0.045 * hl, 0], [0.04 * hl, 0.05 * hl, 0.021 * hl], g, Region.Skin, SKIN));
    const fx = 0.006 + 0.03 * grip, fy = -0.15 + 0.055 * grip;
    L.push(cone(`wr${s}`, [0.002, -0.075 * hl, 0], [fx * hl, fy * hl, 0], 0.026 * hl, (0.019 + 0.006 * grip) * hl, g, Region.Skin, SKIN));
    L.push(cone(`wr${s}`, [0.028 * hl, -0.03 * hl, 0], [(0.05 + 0.012 * grip) * hl, -0.07 * hl, 0], 0.013 * hl, 0.011 * hl, g, Region.Skin, SKIN));
  }
  // Legs: thigh, knee, shin with calf, boot.
  for (const [s, g] of [['N', G.legN], ['F', G.legF]] as const) {
    L.push(cone(`hip${s}`, [0, 0.02, 0], [0, -b.thigh, 0], (b.female ? 0.092 : 0.088) * ls, 0.06 * ls, g, Region.Bottom, PANTS));
    L.push(ell(`kn${s}`, [0.008, 0, 0], [0.058 * ls, 0.06 * ls, 0.058 * ls], g, Region.Bottom, PANTS));
    L.push(cone(`kn${s}`, [0, 0, 0], [0, -b.shin + 0.05, 0], 0.057 * ls, 0.048 * ls, g, Region.Bottom, PANTS));
    L.push(ell(`kn${s}`, [-0.016 * ls, -b.shin * 0.3, 0], [0.05 * ls, b.shin * 0.27, 0.05 * ls], g, Region.Bottom, PANTS));
    // Boot: shaft, heel, toe and a dark sole.
    const bs = ls * (b.id === 'child' ? 1.08 : 1);
    L.push(cone(`an${s}`, [0, 0.11 * bs, 0], [0, -0.02, 0], 0.053 * bs, 0.05 * bs, G.gear0 + (s === 'N' ? 2 : 3), Region.Gear, BOOT));
    L.push(ell(`an${s}`, [-0.016 * bs, -b.ankleH + 0.04 * bs, 0], [0.05 * bs, 0.042 * bs, 0.046 * bs], G.gear0 + (s === 'N' ? 2 : 3), Region.Gear, BOOT));
    L.push(ell(`an${s}`, [0.085 * bs, -b.ankleH + 0.034 * bs, 0], [0.085 * bs, 0.034 * bs, 0.047 * bs], G.gear0 + (s === 'N' ? 2 : 3), Region.Gear, BOOT));
    L.push(box(`an${s}`, [0.035 * bs, -b.ankleH + 0.008, 0], [0.135 * bs, 0.009, 0.046 * bs], 0.006, G.detail, Region.Gear, SOLE));
  }
  return L;
}

// --- gear held in the animations (baked into the body render, so it is lit and occluded properly) ---
const WOOD = hex(0x7a5232), STEEL = hex(0x7a7e86), DSTEEL = hex(0x4e525a), TIN = hex(0x6c8494), CARD = hex(0xa88452), CARD_D = hex(0x7a5e3a);
const IRON = hex(0x34343a), BOARD = hex(0x7a5a3a), PAPER = hex(0xe8e2d2), POT = hex(0x5a5e66);

export type GearId = 'hammer' | 'wrench' | 'ladle' | 'can' | 'pick' | 'dumbbells' | 'box' | 'clipboard' | 'pot' | 'bandage' | null;

export function gearPrims(g: GearId, b: Body): LP[] {
  const s = b.limbS * (b.id === 'child' ? 1.1 : 1);
  const hy = -0.085 * s; // fist centre below the wrist
  switch (g) {
    case 'hammer':
      return [
        cone('wrN', [-0.05 * s, hy, 0], [0.25 * s, hy, 0], 0.014 * s, 0.012 * s, G.gear0, Region.Gear, WOOD),
        box('wrN', [0.25 * s, hy + 0.01 * s, 0], [0.024 * s, 0.065 * s, 0.02 * s], 0.008, G.gear1, Region.Gear, STEEL),
      ];
    case 'wrench':
      return [
        box('wrN', [0.1 * s, hy, 0], [0.13 * s, 0.013 * s, 0.006 * s], 0.005, G.gear0, Region.Gear, STEEL),
        ell('wrN', [0.235 * s, hy, 0], [0.032 * s, 0.03 * s, 0.009 * s], G.gear0, Region.Gear, STEEL),
      ];
    case 'ladle':
      return [
        cone('wrN', [-0.02 * s, hy, 0], [0.04 * s, hy - 0.3 * s, 0], 0.009 * s, 0.008 * s, G.gear0, Region.Gear, WOOD),
        ell('wrN', [0.05 * s, hy - 0.32 * s, 0], [0.04 * s, 0.025 * s, 0.04 * s], G.gear0, Region.Gear, WOOD),
      ];
    case 'can':
      return [
        box('wrN', [0.02 * s, hy - 0.1 * s, 0], [0.085 * s, 0.07 * s, 0.05 * s], 0.025, G.gear0, Region.Gear, TIN),
        cone('wrN', [0.07 * s, hy - 0.12 * s, 0], [0.24 * s, hy - 0.03 * s, 0], 0.016 * s, 0.01 * s, G.gear0, Region.Gear, TIN),
        ell('wrN', [0.245 * s, hy - 0.028 * s, 0], [0.018 * s, 0.012 * s, 0.018 * s], G.gear1, Region.Gear, DSTEEL),
        cone('wrN', [-0.02 * s, hy, 0], [0.05 * s, hy, 0], 0.012 * s, 0.012 * s, G.gear1, Region.Gear, DSTEEL),
      ];
    case 'pick':
      return [
        cone('wrN', [-0.12 * s, hy, 0], [0.5 * s, hy, 0], 0.016 * s, 0.014 * s, G.gear0, Region.Gear, WOOD),
        cone('wrN', [0.5 * s, hy + 0.2 * s, 0], [0.5 * s, hy, 0], 0.006 * s, 0.022 * s, G.gear1, Region.Gear, DSTEEL),
        cone('wrN', [0.5 * s, hy, 0], [0.52 * s, hy - 0.2 * s, 0], 0.022 * s, 0.005 * s, G.gear1, Region.Gear, DSTEEL),
      ];
    case 'dumbbells':
      return (['N', 'F'] as const).flatMap((sd, i) => [
        cone(`wr${sd}`, [0.0, hy, -0.08 * s], [0.0, hy, 0.08 * s], 0.012 * s, 0.012 * s, G.gear0 + i, Region.Gear, IRON),
        cone(`wr${sd}`, [0.0, hy, 0.06 * s], [0.0, hy, 0.1 * s], 0.045 * s, 0.045 * s, G.gear0 + i, Region.Gear, IRON),
        cone(`wr${sd}`, [0.0, hy, -0.06 * s], [0.0, hy, -0.1 * s], 0.045 * s, 0.045 * s, G.gear0 + i, Region.Gear, IRON),
      ]);
    case 'box':
      return [
        box('spine', [0.25 * b.torsoS, b.abd * 0.55, 0], [0.13 * s, 0.11 * s, 0.17 * s], 0.008, G.gear0, Region.Gear, CARD),
        box('spine', [0.25 * b.torsoS, b.abd * 0.55 + 0.03 * s, 0], [0.132 * s, 0.012 * s, 0.172 * s], 0.004, G.gear1, Region.Gear, CARD_D),
      ];
    case 'clipboard':
      return [
        box('wrF', [0.06 * s, hy - 0.02 * s, 0.01], [0.11 * s, 0.006 * s, 0.08 * s], 0.003, G.gear0, Region.Gear, BOARD),
        box('wrF', [0.06 * s, hy - 0.013 * s, 0.01], [0.095 * s, 0.003 * s, 0.07 * s], 0.002, G.gear1, Region.Gear, PAPER),
      ];
    case 'pot':
      // A cauldron on the stove in front (the stove itself is in the painting).
      return [box('root', [0.42, -0.02, 0], [0.13, 0.11, 0.13], 0.05, G.gear1, Region.Gear, POT)];
    case 'bandage':
      return [ell('wrN', [0.03 * s, hy, 0], [0.03 * s, 0.03 * s, 0.03 * s], G.gear0, Region.Gear, PAPER)];
    default:
      return [];
  }
}

// --- attachments (rendered once in the head's frame, drawn on top of the body in the game) ---
export type AttachId = 'hair-short' | 'hair-curly' | 'hair-bun' | 'hair-braids' | 'hair-long' | 'hair-cropped' | 'beard' | 'glasses' | 'goggles'
  | 'hat-straw' | 'hat-hard' | 'hat-chef' | 'hat-cap' | 'hat-helmet' | 'hat-headset' | 'hat-hazmat' | 'bandage';

export const ATTACHMENTS: AttachId[] = ['hair-short', 'hair-curly', 'hair-bun', 'hair-braids', 'hair-long', 'hair-cropped', 'beard', 'glasses', 'goggles',
  'hat-straw', 'hat-hard', 'hat-chef', 'hat-cap', 'hat-helmet', 'hat-headset', 'hat-hazmat', 'bandage'];

/** Which attachments are tinted in the game (rendered white); the rest carry their own colours. */
export const TINTED: Partial<Record<AttachId, boolean>> = { 'hair-short': true, 'hair-curly': true, 'hair-bun': true, 'hair-braids': true, 'hair-long': true, 'hair-cropped': true, beard: true, 'hat-cap': true };

export function attachPrims(a: AttachId, b: Body): LP[] {
  const h = b.headS;
  const W = grey(0.92), HW = grey(0.86);
  const S = (v: V3): V3 => [v[0] * h, v[1] * h, v[2] * h];
  const E = (c: V3, r: V3, col: V3, g: number = G.att0, plane?: [V3, V3]) => ell('head', S(c), S(r), g, a.startsWith('hat') || a === 'goggles' || a === 'glasses' || a === 'bandage' ? Region.Gear : Region.Top, col, plane && [S(plane[0]), plane[1]]);
  const C = (p: V3, q: V3, r1: number, r2: number, col: V3, g: number = G.att0) => cone('head', S(p), S(q), r1 * h, r2 * h, g, a.startsWith('hair') || a === 'beard' ? Region.Top : Region.Gear, col);
  // Hairline: keep the hair above/behind a plane through the forehead and temple.
  const hairline = (lift = 0): [V3, V3] => [[0.05, 0.135 + lift, 0], [-0.62, 0.78, 0]];
  const cap = (scale: number, lift = 0): LP[] => [
    E([-0.012, 0.12, 0], [0.108 * scale, 0.123 * scale, 0.095 * scale], W, G.att0, hairline(lift)),
    E([-0.05, 0.085, 0], [0.07 * scale, 0.09 * scale, 0.09 * scale], HW, G.att0, [[-0.02, 0.05, 0], [-0.5, 0.86, 0]]),
  ];
  switch (a) {
    case 'hair-short': return cap(1.02);
    case 'hair-cropped': return cap(0.985, 0.012);
    case 'hair-curly': return [
      ...cap(1.05),
      ...([[-0.02, 0.215, 0.03], [0.04, 0.2, -0.02], [-0.07, 0.19, -0.04], [-0.1, 0.13, 0.05], [-0.09, 0.09, -0.05], [0.02, 0.22, -0.05], [-0.05, 0.22, 0.05], [0.05, 0.19, 0.06]] as V3[])
        .map(c => E(c, [0.042, 0.042, 0.042], W, G.att1)),
    ];
    case 'hair-bun': return [...cap(1.02), E([-0.105, 0.18, 0], [0.048, 0.046, 0.046], HW, G.att1)];
    case 'hair-long': return [...cap(1.04), E([-0.075, 0.03, 0], [0.06, 0.17, 0.098], HW, G.att0, [[0, -0.16, 0], [0, 1, 0]])];
    case 'hair-braids': return [
      ...cap(1.02),
      ...([1, -1] as const).flatMap(s => [C([-0.04, 0.07, s * 0.07], [-0.03, -0.14, s * 0.07], 0.022, 0.016, HW, G.att1), E([-0.03, -0.15, s * 0.07], [0.02, 0.02, 0.02], HW, G.att2)]),
    ];
    case 'beard': return [E([0.03, 0.04, 0], [0.083, 0.064, 0.077], W, G.att0, [[0, 0.07, 0], [0, -1, 0]])];
    case 'glasses': return [
      E([0.104, 0.104, 0.036], [0.005, 0.017, 0.021], hex(0x2a2622), G.att0),
      E([0.104, 0.104, -0.036], [0.005, 0.017, 0.021], hex(0x2a2622), G.att0),
      C([0.1, 0.108, 0.058], [-0.01, 0.1, 0.088], 0.004, 0.004, hex(0x2a2622), G.att1),
    ];
    case 'goggles': return [
      E([-0.01, 0.17, 0], [0.108, 0.018, 0.096], hex(0x4a3e30), G.att0),
      E([0.088, 0.172, 0.036], [0.018, 0.024, 0.026], hex(0x3a4a5a), G.att1),
      E([0.088, 0.172, -0.036], [0.018, 0.024, 0.026], hex(0x3a4a5a), G.att1),
    ];
    case 'bandage': return [
      E([-0.008, 0.16, 0], [0.108, 0.026, 0.094], hex(0xd8d0bc), G.att0),
      E([0.03, 0.165, 0.07], [0.012, 0.012, 0.02], hex(0x8a3a30), G.att1),
    ];
    case 'hat-straw': return [
      E([0.0, 0.205, 0], [0.205, 0.011, 0.2], hex(0xc0a064), G.att0),
      E([-0.006, 0.245, 0], [0.098, 0.052, 0.092], hex(0xc8aa70), G.att1, [[0, 0.205, 0], [0, 1, 0]]),
      E([-0.006, 0.222, 0], [0.1, 0.014, 0.094], hex(0x6a4a2a), G.att2),
    ];
    case 'hat-hard': return [
      E([-0.006, 0.15, 0], [0.117, 0.105, 0.102], hex(0xd8a23a), G.att0, [[0, 0.158, 0], [0, 1, 0]]),
      E([0.04, 0.16, 0], [0.11, 0.008, 0.106], hex(0xc89430), G.att1),
      E([-0.006, 0.255, 0], [0.012, 0.012, 0.09], hex(0xe0b04a), G.att2),
    ];
    case 'hat-chef': return [
      E([-0.012, 0.3, 0], [0.098, 0.1, 0.092], hex(0xeeece4), G.att0),
      cone('head', S([-0.008, 0.2, 0]), S([-0.01, 0.27, 0]), 0.102 * h, 0.092 * h, G.att0, Region.Gear, hex(0xe2e0d8)),
    ];
    case 'hat-cap': return [
      E([-0.008, 0.15, 0], [0.11, 0.098, 0.098], W, G.att0, [[0, 0.16, 0], [0, 1, 0]]),
      E([0.115, 0.162, 0], [0.07, 0.008, 0.07], grey(0.7), G.att1),
    ];
    case 'hat-helmet': return [
      E([-0.012, 0.14, 0], [0.128, 0.115, 0.112], hex(0x5a6a3a), G.att0, [[0, 0.13, 0], [0, 1, 0]]),
      E([-0.012, 0.135, 0], [0.132, 0.012, 0.116], hex(0x4a5a2e), G.att1),
    ];
    case 'hat-headset': return [
      C([-0.005, 0.1, 0.098], [-0.01, 0.235, 0.0], 0.008, 0.008, hex(0x2a2a2a), G.att0),
      C([-0.01, 0.235, 0.0], [-0.005, 0.1, -0.098], 0.008, 0.008, hex(0x2a2a2a), G.att0),
      E([-0.008, 0.092, 0.096], [0.034, 0.04, 0.018], hex(0x3a3a3a), G.att1),
      C([0.0, 0.08, 0.1], [0.095, 0.035, 0.075], 0.005, 0.005, hex(0x2a2a2a), G.att2),
    ];
    case 'hat-hazmat': return [
      E([-0.004, 0.105, 0], [0.13, 0.15, 0.114], hex(0xc4b04e), G.att0),
      E([0.072, 0.105, 0], [0.066, 0.062, 0.092], hex(0x8fb4c8), G.att1),
      cone('head', S([-0.01, -0.04, 0]), S([0, 0.04, 0]), 0.1 * h, 0.09 * h, G.att0, Region.Gear, hex(0xb8a448)),
    ];
  }
}

// --- skeleton ---
export type Pose = Record<string, number>;

export const BASE: Pose = {
  px: 0, py: 0, pp: 0, sp: 0.03, st: 0, cl: 0, ct: 0, nk: 0, hd: 0, hy: 0,
  sF_N: 0.05, sA_N: 0.1, sT_N: 0, eF_N: 0.2, wF_N: 0.05, g_N: 0.35,
  sF_F: -0.04, sA_F: 0.1, sT_F: 0, eF_F: 0.24, wF_F: 0.05, g_F: 0.35,
  fx_N: 0.035, fy_N: 0, fa_N: 0, fx_F: -0.03, fy_F: 0, fa_F: 0,
};

/** 2-bone IK in the side plane: thigh flex, knee bend, ankle angle that put the ankle at (tx, ty) with the foot at angle fa. */
function legIK(hip: V3, tx: number, ty: number, fa: number, L1: number, L2: number): [number, number, number] {
  const dx = tx - hip[0], dy = ty - hip[1];
  let d = Math.hypot(dx, dy);
  d = Math.min(d, (L1 + L2) * 0.9995);
  d = Math.max(d, Math.abs(L1 - L2) + 1e-4);
  const th = Math.atan2(dx, -dy);
  const al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  const be = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
  const hF = th + al;
  const kB = Math.PI - be;
  const aA = fa - hF + kB;
  return [hF, kB, aA];
}

export function pose(b: Body, p: Pose): Record<string, Bone> {
  const q = (k: string) => (p[k] ?? BASE[k] ?? 0) + (b.posture[k] ?? 0);
  const B: Record<string, Bone> = {};
  const root: Bone = { R: rz(-q('pp')), t: [q('px'), rootHeight(b) + q('py'), 0] };
  B.root = root;
  B.spine = child(root, [0, 0.035, 0], mul(ry(q('st')), rz(-q('sp'))));
  B.chest = child(B.spine, [0, b.abd, 0], mul(ry(q('ct')), rz(-q('cl'))));
  B.neck = child(B.chest, [0.004, b.chestLen, 0], rz(-q('nk')));
  B.head = child(B.neck, [0.012, b.neck, 0], mul(ry(q('hy')), rz(-q('hd'))));
  for (const [s, sg] of [['N', 1], ['F', -1]] as const) {
    B[`sh${s}`] = child(B.chest, [-0.012, b.shY, sg * b.shW], mul(rz(q(`sF_${s}`)), mul(rx(-sg * q(`sA_${s}`)), ry(sg * q(`sT_${s}`)))));
    B[`el${s}`] = child(B[`sh${s}`], [0, -b.upper, 0], rz(q(`eF_${s}`)));
    B[`wr${s}`] = child(B[`el${s}`], [0, -b.fore, 0], rz(q(`wF_${s}`)));
    // Legs: IK to the foot target (ankle height above the floor plus lift).
    const hipOff: V3 = [0, -b.hipDrop, sg * b.hipW];
    const hipW = point(root, hipOff);
    const [hF, kB, aA] = legIK(hipW, q(`fx_${s}`), b.ankleH + q(`fy_${s}`), q(`fa_${s}`), b.thigh, b.shin);
    // Undo the pelvis pitch so the IK angles stay in world terms.
    B[`hip${s}`] = child(root, hipOff, mul(rz(q('pp') + hF), rx(-sg * 0.025)));
    B[`kn${s}`] = child(B[`hip${s}`], [0, -b.thigh, 0], rz(-kB));
    B[`an${s}`] = child(B[`kn${s}`], [0, -b.shin, 0], rz(aA));
  }
  B.I = { R: I3, t: [0, 0, 0] };
  return B;
}

// --- animation ---
type Key = [number, Pose, ('ease' | 'lin')?];

export interface Anim {
  frames: number;
  fps: number;
  keys: Key[];
  /** Channel → phase delay (follow-through / overlapping action). */
  lag?: Record<string, number>;
  /** Procedural channels added on top (walk/run feet). */
  fn?: (ph: number, b: Body, out: Pose) => void;
  gear?: GearId;
  /** Walk cycles: metres covered per loop (the game advances the frame by distance). */
  stride?: number;
}

/** Periodic Hermite interpolation of one channel through the keys that set it. */
function sampleChannel(keys: Key[], ch: string, t: number): number | undefined {
  const ks = keys.filter(k => ch in k[1]);
  if (!ks.length) return undefined;
  if (ks.length === 1) return ks[0][1][ch];
  const n = ks.length;
  t = ((t % 1) + 1) % 1;
  let i = n - 1;
  for (let j = 0; j < n; j++) if (ks[j][0] <= t) i = j;
  const k0 = ks[(i - 1 + n) % n], k1 = ks[i], k2 = ks[(i + 1) % n], k3 = ks[(i + 2) % n];
  const t1 = k1[0];
  let t2 = k2[0];
  if (t2 <= t1) t2 += 1;
  let tt = t;
  if (tt < t1) tt += 1;
  const span = t2 - t1;
  const u = span > 0 ? (tt - t1) / span : 0;
  let t0 = k0[0];
  if (t0 >= t1) t0 -= 1;
  let t3 = k3[0];
  while (t3 <= t2) t3 += 1;
  const v0 = k0[1][ch], v1 = k1[1][ch], v2 = k2[1][ch], v3 = k3[1][ch];
  if (k1[2] === 'lin') return v1 + (v2 - v1) * u;
  // Tangents (per unit u); 'ease' keys stop dead (holds, anticipation tops, impacts).
  const m1 = k1[2] === 'ease' ? 0 : ((v2 - v0) / Math.max(1e-6, t2 - t0)) * span;
  const m2 = k2[2] === 'ease' ? 0 : ((v3 - v1) / Math.max(1e-6, t3 - t1)) * span;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * v2 + (u3 - u2) * m2;
}

export function sample(a: Anim, b: Body, ph: number): Pose {
  const out: Pose = { ...BASE };
  const chans = new Set<string>();
  for (const k of a.keys) for (const c of Object.keys(k[1])) chans.add(c);
  for (const c of chans) {
    const v = sampleChannel(a.keys, c, ph - (a.lag?.[c] ?? 0));
    if (v !== undefined) out[c] = v;
  }
  a.fn?.(ph, b, out);
  return out;
}

// Lag presets: the head trails the chest, forearms trail upper arms, hands trail forearms.
const FOLLOW: Record<string, number> = { cl: 0.02, nk: 0.05, hd: 0.08, eF_N: 0.04, eF_F: 0.04, wF_N: 0.08, wF_F: 0.08 };

/**
 * Walking: each foot is planted for 60 % of the loop and slides back under the body at walking speed (so it stays
 * put in the world while the game moves the body), then swings forward with a lift; heel strike and toe-off tilt
 * the foot; the pelvis rides highest over the planted leg.
 */
function walkFeet(stride: number, lift: number, bad = 0) {
  return (ph: number, b: Body, o: Pose) => {
    const st = 0.6;
    for (const [s, off] of [['N', 0], ['F', 0.5]] as const) {
      const u = (((ph + off) % 1) + 1) % 1;
      const hurt = s === 'N' ? bad : 0;
      if (u < st) {
        const k = u / st;
        o[`fx_${s}`] = stride * 0.3 * (1 - 2 * k) + (s === 'N' ? 0.01 : -0.01);
        o[`fy_${s}`] = 0;
        // Heel strike (toe up) → flat → heel off (toe down).
        o[`fa_${s}`] = k < 0.12 ? 0.22 * (1 - k / 0.12) : k > 0.72 ? -0.5 * ((k - 0.72) / 0.28) ** 1.4 : 0;
        if (k > 0.72) o[`fy_${s}`] = 0.05 * ((k - 0.72) / 0.28) ** 2;
      } else {
        const k = (u - st) / (1 - st);
        const e = k * k * (3 - 2 * k);
        o[`fx_${s}`] = stride * 0.3 * (-1 + 2 * e);
        o[`fy_${s}`] = 0.05 * (1 - k) ** 2 + lift * (1 - hurt * 0.5) * Math.sin(Math.PI * Math.min(1, k * 1.1));
        o[`fa_${s}`] = -0.5 * (1 - k) ** 2 + 0.22 * k * k;
      }
    }
    // Pelvis: up over the planted leg, down at the double support; a limp drops it onto the bad leg.
    o.py = (o.py ?? 0) - 0.022 + 0.022 * Math.cos(ph * Math.PI * 4 - 0.6) * 0.9 - (bad ? 0.03 * Math.max(0, Math.sin(ph * Math.PI * 2 - 0.3)) : 0);
    o.px = (o.px ?? 0);
  };
}

export const ANIMS: Record<string, Anim> = {
  idle: {
    frames: 12, fps: 6,
    keys: [
      [0, { py: 0, cl: 0, sF_N: 0.05, sF_F: -0.04, nk: 0, px: 0, fx_N: 0.04, fx_F: -0.03 }],
      [0.5, { py: -0.006, cl: 0.025, sF_N: 0.08, sF_F: -0.01, nk: 0.03, px: 0.008 }],
    ],
    lag: FOLLOW,
  },
  look: {
    frames: 16, fps: 8,
    keys: [
      [0, { hy: 0, hd: 0, nk: 0, sF_F: -0.04, eF_F: 0.24, sA_F: 0.1, st: 0 }, 'ease'],
      [0.2, { hy: 0.32, hd: -0.05, nk: 0.02, st: 0.08 }, 'ease'],
      [0.45, { hy: 0.32, hd: -0.12, nk: -0.06, st: 0.08 }, 'ease'],
      [0.62, { hy: -0.2, hd: 0.04, nk: 0.03, st: -0.05, sF_F: -0.3, eF_F: 1.25, sA_F: 0.45 }, 'ease'],
      [0.82, { hy: -0.2, hd: 0.02, nk: 0.02, st: -0.05, sF_F: -0.3, eF_F: 1.3, sA_F: 0.45 }, 'ease'],
    ],
    lag: FOLLOW,
  },
  sad: {
    frames: 8, fps: 4,
    keys: [
      [0, { sp: 0.16, cl: 0.12, nk: 0.32, hd: 0.15, sF_N: 0.14, sF_F: 0.06, eF_N: 0.15, py: -0.012 }],
      [0.5, { sp: 0.15, cl: 0.15, nk: 0.36, hd: 0.18, sF_N: 0.16, sF_F: 0.08, py: -0.018 }],
    ],
    lag: FOLLOW,
  },
  hunch: {
    frames: 8, fps: 5,
    keys: [
      [0, { sp: 0.36, cl: 0.12, nk: 0.18, hd: -0.1, sF_N: 0.62, eF_N: 1.75, sA_N: 0.05, sF_F: 0.2, eF_F: 0.4, py: -0.06, fx_N: 0.1, fx_F: -0.08 }],
      [0.5, { sp: 0.4, cl: 0.14, nk: 0.22, py: -0.07, sF_F: 0.24 }],
    ],
    lag: FOLLOW,
  },
  walk: {
    frames: 12, fps: 12, stride: 1.25,
    keys: [
      [0, { sF_N: -0.36, sF_F: 0.36, eF_N: 0.15, eF_F: 0.5, sp: 0.06, st: 0.06, nk: -0.02 }],
      [0.5, { sF_N: 0.36, sF_F: -0.36, eF_N: 0.5, eF_F: 0.15, sp: 0.06, st: -0.06, nk: -0.02 }],
    ],
    lag: { ...FOLLOW, eF_N: 0.07, eF_F: 0.07, st: 0.02 },
    fn: walkFeet(1.25, 0.055),
  },
  limp: {
    frames: 12, fps: 10, stride: 0.95,
    keys: [
      [0, { sF_N: -0.2, sF_F: 0.25, eF_N: 0.25, eF_F: 0.5, sp: 0.1, cl: 0.06, nk: 0.08 }],
      [0.25, { sp: 0.18, cl: 0.1, nk: 0.14 }],
      [0.5, { sF_N: 0.2, sF_F: -0.25, eF_N: 0.5, eF_F: 0.25, sp: 0.1, cl: 0.05, nk: 0.08 }],
    ],
    lag: FOLLOW,
    fn: walkFeet(0.95, 0.035, 1),
  },
  walkCarry: {
    frames: 12, fps: 12, stride: 1.1, gear: 'box',
    keys: [
      [0, { sF_N: 0.5, sF_F: 0.5, eF_N: 0.75, eF_F: 0.75, sA_N: 0.32, sA_F: 0.32, sp: -0.04, cl: -0.05, g_N: 0.8, g_F: 0.8, st: 0.03 }],
      [0.5, { sF_N: 0.52, sF_F: 0.52, sp: -0.04, cl: -0.05, st: -0.03 }],
    ],
    lag: FOLLOW,
    fn: walkFeet(1.1, 0.045),
  },
  carry: {
    frames: 8, fps: 5, gear: 'box',
    keys: [
      [0, { sF_N: 0.5, sF_F: 0.5, eF_N: 0.75, eF_F: 0.75, sA_N: 0.32, sA_F: 0.32, sp: -0.05, cl: -0.05, g_N: 0.8, g_F: 0.8, py: 0 }],
      [0.5, { sF_N: 0.48, sF_F: 0.48, py: -0.008, cl: -0.03 }],
    ],
    lag: FOLLOW,
  },
  water: {
    frames: 12, fps: 8, gear: 'can',
    keys: [
      [0, { sF_N: 0.75, eF_N: 0.35, wF_N: -0.05, sp: 0.1, nk: 0.18, hd: 0.15, sF_F: 0.0, eF_F: 1.3, sA_F: 0.35, g_N: 1, fx_N: 0.12, fx_F: -0.06 }, 'ease'],
      [0.35, { sF_N: 0.95, eF_N: 0.25, wF_N: 0.55, sp: 0.14, nk: 0.22 }, 'ease'],
      [0.6, { sF_N: 0.92, eF_N: 0.25, wF_N: 0.6, sp: 0.15 }, 'ease'],
    ],
    lag: FOLLOW,
  },
  hammer: {
    frames: 12, fps: 12, gear: 'hammer',
    keys: [
      // Down on the work, wind up slowly (anticipation), snap down, hold the impact, settle.
      [0, { sF_N: 0.75, eF_N: 0.55, wF_N: -0.35, ct: 0.0, cl: 0.12, sp: 0.1, nk: 0.22, hd: 0.15, sF_F: 0.45, eF_F: 1.0, g_N: 1, g_F: 0.6, fx_N: 0.1, fx_F: -0.08, py: -0.01 }, 'ease'],
      [0.45, { sF_N: 1.65, eF_N: 1.45, wF_N: -0.35, ct: -0.2, cl: -0.02, sp: 0.04, nk: 0.12, py: 0.004 }, 'ease'],
      [0.6, { sF_N: 0.8, eF_N: 0.5, wF_N: -0.45, ct: 0.08, cl: 0.16, sp: 0.12, nk: 0.24, py: -0.016 }, 'ease'],
      [0.78, { sF_N: 0.84, eF_N: 0.56, wF_N: -0.3, ct: 0.04, cl: 0.13, nk: 0.22, py: -0.01 }],
    ],
    lag: { nk: 0.04, hd: 0.06, eF_N: 0.03, wF_N: 0.05 },
  },
  wrench: {
    frames: 12, fps: 10, gear: 'wrench',
    keys: [
      [0, { sF_N: 0.95, eF_N: 0.7, wF_N: 0.3, sF_F: 0.85, eF_F: 0.75, sp: 0.16, cl: 0.06, nk: 0.15, hd: 0.1, g_N: 1, g_F: 0.7, fx_N: 0.14, fx_F: -0.08 }, 'ease'],
      [0.5, { sF_N: 0.6, eF_N: 0.95, wF_N: -0.2, sp: 0.2, cl: 0.1, ct: 0.12, py: -0.012 }, 'ease'],
      [0.65, { sF_N: 0.58, eF_N: 0.98, wF_N: -0.25, ct: 0.13 }, 'ease'],
    ],
    lag: FOLLOW,
  },
  stir: {
    frames: 12, fps: 10, gear: 'ladle',
    keys: [
      [0, { sF_N: 0.62, eF_N: 1.0, wF_N: 0.2, sp: 0.1, nk: 0.22, hd: 0.15, sF_F: 0.45, eF_F: 1.1, sA_F: 0.25, g_N: 1, ct: 0.04, fx_N: 0.08 }],
      [0.25, { sF_N: 0.78, eF_N: 0.78, ct: 0.08 }],
      [0.5, { sF_N: 0.66, eF_N: 0.55, ct: 0.03 }],
      [0.75, { sF_N: 0.5, eF_N: 0.8, ct: -0.02 }],
    ],
    lag: FOLLOW,
  },
  type: {
    frames: 10, fps: 10,
    keys: [
      [0, { sF_N: 0.42, eF_N: 1.25, wF_N: -0.3, sF_F: 0.4, eF_F: 1.3, wF_F: -0.3, sp: 0.12, nk: 0.18, hd: 0.06, g_N: 0.2, g_F: 0.2, fx_N: 0.06 }],
      [0.2, { wF_N: -0.12, eF_N: 1.2 }],
      [0.4, { wF_F: -0.12, wF_N: -0.3, eF_N: 1.25 }],
      [0.6, { wF_F: -0.3, wF_N: -0.15, nk: 0.2 }],
      [0.8, { wF_N: -0.3, wF_F: -0.1, nk: 0.18 }],
    ],
    lag: FOLLOW,
  },
  inspect: {
    frames: 12, fps: 6, gear: 'clipboard',
    keys: [
      [0, { sF_F: 0.6, eF_F: 1.2, wF_F: 0.15, sA_F: 0.15, g_F: 0.8, sF_N: 0.5, eF_N: 1.3, g_N: 0.7, nk: 0.3, hd: 0.15, sp: 0.06 }, 'ease'],
      [0.4, { nk: 0.26, hd: 0.08, sF_N: 0.55, eF_N: 1.25, wF_N: -0.2 }, 'ease'],
      [0.65, { nk: 0.0, hd: -0.12, hy: 0.15, sF_N: 0.15, eF_N: 0.4 }, 'ease'],
      [0.85, { nk: 0.05, hd: -0.1, hy: 0.15, sF_N: 0.15, eF_N: 0.4 }, 'ease'],
    ],
    lag: FOLLOW,
  },
  lift: {
    frames: 14, fps: 10, gear: 'dumbbells',
    keys: [
      [0, { sF_N: 0.45, eF_N: 2.5, sF_F: 0.45, eF_F: 2.5, wF_N: -0.4, wF_F: -0.4, sA_N: 0.35, sA_F: 0.35, g_N: 1, g_F: 1, py: 0, fx_N: 0.06, fx_F: -0.06 }, 'ease'],
      [0.18, { py: -0.045, sp: 0.04 }, 'ease'],
      [0.45, { sF_N: 2.95, eF_N: 0.15, sF_F: 2.95, eF_F: 0.15, wF_N: 0, wF_F: 0, py: 0.006, sp: -0.04 }, 'ease'],
      [0.6, { sF_N: 2.95, eF_N: 0.15, sF_F: 2.95, eF_F: 0.15, py: 0.004 }, 'ease'],
    ],
    lag: { nk: 0.04, hd: 0.06 },
  },
  tend: {
    frames: 12, fps: 8,
    keys: [
      [0, { sp: 0.42, cl: 0.12, nk: 0.08, hd: 0.1, sF_N: 0.95, eF_N: 0.65, sF_F: 0.9, eF_F: 0.8, g_N: 0.6, g_F: 0.5, py: -0.03, fx_N: 0.12, fx_F: -0.1 }],
      [0.25, { sF_N: 1.1, eF_N: 0.45, sF_F: 0.8, eF_F: 0.9 }],
      [0.5, { sF_N: 0.9, eF_N: 0.75, sF_F: 1.0, eF_F: 0.6, hd: 0.14 }],
      [0.75, { sF_N: 1.05, eF_N: 0.5, sF_F: 0.88, eF_F: 0.85 }],
    ],
    lag: FOLLOW,
  },
  dig: {
    frames: 14, fps: 10, gear: 'pick',
    keys: [
      [0, { sF_N: 0.6, eF_N: 0.3, sF_F: 0.65, eF_F: 0.4, wF_N: -0.6, sp: 0.42, cl: 0.12, nk: 0.15, g_N: 1, g_F: 1, py: -0.07, fx_N: 0.2, fx_F: -0.14 }, 'ease'],
      [0.42, { sF_N: 2.7, eF_N: 1.2, sF_F: 2.5, eF_F: 1.0, wF_N: -0.2, sp: -0.06, cl: -0.08, nk: 0.0, py: -0.01 }, 'ease'],
      [0.58, { sF_N: 0.55, eF_N: 0.2, sF_F: 0.6, eF_F: 0.3, wF_N: -0.7, sp: 0.48, cl: 0.14, nk: 0.18, py: -0.085 }, 'ease'],
      [0.75, { sF_N: 0.6, eF_N: 0.28, sp: 0.44, py: -0.075 }],
    ],
    lag: { nk: 0.04, hd: 0.06, eF_N: 0.03, eF_F: 0.03 },
  },
  punch: {
    frames: 12, fps: 12,
    keys: [
      [0, { sF_N: 0.75, eF_N: 2.2, sF_F: 0.9, eF_F: 2.25, g_N: 1, g_F: 1, sp: 0.1, nk: 0.12, ct: 0, fx_N: 0.1, fx_F: -0.12, py: -0.025 }, 'ease'],
      [0.12, { sF_N: 1.5, eF_N: 0.15, ct: 0.18 }, 'ease'],
      [0.28, { sF_N: 0.75, eF_N: 2.2, ct: 0 }, 'ease'],
      [0.55, { sF_F: 1.55, eF_F: 0.2, ct: -0.22, sp: 0.14 }, 'ease'],
      [0.72, { sF_F: 0.9, eF_F: 2.25, ct: 0, sp: 0.1 }, 'ease'],
    ],
    lag: { nk: 0.03, hd: 0.05 },
    fn: (ph, _b, o) => { o.py = (o.py ?? 0) + 0.012 * Math.sin(ph * Math.PI * 4); },
  },
  run: {
    frames: 10, fps: 14,
    keys: [
      [0, { sF_N: -0.6, sF_F: 0.6, eF_N: 1.5, eF_F: 1.6, sp: 0.16, nk: -0.06, g_N: 0.9, g_F: 0.9 }],
      [0.5, { sF_N: 0.6, sF_F: -0.6, eF_N: 1.6, eF_F: 1.5, sp: 0.16, nk: -0.06 }],
    ],
    lag: { eF_N: 0.05, eF_F: 0.05, nk: 0.05 },
    fn: (ph, _b, o) => {
      // On the treadmill: planted 35 % of the loop, the belt carries the foot back; a flight phase between steps.
      for (const [s, off] of [['N', 0], ['F', 0.5]] as const) {
        const u = (((ph + off) % 1) + 1) % 1;
        if (u < 0.35) {
          const k = u / 0.35;
          o[`fx_${s}`] = 0.32 * (0.5 - k);
          o[`fy_${s}`] = 0;
          o[`fa_${s}`] = k > 0.6 ? -0.6 * (k - 0.6) / 0.4 : 0.05;
        } else {
          const k = (u - 0.35) / 0.65;
          o[`fx_${s}`] = 0.32 * (-0.5 + k) - 0.08 * Math.sin(Math.PI * k);
          o[`fy_${s}`] = 0.22 * Math.sin(Math.PI * Math.min(1, k * 1.05)) ** 1.3;
          o[`fa_${s}`] = -0.6 * (1 - k) + 0.1 * k;
        }
      }
      o.py = -0.05 + 0.03 * Math.cos(ph * Math.PI * 4 - 1.2);
    },
  },
  dangle: {
    frames: 8, fps: 8,
    keys: [
      [0, { sF_N: 2.6, eF_N: 0.5, sF_F: 2.4, eF_F: 0.6, sA_N: 0.4, sA_F: 0.4, py: 0.1, fx_N: 0.06, fx_F: -0.06, fy_N: 0.16, fy_F: 0.06, fa_N: -0.5, fa_F: -0.4, nk: -0.12, hd: 0.08, sp: -0.04, g_N: 0.2, g_F: 0.2 }],
      [0.5, { sF_N: 2.45, sF_F: 2.6, fx_N: -0.06, fx_F: 0.06, fy_N: 0.06, fy_F: 0.16, nk: -0.06, hd: 0.14 }],
    ],
    lag: { ...FOLLOW, eF_N: 0.12, eF_F: 0.12 },
  },
};

export const ANIM_ORDER = Object.keys(ANIMS);

/**
 * Plan 2026-10 M3: poses that use the set. Their origin (the sprite pivot) is the SURFACE the person is on, not the floor:
 * the seat of a chair, bench or bunk edge (feet hang 0.45 m below it, which is where a chair's floor is), or the mattress
 * (the body lies on it). The game places the pivot at the painted seat / bed, so one render serves every height.
 * Rendered by tools/people3d.html?set into people/<body>-set.webp + people-set.json (kept apart from the main atlases).
 */
const SEAT_Y = 0.13; // pelvis centre above the seat surface
const SIT_BASE: Pose = {
  py: SEAT_Y - 0.995, sp: 0.04, fx_N: 0.43, fx_F: 0.4, fy_N: -0.435, fy_F: -0.435, fa_N: 0.02, fa_F: 0.02,
  sF_N: 0.22, eF_N: 1.0, wF_N: 0.1, sF_F: 0.2, eF_F: 1.05, wF_F: 0.1, g_N: 0.3, g_F: 0.3,
};
const LIE_BASE: Pose = {
  pp: -Math.PI / 2, py: 0.125 - 0.995, px: 0, sp: 0, cl: 0, nk: 0.05, hd: -0.12,
  fx_N: 0.97, fx_F: 0.95, fy_N: 0.0, fy_F: 0.0, fa_N: 1.3, fa_F: 1.2,
  sF_N: -0.08, eF_N: 0.3, wF_N: 0, sF_F: -0.1, eF_F: 0.25, wF_F: 0, g_N: 0.3, g_F: 0.3, sA_N: 0.12, sA_F: 0.12,
};

export const SET_ANIMS: Record<string, Anim> = {
  // Seated, resting: breathing, a slow look around.
  sit: {
    frames: 10, fps: 4,
    keys: [
      [0, { ...SIT_BASE, cl: 0.0, nk: 0.02, hy: 0 }],
      [0.25, { ...SIT_BASE, cl: 0.03, py: SIT_BASE.py - 0.004, nk: 0.03, hy: 0.28 }, 'ease'],
      [0.5, { ...SIT_BASE, cl: 0.0, nk: 0.02, hy: 0.28 }, 'ease'],
      [0.75, { ...SIT_BASE, cl: 0.03, py: SIT_BASE.py - 0.004, nk: 0.05, hy: -0.12, hd: 0.06 }, 'ease'],
    ],
    lag: FOLLOW,
  },
  // Seated, talking: hands out in turn, nodding.
  sitTalk: {
    frames: 12, fps: 7,
    keys: [
      [0, { ...SIT_BASE, sF_N: 0.7, eF_N: 1.5, wF_N: -0.1, g_N: 0.4, nk: 0.02, hd: 0.02, sp: 0.06 }],
      [0.2, { ...SIT_BASE, sF_N: 0.95, eF_N: 1.2, wF_N: 0.2, nk: 0.06, hd: 0.1, sp: 0.07 }],
      [0.45, { ...SIT_BASE, sF_N: 0.55, eF_N: 1.1, sF_F: 0.5, eF_F: 1.4, nk: 0.0, hd: -0.03, sp: 0.05 }],
      [0.7, { ...SIT_BASE, sF_N: 0.85, eF_N: 1.5, sF_F: 0.25, eF_F: 1.1, nk: 0.05, hd: 0.12, sp: 0.07 }],
    ],
    lag: FOLLOW,
  },
  // Seated at a table, leaning in: the spoon goes to the mouth, the other hand rests on the table.
  eat: {
    frames: 12, fps: 5,
    keys: [
      [0, { ...SIT_BASE, sp: 0.2, cl: 0.06, nk: 0.14, hd: 0.08, sF_N: 0.55, eF_N: 1.25, wF_N: -0.1, sF_F: 0.55, eF_F: 0.7, g_N: 0.7, g_F: 0.3 }, 'ease'],
      [0.25, { ...SIT_BASE, sp: 0.2, cl: 0.06, nk: 0.14, hd: 0.08, sF_N: 0.5, eF_N: 0.95, wF_N: -0.2, sF_F: 0.55, eF_F: 0.7, g_N: 0.7 }, 'ease'],
      [0.5, { ...SIT_BASE, sp: 0.12, cl: 0.04, nk: 0.06, hd: 0.02, sF_N: 0.75, eF_N: 2.2, wF_N: 0.5, sF_F: 0.55, eF_F: 0.7, g_N: 0.7 }, 'ease'],
      [0.7, { ...SIT_BASE, sp: 0.12, cl: 0.04, nk: 0.06, hd: 0.0, sF_N: 0.75, eF_N: 2.25, wF_N: 0.5, g_N: 0.7 }, 'ease'],
    ],
    lag: { nk: 0.04, hd: 0.06, eF_N: 0.03, wF_N: 0.05 },
  },
  // Lying on the back, head to the left (the game mirrors it): breathing, an occasional shift.
  sleep: {
    frames: 8, fps: 2,
    keys: [
      [0, { ...LIE_BASE, cl: 0.0, py: LIE_BASE.py }],
      [0.4, { ...LIE_BASE, cl: 0.035, py: LIE_BASE.py + 0.006, sp: 0.01 }, 'ease'],
      [0.8, { ...LIE_BASE, cl: 0.0, py: LIE_BASE.py, hd: -0.18, nk: 0.02 }, 'ease'],
    ],
    lag: { cl: 0.03, hd: 0.08, nk: 0.05 },
  },
  // Standing and talking: a hand makes the point, the head nods.
  talk: {
    frames: 12, fps: 7,
    keys: [
      [0, { sF_N: 0.7, eF_N: 1.4, wF_N: -0.1, g_N: 0.4, sF_F: 0.1, eF_F: 0.4, nk: 0.02, hd: 0.0, sp: 0.04, fx_N: 0.05, fx_F: -0.05 }],
      [0.2, { sF_N: 0.95, eF_N: 1.1, wF_N: 0.2, hd: 0.1, nk: 0.05, sp: 0.07 }],
      [0.5, { sF_N: 0.55, eF_N: 1.3, sF_F: 0.55, eF_F: 1.3, hd: -0.03, sp: 0.04 }],
      [0.75, { sF_N: 0.85, eF_N: 1.5, sF_F: 0.15, eF_F: 0.5, hd: 0.1, nk: 0.04, sp: 0.07 }],
    ],
    lag: FOLLOW,
  },
};

export const SET_ORDER = Object.keys(SET_ANIMS);

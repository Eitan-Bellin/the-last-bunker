/**
 * The shared test scene, as data: carved spaces, walk graph, dwellings, lights.
 * Entrance is on the RIGHT (Hebrew reading order): surface → hub → corridor → district → dark edge.
 */
import { T } from './tokens';

export type BackStyle = 'concrete' | 'hub' | 'tile' | 'rock' | 'brick' | 'none';

export interface Hole {
  id: string;
  pts: number[];
  back: BackStyle;
  explored: boolean;
}

const G = T.world.groundY;

function arch(x0: number, x1: number, yBase: number, rise: number, n = 18): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(x0 + (x1 - x0) * t, yBase - rise * Math.sin(Math.PI * t));
  }
  return out;
}

export const HUB = { x0: 1960, x1: 2660, l1: 560, l2: 760, l3: 960, top: 470, rise: 95 };
export const DISTRICT = { street: 1020, terrace: 800, x0: 380, x1: 1290 };

export const holes: Hole[] = [
  {
    id: 'ramp', back: 'concrete', explored: true,
    pts: [2890, 280, 3070, 280, 3070, 320, 3040, 320, 2660, 560, 2590, 560, 2590, 452, 2690, 438, 2905, 306],
  },
  {
    id: 'hub', back: 'hub', explored: true,
    pts: [HUB.x0, HUB.l3, HUB.x1, HUB.l3, ...arch(HUB.x1, HUB.x0, HUB.top, HUB.rise)],
  },
  {
    id: 'corridor', back: 'tile', explored: true,
    pts: [1290, 893, 1966, 880, 1966, 960, 1410, 960, 1290, 1020],
  },
  {
    id: 'district', back: 'none', explored: true,
    pts: [
      380, 1020, 1300, 1020, 1312, 960, 1298, 880, 1268, 770, 1222, 655, 1130, 588, 1000, 556,
      880, 566, 760, 545, 640, 552, 530, 585, 448, 640, 400, 735, 372, 850, 366, 950,
    ],
  },
  {
    id: 'edge', back: 'rock', explored: false,
    pts: [30, 1020, 380, 1020, 382, 928, 330, 916, 260, 908, 190, 892, 130, 870, 70, 878, 34, 920],
  },
  {
    id: 'storeroom', back: 'concrete', explored: false,
    pts: [2660, 680, 2890, 684, 2895, 760, 2660, 760],
  },
  {
    id: 'cellar', back: 'brick', explored: false,
    pts: [400, 402, 610, 396, 760, 404, 772, 470, 760, 524, 392, 524, 386, 460],
  },
  {
    id: 'cave', back: 'none', explored: false,
    pts: [
      880, 1290, 960, 1210, 1080, 1176, 1190, 1188, 1300, 1168, 1420, 1196, 1540, 1186, 1640, 1230,
      1700, 1310, 1660, 1390, 1540, 1420, 1360, 1412, 1180, 1424, 1010, 1404, 900, 1370,
    ],
  },
];

/** soft "explored at start" region (fog is erased under it) */
export const startExplored: number[][] = [
  [2560, 0, 3400, 0, 3400, 420, 3060, 420, 2700, 620, 2560, 620],
  [1940, 360, 2680, 360, 2680, 990, 1940, 990],
  [1270, 860, 1990, 860, 1990, 1040, 1270, 1040],
  [430, 520, 1320, 520, 1320, 1050, 430, 1050],
];

// ------------------------------------------------------------------ walk graph

export type EdgeKind = 'walk' | 'stairs' | 'ramp';

export const nodes: Record<string, [number, number]> = {
  s_far: [3360, G], s_mid: [3180, G], s_hatch: [3040, G], ramp_bot: [2660, 560],
  l1_r: [2630, 560], l1_a: [2400, 560], bridge_mid: [2290, 560], l1_bl: [2140, 560], l1_l: [1990, 560],
  l2_la: [2200, 760], l2_lb: [2020, 760], l2_le: [1980, 760],
  l2_rc: [2640, 760], l2_r: [2470, 760],
  l3_b: [2220, 960], l3_c: [2440, 960], l3_r: [2630, 960], l3_l: [1975, 960],
  cor_mid: [1690, 960], cor_l: [1410, 960], cor_bot: [1290, 1020],
  st_bot: [1268, 1020], lamp: [1190, 1020], plaza: [960, 1020], plaza_w: [890, 1020],
  door_ws: [768, 1020], door_q: [560, 1020], street_l: [400, 1020], edge_look: [372, 1020],
  st_top: [1070, 800], door_hy: [937, 800], door_md: [728, 800], door_cn: [558, 800], terrace_l: [450, 800],
};

export const edges: [string, string, EdgeKind][] = [
  ['s_far', 's_mid', 'walk'], ['s_mid', 's_hatch', 'walk'], ['s_hatch', 'ramp_bot', 'ramp'],
  ['ramp_bot', 'l1_r', 'walk'], ['l1_r', 'l1_a', 'walk'], ['l1_a', 'bridge_mid', 'walk'],
  ['bridge_mid', 'l1_bl', 'walk'], ['l1_bl', 'l1_l', 'walk'],
  ['l1_a', 'l2_la', 'stairs'], ['l2_la', 'l2_lb', 'walk'], ['l2_lb', 'l2_le', 'walk'],
  ['l2_lb', 'l3_b', 'stairs'], ['l3_b', 'l3_c', 'walk'], ['l3_c', 'l3_r', 'walk'],
  ['l3_c', 'l2_rc', 'stairs'], ['l2_rc', 'l2_r', 'walk'],
  ['l3_b', 'l3_l', 'walk'], ['l3_l', 'cor_mid', 'walk'], ['cor_mid', 'cor_l', 'walk'],
  ['cor_l', 'cor_bot', 'ramp'], ['cor_bot', 'st_bot', 'walk'], ['st_bot', 'lamp', 'walk'],
  ['lamp', 'plaza', 'walk'], ['plaza', 'plaza_w', 'walk'], ['plaza_w', 'door_ws', 'walk'],
  ['door_ws', 'door_q', 'walk'], ['door_q', 'street_l', 'walk'], ['street_l', 'edge_look', 'walk'],
  ['st_bot', 'st_top', 'stairs'], ['st_top', 'door_hy', 'walk'], ['door_hy', 'door_md', 'walk'],
  ['door_md', 'door_cn', 'walk'], ['door_cn', 'terrace_l', 'walk'],
];

/** where people like to linger (weights) */
export const pois: [string, number][] = [
  ['plaza', 5], ['plaza_w', 3], ['door_q', 3], ['door_ws', 3], ['door_hy', 2], ['door_md', 2], ['door_cn', 2],
  ['terrace_l', 1], ['edge_look', 1], ['bridge_mid', 2], ['l1_l', 1], ['l2_le', 1], ['l2_r', 1], ['l3_r', 2],
  ['cor_mid', 1], ['s_hatch', 1], ['s_far', 1], ['lamp', 2],
];

// ------------------------------------------------------------------ dwellings

export interface Dwelling { art: string; x: number; floor: number; w: number; label: string; }
const RH = 170;
export const ROOM_H = RH;
export const dwellings: Dwelling[] = [
  { art: 'quarters-1', x: 440, floor: DISTRICT.street, w: 234, label: 'מגורים' },
  { art: 'workshop-1', x: 690, floor: DISTRICT.street, w: 156, label: 'סדנה' },
  { art: 'canteen-1', x: 480, floor: DISTRICT.terrace, w: 156, label: 'מטבח' },
  { art: 'medbay-1', x: 650, floor: DISTRICT.terrace, w: 156, label: 'מרפאה' },
  { art: 'hydroponics-1', x: 820, floor: DISTRICT.terrace, w: 234, label: 'חממה' },
];

// ------------------------------------------------------------------ lights

export interface LightDef {
  x: number; y: number; r: number; c: number; i: number;
  flicker?: number;       // 0..1
  blink?: number;         // Hz, on/off
  cone?: number;          // downward cone length
  glow?: number;          // additive halo multiplier
  zone?: string;
}

const L = T.light.colors;

function catenary(x0: number, y0: number, x1: number, y1: number, sag: number, step: number) {
  const pts: [number, number][] = [];
  const n = Math.max(2, Math.round(Math.abs(x1 - x0) / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)]);
  }
  return pts;
}

export const strings: { x0: number; y0: number; x1: number; y1: number; sag: number; step: number }[] = [
  { x0: 1990, y0: 600, x1: 2630, y1: 600, sag: 46, step: 40 },
  { x0: 1990, y0: 800, x1: 2630, y1: 800, sag: 34, step: 46 },
  { x0: 450, y0: 640, x1: 1235, y1: 640, sag: 58, step: 44 },
  { x0: 1085, y0: 836, x1: 1292, y1: 884, sag: 26, step: 34 },
];

export const lights: LightDef[] = [
  // sky spill down the ramp
  { x: 3010, y: 330, r: 420, c: L.sky, i: 0.9, glow: 0.4 },
  { x: 2800, y: 470, r: 160, c: L.emergency, i: 0.55, blink: 0.7, glow: 1 },
  // hub
  { x: 2310, y: 508, r: 440, c: L.amber, i: 0.75, flicker: 0.05, cone: 420, glow: 1 },
  { x: 1988, y: 512, r: 210, c: L.tungsten, i: 0.5, glow: 0.8 },
  { x: 2632, y: 512, r: 210, c: L.tungsten, i: 0.5, glow: 0.8 },
  { x: 1988, y: 712, r: 210, c: L.tungsten, i: 0.5, glow: 0.8 },
  { x: 2632, y: 712, r: 210, c: L.tungsten, i: 0.5, flicker: 0.4, glow: 0.8 },
  { x: 1988, y: 912, r: 200, c: L.tungsten, i: 0.5, glow: 0.8 },
  { x: 2632, y: 912, r: 200, c: L.tungsten, i: 0.5, glow: 0.8 },
  { x: 2310, y: 930, r: 260, c: L.warm, i: 0.6, glow: 0 },
  // corridor
  { x: 1880, y: 888, r: 180, c: L.fluoro, i: 0.75, cone: 70, glow: 0.7 },
  { x: 1680, y: 886, r: 180, c: L.fluoro, i: 0.75, flicker: 0.9, cone: 70, glow: 0.7 },
  { x: 1480, y: 890, r: 170, c: L.fluoro, i: 0.7, cone: 70, glow: 0.7 },
  // district
  { x: 960, y: 990, r: 320, c: L.fire, i: 1.15, flicker: 0.55, glow: 1.3 },
  { x: 1190, y: 934, r: 230, c: L.warm, i: 0.85, cone: 86, glow: 1 },
  // edge (beyond the rubble)
  { x: 80, y: 975, r: 280, c: L.cold, i: 0.9, flicker: 0.12, glow: 0.9 },
  { x: 372, y: 940, r: 120, c: L.emergency, i: 0.6, blink: 0.45, glow: 1 },
  // storeroom
  { x: 2780, y: 700, r: 130, c: L.tungsten, i: 0.55, flicker: 0.7, glow: 0.8 },
  // cellar
  { x: 560, y: 500, r: 150, c: L.lantern, i: 0.7, flicker: 0.4, glow: 1 },
  // hidden cave — bioluminescence
  { x: 1000, y: 1360, r: 220, c: L.bio, i: 1.0, flicker: 0.1, glow: 1 },
  { x: 1260, y: 1390, r: 280, c: L.bio, i: 1.0, flicker: 0.1, glow: 1 },
  { x: 1520, y: 1370, r: 220, c: L.bio, i: 1.0, flicker: 0.1, glow: 1 },
  { x: 1630, y: 1290, r: 130, c: L.bio, i: 0.6, flicker: 0.1, glow: 1 },
];

for (const s of strings)
  for (const [x, y] of catenary(s.x0, s.y0, s.x1, s.y1, s.sag, s.step))
    lights.push({ x, y: y + 6, r: 62, c: L.amber, i: 0.22, flicker: 0.08, glow: 0.9 });

export { catenary };

/** broad zone fill lights (ellipses) so spaces stay readable between lamps */
export const zones: { x: number; y: number; w: number; h: number; c: number; a: number }[] = [
  { x: 2310, y: 720, w: 900, h: 760, c: T.light.zoneAmbient.hub.c, a: T.light.zoneAmbient.hub.a },
  { x: 1630, y: 930, w: 900, h: 220, c: T.light.zoneAmbient.corridor.c, a: T.light.zoneAmbient.corridor.a },
  { x: 840, y: 820, w: 1200, h: 680, c: T.light.zoneAmbient.district.c, a: T.light.zoneAmbient.district.a },
  { x: 200, y: 960, w: 460, h: 220, c: T.light.zoneAmbient.edge.c, a: T.light.zoneAmbient.edge.a },
];

export const labels: { x: number; y: number; text: string; sub: string }[] = [
  { x: 3150, y: 250, text: 'פתח הבונקר', sub: 'פני השטח' },
  { x: 2310, y: 400, text: 'כיכר הפעמון', sub: 'רובד 1 · מקלט עליון' },
  { x: 1660, y: 860, text: 'מעבר השירות', sub: 'רובד 2' },
  { x: 840, y: 535, text: 'שכונת הכורים', sub: 'מגורים · 5 בתים' },
  { x: 200, y: 860, text: 'הקצה החשוך', sub: 'מנהרה חסומה' },
  { x: 1290, y: 1160, text: 'מערת הזוהר', sub: 'נחשפה!' },
  { x: 580, y: 384, text: 'מרתף ישן', sub: 'נחשף!' },
  { x: 2775, y: 668, text: 'מחסן אטום', sub: 'נחשף!' },
];

/**
 * [world:C0] The seven strata of "The City Below" as LOGIC sees them: which logical floors belong to which stratum, their names and
 * the cosmetic pockets hidden in each. Pure data plus a few pure helpers, Node-safe (the sim, the lint and the save code import it).
 *
 * - Stratum 0 is the surface row (floor -1). Stratum s >= 1 is the four floors 4(s-1) .. 4(s-1)+3, so every stratum seam sits on a
 *   service gallery (GALLERY_ABOVE_FLOORS 3, 7, 11, 15, 19; checked by tools/sim/lint.ts) and the floor-index rules keep their meaning:
 *   FIRE_CODE_FLOOR 8 opens stratum 3, stabilityCut bites from floor 12 = stratum 4.
 * - The art-direction twin of this table (palette, light, fog) is `STRATA` in src/world/tokens.ts; both agree on the floor ranges.
 * - A pocket is a cosmetic secret: it lies beyond the furthest any floor can logically reach (a wing at its Act cap plus a district),
 *   or inside a gallery band, so it can never collide with a room. Finding one only writes `state.city.found` (CitySystem).
 */

export type StratumId = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** The kit (art set) of a stratum; one per stratum. */
export type KitId = 'surface' | 'shelter' | 'works' | 'metro' | 'mines' | 'caves' | 'core';

export interface PocketDef {
  /** Stable id `p:<stratum>:<name>`; saved in state.city.found, never renamed. */
  id: string;
  /** The floor the pocket is anchored to (its y comes from floorTop(anchorFloor) + dy). */
  anchorFloor: number;
  /** West of the west wing, east past the districts, or 'below' = inside the gallery band under anchorFloor. */
  side: 'w' | 'e' | 'below';
  /** Left edge in slots on the logical slot line of anchorFloor (negative = west of the spine). */
  dxSlots: number;
  /** World units below floorTop(anchorFloor); for side 'below', below the top of the gallery band under anchorFloor (geom galleryTop). */
  dy: number;
  /** Width in slots. */
  w: number;
  /** Height in world units. */
  h: number;
  name: Record<'he' | 'en', string>;
}

export interface StratumDef {
  id: StratumId;
  key: KitId;
  /** Inclusive logical floor range. */
  floors: readonly [number, number];
  name: Record<'he' | 'en', string>;
  pockets: readonly PocketDef[];
}

export const FLOORS_PER_STRATUM = 4;
/** The deepest stratum. */
export const LAST_STRATUM: StratumId = 6;

/** Reach the pockets must keep clear of: the widest wing cap (data/wings.ts WING_CAP_*) plus a district (DISTRICT_SLOTS) and a margin. */
export const POCKET_CLEAR_EAST = 30;
export const POCKET_CLEAR_WEST = 14;

const p = (s: number, name: string, anchorFloor: number, side: PocketDef['side'], dxSlots: number, w: number, he: string, en: string, dy = 8, h = 84): PocketDef =>
  ({ id: `p:${s}:${name}`, anchorFloor, side, dxSlots, dy, w, h, name: { he, en } });

export const STRATA: readonly StratumDef[] = [
  { id: 0, key: 'surface', floors: [-1, -1], name: { he: 'פני השטח', en: 'Surface' }, pockets: [] },
  {
    id: 1, key: 'shelter', floors: [0, 3], name: { he: 'המקלט העליון', en: 'Upper Shelter' },
    pockets: [
      p(1, 'wellRoom', 1, 'w', -18, 3, 'חדר הבאר', 'The Well Room'),
      p(1, 'oldChapel', 2, 'e', 30, 3, 'בית התפילה הנטוש', 'The Abandoned Chapel'),
    ],
  },
  {
    id: 2, key: 'works', floors: [4, 7], name: { he: 'רשת השירות', en: 'Service Network' },
    pockets: [
      p(2, 'pumpGallery', 5, 'e', 31, 4, 'גלריית המשאבות', 'The Pump Gallery'),
      p(2, 'valveVault', 6, 'w', -19, 3, 'כספת המגופים', 'The Valve Vault'),
      p(2, 'crawlway', 7, 'below', 4, 5, 'מעבר הזחילה', 'The Crawlway', 4, 26),
    ],
  },
  {
    id: 3, key: 'metro', floors: [8, 11], name: { he: 'המטרו הישן', en: 'Old Metro' },
    pockets: [
      p(3, 'ghostPlatform', 9, 'e', 30, 5, 'רציף הרפאים', 'The Ghost Platform'),
      p(3, 'tokenBooth', 10, 'w', -17, 2, 'תא הכרטיסן', 'The Token Booth'),
    ],
  },
  {
    id: 4, key: 'mines', floors: [12, 15], name: { he: 'המכרות', en: 'The Mines' },
    pockets: [
      p(4, 'floodedDrift', 13, 'e', 31, 4, 'הנקבה המוצפת', 'The Flooded Drift'),
      p(4, 'canaryNiche', 14, 'w', -16, 2, 'גומחת הכנרית', 'The Canary Niche'),
    ],
  },
  {
    id: 5, key: 'caves', floors: [16, 19], name: { he: 'המערות העמוקות', en: 'Deep Caves' },
    pockets: [
      p(5, 'crystalGrotto', 17, 'e', 30, 4, 'מערת הגבישים', 'The Crystal Grotto'),
      p(5, 'echoLake', 18, 'w', -20, 4, 'אגם ההד', 'The Echo Lake'),
    ],
  },
  {
    id: 6, key: 'core', floors: [20, 23], name: { he: 'הליבה', en: 'The Core' },
    pockets: [
      p(6, 'heartVent', 21, 'e', 32, 3, 'פתח הלב', 'The Heart Vent'),
      p(6, 'sealedLab', 22, 'w', -18, 3, 'המעבדה החתומה', 'The Sealed Lab'),
    ],
  },
];

/** The stratum a logical floor belongs to: the surface row (-1) is 0; floor f is 1 + floor(f / 4), capped at the core. */
export function stratumOf(floor: number): StratumId {
  if (floor < 0) return 0;
  return Math.min(LAST_STRATUM, 1 + Math.floor(floor / FLOORS_PER_STRATUM)) as StratumId;
}

/** Every stratum a bunker of `currentFloors` dug floors has reached (the surface always), ascending. */
export function strataReached(currentFloors: number): StratumId[] {
  const out: StratumId[] = [0];
  const n = Math.max(0, Math.floor(currentFloors));
  for (let f = 0; f < n; f += FLOORS_PER_STRATUM) {
    const s = stratumOf(f);
    if (out[out.length - 1] !== s) out.push(s);
  }
  return out;
}

/** True for the first (top) floor of an underground stratum: digging it is a breakthrough into a new stratum. */
export function isStratumTop(floor: number): boolean {
  return floor >= 0 && floor % FLOORS_PER_STRATUM === 0;
}

/** Every pocket of every stratum. */
export function allPockets(): PocketDef[] {
  return STRATA.flatMap(s => [...s.pockets]);
}

/** The pocket with this id, or undefined. */
export function pocketById(id: string): PocketDef | undefined {
  for (const s of STRATA) for (const pk of s.pockets) if (pk.id === id) return pk;
  return undefined;
}

/** The stratum a pocket id belongs to (from `p:<s>:<name>`), or null for a malformed id. */
export function pocketStratum(id: string): StratumId | null {
  const m = /^p:(\d):/.exec(id);
  return m && +m[1] <= LAST_STRATUM ? (+m[1] as StratumId) : null;
}

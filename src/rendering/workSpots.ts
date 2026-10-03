import type { Container } from 'pixi.js';
import { ArtLibrary } from '../art/ArtLibrary';
import { artEntry } from '../art/registry';
import type { Activity, Lane } from './people';

/**
 * gfx-p0 people: where survivors stand to work in each painting, so the chef stirs the pot on the stove,
 * the medic leans over the bed and two workshop hands don't hammer into each other.
 *
 * A spot is `[x, face, activity?, depth?]`: x is a fraction of the painting's width (it mirrors with the room),
 * face is the side the equipment is on (1 = right), activity overrides the room's default, depth is 0 (back of the
 * floor, against the machines) .. 1 (front edge). Spots were placed by eye on every painting (all tiers), with
 * the worker's hands landing on the machine and at least ~14 units between bodies.
 */
type SpotDef = readonly [x: number, face: 1 | -1, act?: Activity, depth?: number];

interface RoomDef {
  spots: readonly SpotDef[];
  /** Floor stretches nobody stands on (a pit, the water), as fractions of the width. */
  block?: readonly (readonly [number, number])[];
  /** Walkable span, as fractions of the width (default 0.09 .. 0.91). */
  range?: readonly [number, number];
  /** Floor raised by this many units (a dock or a platform painted above the room floor). */
  dy?: number;
}

const ARMORY: RoomDef = { spots: [[0.18, 1, 'hammer'], [0.58, 1, 'type'], [0.9, -1, 'type']] };
const CANTEEN_OLD: RoomDef = { spots: [[0.31, -1, 'stir'], [0.56, 1, 'tend', 0.3], [0.82, 1, 'tend']] };
const FARM: RoomDef = { spots: [[0.18, 1], [0.4, 1], [0.62, -1], [0.84, -1]] };
const GENERATOR: RoomDef = { spots: [[0.12, 1, 'wrench'], [0.86, -1, 'wrench'], [0.62, 1, 'tend', 0.35]] };
const LAB_OLD: RoomDef = { spots: [[0.24, 1, 'tend'], [0.48, 1, 'tend'], [0.7, 1, 'type']] };
const MEDBAY: RoomDef = { spots: [[0.4, -1, 'tend'], [0.62, 1, 'type', 0.35], [0.88, -1, 'tend']] };
const RADIO: RoomDef = { spots: [[0.24, 1, 'type'], [0.6, 1, 'type'], [0.88, -1, 'tend']] };
const REACTOR: RoomDef = { spots: [[0.28, 1, 'wrench'], [0.66, -1, 'wrench'], [0.8, 1, 'type'], [0.12, 1, 'wrench', 0.4]] };
const STORAGE: RoomDef = { spots: [[0.2, -1], [0.44, 1], [0.6, -1], [0.76, 1]] };
const GYM: RoomDef = { spots: [[0.21, -1, 'punch'], [0.47, 1, 'lift', 0.3], [0.8, -1, 'lift', 0.5]] };
// The pump's well is cut into the floor in the middle of every tier: nobody walks over it.
const PUMP: RoomDef = { spots: [[0.2, 1, 'wrench'], [0.78, -1, 'wrench'], [0.9, 1, 'wrench', 0.6]], block: [[0.36, 0.67]] };
const PURIFIER: RoomDef = { spots: [[0.14, 1, 'wrench'], [0.47, 1, 'wrench'], [0.84, -1, 'wrench']] };
const WORKSHOP: RoomDef = { spots: [[0.16, 1, 'hammer'], [0.5, 1, 'wrench'], [0.76, 1, 'wrench']] };

const ROOMS: Record<string, RoomDef> = {
  'rooms/armory-0': ARMORY, 'rooms/armory-1': ARMORY,
  'rooms/armory-2': { spots: [[0.17, 1, 'hammer'], [0.58, 1, 'type'], [0.93, -1, 'type']] },
  'rooms/canteen-0': CANTEEN_OLD, 'rooms/canteen-1': CANTEEN_OLD,
  'rooms/canteen-2': { spots: [[0.3, -1, 'stir'], [0.5, 1, 'tend', 0.35], [0.86, -1, 'tend']] },
  'rooms/farm-0': FARM, 'rooms/farm-1': FARM, 'rooms/farm-2': FARM,
  'rooms/generator-0': { spots: [[0.12, 1, 'wrench'], [0.6, -1, 'wrench'], [0.72, 1, 'tend', 0.35]] },
  'rooms/generator-1': GENERATOR, 'rooms/generator-2': GENERATOR,
  'rooms/hydroponics-0': FARM, 'rooms/hydroponics-1': FARM,
  'rooms/hydroponics-2': { spots: [[0.2, 1], [0.42, 1], [0.62, -1], [0.8, 1, 'type']] },
  'rooms/laboratory-0': LAB_OLD, 'rooms/laboratory-1': LAB_OLD,
  'rooms/laboratory-2': { spots: [[0.2, 1, 'tend'], [0.52, 1, 'tend'], [0.92, -1, 'type']] },
  'rooms/medbay-0': { spots: [[0.42, -1, 'tend'], [0.88, -1, 'type']] },
  'rooms/medbay-1': MEDBAY, 'rooms/medbay-2': MEDBAY,
  'rooms/radioTower-0': RADIO, 'rooms/radioTower-1': RADIO,
  'rooms/radioTower-2': { spots: [[0.28, 1, 'type'], [0.62, 1, 'type'], [0.9, -1, 'type']] },
  'rooms/reactor-0': REACTOR, 'rooms/reactor-1': REACTOR,
  'rooms/reactor-2': { spots: [[0.28, 1, 'wrench'], [0.66, -1, 'wrench'], [0.8, 1, 'type'], [0.2, -1, 'type', 0.4]] },
  'rooms/storage-0': STORAGE, 'rooms/storage-1': STORAGE,
  'rooms/storage-2': { spots: [[0.25, 1], [0.46, 1], [0.62, -1], [0.8, 1, 'type']] },
  'rooms/trainingRoom-0': GYM, 'rooms/trainingRoom-1': GYM,
  // Top tier: a sparring robot on the left and a treadmill on the right.
  'rooms/trainingRoom-2': { spots: [[0.22, -1, 'punch'], [0.45, 1, 'lift', 0.3], [0.84, 1, 'run', 0.15]] },
  'rooms/waterPump-0': PUMP, 'rooms/waterPump-1': PUMP, 'rooms/waterPump-2': PUMP,
  'rooms/waterPurifier-0': PURIFIER, 'rooms/waterPurifier-1': PURIFIER, 'rooms/waterPurifier-2': PURIFIER,
  'rooms/workshop-0': { spots: [[0.24, 1, 'hammer'], [0.62, -1, 'wrench'], [0.78, 1, 'wrench']] },
  'rooms/workshop-1': WORKSHOP,
  'rooms/workshop-2': { spots: [[0.34, -1, 'type'], [0.58, 1, 'hammer'], [0.8, 1, 'type']] },
  // Districts: crystals to chip at, a dock over the water, a platform above the tracks.
  'districts/cave': { spots: [[0.34, 1, 'dig'], [0.6, 1, 'dig'], [0.8, 1, 'dig'], [0.2, -1, 'dig']] },
  'districts/lake': { spots: [[0.16, 1, 'water'], [0.3, 1, 'water'], [0.38, -1, 'carry']], range: [0.08, 0.4], dy: -14 },
  'districts/metro': { spots: [[0.2, 1, 'carry'], [0.5, 1, 'carry'], [0.36, -1, 'carry'], [0.72, -1, 'carry']], dy: -13 },
  // Halls: the lower level's fountain and planters, the reactor's three consoles.
  'halls/atrium': { spots: [[0.4, 1, 'tend'], [0.6, -1, 'tend'], [0.15, -1, 'water'], [0.86, 1, 'water']] },
  'halls/reactorHall': { spots: [[0.24, -1, 'type'], [0.38, 1, 'type'], [0.62, -1, 'type'], [0.76, 1, 'type']] },
};

/** Something standing in a room (a Person); the crowd only needs where it is and where it is going. */
export interface CrowdMember {
  readonly container: Container;
  /** Current x (room-local). */
  readonly posX: number;
  /** Where it is heading (its own x when standing). */
  readonly goalX: number;
  /** Depth on the floor, 0 (back) .. 1 (front). */
  readonly posD: number;
  /** Scaled width of its name tag, or 0 when no tag shows. */
  tagWidth(): number;
  /** Which row its name tag sits in (0 = just above the head). */
  setTagRow(row: number): void;
}

export interface Spot {
  x: number;
  face: 1 | -1;
  act: Activity | null;
  depth: number;
  owner: CrowdMember | null;
}

const MIN_GAP = 15;

/** The people of one room: who holds which work spot, free floor for the rest, and the lamp shadows fall from. */
export class Crowd {
  readonly members: CrowdMember[] = [];
  spots: Spot[] = [];
  x0 = 0;
  x1 = 1;
  dy = 0;
  private blocks: [number, number][] = [];
  /** The main lamp (room-local x, and its height above the floor), or null when the room has none. */
  lamp: { x: number; h: number } | null = null;
  sig = '';

  readonly container: Container;

  constructor(container: Container) {
    this.container = container;
  }

  configure(sig: string, key: string | null, mirror: boolean, width: number, lane: Lane, height: number): void {
    this.sig = sig;
    const def = key ? ROOMS[key] : undefined;
    const fx = (f: number) => (mirror ? 1 - f : f) * width;
    for (const s of this.spots) s.owner = null;
    this.spots = (def?.spots ?? []).map(([x, f, act, depth]) => ({ x: fx(x), face: (mirror ? -f : f) as 1 | -1, act: act ?? null, depth: depth ?? 0.2, owner: null }));
    const r = def?.range ?? (key ? [0.09, 0.91] : null);
    this.x0 = r ? Math.min(fx(r[0]), fx(r[1])) : lane.x0;
    this.x1 = r ? Math.max(fx(r[0]), fx(r[1])) : lane.x1;
    this.blocks = (def?.block ?? []).map(([a, b]) => [Math.min(fx(a), fx(b)), Math.max(fx(a), fx(b))]);
    this.dy = def?.dy ?? 0;
    // Cast shadows fall away from the room's main lamp: the biggest light, preferring the ones near the middle.
    const entry = key ? artEntry(key) : undefined;
    let best: { x: number; h: number } | null = null;
    let score = -Infinity;
    for (const l of entry ? ArtLibrary.lightsFor(entry) : []) {
      const s = l.r - Math.abs(l.x - 0.5) * 0.08;
      if (s > score) {
        score = s;
        // People stand on the lower level's floor; lamps are measured from the painting's top.
        best = { x: fx(l.x), h: Math.max(18, height - 8 - l.y * height) };
      }
    }
    this.lamp = best;
  }

  join(m: CrowdMember): void {
    if (!this.members.includes(m)) this.members.push(m);
  }

  leave(m: CrowdMember): void {
    const i = this.members.indexOf(m);
    if (i >= 0) this.members.splice(i, 1);
    for (const s of this.spots) if (s.owner === m) s.owner = null;
  }

  /** Whether the floor between two points crosses a pit or the water. */
  crosses(a: number, b: number): boolean {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return this.blocks.some(([b0, b1]) => hi > b0 && lo < b1);
  }

  private inBlock(x: number): boolean {
    return this.blocks.some(([b0, b1]) => x > b0 - 6 && x < b1 + 6);
  }

  /** Claims a free work spot reachable from x (preferring a different one from `avoid`), or null. */
  claim(m: CrowdMember, x: number, rnd: () => number, avoid: Spot | null = null): Spot | null {
    const free = this.spots.filter(s => (!s.owner || s.owner === m) && s !== avoid && !this.crosses(x, s.x));
    if (!free.length) return null;
    const s = free[Math.floor(rnd() * free.length)];
    for (const o of this.spots) if (o.owner === m) o.owner = null;
    s.owner = m;
    return s;
  }

  release(m: CrowdMember): void {
    for (const s of this.spots) if (s.owner === m) s.owner = null;
  }

  /** Room left on the floor: the best of a few random points, as far as possible from everyone else's goal. */
  freeX(m: CrowdMember, from: number, rnd: () => number): number {
    let bestX = from, bestGap = -1;
    for (let i = 0; i < 7; i++) {
      const x = this.x0 + rnd() * (this.x1 - this.x0);
      if (this.inBlock(x) || this.crosses(from, x)) continue;
      let gap = Infinity;
      for (const o of this.members) if (o !== m) gap = Math.min(gap, Math.abs(o.goalX - x));
      for (const s of this.spots) if (s.owner && s.owner !== m) gap = Math.min(gap, Math.abs(s.x - x));
      if (gap >= MIN_GAP * 1.6) return x;
      if (gap > bestGap) { bestGap = gap; bestX = x; }
    }
    return bestX;
  }

  /** Arrival point for someone walking in, on the side nearest the lift shaft (left) unless that side is cut off. */
  entryX(): number {
    return this.inBlock(this.x0 + 4) ? this.x1 - 4 : this.x0 + 4;
  }
}

const crowds = new WeakMap<Container, Crowd>();
const touched = new Set<Crowd>();

/**
 * The crowd of a room's people layer, (re)configured when the room's painting or mirroring changes.
 * `visualSig` is the room view's signature (`type|new|openL|openR|artKey|mirror`); an unknown key means
 * no painted spots, only spacing.
 */
export function crowdFor(layer: Container, lane: Lane, visualSig: string, width: number, painted: boolean, height = 100): Crowd {
  let c = crowds.get(layer);
  if (!c) {
    c = new Crowd(layer);
    crowds.set(layer, c);
  }
  const sig = `${painted}|${visualSig}|${width}`;
  if (c.sig !== sig) {
    const parts = visualSig.split('|');
    const i = parts.findIndex(p => p in ROOMS);
    const key = painted && i >= 0 ? parts[i] : null;
    c.configure(sig, key, key !== null && parts[i + 1] === 'true', width, lane, height);
  }
  touched.add(c);
  return c;
}

const rowsEnd: number[] = [];
interface TagEntry { m: CrowdMember; x: number; y: number; w: number }
const pool: TagEntry[] = [];
const list: TagEntry[] = [];
const byFloorThenX = (a: TagEntry, b: TagEntry) => a.y - b.y || a.x - b.x;

/**
 * Once per frame after everyone moved: drop people who left a room and stack name tags that would overlap
 * (across neighbouring rooms on the same floor too) into rows.
 */
export function settleCrowds(): void {
  let n = 0;
  for (const c of touched) {
    for (let i = c.members.length - 1; i >= 0; i--) {
      const m = c.members[i];
      if (m.container.destroyed || m.container.parent !== c.container) c.leave(m);
    }
    const root = c.container.parent;
    if (!root) continue;
    for (const m of c.members) {
      const w = m.tagWidth();
      if (w <= 0) continue;
      const e = pool[n] ?? (pool[n] = { m, x: 0, y: 0, w: 0 });
      e.m = m;
      e.x = root.x + m.posX;
      e.y = Math.round(root.y + c.container.y);
      e.w = w;
      n++;
    }
  }
  touched.clear();
  if (!n) return;
  list.length = 0;
  for (let i = 0; i < n; i++) list.push(pool[i]);
  list.sort(byFloorThenX);
  let floorY = NaN;
  for (const e of list) {
    if (e.y !== floorY) {
      floorY = e.y;
      rowsEnd.length = 0;
    }
    let row = 0;
    while (row < rowsEnd.length && rowsEnd[row] > e.x - e.w / 2 - 2) row++;
    rowsEnd[row] = e.x + e.w / 2;
    e.m.setTagRow(Math.min(row, 3));
  }
}

import type { BuildingType, GameState } from '../core/GameState';
import { roomSlots } from '../data/buildingDefs';
import { BASE_EAST, ROOMS_X, SHAFT_GAP, extentsFor, slotX } from './geom';
import { occupancy, type Cell, type Grid } from './occupancy';

/**
 * [plan4:ST-13] Where the doors are. Pure data (no Pixi): the renderer draws a doorway in each of these columns, and the walking code (People-Circulation,
 * `routes.ts`) can ask where a person leaves a room.
 *
 * A boundary index `b` is the line between slot `b - 1` and slot `b` (the same convention as the keys of `state.layout.doors`: `"floor:b"`). East of the
 * shaft slot 0 is the first slot, so b = 0 is the line between the shaft and slot 0 (the east landing); west of it slot -1 is the first slot, so b = 0 is also
 * the line between slot -1 and the shaft (the west landing). `x` tells the two apart: it is the world x of the column the door cuts through.
 *
 * Which boundaries have a door:
 *  - 'room'    two different rooms meet (a column stands there: the door is cut through it); two rooms of the same type and level open into one compound
 *              and have no column and no door: walk straight across,
 *  - 'landing' a room stands against the shaft (the east side, and the west side where a wing reaches it),
 *  - 'stub'    where a wing ends: the last dug step (one or two empty slots) is a short corridor, and the room beside it has a door onto it.
 * A ruin is rubble, not a room: there is no door into one.
 */

/** [plan4:ST-13] The doorway passage (units): wide and tall enough for a walker (about 56 high); the plan's 14 x 50 sketch was too low for the people. */
export const DOOR_W = 13.6;
export const DOOR_H = 57;

export type DoorStyle = 'slide' | 'blast' | 'curtain' | 'open';

export interface Opening {
  floor: number;
  /** The line between slot b - 1 and slot b (see above). */
  slot: number;
  /** World x of the column the door cuts through (the middle of the doorway). */
  x: number;
  kind: 'room' | 'landing' | 'stub';
  /** For a landing: which side of the shaft. */
  side?: 'w' | 'e';
  /** The room on the west / east of the door (null: the shaft, an empty bay, or the stub). */
  leftId: string | null;
  rightId: string | null;
  style: DoorStyle;
  /** For a stub: how many empty slots of corridor lie beyond the door (1 or 2). */
  run?: number;
}

const BLAST: ReadonlySet<BuildingType> = new Set<BuildingType>(['laboratory', 'medbay', 'reactor', 'reactorHall', 'armory', 'batteryBank', 'generator']);
const CURTAIN: ReadonlySet<BuildingType> = new Set<BuildingType>(['canteen', 'farm', 'hydroponics', 'mushroomFarm', 'quarters', 'commons', 'barracks']);

/** The door a room type gets (the four styles of the plan: round blast door, plastic curtain, sliding steel door, bare opening). */
export function doorStyleFor(type: BuildingType | undefined): DoorStyle {
  if (!type) return 'open';
  if (BLAST.has(type)) return 'blast';
  if (CURTAIN.has(type)) return 'curtain';
  return 'slide';
}

/** Rooms only: a ruin and an empty bay have no door. */
const isRoom = (c: Cell): c is NonNullable<Cell> => !!c && !c.ruin;

/** The steel/slide door beats the curtain, the blast door beats both (the heavier of the two neighbours decides). */
function styleBetween(a: Cell, b: Cell): DoorStyle {
  const sa = doorStyleFor(isRoom(a) ? a.type : undefined), sb = doorStyleFor(isRoom(b) ? b.type : undefined);
  const rank: Record<DoorStyle, number> = { open: 0, curtain: 1, slide: 2, blast: 3 };
  return rank[sa] >= rank[sb] ? sa : sb;
}

/** Every door of floor f of an occupancy grid, west to east. */
export function openingsOfFloor(grid: Grid, f: number): Opening[] {
  const out: Opening[] = [];
  const ext = grid.ext[f];
  const row = grid[f];
  if (!ext || !row) return out;
  const cell = (s: number): Cell => row[s + ext.w] ?? null;
  const idOf = (c: Cell): string | null => (c ? c.id ?? null : null);
  // West landing (a west wing's first room against the shaft) and the doors between rooms west of the shaft.
  if (ext.w > 0) {
    const a = cell(-1);
    if (isRoom(a)) out.push({ floor: f, slot: 0, x: -SHAFT_GAP, kind: 'landing', side: 'w', leftId: idOf(a), rightId: null, style: 'open' });
  }
  for (let b = -ext.w + 1; b < ext.e; b++) {
    if (b === 0) continue; // the shaft
    const a = cell(b - 1), c = cell(b);
    if (isRoom(a) && isRoom(c) && a.key !== c.key) out.push({ floor: f, slot: b, x: slotX(b), kind: 'room', leftId: idOf(a), rightId: idOf(c), style: styleBetween(a, c) });
  }
  const east0 = cell(0);
  if (isRoom(east0)) out.push({ floor: f, slot: 0, x: ROOMS_X, kind: 'landing', side: 'e', leftId: null, rightId: idOf(east0), style: 'open' });
  // The corridor stubs: the outermost one or two empty slots of a wing, with a room right beside them.
  if (ext.e > BASE_EAST) {
    let run = 0;
    while (run < ext.e && !cell(ext.e - 1 - run)) run++;
    const edge = ext.e - run;
    if (run >= 1 && run <= 2 && edge > 0 && isRoom(cell(edge - 1))) out.push({ floor: f, slot: edge, x: slotX(edge), kind: 'stub', leftId: idOf(cell(edge - 1)), rightId: null, style: 'blast', run });
  }
  if (ext.w > 0) {
    let run = 0;
    while (run < ext.w && !cell(-ext.w + run)) run++;
    const edge = -ext.w + run;
    if (run >= 1 && run <= 2 && edge < 0 && isRoom(cell(edge))) out.push({ floor: f, slot: edge, x: slotX(edge), kind: 'stub', leftId: null, rightId: idOf(cell(edge)), style: 'blast', run });
  }
  return out.sort((p, q) => p.x - q.x);
}

type Source = Pick<GameState, 'buildings' | 'ruins' | 'layout' | 'currentFloors'>;

/** Every door of floor `floor` in the live state, west to east. */
export function floorOpenings(state: Source, floor: number): Opening[] {
  const floors = state.currentFloors;
  const grid = occupancy(state.buildings, state.ruins, floors, extentsFor(state, floors));
  return openingsOfFloor(grid, floor);
}

/**
 * Where a person leaves a room. With a floor number: the world x of every door of that floor (west to east). With a room id: `{ w, e }`, the x of the door on
 * its west and on its east side, or null on a side with no door (it opens into a neighbour of the same kind, an empty bay or the end of the floor: walk on).
 * A room against the shaft has its landing door as its shaft-side door.
 */
export function roomDoorX(state: Source, floor: number): number[];
export function roomDoorX(state: Source, roomId: string): { w: number | null; e: number | null };
export function roomDoorX(state: Source, which: number | string): number[] | { w: number | null; e: number | null } {
  if (typeof which === 'number') return floorOpenings(state, which).map(o => o.x);
  const b = state.buildings.find(r => r.id === which);
  if (!b) return { w: null, e: null };
  const ops = floorOpenings(state, b.position.floor);
  const x0 = b.position.x;
  const x1 = x0 + roomSlots(b.type);
  const at = (slot: number, x: number | null): number | null => {
    const hit = ops.find(o => (x === null ? o.slot === slot && o.kind !== 'landing' : o.x === x && o.slot === slot) && (o.leftId === which || o.rightId === which));
    return hit ? hit.x : null;
  };
  // A room of the east part: its west boundary is x0 (the landing when x0 is 0), its east boundary x1. West wing rooms mirror that against the shaft.
  const west = x0 === 0 ? at(0, ROOMS_X) : at(x0, null);
  const east = x1 === 0 ? at(0, -SHAFT_GAP) : at(x1, null);
  return { w: west, e: east };
}

/** The state of the bulkhead door on boundary `slot` of `floor` (raw `layout.doors`: no entry = open). */
export function doorStateAt(state: Pick<GameState, 'layout'>, floor: number, slot: number): 'open' | 'closed' | 'sealed' {
  return state.layout?.doors?.[`${floor}:${slot}`] ?? 'open';
}

/** How far inside the room, from the doorway's centre line (the room edge), a walker stops when it enters (the doorway is DOOR_W wide, so it is still in it). */
export const DOORWAY_INSET = 4;

/**
 * [plan4:ST-13] Pure: the world x where a walker enters or leaves a room standing at [roomX, roomX + roomW], on the side facing `fromX`. The doors are cut
 * through the columns on the room's edges (and the landing against the shaft), so the doorway is the near edge, a few units inside the room.
 */
export function doorwayX(roomX: number, roomW: number, fromX: number): number {
  return fromX < roomX + roomW / 2 ? roomX + DOORWAY_INSET : roomX + roomW - DOORWAY_INSET;
}

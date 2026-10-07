import { BuildingSystem, type PlaceBlock } from './BuildingSystem';
import { floorExtent, type BuildingInstance, type BuildingType, type GameState, type Position } from '../core/GameState';
import { compoundNeighbors, getDef, roomSlots, synergyOf, touching } from '../data/buildingDefs';
import { INCIDENTS } from '../data/incidents';
import { isFirebreak } from '../data/roomEffects';
import { BASE_FLOORS, allowedFloors } from '../data/zones';

// [plan4:ST-19] What a spot is worth: the ranking behind the "Best spot" button, and the effect chips shown over the ghost room.
// Pure functions of the state (no DOM, no renderer), so the simulation bot can ask `bestSpot` too.

/** One shared instance: placeBlock reads only the state it is given. */
const BS = new BuildingSystem();

/** Every position where `type` can be placed right now (floors of the zone / deep levels, every slot the floor reaches). */
export function validSpots(type: BuildingType, state: GameState, bs: BuildingSystem = BS): Position[] {
  const out: Position[] = [];
  const w = roomSlots(type);
  for (const floor of allowedFloors(type, state.currentFloors)) {
    const ext = floorExtent(state, floor);
    for (let x = -ext.w; x + w <= ext.e; x++) {
      const pos = { x, y: 0, floor };
      if (bs.placeBlock(type, pos, state) === null) out.push(pos);
    }
  }
  return out;
}

/** Slots between the room and the lift shaft (0 = it touches the shaft side); a west room counts from its east edge. */
export function liftDistance(type: BuildingType, pos: Position): number {
  return pos.x >= 0 ? pos.x : Math.max(0, -(pos.x + roomSlots(type)));
}

/** A room as it would stand once built (level 1, finished), for the neighbour maths. */
function ghostRoom(type: BuildingType, pos: Position): BuildingInstance {
  return {
    id: '__ghost', type, level: 1, position: { x: pos.x, y: 0, floor: pos.floor }, assignedSurvivorIds: [],
    constructionProgress: 0, constructionTotal: 0, isConstructing: false, specialization: null,
  };
}

export interface PlaceEffects {
  /** Same-type, same-level neighbours that give the compound bonus (10% each). */
  compound: number;
  /** Neighbour-pair bonus (share, 0..0.2) and the neighbours that give it. */
  synergy: number;
  synergyWith: BuildingType[];
  /** Slots between the room and the lift shaft. */
  liftDist: number;
  /** Fire: a neighbour that burns easily (`near`), or this room is such a source and has neighbours that can catch it (`self`). */
  fire: { kind: 'near'; room: BuildingType } | { kind: 'self' } | null;
}

/** Fire weight of a type (INCIDENTS.fire.rooms): how likely it is to catch fire. */
function fireWeight(t: BuildingType): number {
  return (INCIDENTS.fire.rooms as Partial<Record<BuildingType, number>>)[t] ?? 0;
}

/** What standing at `pos` would give or risk. */
export function placeEffects(type: BuildingType, pos: Position, state: GameState): PlaceEffects {
  const g = ghostRoom(type, pos);
  const syn = synergyOf(state, g);
  const neighbours = state.buildings.filter(o => touching(o, g));
  let fire: PlaceEffects['fire'] = null;
  if (!isFirebreak(g)) {
    const hot = neighbours.filter(o => !isFirebreak(o)).sort((a, b) => fireWeight(b.type) - fireWeight(a.type))[0];
    const hotNeighbour = neighbours.find(o => !isFirebreak(o) && fireWeight(o.type) >= 1.5);
    if (hotNeighbour) fire = { kind: 'near', room: hotNeighbour.type };
    else if (fireWeight(type) >= 2 && hot) fire = { kind: 'self' };
  }
  return {
    compound: compoundNeighbors(state, g), synergy: syn.total, synergyWith: syn.links.map(l => l.with),
    liftDist: liftDistance(type, pos), fire,
  };
}

/** Score of a spot, lexicographic: more compound neighbours, then nearer the shaft, then in the room's own zone, then the shallowest floor. */
function rankKey(type: BuildingType, pos: Position, state: GameState, home: number[]): [number, number, number, number] {
  const zoneMatch = home.length === 0 || home.includes(pos.floor) ? 1 : 0;
  return [compoundNeighbors(state, ghostRoom(type, pos)), -liftDistance(type, pos), zoneMatch, -pos.floor];
}

/** Best first (compare of two rankKeys). */
function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * The recommended spot for a new room: a same-type neighbour for the compound bonus > the nearest to the shaft > the room's own zone >
 * the lowest floor number (shallowest). Ties keep the west-most / first found, so the answer is deterministic. null = nowhere to put it.
 */
export function bestSpot(type: BuildingType, state: GameState, bs: BuildingSystem = BS): Position | null {
  const home = allowedFloors(type, BASE_FLOORS);
  let best: Position | null = null;
  let bestKey: number[] = [];
  for (const pos of validSpots(type, state, bs)) {
    const key = rankKey(type, pos, state, home);
    if (!best || better(key, bestKey)) { best = pos; bestKey = key; }
  }
  return best;
}

/** The valid spot nearest to a world point (for dragging the ghost): spots are compared by their centre. Null when nowhere is valid. */
export function nearestSpot(spots: Position[], type: BuildingType, cx: number, cy: number, centreOf: (type: BuildingType, p: Position) => { x: number; y: number }): Position | null {
  let best: Position | null = null;
  let bd = Infinity;
  for (const p of spots) {
    const c = centreOf(type, p);
    const d = (c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** [plan4:ST-19] A tap on slot `slot` of `floor`: the spot the room should take (it may start up to width-1 slots left of the tap so that it covers it). */
export function spotForTap(type: BuildingType, floor: number, slot: number, state: GameState, bs: BuildingSystem = BS): { pos: Position; block: PlaceBlock | null } {
  const w = roomSlots(type);
  const first: Position = { x: slot, y: 0, floor };
  const block = bs.placeBlock(type, first, state);
  if (block === null) return { pos: first, block };
  // A wide room tapped near the end of a floor, or in a gap one slot short of its width: slide it left until it covers the tapped slot and fits.
  for (let dx = 1; dx < w; dx++) {
    const p: Position = { x: slot - dx, y: 0, floor };
    if (bs.placeBlock(type, p, state) === null) return { pos: p, block: null };
  }
  return { pos: first, block };
}

/** A tidy "B2, B4–B9" for a list of floor numbers (0-based in, 1-based out as the depth ruler shows them). */
export function floorRangesLabel(floors: number[]): string {
  const f = [...new Set(floors)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < f.length;) {
    let j = i;
    while (j + 1 < f.length && f[j + 1] === f[j] + 1) j++;
    parts.push(j === i ? `B${f[i] + 1}` : `B${f[i] + 1}–B${f[j] + 1}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** The room's display name in a locale. */
export function nameOf(type: BuildingType, locale: string): string {
  const d = getDef(type);
  return d?.name[locale] ?? d?.name.en ?? type;
}

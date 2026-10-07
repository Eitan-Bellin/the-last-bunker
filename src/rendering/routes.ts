import type { GameState } from '../core/GameState';
import { getDef } from '../data/buildingDefs';
import { ROOMS_X, ROOM_H, SHAFT_GAP, SHAFT_W, SLOT_W, floorTop, slotAtX, slotX } from './geom';

/**
 * [plan4:ST-18] Route planning for people walking between rooms, floors and the lift. Purely cosmetic (decision D4): nothing here
 * feeds back into the simulation, a failed plan just means the survivor appears in their new room as before.
 *
 * A route is a short list of waypoints in world space. `kind[i]` says how the walker gets from waypoint i-1 to i:
 * on foot along one floor, in the lift, up/down the emergency stairs (a zig-zag through the stairwell column), or up a
 * ladder in the shaft (no power and no stairwell). Everything is preallocated: `route()` writes into a Route the caller owns
 * (or the shared scratch one), so planning allocates nothing.
 */

export const LEG_WALK = 0;
export const LEG_LIFT = 1;
export const LEG_STAIRS = 2;
export const LEG_LADDER = 3;

export const MAX_WP = 10;

export class Route {
  n = 0;
  x = new Float32Array(MAX_WP);
  y = new Float32Array(MAX_WP);
  floor = new Int16Array(MAX_WP);
  kind = new Uint8Array(MAX_WP);
  /** Stairs legs: half-width of the zig-zag and number of flights (stored on the leg's end waypoint). */
  amp = new Float32Array(MAX_WP);
  flights = new Uint8Array(MAX_WP);
  /** Rough time the whole trip takes, in seconds (lets the caller refuse an absurdly long walk). */
  seconds = 0;

  copyFrom(o: Route): void {
    this.n = o.n;
    this.seconds = o.seconds;
    this.x.set(o.x);
    this.y.set(o.y);
    this.floor.set(o.floor);
    this.kind.set(o.kind);
    this.amp.set(o.amp);
    this.flights.set(o.flights);
  }
}

/** A place a walker starts from or heads for: a floor (-1 = the surface row), a world x and the world y of the walking line. */
export interface Stop {
  floor: number;
  x: number;
  y: number;
}

/** Walking speed on a floor, stair speed and ladder speed, world units per second. */
export const WALK_SPEED = 30;
export const STAIR_SPEED = 22;
export const LADDER_SPEED = 15;
/** Longest trip we draw; anything slower is not worth watching and the survivor just appears. */
export const MAX_TRIP_S = 60;
/** Rough wait for the lift to come, load and arrive, in seconds (the car's trip itself takes ~2 s whatever the distance). */
const LIFT_EST_S = 10;

/** Where people stand to wait for and board the lift (the middle of the car), and where the shaft ladder is. */
export const LANDING_X = SHAFT_W / 2;
export const LADDER_X = 14;
/** The walking line on a floor: depth 0.5 of the room floor (people walk between y = ROOM_H - 13 and ROOM_H - 3 of their room). */
export const LINE_OFF = ROOM_H - 8;

export function lineY(floor: number, groundY = -8): number {
  return floor >= 0 ? floorTop(floor) + LINE_OFF : groundY;
}

// --- Doors -----------------------------------------------------------------------------------------------------------------------

export type DoorBlockedFn = (floor: number, fromSlot: number, toSlot: number) => boolean;

let blockedFn: DoorBlockedFn = () => false;

/**
 * [plan4:ST-18 / ST-14] Whether the partition door between two neighbouring slots of a floor stops a walker (closed or sealed).
 * Injectable because the door system (Rooms-Systems' `isPassable`) lands separately: until `setDoorBlocked` is called every door is open.
 * The merger wires it with `setDoorBlocked((f, a, b) => !isPassable(state, f, a, b))` (see BunkerRenderer's hook).
 */
export function doorBlocked(floor: number, fromSlot: number, toSlot: number): boolean {
  return blockedFn(floor, fromSlot, toSlot);
}

export function setDoorBlocked(fn: DoorBlockedFn | null): void {
  blockedFn = fn ?? (() => false);
}

/** Whether walking along a floor from world x0 to x1 crosses a closed door (the shaft itself has no partition). */
export function walkBlocked(floor: number, x0: number, x1: number): boolean {
  if (floor < 0) return false;
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  if (hi > ROOMS_X) {
    const a = slotAtX(Math.max(lo, ROOMS_X)), b = slotAtX(hi);
    if (a !== null && b !== null) for (let s = a; s < b; s++) if (doorBlocked(floor, s, s + 1)) return true;
  }
  if (lo < -SHAFT_GAP) {
    const a = slotAtX(lo), b = slotAtX(Math.min(hi, -SHAFT_GAP - 0.01));
    if (a !== null && b !== null) for (let s = a; s < b; s++) if (doorBlocked(floor, s, s + 1)) return true;
  }
  return false;
}

// --- Room doorways ---------------------------------------------------------------------------------------------------------------

/**
 * World x where a walker enters or leaves a room of the given extent, on the side they come from (`fromX` = where they were).
 * TODO [plan4:ST-13] switch to Structure-Render's `roomDoorX` once it is merged: until then the doorway is the room's edge.
 */
export function entryX(roomX: number, roomW: number, fromX: number): number {
  return fromX < roomX + roomW / 2 ? roomX + 3 : roomX + roomW - 3;
}

// --- Stairs ----------------------------------------------------------------------------------------------------------------------

/** The world x of the middle of a stairwell column that runs through every floor from lo to hi, or NaN when there is none. */
export function stairColumnX(state: GameState, lo: number, hi: number): number {
  for (const inf of state.layout?.infra ?? []) {
    if (inf.kind === 'stairs' && inf.floor <= lo && inf.floor + (inf.floors ?? 1) - 1 >= hi) return slotX(inf.x) + SLOT_W / 2;
  }
  const bs = state.buildings;
  for (const c of bs) {
    if (c.position.floor !== lo || c.isConstructing || !getDef(c.type)?.effects?.evacuation) continue;
    let ok = true;
    for (let f = lo + 1; f <= hi && ok; f++) {
      ok = false;
      for (const o of bs) {
        if (o.position.floor === f && o.position.x === c.position.x && !o.isConstructing && getDef(o.type)?.effects?.evacuation) { ok = true; break; }
      }
    }
    if (ok) return slotX(c.position.x) + SLOT_W / 2;
  }
  return NaN;
}

// --- Planning --------------------------------------------------------------------------------------------------------------------

/** The route most callers can plan into when they copy the result straight away. */
export const SCRATCH = new Route();

function push(r: Route, kind: number, floor: number, x: number, y: number): void {
  const i = r.n++;
  r.kind[i] = kind;
  r.floor[i] = floor;
  r.x[i] = x;
  r.y[i] = y;
  r.amp[i] = 0;
  r.flights[i] = 0;
}

/** Adds a walk along the current floor to x (skipped when already there). False when a closed door is in the way. */
function walkTo(r: Route, x: number): boolean {
  const i = r.n - 1;
  if (Math.abs(r.x[i] - x) < 0.5) return true;
  if (walkBlocked(r.floor[i], r.x[i], x)) return false;
  push(r, LEG_WALK, r.floor[i], x, r.y[i]);
  r.seconds += Math.abs(x - r.x[i]) / WALK_SPEED;
  return true;
}

/**
 * Adds the climb from the current floor to `toFloor`: the lift when it runs (power and `liftOk`), the stairwell when there is one
 * (always in a blackout; about 30% of one- and two-floor hops with power), otherwise the ladder up the shaft. `rnd` is a 0..1 roll.
 * Floor -1 (the surface row) is only reachable by the ladder.
 */
function hop(r: Route, state: GameState, toFloor: number, liftOk: boolean, rnd: number, groundY: number): boolean {
  const i = r.n - 1;
  const from = r.floor[i];
  const lo = Math.min(from, toFloor), hi = Math.max(from, toFloor);
  const n = hi - lo;
  const ty = lineY(toFloor, groundY);
  if (lo < 0) {
    if (!walkTo(r, LADDER_X)) return false;
    push(r, LEG_LADDER, toFloor, LADDER_X, ty);
    r.seconds += Math.abs(ty - r.y[r.n - 2]) / LADDER_SPEED;
    return true;
  }
  const stairX = n <= 6 ? stairColumnX(state, lo, hi) : NaN;
  const useStairs = !Number.isNaN(stairX) && (!liftOk || (n <= 2 && rnd < 0.3));
  if (useStairs) {
    const amp = SLOT_W * 0.32;
    if (!walkTo(r, stairX - amp)) return false;
    push(r, LEG_STAIRS, toFloor, stairX + (n & 1 ? amp : -amp), ty);
    const k = r.n - 1;
    r.amp[k] = amp;
    r.flights[k] = n;
    r.seconds += (n * Math.hypot(amp * 2, Math.abs(ty - r.y[k - 1]) / n)) / STAIR_SPEED;
    return true;
  }
  if (liftOk) {
    if (!walkTo(r, LANDING_X)) return false;
    push(r, LEG_LIFT, toFloor, LANDING_X, ty);
    r.seconds += LIFT_EST_S;
    return true;
  }
  if (!walkTo(r, LADDER_X)) return false;
  push(r, LEG_LADDER, toFloor, LADDER_X, ty);
  r.seconds += Math.abs(ty - r.y[r.n - 2]) / LADDER_SPEED;
  return true;
}

/**
 * Plans how to get from one stop to another into `out` (default: the shared scratch route). Null when there is no way
 * (a closed or sealed door in between, or a trip too long to be worth drawing).
 *
 *   same floor      straight along the floor, through every partition door on the way (all must be open)
 *   other floor     walk to the lift landing (or stairwell), ride or climb, walk on; the surface row (floor -1) joins floor 0 by the shaft ladder
 *
 * `liftOk` is whether the lift is running (power, the cage lift exists, at least two floors); with it off only stairs and the ladder remain.
 */
export function route(state: GameState, from: Stop, to: Stop, liftOk: boolean, rnd: number, out: Route = SCRATCH): Route | null {
  out.n = 0;
  out.seconds = 0;
  push(out, LEG_WALK, from.floor, from.x, from.y);
  if (from.floor === to.floor) {
    if (!walkTo(out, to.x)) return null;
  } else {
    const groundY = from.floor < 0 ? from.y : to.floor < 0 ? to.y : -8;
    const lift = liftOk && state.currentFloors >= 2;
    if (from.floor < 0 || to.floor < 0) {
      // Via floor 0: the ladder joins the surface row to it, then the usual climb for the rest.
      const other = from.floor < 0 ? to.floor : from.floor;
      if (from.floor < 0) {
        if (!hop(out, state, 0, lift, rnd, groundY)) return null;
        if (other > 0 && !hop(out, state, other, lift, rnd, groundY)) return null;
      } else {
        if (other > 0 && !hop(out, state, 0, lift, rnd, groundY)) return null;
        if (!hop(out, state, -1, lift, rnd, groundY)) return null;
      }
    } else if (!hop(out, state, to.floor, lift, rnd, groundY)) return null;
    if (!walkTo(out, to.x)) return null;
  }
  // The end point's own y (its line may sit a little off the standard one, e.g. a dock above the floor).
  out.y[out.n - 1] = to.y;
  return out.seconds <= MAX_TRIP_S ? out : null;
}

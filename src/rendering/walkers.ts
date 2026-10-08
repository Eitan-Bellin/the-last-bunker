import { Container } from 'pixi.js';
import type { GameState } from '../core/GameState';
import { GFX } from './gfxFeatures';
import { reducedMotion } from '../utils/a11y'; // plan4:AC-2
import { ROOM_H, SLOT_W, floorIndexAt, slotX } from './geom';
import { depthGains } from './structure'; // plan4:polish
import { getDef } from '../data/buildingDefs'; // plan4:polish
import { VIEW } from './perfFx';
import type { Person } from './people';
import type { LiftApi } from './shaft';
import {
  LADDER_SPEED, LADDER_X, LANDING_X, LEG_LADDER, LEG_LIFT, LEG_STAIRS, LEG_WALK, STAIR_SPEED, WALK_SPEED, Route, entryX, route, type Stop,
} from './routes';

/**
 * [plan4:ST-18] People walking between rooms, floors and the lift. COSMETIC (decision D4): the survivor's room, job and everything the
 * simulation reads were already decided; this only changes how they get from the old room's floor to the new one.
 *
 * How it works: when the renderer finds that a survivor's room changed (a new job, a meal, bedtime ...) it asks `intercept` first. If there is
 * a free walker slot and a route, the survivor's own figure leaves its room, walks along the route on this layer (above the rooms, below the
 * effects) and is put into the new room at its doorway by the usual placement. Otherwise the old behaviour applies: they just appear there.
 *
 * Budget: at most 12 walkers at once, no walking below zoom 0.7 or off screen (the walker is placed at its destination at once), every slot, route and
 * scratch object preallocated: a frame allocates nothing. Behind the `walkers` feature flag (gfxFeatures.ts): off = exactly the old behaviour.
 */

export const MAX_WALKERS = 12;
/** Below this zoom nobody can see a walker: no walks are started and the running ones finish at once. */
export const WALK_MIN_ZOOM = 0.7;
/** Give up waiting for the lift, or riding, after this many seconds (the walker then simply appears at its destination). */
const WAIT_LIFT_MAX = 30;
const RIDE_MAX = 40;
/** A walker this far outside the camera's view is finished at once. */
const VIEW_MARGIN = 80;

const M_WALK = 0;
const M_WAIT = 1;
const M_RIDE = 2;
const M_CLIMB = 3;
/** [plan4:polish] An evacuee waiting at the exit until the room is safe again. */
const M_HOLD = 4;
/** [plan4:polish] At most this many people leave a burning room at once, and wait at the exit at most this long (seconds). */
export const MAX_EVACUEES = 4;
const HOLD_MAX = 60;

/** What the walkers need to know about a room view (RoomView in RoomViews.ts). */
export interface WalkView {
  root: Container;
  people: Container;
  width: number;
}

interface Slot {
  person: Person | null;
  route: Route;
  /** Index of the waypoint being walked to. */
  leg: number;
  mode: number;
  px: number;
  py: number;
  /** Climb progress and length, and the start of the climb leg. */
  s: number;
  len: number;
  sx: number;
  sy: number;
  /** Timer of waiting for and riding in the lift. */
  t: number;
  ticket: number;
  destId: string;
  endLocalX: number;
  /** [plan4:polish] A fire or collapse evacuation (walks to the exit and waits there), not a move to another room. */
  evac: boolean;
}

const colors = { shirt: 0, skin: 0, pants: 0 };

/** 0..1 triangle wave of the zig-zag on a stairwell: flight k goes left to right when k is even, right to left when odd (-1..1). */
function zig(w: number): number {
  const p = w - 2 * Math.floor(w / 2);
  return p < 1 ? 2 * p - 1 : 3 - 2 * p;
}

export class Walkers {
  /** Sits above the rooms and the shaft, under the dust and effects. Walking survivors are tappable and draggable like everyone else. */
  readonly layer = new Container();
  /** Counters for tests and the perf probe: walks started, refused for lack of a route/slot (`skipped`), finished, cut short (teleported). */
  readonly stats = { started: 0, skipped: 0, finished: 0, cut: 0 };
  private slots: Slot[] = [];
  private active = 0;
  private lift: LiftApi | null = null;
  /** [plan4:polish] The power ratio (the walkers' light dims with it, like the people in the rooms). Set by the renderer once a picture. */
  power = 1;
  /** [plan4:polish] Rooms with a fire, a collapse or a meltdown on right now (ids); refreshHot fills it once a picture. */
  private hot = new Set<string>();
  private hotB = new Set<string>();
  /** How many times each room has caught trouble (a new fire = a new epoch), so people who already left for one fire do not leave again when the hold times out. */
  private epochs = new Map<string, number>();
  private evacuees = 0;
  private evacuated = new WeakMap<Person, string>();
  private from: Stop = { floor: 0, x: 0, y: 0 };
  private to: Stop = { floor: 0, x: 0, y: 0 };

  constructor() {
    this.layer.label = 'walkers';
    this.layer.isRenderGroup = true;
    this.layer.sortableChildren = true;
    for (let i = 0; i < MAX_WALKERS; i++) {
      this.slots.push({ person: null, route: new Route(), leg: 0, mode: M_WALK, px: 0, py: 0, s: 0, len: 0, sx: 0, sy: 0, t: 0, ticket: 0, destId: '', endLocalX: 0, evac: false });
    }
  }

  /** How many are walking right now. */
  get count(): number {
    return this.active;
  }

  /** The lift of the shaft just built (null for the plain old shaft, where nobody rides). Walkers waiting for the old car are let go. */
  setLift(lift: LiftApi | null): void {
    if (lift === this.lift) return;
    this.lift = lift;
    for (const s of this.slots) if (s.person && s.ticket) { s.ticket = 0; this.finish(s, true); }
  }

  private slotOf(p: Person): Slot | null {
    for (const s of this.slots) if (s.person === p) return s;
    return null;
  }

  private inView(x: number, y: number): boolean {
    return x > VIEW.x0 - VIEW_MARGIN && x < VIEW.x1 + VIEW_MARGIN && y > VIEW.y0 - VIEW_MARGIN && y < VIEW.y1 + VIEW_MARGIN;
  }

  /**
   * Called by the renderer when `person` should be in room `toId` (view `toView`) but is not yet. Returns true when the survivor is (now) walking there
   * and the renderer must leave them alone; false when the old placement applies. `fromView` is the room they stand in now (undefined for none).
   * `zoom` is the camera zoom.
   */
  intercept(person: Person, fromView: WalkView | undefined, toView: WalkView | undefined, toId: string, state: GameState, zoom: number): boolean {
    if (person.inTransit) {
      const s = this.slotOf(person);
      if (s && s.destId === toId) return true;
      if (s) this.cancel(s, true); // the plan changed on the way: the old placement takes over
      return false;
    }
    if (!GFX.walkers || reducedMotion() || this.active >= MAX_WALKERS || zoom < WALK_MIN_ZOOM) return false; // plan4:AC-2 reduced motion: people appear at their destination
    if (!fromView || !toView || fromView === toView) return false;
    const c = person.container;
    if (c.parent !== fromView.people || !c.visible || person.isLifted) return false;
    const wx = fromView.root.x + fromView.people.x + c.x;
    const wy = fromView.root.y + fromView.people.y + c.y;
    if (!this.inView(wx, wy)) return false;
    const toY = toView.root.y + toView.people.y + (ROOM_H - 8);
    const from = this.from, to = this.to;
    from.floor = floorIndexAt(wy);
    from.x = wx;
    from.y = wy;
    to.floor = floorIndexAt(toY);
    to.y = toY;
    // The doorway they come through: on the side they approach from (the shaft for another floor, where they stand for the same one).
    to.x = entryX(toView.root.x, toView.width, from.floor === to.floor ? wx : LANDING_X);
    const slot = this.free();
    if (!slot) return false;
    const lift = this.lift;
    const r = route(state, from, to, !!lift && lift.ready(), Math.random(), slot.route);
    if (!r) {
      this.stats.skipped++;
      return false;
    }
    // The ladder is for blackouts and the surface only; with power but no cage lift (the plain old shaft) cross-floor trips just appear.
    if ((state.powerRatio ?? 1) > 0.3 && from.floor >= 0 && to.floor >= 0) {
      for (let i = 1; i < r.n; i++) if (r.kind[i] === LEG_LADDER) {
        this.stats.skipped++;
        return false;
      }
    }
    slot.person = person;
    slot.destId = toId;
    slot.evac = false;
    slot.endLocalX = to.x - toView.root.x;
    slot.px = wx;
    slot.py = wy;
    slot.leg = 1;
    slot.ticket = 0;
    this.active++;
    this.stats.started++;
    person.beginTransit();
    this.layer.addChild(c);
    c.position.set(wx, wy);
    this.beginLeg(slot);
    return true;
  }

  /** [plan4:polish] Once a picture: which rooms are in trouble (a fire incident, or a collapse / meltdown disaster aimed at the room). No allocation. */
  refreshHot(state: GameState): void {
    const prev = this.hot, next = this.hotB;
    next.clear();
    for (const i of state.incidents ?? []) if (i.kind === 'fire' && i.buildingId) next.add(i.buildingId);
    for (const d of state.danger?.disasters ?? []) if ((d.kind === 'collapse' || d.kind === 'meltdown') && d.buildingId) next.add(d.buildingId);
    for (const id of next) if (!prev.has(id)) this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    this.hot = next;
    this.hotB = prev;
  }

  /** Whether a room is in trouble right now (evacuate only makes sense then). */
  isHot(roomId: string): boolean {
    return this.hot.has(roomId);
  }

  /** [plan4:polish] The light on a walker in the shaft and the corridors: the rooms' warm lamp-lit tint, dimmed with the power and the depth (people.ts / BunkerRenderer use the same numbers). */
  private ambientAt(y: number): number {
    const dg = depthGains(y - ROOM_H / 2);
    const v = 0.9 * (0.62 + 0.38 * this.power) * 0.96;
    const ch = (base: number, g: number) => Math.round(Math.min(255, base * v * g));
    return (ch(255, dg[0]) << 16) | (ch(240, dg[1]) << 8) | ch(218, dg[2]);
  }

  /** [plan4:polish] The nearest way out on the person's floor: a stairwell (built column or an evacuation room), else the shaft's ladder. */
  private exitFor(state: GameState, floor: number, wx: number): number {
    let best = LADDER_X, bestD = Math.abs(LADDER_X - wx) + 40; // (the shaft is the fallback: a stairwell has to be clearly nearer to win)
    const consider = (x: number): void => { const d = Math.abs(x - wx); if (d < bestD) { bestD = d; best = x; } };
    for (const i of state.layout?.infra ?? []) {
      if (i.kind === 'stairwell' && floor >= i.floor && floor <= i.floor + Math.max(1, i.floors ?? 1) - 1) consider(slotX(i.x) + SLOT_W / 2);
    }
    for (const b of state.buildings) {
      if (b.position.floor === floor && !b.isConstructing && getDef(b.type)?.effects?.evacuation) consider(slotX(b.position.x) + SLOT_W / 2);
    }
    return best;
  }

  /**
   * [plan4:polish] A fire or a collapse is on in the room (`hot`): `person`, standing in it, walks out to the nearest stairwell or the shaft and waits there until it
   * is over, then comes back to the doorway. Cosmetic only (nothing the simulation reads changes). True when the walk started and the renderer must leave them alone.
   */
  evacuate(person: Person, view: WalkView, roomId: string, state: GameState, zoom: number): boolean {
    if (!GFX.walkers || this.evacuees >= MAX_EVACUEES || this.active >= MAX_WALKERS || zoom < WALK_MIN_ZOOM) return false;
    if (person.inTransit || person.isLifted || this.evacuated.get(person) === `${roomId}#${this.epochs.get(roomId) ?? 0}`) return false;
    const c = person.container;
    if (c.parent !== view.people || !c.visible) return false;
    const wx = view.root.x + view.people.x + c.x;
    const wy = view.root.y + view.people.y + c.y;
    if (!this.inView(wx, wy)) return false;
    const from = this.from, to = this.to;
    from.floor = to.floor = floorIndexAt(wy);
    from.x = wx;
    from.y = to.y = wy;
    to.x = this.exitFor(state, from.floor, wx);
    const slot = this.free();
    if (!slot) return false;
    const r = route(state, from, to, false, 0, slot.route);
    if (!r || r.n < 2) return false; // already there, or a shut door in the way: they stay
    slot.person = person;
    slot.destId = roomId;
    slot.evac = true;
    slot.endLocalX = entryX(view.root.x, view.width, to.x) - view.root.x;
    slot.px = wx;
    slot.py = wy;
    slot.leg = 1;
    slot.ticket = 0;
    this.active++;
    this.evacuees++;
    this.evacuated.set(person, `${roomId}#${this.epochs.get(roomId) ?? 0}`);
    this.stats.started++;
    person.beginTransit();
    this.layer.addChild(c);
    c.position.set(wx, wy);
    this.beginLeg(slot);
    return true;
  }

  private free(): Slot | null {
    for (const s of this.slots) if (!s.person) return s;
    return null;
  }

  private beginLeg(s: Slot): void {
    const r = s.route;
    while (s.leg < r.n) {
      const k = r.kind[s.leg];
      if (k === LEG_WALK) {
        s.mode = M_WALK;
        return;
      }
      if (k === LEG_LIFT) {
        const t = this.lift ? this.lift.request(r.floor[s.leg - 1], r.floor[s.leg]) : 0;
        if (!t) {
          this.finish(s, true);
          return;
        }
        s.ticket = t;
        s.mode = M_WAIT;
        s.t = 0;
        return;
      }
      // Stairs or ladder: a climb along the leg.
      const x0 = r.x[s.leg - 1], y0 = r.y[s.leg - 1], x1 = r.x[s.leg], y1 = r.y[s.leg];
      s.mode = M_CLIMB;
      s.s = 0;
      s.sx = x0;
      s.sy = y0;
      const fl = r.flights[s.leg];
      s.len = k === LEG_STAIRS && fl > 0 ? fl * Math.hypot(r.amp[s.leg] * 2, Math.abs(y1 - y0) / fl) : Math.abs(y1 - y0) + Math.abs(x1 - x0);
      return;
    }
    if (s.evac) {
      s.mode = M_HOLD;
      s.t = 0;
      return;
    }
    this.finish(s, false);
  }

  /** Puts the survivor back for the renderer's placement: it appears at the doorway of the destination (a cut walk, `cut`, counts apart). */
  private finish(s: Slot, cut: boolean): void {
    const p = s.person;
    if (!p) return;
    if (s.ticket && this.lift) this.lift.release(s.ticket);
    s.ticket = 0;
    p.setRiding(false);
    p.endTransit(s.endLocalX, 0.5);
    if (p.container.parent === this.layer) this.layer.removeChild(p.container);
    if (s.evac) { this.evacuees--; s.evac = false; }
    s.person = null;
    this.active--;
    if (cut) this.stats.cut++;
    else this.stats.finished++;
  }

  /** Drops a walk without placing the survivor (carried by the player, destroyed, re-planned). With `keepOut` the container stays where it is. */
  private cancel(s: Slot, keepOut: boolean): void {
    const p = s.person;
    if (!p) return;
    if (s.ticket && this.lift) this.lift.release(s.ticket);
    s.ticket = 0;
    if (!p.container.destroyed) {
      p.setRiding(false);
      p.abortTransit();
      if (!keepOut && p.container.parent === this.layer) this.layer.removeChild(p.container);
    }
    if (s.evac) { this.evacuees--; s.evac = false; }
    s.person = null;
    this.active--;
    this.stats.cut++;
  }

  /** Drops every walk (a new game state is loaded, the views are rebuilt). */
  clear(): void {
    for (const s of this.slots) if (s.person) this.cancel(s, false);
  }

  /** Once a picture, before the people are placed: moves every walker. `zoom` below `WALK_MIN_ZOOM` or a walker off screen ends the walk at once. */
  update(dt: number, t: number, zoom: number): void {
    if (!this.active) return;
    const live = GFX.walkers && zoom >= WALK_MIN_ZOOM;
    for (const s of this.slots) {
      const p = s.person;
      if (!p) continue;
      if (p.container.destroyed) { this.cancel(s, true); continue; }
      if (p.isLifted) { this.cancel(s, true); continue; }
      if (!live || !this.inView(s.px, s.py)) { this.finish(s, true); continue; }
      this.step(s, p, dt, t);
    }
  }

  private step(s: Slot, p: Person, dt: number, t: number): void {
    const r = s.route;
    const lift = this.lift;
    if (s.mode !== M_RIDE) p.setAmbient(this.ambientAt(s.py)); // plan4:polish in transit they wear the light of where they are, not of the room they left
    switch (s.mode) {
      case M_WALK: {
        const tx = r.x[s.leg], ty = r.y[s.leg];
        const dx = tx - s.px, dy = ty - s.py;
        const dist = Math.hypot(dx, dy);
        const stepLen = WALK_SPEED * dt;
        let moved = stepLen;
        if (dist <= stepLen) {
          moved = dist;
          s.px = tx;
          s.py = ty;
        } else {
          s.px += (dx / dist) * stepLen;
          s.py += (dy / dist) * stepLen;
        }
        p.stepTransit(dt, t, s.px, s.py, moved, dx > 0.05 ? 1 : dx < -0.05 ? -1 : 0, true);
        if (dist <= stepLen) {
          s.leg++;
          this.beginLeg(s);
        }
        return;
      }
      case M_WAIT: {
        s.t += dt;
        p.stepTransit(dt, t, s.px, s.py, 0, 0, false);
        if (!lift || !lift.ready() || s.t > WAIT_LIFT_MAX) {
          this.finish(s, true);
        } else if (lift.canBoard(s.ticket)) {
          p.riderColors(colors);
          lift.board(s.ticket, colors.shirt, colors.skin, colors.pants);
          p.setRiding(true);
          s.mode = M_RIDE;
          s.t = 0;
        }
        return;
      }
      case M_HOLD: {
        s.t += dt;
        p.stepTransit(dt, t, s.px, s.py, 0, 0, false);
        if (!this.hot.has(s.destId) || s.t > HOLD_MAX) this.finish(s, false); // safe again (or long enough): back to the room's doorway
        return;
      }
      case M_RIDE: {
        s.t += dt;
        if (lift && lift.arrived(s.ticket)) {
          lift.release(s.ticket);
          s.ticket = 0;
          s.px = r.x[s.leg];
          s.py = r.y[s.leg];
          p.setRiding(false);
          p.stepTransit(dt, t, s.px, s.py, 0, 0, false); // (placed at once: no frame at the old floor)
          s.leg++;
          this.beginLeg(s);
        } else if (!lift || s.t > RIDE_MAX) {
          this.finish(s, true);
        }
        return;
      }
      default: {
        const stairs = r.kind[s.leg] === LEG_STAIRS;
        s.s += (stairs ? STAIR_SPEED : LADDER_SPEED) * dt;
        const u = s.len > 0 ? Math.min(1, s.s / s.len) : 1;
        const x1 = r.x[s.leg], y1 = r.y[s.leg];
        const nx = stairs ? s.sx + r.amp[s.leg] + r.amp[s.leg] * zig(u * r.flights[s.leg]) : s.sx + (x1 - s.sx) * u;
        const ny = s.sy + (y1 - s.sy) * u;
        const dx = nx - s.px;
        const moved = Math.hypot(dx, ny - s.py);
        s.px = nx;
        s.py = ny;
        p.stepTransit(dt, t, nx, ny, moved, dx > 0.02 ? 1 : dx < -0.02 ? -1 : 0, true);
        if (u >= 1) {
          s.leg++;
          this.beginLeg(s);
        }
      }
    }
  }
}

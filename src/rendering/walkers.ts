import { Container } from 'pixi.js';
import type { GameState } from '../core/GameState';
import { GFX } from './gfxFeatures';
import { reducedMotion } from '../utils/a11y'; // plan4:AC-2
import { ROOM_H, SLOT_W, floorIndexAt } from './geom';
import { slotX } from '../world/project';
import { depthGains } from './structure'; // plan4:polish
import { getDef } from '../data/buildingDefs'; // plan4:polish
import { VIEW } from './perfFx';
import type { Activity, Person } from './people';
import type { LiftApi } from './shaft';
import {
  LADDER_SPEED, LADDER_X, LANDING_X, LEG_LADDER, LEG_LIFT, LEG_STAIRS, LEG_WALK, MAX_WP, STAIR_SPEED, WALK_SPEED, Route, entryX, route, type Stop,
} from './routes';
// [world:C1-Li] City life (presentation only): loitering, the dig crew at work, carried light, rim, self-light, the ambience hints.
import { CITY } from '../world/flag';
import { LIFE, LIGHT, PEOPLE, STRATA } from '../world/tokens';
import { PEOPLE_RENDER } from '../world/tokensRender';
import { stratumOf } from '../data/strata';
import { cityLayoutProvider } from '../world/render/citySeams';
import { IdleSpots, cycleIndex, idHash, onBreakAt, outAt, roll01 } from '../world/life/idleSpots';
import {
  CARRY_HEADLAMP, CARRY_NONE, addCarried, addSelfLight, carryFor, lightAt, lightGen, moveLight, removeLight, setLifeTier, type LifeTier,
} from '../world/life/lanterns';
import { crewPlace, digSite, digSlotOfCrew, newDigSite, type DigSite } from '../world/life/digCrew';
import { lifeHints } from '../world/life/ambience';

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
/** [world:C1-Li] Standing at a hub spot (loitering) and working at the dig face: walker slots that stay out (city only). */
const M_LOITER = 5;
const M_WORK = 6;
/** [world:C1-Li] Slot kinds: an ordinary walk or evacuation, a loiterer, a digger. */
const LIFE_NONE = 0;
const LIFE_LOITER = 1;
const LIFE_DIG = 2;
/** [world:C1-Li] Extra slots in city mode for the people who stay out (loiterers at the High cap, plus up to 12 diggers). */
const LIFE_SLOTS = LIFE.idle.max.high + 12;

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
  // [world:C1-Li] city life
  /** LIFE_NONE (a walk between rooms), LIFE_LOITER or LIFE_DIG. */
  life: number;
  /** Walking back to the room after loitering or digging. */
  ret: boolean;
  /** Where the walk out ends (the spot / the place at the face), the facing and the activity there. */
  ex: number;
  ey: number;
  face: number;
  act: Activity;
  /** The idle spot held (-1), or the dig slot and the crew index. */
  spot: number;
  site: number;
  member: number;
  /** Hash of the person's id (lantern share, schedule). */
  h: number;
  /** Carried light (lantern / headlamp) and self-light ids with their light generation (-1 = none). */
  carry: number;
  lightId: number;
  lightGen: number;
  selfId: number;
  selfGen: number;
  selfT: number;
  /** Index in the slot table (spot ownership, frame staggering). */
  idx: number;
  /** A worker on a short break (their room is `destId`), not an idle person. */
  work: boolean;
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
  // [world:C1-Li] city life state (unused in classic mode)
  /** Slots that stay out (loiterers and diggers); walks between rooms are capped at MAX_WALKERS on top of them. */
  private lifeN = 0;
  private loiterN = 0;
  /** Counters for the dev probe: life walks started, jumps (placed without walking), sent back, plans refused. */
  readonly lifeStats = { loiter: 0, dig: 0, started: 0, jumped: 0, back: 0, refused: 0, spots: 0 };
  private readonly spots = new IdleSpots();
  private readonly sites: DigSite[] = [newDigSite(), newDigSite()];
  private readonly siteOk = [false, false];
  private readonly crewK = [0, 0];
  private readonly quarters = new Set<string>();
  /** Rooms with a worker out on a break right now (one at a time per room). */
  private readonly breakRooms = new Set<string>();
  private readonly retryAt = new WeakMap<Person, number>();
  private readonly tmpRoute = new Route();
  private readonly place = { x: 0, face: 1 };
  /** redirect()'s one-room view map (reused: no Map per redirect). */
  private readonly oneView = new Map<string, WalkView>();
  private nextPass = 0;
  private nextSig = 0;
  private now = 0;
  private frame = 0;
  private floorsN = 0;
  private tier: LifeTier = 'high';

  constructor() {
    this.layer.label = 'walkers';
    this.layer.isRenderGroup = true;
    this.layer.sortableChildren = true;
    const n = CITY ? MAX_WALKERS + LIFE_SLOTS : MAX_WALKERS;
    for (let i = 0; i < n; i++) {
      this.slots.push({
        person: null, route: new Route(), leg: 0, mode: M_WALK, px: 0, py: 0, s: 0, len: 0, sx: 0, sy: 0, t: 0, ticket: 0, destId: '', endLocalX: 0, evac: false,
        life: LIFE_NONE, ret: false, ex: 0, ey: 0, face: 1, act: 'idle', spot: -1, site: -1, member: -1, h: 0, carry: CARRY_NONE, lightId: -1, lightGen: 0, selfId: -1, selfGen: 0, selfT: 0, idx: i, work: false,
      });
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
    for (const s of this.slots) if (s.person && s.ticket) { s.ticket = 0; this.giveUp(s); }
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
      if (s && s.life) return this.redirect(s, person, toView, toId, state); // [world:C1-Li] a loiterer or digger the renderer wants elsewhere
      if (s) this.cancel(s, true); // the plan changed on the way: the old placement takes over
      return false;
    }
    if (!GFX.walkers || reducedMotion() || this.active - this.lifeN >= MAX_WALKERS || zoom < WALK_MIN_ZOOM) return false; // plan4:AC-2 reduced motion: people appear at their destination
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
    if (CITY) this.equip(slot, person, carryFor(idHash(person.id), stratumOf(Math.max(from.floor, to.floor)))); // [world:C1-Li] a lantern in the deep
    this.beginLeg(slot);
    return true;
  }

  /** [plan4:polish] Once a picture: which rooms are in trouble (a fire incident, or a collapse / meltdown disaster aimed at the room). No allocation. */
  refreshHot(state: GameState): void {
    this.floorsN = state.currentFloors; // [world:C1-Li] (self-light: below the dug city is dark)
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

  /**
   * [plan4:polish] The light on a walker in the shaft and the corridors: the rooms' warm lamp-lit tint, dimmed with the power and the depth (people.ts / BunkerRenderer use the same numbers).
   * [world:C1-Li] In the city the walkers stand in the lit group: the lightmap lights them, so their own tint is the neutral PEOPLE_RENDER.cityAmbient
   * (this replaces the runtime override BunkerRenderer.mountCity used to install).
   */
  private ambientAt(y: number): number {
    if (CITY) return PEOPLE_RENDER.cityAmbient;
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
      if (i.kind === 'stairwell' && floor >= i.floor && floor <= i.floor + Math.max(1, i.floors ?? 1) - 1) consider(slotX(floor, i.x) + SLOT_W / 2);
    }
    for (const b of state.buildings) {
      if (b.position.floor === floor && !b.isConstructing && getDef(b.type)?.effects?.evacuation) consider(slotX(floor, b.position.x) + SLOT_W / 2);
    }
    return best;
  }

  /**
   * [plan4:polish] A fire or a collapse is on in the room (`hot`): `person`, standing in it, walks out to the nearest stairwell or the shaft and waits there until it
   * is over, then comes back to the doorway. Cosmetic only (nothing the simulation reads changes). True when the walk started and the renderer must leave them alone.
   */
  evacuate(person: Person, view: WalkView, roomId: string, state: GameState, zoom: number): boolean {
    if (!GFX.walkers || this.evacuees >= MAX_EVACUEES || this.active - this.lifeN >= MAX_WALKERS || zoom < WALK_MIN_ZOOM) return false;
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
          this.giveUp(s);
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
    if (s.life && !s.ret) {
      this.enterHold(s); // [world:C1-Li] arrived at the spot / the face
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
    this.dropLife(s);
    p.endTransit(s.life && cut ? null : s.endLocalX, 0.5); // [world:C1-Li] a life walk cut short: the crowd's usual entry
    if (p.container.parent === this.layer) this.layer.removeChild(p.container);
    if (s.evac) { this.evacuees--; s.evac = false; }
    this.endLifeSlot(s);
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
    this.dropLife(s);
    if (!p.container.destroyed) {
      p.setRiding(false);
      p.abortTransit();
      if (!keepOut && p.container.parent === this.layer) this.layer.removeChild(p.container);
    }
    if (s.evac) { this.evacuees--; s.evac = false; }
    this.endLifeSlot(s);
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
    if (CITY) this.hints(t, zoom); // [world:C1-Li]
    if (!this.active) return;
    const live = GFX.walkers && zoom >= WALK_MIN_ZOOM;
    this.frame++;
    for (const s of this.slots) {
      const p = s.person;
      if (!p) continue;
      if (p.container.destroyed) { this.cancel(s, true); continue; }
      if (p.isLifted) { this.cancel(s, true); continue; }
      if (s.life) { this.stepLife(s, p, dt, t, zoom); continue; } // [world:C1-Li] loiterers and diggers stay out, on screen or not
      if (!live || !this.inView(s.px, s.py)) { this.finish(s, true); continue; }
      this.step(s, p, dt, t);
      if (CITY && s.person) this.lightStep(s, p, t);
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
          this.giveUp(s);
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
          this.giveUp(s);
        }
        return;
      }
      case M_LOITER: {
        // [world:C1-Li] At a hub spot: idle, now and then talking to a neighbour (barrel, bench, plaza) or looking out over the rail.
        const phase = Math.floor((t + (s.h & 255) * 0.05) / 5);
        const rail = s.spot >= 0 && this.spots.kindOf(s.spot) === 'rail';
        p.setTransitPose(phase % 3 === 1 ? (rail ? 'look' : 'talk') : null);
        p.stepTransit(dt, t, s.px, s.py, 0, s.face, false);
        return;
      }
      case M_WORK: {
        p.stepTransit(dt, t, s.px, s.py, 0, s.face, false, s.act);
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

  // ===================================================================================================================================
  // [world:C1-Li] City life. Presentation only (decision D4 holds): who is idle, who digs and where everybody works is the game's; this only
  // changes where an idle person stands for a while and that the dig crew is seen at the rock instead of in the quarters.
  // ===================================================================================================================================

  /** A lift wait or ride that cannot go on: a life walk out is placed at its end at once, anything else appears at its destination (as before). */
  private giveUp(s: Slot): void {
    if (s.life && !s.ret) this.jumpToEnd(s);
    else this.finish(s, true);
  }

  private jumpToEnd(s: Slot): void {
    if (s.ticket && this.lift) this.lift.release(s.ticket);
    s.ticket = 0;
    s.person?.setRiding(false);
    s.px = s.ex;
    s.py = s.ey;
    s.leg = s.route.n;
    this.enterHold(s);
  }

  private enterHold(s: Slot): void {
    s.mode = s.life === LIFE_DIG ? M_WORK : M_LOITER;
    s.t = this.now; // (in a hold, t is when it began)
    s.px = s.ex;
    s.py = s.ey;
    s.person?.container.position.set(s.px, s.py);
  }

  /** Lights off and the spot freed (the person keeps the slot until finish / cancel clears it). */
  private dropLife(s: Slot): void {
    removeLight(s.lightId, s.lightGen, false);
    removeLight(s.selfId, s.selfGen, true);
    s.lightId = s.selfId = -1;
    s.carry = CARRY_NONE;
    if (s.spot >= 0) this.spots.release(s.idx);
    s.spot = -1;
  }

  private endLifeSlot(s: Slot): void {
    if (s.life) {
      this.lifeN--;
      if (s.life === LIFE_LOITER) this.loiterN--;
    }
    s.life = LIFE_NONE;
    s.ret = false;
    s.work = false;
    s.site = s.member = -1;
  }

  /** Gives a walker a carried light (a lantern or a headlamp) when the tier's budget allows; the figure carries one only if it is lit. */
  private equip(s: Slot, p: Person, kind: number): void {
    s.carry = CARRY_NONE;
    if (kind === CARRY_NONE) return;
    const id = addCarried(kind as 1 | 2, s.px, s.py);
    if (id < 0) return;
    s.carry = kind;
    s.lightId = id;
    s.lightGen = lightGen();
    p.setCarry(kind);
  }

  /** The ambience hints, once a picture (no allocation). */
  private hints(t: number, zoom: number): void {
    this.now = t;
    lifeHints.ok = true;
    lifeHints.cy = (VIEW.y0 + VIEW.y1) / 2;
    lifeHints.zoom = zoom;
    lifeHints.floors = this.floorsN;
  }

  /** Per frame: the carried light follows its walker; every few frames self-light and rim are re-read from the lightmap (no allocation). */
  private lightStep(s: Slot, p: Person, t: number): void {
    const f = p.facingDir;
    if (s.lightId >= 0) {
      if (s.carry === CARRY_HEADLAMP) moveLight(s.lightId, s.lightGen, s.px + f * LIFE.lantern.head.x, s.py - p.standHeight + LIFE.lantern.head.y);
      else moveLight(s.lightId, s.lightGen, s.px + f * LIFE.lantern.hand.x, s.py + LIFE.lantern.hand.y);
    }
    if (s.selfId >= 0) moveLight(s.selfId, s.selfGen, s.px, s.py - LIFE.selfLight.dy);
    if ((this.frame + s.idx) % LIFE.rim.every !== 0) return;
    const R = LIFE.rim, S = LIFE.selfLight;
    const here = lightAt(s.px, s.py + R.sampleY);
    const dark = here < S.below;
    // Self-light where no walkway floor holds them up: below the dug city (the pit), on a stair flight between lanes, out at an edge.
    const offBand = s.mode === M_CLIMB || floorIndexAt(s.py) >= this.floorsN || (s.life === LIFE_DIG && this.sites[s.site]?.kind === 'edge');
    if (s.selfId < 0 && s.lightId < 0 && dark && offBand) {
      const id = addSelfLight(s.px, s.py - LIFE.selfLight.dy);
      if (id >= 0) { s.selfId = id; s.selfGen = lightGen(); s.selfT = t; }
    } else if (s.selfId >= 0 && (!offBand || here > S.below + S.intensity * 0.7) && t - s.selfT > S.hold) {
      removeLight(s.selfId, s.selfGen, true);
      s.selfId = -1;
    }
    if (this.tier === 'low' || this.tier === 'lite') {
      p.setRim(0, 0, 0, 0);
      return;
    }
    const lr = lightAt(s.px + R.sampleDx, s.py + R.sampleY), ll = lightAt(s.px - R.sampleDx, s.py + R.sampleY);
    const dir = lr > ll + 0.02 ? 1 : ll > lr + 0.02 ? -1 : 0;
    const fl = floorIndexAt(s.py);
    const color = s.lightId >= 0 ? (s.carry === CARRY_HEADLAMP ? LIGHT.presets.headlamp.color : LIGHT.presets.lantern.color) : STRATA[stratumOf(Math.max(0, fl))].light.key;
    const o = PEOPLE.rim.offset;
    p.setRim(color, dark ? PEOPLE.rim.darkAlpha : PEOPLE.rim.alpha, dir * o, dir === 0 ? -o : -o * 0.5);
  }

  /** One frame of a loiterer or digger: walking out / back as usual, standing at the spot, or jumping when nobody can watch. */
  private stepLife(s: Slot, p: Person, dt: number, t: number, zoom: number): void {
    const holding = s.mode === M_LOITER || s.mode === M_WORK;
    if (zoom < LIFE.idle.minZoom || !GFX.walkers) {
      // The map: a walk out ends at its spot, a walk back ends at home; whoever stands somewhere stays (and is not animated).
      if (!holding) {
        if (s.ret) this.finish(s, true);
        else { this.jumpToEnd(s); this.lifeStats.jumped++; }
      }
      return;
    }
    if (holding && !this.inView(s.px, s.py)) return; // nobody watches: no animation, no light work (the light stays where it is)
    this.step(s, p, dt, t);
    if (s.person) this.lightStep(s, p, t);
  }

  /**
   * [world:C1-Li] The life pass (BunkerRenderer.renderPeople calls it right after `update`, every picture; it decides LIFE.idle.passHz times a
   * second). City mode only. `people` and `views` are the renderer's maps (survivor id -> Person, room id -> its view), `night` its 0..1 night
   * and `tier` the render tier (caps). Starts loiter walks for idle people whose schedule says "out", sends them back when it says "in"
   * (or night falls, or they got a job), and keeps the dig crew at the face while their dig runs. Allocation-free in steady state.
   */
  life(state: GameState, people: ReadonlyMap<string, Person>, views: ReadonlyMap<string, WalkView>, zoom: number, night: number, tier: LifeTier): void {
    if (!CITY) return;
    this.tier = tier;
    setLifeTier(tier);
    const t = this.now;
    if (t < this.nextPass) return;
    this.nextPass = t + 1 / LIFE.idle.passHz;
    const on = GFX.walkers && tier !== 'lite';
    // The layout's places (rebuilt when its signature changes; checked once a second) and the dig sites.
    const prov = cityLayoutProvider();
    if (t >= this.nextSig) {
      this.nextSig = t + 1;
      const sig = prov.sig(state);
      if (sig !== this.spots.sig) {
        const layout = prov.build(state);
        for (const s of this.slots) if (s.person && s.life === LIFE_LOITER && !s.ret) this.sendBack(s, state, views);
        this.spots.build(layout);
        this.lifeStats.spots = this.spots.n;
        this.layoutRef = layout;
      }
    }
    const layout = this.layoutRef;
    for (let k = 0; k < 2; k++) {
      this.siteOk[k] = !!layout && digSite(state, layout, k, this.sites[k]);
      this.crewK[k] = 0;
    }
    this.quarters.clear();
    for (const b of state.buildings) if (b.type === 'quarters') this.quarters.add(b.id);
    this.breakRooms.clear();
    for (const s of this.slots) if (s.person && s.life === LIFE_LOITER && s.work) this.breakRooms.add(s.destId);
    const lift = !!this.lift && this.lift.ready();
    const nightOn = night > 0.65;
    const cap = on ? LIFE.idle.max[tier] : 0;
    let crowd = 0;
    this.startsLeft = LIFE.idle.startsPerPass;
    for (const sv of state.survivors) {
      if (sv.isOnMission) continue;
      const p = people.get(sv.id);
      if (!p || p.container.destroyed) continue;
      const c = p.container;
      const ds = digSlotOfCrew(sv.assignedBuildingId);
      const k = ds >= 0 ? this.crewK[ds]++ : -1;
      if (p.inTransit) {
        const s = this.slotOf(p);
        if (s && this.inView(s.px, s.py)) crowd++;
        if (!s || !s.life || s.ret) continue;
        if (s.life === LIFE_DIG) {
          if (ds !== s.site || !this.siteOk[ds] || !on) this.sendBack(s, state, views);
          else if (k !== s.member) this.retarget(s, k);
        } else {
          // Called back: at once for a reason (a job, the night, the cap, the spot gone); by the schedule only after LIFE.idle.minHold at the spot.
          const held = s.mode === M_LOITER && t - s.t >= LIFE.idle.minHold;
          const now = !on || s.spot < 0 || this.loiterN > cap || (s.work ? sv.assignedBuildingId !== s.destId : !!sv.assignedBuildingId || nightOn);
          if (now || (held && !(s.work ? onBreakAt(s.h, t) : outAt(s.h, t)))) this.sendBack(s, state, views);
        }
        continue;
      }
      const parent = c.parent;
      if (!parent || !c.visible || p.isLifted) continue;
      const root = parent.parent;
      if (root && this.inView(root.x + parent.x + c.x, root.y + parent.y + c.y)) crowd++;
      if (!on || zoom < LIFE.idle.minZoom || !p.roomId) continue;
      const view = views.get(p.roomId);
      if (!view || parent !== view.people) continue;
      if (this.startsLeft <= 0 || (this.retryAt.get(p) ?? 0) > t) continue;
      if (ds >= 0) {
        if (this.siteOk[ds]) this.startDig(p, view, ds, k, state, lift);
      } else if (!sv.assignedBuildingId && !nightOn && this.loiterN < cap && this.quarters.has(p.roomId)) {
        const h = idHash(sv.id);
        if (outAt(h, t)) this.startLoiter(p, view, h, state, lift, false);
      } else if (sv.assignedBuildingId === p.roomId && this.loiterN < cap && !this.breakRooms.has(p.roomId) && view.people.children.length >= LIFE.idle.breakMinCrew) {
        // A worker's short break: presentation only (the simulation's crew and production do not change).
        const h = idHash(sv.id);
        if (onBreakAt(h, t) && this.startLoiter(p, view, h, state, lift, true)) this.breakRooms.add(p.roomId);
      }
    }
    lifeHints.crowd = crowd;
    this.lifeStats.loiter = this.loiterN;
    this.lifeStats.dig = this.lifeN - this.loiterN;
  }

  private layoutRef: import('../world/render/layoutTypes').CityLayout | null = null;
  private startsLeft = 0;

  /** A free slot for someone who stays out (never one of the MAX_WALKERS kept for walks between rooms). */
  private freeLife(): Slot | null {
    // (the table has MAX_WALKERS + LIFE_SLOTS slots, so a free one is always left for the walks between rooms)
    return this.lifeN >= LIFE_SLOTS ? null : this.free();
  }

  /** Takes `p` out of their room into slot `s` at world (wx, wy) as a life walker heading for (ex, ey). */
  private takeOut(s: Slot, p: Person, wx: number, wy: number, life: number, roomId: string, view: WalkView): void {
    s.person = p;
    s.destId = roomId;
    s.evac = false;
    s.life = life;
    s.ret = false;
    s.endLocalX = entryX(view.root.x, view.width, s.ex) - view.root.x;
    s.px = wx;
    s.py = wy;
    s.leg = 1;
    s.ticket = 0;
    this.active++;
    this.lifeN++;
    if (life === LIFE_LOITER) this.loiterN++;
    this.lifeStats.started++;
    p.beginTransit();
    this.layer.addChild(p.container);
    p.container.position.set(wx, wy);
  }

  /** The world point of a person standing in a room view. */
  private posIn(p: Person, view: WalkView, out: Stop): void {
    const c = p.container;
    out.x = view.root.x + view.people.x + c.x;
    out.y = view.root.y + view.people.y + c.y;
    out.floor = floorIndexAt(out.y);
  }

  private startLoiter(p: Person, view: WalkView, h: number, state: GameState, lift: boolean, work: boolean): boolean {
    const from = this.from, to = this.to;
    this.posIn(p, view, from);
    if (from.floor < 0) return false;
    const cyc = work ? cycleIndex(h ^ 0x5bd1e995, this.now, LIFE.idle.breakCycle) : cycleIndex(h, this.now);
    const i = this.spots.pick(from.floor, from.x, stratumOf(from.floor), roll01(h, 1000 + cyc), work ? LIFE.idle.breakFloors : LIFE.idle.maxFloors);
    if (i < 0) return false;
    const s = this.freeLife();
    if (!s) return false;
    to.floor = this.spots.floor[i];
    to.x = this.spots.x[i];
    to.y = this.spots.y[i];
    this.startsLeft--;
    const walk = !reducedMotion() && (this.inView(from.x, from.y) || this.inView(to.x, to.y));
    if (walk && !route(state, from, to, lift, roll01(h, 2000 + cyc), s.route)) {
      this.retryAt.set(p, this.now + LIFE.idle.retry);
      this.lifeStats.refused++;
      return false;
    }
    s.work = work;
    s.ex = to.x;
    s.ey = to.y;
    s.face = this.spots.face[i];
    s.act = 'idle';
    s.spot = i;
    s.h = h;
    this.spots.taken[i] = s.idx;
    this.takeOut(s, p, from.x, from.y, LIFE_LOITER, p.roomId!, view);
    this.equip(s, p, carryFor(h, stratumOf(to.floor)));
    if (walk) this.beginLeg(s);
    else { this.jumpToEnd(s); this.lifeStats.jumped++; }
    return true;
  }

  /** Plans the way to dig site `ds`, place `k`, from `from` into `r` (to the plaza, down the ladder, along the pit). False when there is none. */
  private planDig(state: GameState, from: Stop, ds: number, k: number, lift: boolean, r: Route): boolean {
    const site = this.sites[ds];
    crewPlace(site, k, this.place);
    const to = this.to;
    to.floor = site.entryFloor;
    to.x = site.entryX;
    to.y = site.entryY;
    if (!site.ladder) {
      to.x = this.place.x; // an edge: along the floor to the place by the rubble
      return !!route(state, from, to, lift, 0.5, r);
    }
    if (from.floor === site.floor) {
      // already down in the pit: along it
      r.n = 0;
      pushLeg(r, LEG_WALK, from.floor, from.x, from.y);
      pushLeg(r, LEG_WALK, site.floor, this.place.x, site.y);
      return true;
    }
    if (!route(state, from, to, lift, 0.5, r)) return false;
    if (r.n + 2 > MAX_WP) return false;
    pushLeg(r, LEG_LADDER, site.floor, site.entryX, site.y);
    pushLeg(r, LEG_WALK, site.floor, this.place.x, site.y);
    return true;
  }

  private startDig(p: Person, view: WalkView, ds: number, k: number, state: GameState, lift: boolean): void {
    const from = this.from;
    this.posIn(p, view, from);
    if (from.floor < 0) return;
    const s = this.freeLife();
    if (!s) return;
    const site = this.sites[ds];
    crewPlace(site, k, this.place);
    const ex = this.place.x, face = this.place.face;
    this.startsLeft--;
    const walk = !reducedMotion() && (this.inView(from.x, from.y) || this.inView(ex, site.y));
    if (walk && !this.planDig(state, from, ds, k, lift, s.route)) {
      this.retryAt.set(p, this.now + LIFE.idle.retry);
      this.lifeStats.refused++;
      return;
    }
    const digs = k < LIFE.dig.atFace;
    s.ex = ex;
    s.ey = site.y;
    s.face = face;
    s.act = digs ? 'dig' : 'carry';
    s.site = ds;
    s.member = k;
    s.spot = -1;
    s.h = idHash(p.id);
    this.takeOut(s, p, from.x, from.y, LIFE_DIG, p.roomId!, view);
    p.dress('ruin'); // hard hat and pick (the renderer dresses them again when they are back in a room)
    if (digs && LIFE.dig.headlamp) this.equip(s, p, CARRY_HEADLAMP);
    if (walk) this.beginLeg(s);
    else { this.jumpToEnd(s); this.lifeStats.jumped++; }
  }

  /** A digger's place changed (someone joined or left the crew): a short walk along the pit to the new one. */
  private retarget(s: Slot, k: number): void {
    const site = this.sites[s.site];
    crewPlace(site, k, this.place);
    s.member = k;
    s.ex = this.place.x;
    s.ey = site.y;
    s.face = this.place.face;
    s.act = k < LIFE.dig.atFace ? 'dig' : 'carry';
    if (s.mode !== M_WORK) return; // still on the way: the new end is used when they get there
    const r = s.route;
    r.n = 0;
    pushLeg(r, LEG_WALK, floorIndexAt(s.py), s.px, s.py);
    pushLeg(r, LEG_WALK, floorIndexAt(s.py), s.ex, s.ey);
    s.leg = 1;
    s.mode = M_WALK;
  }

  /** Back to the room the renderer wants them in (`destId`): a walk when anyone can see it, else placed there at once. */
  private sendBack(s: Slot, state: GameState, views: ReadonlyMap<string, WalkView>): void {
    const p = s.person;
    const view = views.get(s.destId);
    if (!p || !view) { this.finish(s, true); return; }
    this.lifeStats.back++;
    if (s.ticket && this.lift) this.lift.release(s.ticket);
    s.ticket = 0;
    p.setRiding(false);
    if (s.spot >= 0) { this.spots.release(s.idx); s.spot = -1; }
    const from = this.from, to = this.to;
    from.floor = floorIndexAt(s.py);
    from.x = s.px;
    from.y = s.py;
    to.y = view.root.y + view.people.y + (ROOM_H - 8);
    to.floor = floorIndexAt(to.y);
    to.x = entryX(view.root.x, view.width, from.floor === to.floor ? s.px : LANDING_X);
    s.endLocalX = to.x - view.root.x;
    s.ret = true;
    if (reducedMotion() || (!this.inView(s.px, s.py) && !this.inView(to.x, to.y))) { this.finish(s, true); return; }
    const lift = !!this.lift && this.lift.ready();
    const r = s.route;
    // Out of the pit first: along it to the ladder and up to the plaza.
    const site = s.life === LIFE_DIG ? this.sites[s.site] : null;
    if (site && site.ladder && from.floor === site.floor) {
      r.n = 0;
      pushLeg(r, LEG_WALK, from.floor, from.x, from.y);
      pushLeg(r, LEG_WALK, site.floor, site.entryX, site.y);
      pushLeg(r, LEG_LADDER, site.entryFloor, site.entryX, site.entryY);
      from.floor = site.entryFloor;
      from.x = site.entryX;
      from.y = site.entryY;
      const tail = route(state, from, to, lift, 0.5, this.tmpRoute);
      if (!tail || r.n + tail.n - 1 > MAX_WP) { this.finish(s, true); return; }
      for (let i = 1; i < tail.n; i++) {
        pushLeg(r, tail.kind[i], tail.floor[i], tail.x[i], tail.y[i]);
        r.amp[r.n - 1] = tail.amp[i];
        r.flights[r.n - 1] = tail.flights[i];
      }
    } else if (!route(state, from, to, lift, 0.5, r)) { this.finish(s, true); return; }
    s.leg = 1;
    this.beginLeg(s);
  }

  /**
   * The renderer wants a loiterer or digger in another room than the one they left (`toId`). Still idle (or still on the dig) and only a
   * different quarters: nothing changes, they just come back there later. Otherwise (a job, a meal): they walk there from where they are.
   */
  private redirect(s: Slot, p: Person, toView: WalkView | undefined, toId: string, state: GameState): boolean {
    let assigned: string | null = null;
    for (const sv of state.survivors) if (sv.id === p.id) { assigned = sv.assignedBuildingId ?? null; break; }
    const staysDig = s.life === LIFE_DIG && digSlotOfCrew(assigned) === s.site;
    const staysIdle = s.life === LIFE_LOITER && !s.work && !assigned && this.quarters.has(toId);
    if ((staysDig || staysIdle) && !s.ret) {
      s.destId = toId;
      return true;
    }
    if (!toView) { this.cancel(s, true); return false; }
    s.destId = toId;
    if (s.mode === M_WAIT || s.mode === M_RIDE || s.mode === M_CLIMB) {
      // (mid-lift or mid-flight: finish that leg first; the new room is used when they are back on a floor)
      if (s.ret) return true;
    }
    // Now an ordinary walk between rooms: it counts against MAX_WALKERS like any other, so with the walks full the old placement applies.
    if (this.active - this.lifeN >= MAX_WALKERS) { this.cancel(s, true); return false; }
    this.dropLife(s);
    this.endLifeSlot(s);
    const views = this.oneView;
    views.clear();
    views.set(toId, toView);
    this.sendBack(s, state, views);
    views.clear();
    return !!s.person;
  }
}

/** Appends a waypoint to a route (routes.ts keeps its own push private). */
function pushLeg(r: Route, kind: number, floor: number, x: number, y: number): void {
  const i = r.n++;
  r.kind[i] = kind;
  r.floor[i] = floor;
  r.x[i] = x;
  r.y[i] = y;
  r.amp[i] = 0;
  r.flights[i] = 0;
}

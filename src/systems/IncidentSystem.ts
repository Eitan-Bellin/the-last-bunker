import type { BuildingInstance, Disaster, DisasterKind, GameState, Incident, IncidentKind, ResourceType, Ruin, SurvivorState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { SeededRandom } from '../core/Random';
import type { ResourceSystem } from './ResourceSystem';
import { bus } from '../core/EventBus';
import { roomSlots, touching } from '../data/buildingDefs'; // [plan4:ST-2] touching: one definition of "next to each other"
import { INCIDENTS, INCIDENT_KINDS, DISASTERS, disasterCost, quickFixCost, breachGuardMult } from '../data/incidents';
import { specOf } from '../data/specializations';
import { isHall, isDistrict, roomSlots as slotsOf, effectiveLevel } from '../data/buildingDefs';
import { RUIN_KINDS } from '../data/ruins';
import { evacuationMult, fireCodeMult, hygieneMult, isFirebreak, quarantineCapacity } from '../data/roomEffects'; // [plan4:BL-8, ST-15]
import { DOOR_FIRE_CHANCE, VENT_EPIDEMIC_MULT, breachSpeed, epidemicWeights, shutDoorBetween, ventStackCount } from './InfraSystem'; // plan4:ST-14/15
import { shutDoorCount } from './doors'; // plan4:ST-14
import { wearOf, wearRisk } from './MaintenanceSystem';
import { DAY_MS, disastersPaused, isQuiet, type DeathSystem } from './DeathSystem';
import type { BuildingSystem } from './BuildingSystem';

/** Minutes of quiet between crises, and how long an unattended one takes to peak. */
const MIN_GAP = 420;
const MAX_GAP = 900;
const FIRST_AFTER = 900;
const PEAK_SECONDS = 150;
const TAP_PROGRESS = 0.075;
const CREW_BASE = 0.004;
const CREW_PER_STAT = 0.0012;
const MORALE_WIN = 5;
/** An unattended crisis at full strength eventually runs its course (with its damage done). */
const BURNOUT_SECONDS = 150;

/** [Danger C2] Seconds (play time) between disasters for a player who is online ~2 h a day: about 2-3 days. */
const DISASTER_GAP_MIN = 14_400;
const DISASTER_GAP_MAX = 21_600;
/** Epidemic: the crowd it needs (the plan says 60; a little lower so mid-size bunkers feel it too). */
const EPIDEMIC_POP = 45;
const HURT = 35;

/** How hard a strike lands: online it is the full thing; away it is the soft version (nobody dies, nothing is destroyed). */
export type StrikeMode = 'online' | 'soft';

export interface StrikeResult {
  kind: DisasterKind;
  room: string | null;
  hurt: number;
  died: string[];
  destroyed: boolean;
  /** The away version (not announced with a popup; the welcome-back screen tells it). */
  soft: boolean;
}

export interface IncidentResolved {
  incident: Incident;
  quick: boolean;
}

/**
 * Sprint 6 in-room crises: fire, flood, blackout, roaches and raider breaches.
 * They only break out while the player is watching (never offline) and the crew fights them by itself;
 * every tap on the alarm adds a helping hand.
 */
export class IncidentSystem {
  private nextId = 1;

  private sm: StateManager;
  private rng: SeededRandom;
  private resources: ResourceSystem;
  private death: DeathSystem | null = null;
  private buildingsSys: BuildingSystem | null = null;

  setDeath(death: DeathSystem): void { this.death = death; }
  setBuildings(b: BuildingSystem): void { this.buildingsSys = b; }

  constructor(sm: StateManager, rng: SeededRandom, resources: ResourceSystem) {
    this.sm = sm;
    this.rng = rng;
    this.resources = resources;
  }

  sync(state: GameState): void {
    this.nextId = (state.incidents ?? []).reduce((m, i) => Math.max(m, parseInt(i.id.slice(2), 10) + 1), 1);
  }

  update(dt: number): void {
    const state = this.sm.state;
    const now = state.stats.totalPlayTime;
    if ((state.incidents?.length ?? 0) > 0) this.advance(dt);
    if (now >= (state.nextIncidentAt ?? FIRST_AFTER) && !state.activeEvent) this.maybeSpawn();
    this.updateDisasters();
  }

  /** Rooms an incident of this kind could hit right now, with weights. */
  private candidates(state: GameState, kind: IncidentKind): { b: BuildingInstance; w: number }[] {
    const def = INCIDENTS[kind];
    const out: { b: BuildingInstance; w: number }[] = [];
    if (kind === 'breach' && (state.stats.totalPlayTime < 2400 || state.buildings.length < 6)) return out;
    for (const b of state.buildings) {
      if (b.isConstructing) continue;
      if (state.incidents.some(i => i.buildingId === b.id)) continue;
      if (def.topFloor && b.position.floor !== 0) continue;
      const base = def.rooms[b.type];
      if (!base) continue;
      const hygiene = kind === 'roaches' ? hygieneMult(state) : 1; // [plan4:BL-8] bathhouses keep the roaches away
      const gate = kind === 'breach' ? breachGuardMult(state) : 1; // [plan4:BL-19] a gate post halves the odds of a breach
      out.push({ b, w: base * (specOf(b)?.risk ?? 1) * wearRisk(b) * hygiene * gate }); // [Danger C3] worn rooms break more often
    }
    return out;
  }

  private maybeSpawn(): void {
    const state = this.sm.state;
    const finished = state.buildings.filter(b => !b.isConstructing).length;
    const limit = finished >= 12 ? 2 : 1;
    // [Danger C5] The breather after a death: nothing new breaks for a few hours.
    if (isQuiet(state)) {
      this.schedule(900);
      return;
    }
    if (finished < 3 || !state.storyFlags.includes('intro:done') || state.incidents.length >= limit) {
      this.schedule(120);
      return;
    }
    const pool: { kind: IncidentKind; b: BuildingInstance; w: number }[] = [];
    for (const kind of INCIDENT_KINDS) for (const c of this.candidates(state, kind)) pool.push({ kind, ...c });
    if (pool.length === 0) {
      this.schedule();
      return;
    }
    const total = pool.reduce((s, p) => s + p.w, 0);
    let roll = this.rng.next() * total;
    let pick = pool[0];
    for (const p of pool) {
      roll -= p.w;
      if (roll <= 0) { pick = p; break; }
    }
    this.start(pick.kind, pick.b.id);
    this.schedule();
  }

  private schedule(fixed?: number): void {
    const now = this.sm.state.stats.totalPlayTime;
    this.sm.applyDelta({ path: 'nextIncidentAt', value: now + (fixed ?? this.rng.nextInt(MIN_GAP, MAX_GAP)) });
  }

  /** Raiders who won at the door stay inside: a breach in a top-floor room, already well under way (S7). */
  startBreach(): Incident | null {
    const state = this.sm.state;
    const def = INCIDENTS.breach;
    const free = state.buildings.filter(b => !b.isConstructing && b.position.floor === 0 && !state.incidents.some(i => i.buildingId === b.id));
    const preferred = free.filter(b => def.rooms[b.type]);
    const pool = preferred.length ? preferred : free;
    if (pool.length === 0) return null;
    return this.start('breach', this.rng.pick(pool).id, 0.3);
  }

  start(kind: IncidentKind, buildingId: string, severity = 0): Incident {
    const inc: Incident = {
      id: `i_${this.nextId++}`, kind, buildingId, severity, progress: 0, startedAt: this.sm.state.stats.totalPlayTime,
    };
    this.sm.applyDelta({ path: 'incidents', value: [...this.sm.state.incidents, inc] });
    bus.emit('incident:start', inc);
    return inc;
  }

  /** Everyone who works in the room, plus idle adults who run to help. */
  crewFor(state: GameState, inc: Incident): SurvivorState[] {
    const ids = new Set(state.buildings.find(b => b.id === inc.buildingId)?.assignedSurvivorIds ?? []);
    return state.survivors.filter(s => !s.isOnMission && !s.child && (ids.has(s.id) || !s.assignedBuildingId));
  }

  crewRate(state: GameState, inc: Incident): number {
    const stat = INCIDENTS[inc.kind].stat;
    const ids = new Set(state.buildings.find(b => b.id === inc.buildingId)?.assignedSurvivorIds ?? []);
    let rate = 0;
    for (const s of this.crewFor(state, inc)) rate += (CREW_BASE + s.stats[stat] * CREW_PER_STAT) * (ids.has(s.id) ? 1 : 0.5);
    return rate;
  }

  private advance(dt: number): void {
    const state = this.sm.state;
    const done: Incident[] = [];
    const burnt: Incident[] = [];
    const spread: { kind: IncidentKind; id: string }[] = [];
    const harmed = new Map<string, number>();
    const drain: Partial<Record<ResourceType, number>> = {};
    const next = state.incidents.map(inc => {
      const def = INCIDENTS[inc.kind];
      const b = state.buildings.find(x => x.id === inc.buildingId);
      if (!b) {
        done.push(inc);
        return inc;
      }
      const progress = Math.min(1, inc.progress + this.crewRate(state, inc) * dt);
      // [plan4:ST-14] Raiders inside lose time at every shut door between the shaft and the room (1 with no doors).
      let severity = Math.min(1, inc.severity + (inc.kind === 'breach' ? dt * breachSpeed(state, b, PEAK_SECONDS) : dt) / PEAK_SECONDS);
      const peak = severity >= 1 ? (inc.peak ?? 0) + dt : 0;
      let spreadDone = !!inc.spread;
      for (const [r, v] of Object.entries(def.drain ?? {}) as [ResourceType, number][]) drain[r] = (drain[r] ?? 0) - v * severity * dt;
      if (def.harm) {
        const exit = inc.kind === 'fire' ? evacuationMult(state, b.position.floor) * fireCodeMult(state, b.position.floor) : 1; // [plan4:BL-8, ST-15] a stairwell near by saves skin; a deep floor without one costs it
        for (const id of b.assignedSurvivorIds) harmed.set(id, (harmed.get(id) ?? 0) + def.harm * severity * dt * exit);
      }
      // A fire at its peak jumps to the next room along the floor.
      if (inc.kind === 'fire' && severity >= 1 && !spreadDone && state.incidents.length + spread.length < 3 && !isFirebreak(b)) {
        // [plan4:ST-2/ST-14] Next-door rooms by touching(); a shut bulkhead between them lets the fire through only 10% of the time (the pipes).
        const near = state.buildings.find(o => o !== b && !o.isConstructing && touching(o, b)
          && !isFirebreak(o) && !state.incidents.some(i => i.buildingId === o.id)
          && (!shutDoorBetween(state, b, o) || this.rng.chance(DOOR_FIRE_CHANCE)));
        if (near) spread.push({ kind: 'fire', id: near.id });
        spreadDone = true;
      }
      const updated = { ...inc, progress, severity, peak, spread: spreadDone };
      if (progress >= 1) done.push(updated);
      else if (peak >= BURNOUT_SECONDS) burnt.push(updated);
      return updated;
    });
    const doneIds = new Set([...done, ...burnt].map(d => d.id));
    this.sm.applyDelta({ path: 'incidents', value: next.filter(i => !doneIds.has(i.id)) });
    if (Object.keys(drain).length) this.resources.gain(this.sm, drain);
    if (harmed.size) {
      this.sm.applyDelta({
        path: 'survivors',
        value: this.sm.state.survivors.map(s => (harmed.has(s.id) ? { ...s, health: Math.max(1, s.health - harmed.get(s.id)!) } : s)),
      });
    }
    for (const s of spread) {
      this.start(s.kind, s.id, 0.3);
      bus.emit('incident:spread', s.id);
    }
    for (const inc of done) {
      if (state.buildings.some(b => b.id === inc.buildingId)) this.finish(inc, false);
    }
    for (const inc of burnt) bus.emit('incident:burnout', inc);
  }

  /** A helping hand from the player: each tap pushes the fight forward. */
  tap(incidentId: string): number {
    const state = this.sm.state;
    const inc = state.incidents.find(i => i.id === incidentId);
    if (!inc) return 0;
    const progress = Math.min(1, inc.progress + TAP_PROGRESS);
    if (progress >= 1) {
      this.sm.applyDelta({ path: 'incidents', value: state.incidents.filter(i => i.id !== incidentId) });
      this.finish({ ...inc, progress }, false);
      return 1;
    }
    this.sm.applyDelta({ path: 'incidents', value: state.incidents.map(i => (i.id === incidentId ? { ...i, progress } : i)) });
    return progress;
  }

  canQuickFix(incidentId: string): boolean {
    const inc = this.sm.state.incidents.find(i => i.id === incidentId);
    return !!inc && this.resources.canAfford(this.sm.state, quickFixCost(this.sm.state, inc.kind));
  }

  quickFix(incidentId: string): boolean {
    const state = this.sm.state;
    const inc = state.incidents.find(i => i.id === incidentId);
    if (!inc || !this.resources.spend(this.sm, quickFixCost(state, inc.kind))) return false;
    this.sm.applyDelta({ path: 'incidents', value: this.sm.state.incidents.filter(i => i.id !== incidentId) });
    this.finish(inc, true);
    return true;
  }

  private finish(inc: Incident, quick: boolean): void {
    const state = this.sm.state;
    const crew = new Set(this.crewFor(state, inc).map(s => s.id));
    this.sm.applyDelta({ path: 'survivors', value: state.survivors.map(s => (crew.has(s.id) ? { ...s, xp: s.xp + 25 } : s)) });
    this.sm.applyDelta({ path: 'stats.totalCrisesSurvived', value: state.stats.totalCrisesSurvived + 1 });
    const now = state.stats.totalPlayTime;
    this.sm.applyDelta({ path: 'moraleBuffs', value: [...this.sm.state.moraleBuffs, { value: MORALE_WIN, expiresAt: now + 240 }] });
    bus.emit('incident:resolved', { incident: inc, quick } satisfies IncidentResolved);
  }

  // ---- [Danger C2] disasters: a warning, a countdown, a "handle it" action, and a real price if ignored ----

  private setDanger(patch: Partial<GameState['danger']>): void {
    this.sm.applyDelta({ path: 'danger', value: { ...this.sm.state.danger, ...patch } });
  }

  private updateDisasters(): void {
    const state = this.sm.state;
    const now = state.stats.totalPlayTime;
    for (const dz of state.danger.disasters) if (now >= dz.deadline) this.strike(dz, 'online', true);
    const d = this.sm.state.danger;
    if ((state.era ?? 0) < 2) return;
    if (d.nextDisasterAt === 0) {
      this.scheduleDisaster();
      return;
    }
    if (now < d.nextDisasterAt || d.disasters.length > 0) return;
    // The breathers: after a death, and for a day after more than 3 deaths in a day.
    if (isQuiet(state) || disastersPaused(state)) {
      this.setDanger({ nextDisasterAt: now + 900 });
      return;
    }
    this.spawnDisaster();
    this.scheduleDisaster();
  }

  private scheduleDisaster(): void {
    const now = this.sm.state.stats.totalPlayTime;
    this.setDanger({ nextDisasterAt: now + this.rng.nextInt(DISASTER_GAP_MIN, DISASTER_GAP_MAX) });
  }

  /** The disasters that could strike right now, with weights: one entry per room (or one for the whole bunker). */
  disasterPool(state: GameState): { kind: DisasterKind; buildingId: string | null; w: number }[] {
    const out: { kind: DisasterKind; buildingId: string | null; w: number }[] = [];
    const busy = new Set([...state.incidents.map(i => i.buildingId), ...state.danger.disasters.map(x => x.buildingId)]);
    for (const b of state.buildings) {
      if (b.isConstructing || busy.has(b.id)) continue;
      const wear = wearOf(b);
      const plain = !isHall(b.type) && !isDistrict(b.type) && b.type !== 'elevator' && b.type !== 'quarters';
      if (b.position.floor >= 5 && plain) out.push({ kind: 'collapse', buildingId: b.id, w: 1 + wear / 20 });
      if (b.type === 'waterPump' || b.type === 'waterPurifier') out.push({ kind: 'deepFlood', buildingId: b.id, w: 1 + wear / 20 });
      if (b.type === 'reactor' && effectiveLevel(b) >= 4 && wear >= 40) out.push({ kind: 'meltdown', buildingId: b.id, w: 3 });
      if (b.type === 'geothermal' && effectiveLevel(b) >= 3 && wear >= 40) out.push({ kind: 'steam', buildingId: b.id, w: 3 }); // plan4:BL-24 a worn vent bursts like a reactor melts
    }
    const pop = state.survivors.length;
    if (pop >= EPIDEMIC_POP && state.buildings.some(b => b.type === 'medbay' && !b.isConstructing)) {
      out.push({ kind: 'epidemic', buildingId: null, w: (1 + (pop - EPIDEMIC_POP) / 40) * hygieneMult(state) * Math.pow(VENT_EPIDEMIC_MULT, ventStackCount(state)) }); // plan4:ST-15 each vent stack x0.9 // [plan4:BL-8] hygiene thins the odds
    }
    return out;
  }

  /** Starts a disaster countdown (a weighted pick unless one is forced). */
  spawnDisaster(force?: DisasterKind): Disaster | null {
    const state = this.sm.state;
    let pool = this.disasterPool(state);
    if (force) pool = pool.filter(p => p.kind === force);
    if (pool.length === 0) return null;
    // Pick the kind first (so a bunker full of deep rooms doesn't drown the others), then a room.
    const kinds = [...new Set(pool.map(p => p.kind))];
    const kindW = (k: DisasterKind) => Math.max(...pool.filter(p => p.kind === k).map(p => p.w));
    let roll = this.rng.next() * kinds.reduce((s, k) => s + kindW(k), 0);
    let kind = kinds[0];
    for (const k of kinds) {
      roll -= kindW(k);
      if (roll <= 0) { kind = k; break; }
    }
    const rooms = pool.filter(p => p.kind === kind);
    let r2 = this.rng.next() * rooms.reduce((s, p) => s + p.w, 0);
    let pick = rooms[0];
    for (const p of rooms) {
      r2 -= p.w;
      if (r2 <= 0) { pick = p; break; }
    }
    const now = state.stats.totalPlayTime;
    const dz: Disaster = {
      id: `d_${state.danger.nextId}`, kind, buildingId: pick.buildingId, startedAt: now, deadline: now + DISASTERS[kind].countdown,
    };
    this.setDanger({ disasters: [...state.danger.disasters, dz], nextId: state.danger.nextId + 1 });
    bus.emit('disaster:start', dz);
    return dz;
  }

  // [ux-wp3 E3/R8] spawnOnLeave (a 30% disaster each time the app went to the background, only with notifications on) was removed:
  // it punished leaving, and only the players who allowed notifications. Away danger lives in AwayDanger, the same for everyone.

  /** Adults who could lend a hand right now. */
  freeCrew(state: GameState): SurvivorState[] {
    return state.survivors.filter(s => !s.isOnMission && !s.child && s.health > 20);
  }

  /** Why a disaster can't be handled yet: null = it can. */
  handleBlock(dzId: string): 'cost' | 'crew' | 'gone' | null {
    const state = this.sm.state;
    const dz = state.danger.disasters.find(x => x.id === dzId);
    if (!dz) return 'gone';
    if (!this.resources.canAfford(state, disasterCost(state, dz.kind))) return 'cost';
    if (this.freeCrew(state).length < DISASTERS[dz.kind].crew) return 'crew';
    return null;
  }

  /** The player's answer: pay the price, send the crew, and the disaster never happens. */
  handle(dzId: string): boolean {
    const state = this.sm.state;
    const dz = state.danger.disasters.find(x => x.id === dzId);
    if (!dz || this.handleBlock(dzId)) return false;
    if (!this.resources.spend(this.sm, disasterCost(state, dz.kind))) return false;
    const crew = new Set(this.freeCrew(this.sm.state)
      .sort((a, b) => (b.stats.intelligence + b.stats.strength) - (a.stats.intelligence + a.stats.strength))
      .slice(0, DISASTERS[dz.kind].crew).map(s => s.id));
    this.sm.applyDelta({ path: 'survivors', value: this.sm.state.survivors.map(s => (crew.has(s.id) ? { ...s, xp: s.xp + 40 } : s)) });
    this.setDanger({ disasters: this.sm.state.danger.disasters.filter(x => x.id !== dzId), ignoredSince: null });
    this.sm.applyDelta({ path: 'stats.totalCrisesSurvived', value: this.sm.state.stats.totalCrisesSurvived + 1 });
    const now = this.sm.state.stats.totalPlayTime;
    this.sm.applyDelta({ path: 'moraleBuffs', value: [...this.sm.state.moraleBuffs, { value: MORALE_WIN, expiresAt: now + 240 }] });
    bus.emit('disaster:handled', dz);
    return true;
  }

  private hurt(ids: string[], dmg: number, floor: number): number {
    if (ids.length === 0) return 0;
    const set = new Set(ids);
    this.sm.applyDelta({
      path: 'survivors',
      value: this.sm.state.survivors.map(s => (set.has(s.id) ? { ...s, health: Math.max(Math.min(s.health, floor), s.health - dmg) } : s)),
    });
    return ids.length;
  }

  /** A wrecked room: the building is gone and a ruin takes its place until the crew restores it. */
  private destroyRoom(b: BuildingInstance): void {
    const w = slotsOf(b.type);
    const d = this.sm.state.danger;
    const ruin: Ruin = {
      id: `r_d${d.nextId}`, floor: b.position.floor, x: b.position.x, w, kind: 'wreck', restoresTo: b.type, flooded: false,
      progress: 0, total: Math.round(RUIN_KINDS.wreck.workPerSlot * w), started: false, lore: null,
    };
    this.setDanger({ nextId: d.nextId + 1 });
    const crew = new Set(b.assignedSurvivorIds);
    this.sm.applyDelta({ path: 'buildings', value: this.sm.state.buildings.filter(x => x.id !== b.id) });
    this.sm.applyDelta({ path: 'survivors', value: this.sm.state.survivors.map(s => (crew.has(s.id) ? { ...s, assignedBuildingId: null } : s)) });
    this.sm.applyDelta({ path: 'ruins', value: [...this.sm.state.ruins, ruin] });
    this.buildingsSys?.recalculateMaxPopulation(this.sm);
    this.prune();
    bus.emit('building:demolished', b.id);
  }

  /**
   * [plan4:ST-14] Who falls sick in an epidemic. With no shut door: the old pick (a shuffle, the first 30%). With shut doors the epidemic starts
   * in one person's part of the bunker; people behind a shut door from it catch it at a quarter of the odds, so fewer fall sick in all.
   */
  private pickSick(state: GameState, adults: SurvivorState[], soft: boolean): SurvivorState[] {
    const n = Math.ceil(adults.length * (soft ? 0.2 : 0.3));
    if (shutDoorCount(state) === 0 || adults.length === 0) return this.rng.shuffle(adults).slice(0, n);
    const weights = epidemicWeights(state, adults, this.rng.pick(adults).id);
    if (!weights) return this.rng.shuffle(adults).slice(0, n);
    const pool = [...adults];
    const total = pool.reduce((t, a) => t + (weights.get(a.id) ?? 1), 0);
    const count = Math.min(pool.length, Math.ceil(n * total / pool.length));
    const out: SurvivorState[] = [];
    while (out.length < count && pool.length) {
      let roll = this.rng.next() * pool.reduce((t, a) => t + (weights.get(a.id) ?? 1), 0);
      let at = 0;
      for (let i = 0; i < pool.length; i++) { roll -= weights.get(pool[i].id) ?? 1; if (roll <= 0) { at = i; break; } }
      out.push(pool.splice(at, 1)[0]);
    }
    return out;
  }

  /**
   * The disaster happens. Online it is the full thing (a room wrecked, a flood, a plague, a shutdown reactor);
   * away it is the soft version: people are hurt (never below 15 health), nothing is destroyed.
   * Deaths happen only when allowed (and never inside the breather after a death).
   */
  strike(dz: Disaster, mode: StrikeMode, allowDeath: boolean): StrikeResult {
    const soft = mode === 'soft';
    this.setDanger({ disasters: this.sm.state.danger.disasters.filter(x => x.id !== dz.id) });
    const state = this.sm.state;
    const b = dz.buildingId ? state.buildings.find(x => x.id === dz.buildingId) : undefined;
    const floor = soft ? 15 : 5;
    const res: StrikeResult = { kind: dz.kind, room: dz.buildingId, hurt: 0, died: [], destroyed: false, soft };
    const canKill = allowDeath && !isQuiet(state) && !!this.death;
    const kill = (id: string) => {
      const name = this.sm.state.survivors.find(s => s.id === id)?.name;
      if (name && this.death?.kill(id, `disaster:${dz.kind}`)) res.died.push(name);
    };
    const now = Date.now();
    switch (dz.kind) {
      case 'collapse':
        if (!b) break;
        res.hurt = this.hurt(b.assignedSurvivorIds, (soft ? 20 : HURT) * evacuationMult(state, b.position.floor) * fireCodeMult(state, b.position.floor), floor); // [plan4:BL-8, ST-15]
        // The room is wrecked: shut (half a day online, a quarter away) and fully worn until the crew maintains it back to life.
        this.sm.applyDelta({ path: 'buildings', value: this.sm.state.buildings.map(x => (x.id === b.id ? { ...x, wear: 100 } : x)) });
        this.setDanger({ disabled: { ...this.sm.state.danger.disabled, [b.id]: now + (soft ? DAY_MS / 4 : DAY_MS / 2) } });
        res.destroyed = !soft;
        break;
      case 'deepFlood': {
        // The finished water purifier project protects the stores: the flood is softened (half the loss, no flood in the room).
        const shielded = state.storyFlags.includes('project:purifier');
        const k = (soft ? 0.25 : 0.5) * (shielded ? 0.5 : 1);
        this.resources.gain(this.sm, {
          water: -Math.floor(state.resources.water.amount * k), materials: -Math.floor(state.resources.materials.amount * k * 0.4),
        });
        if (b && !soft && !shielded && !state.incidents.some(i => i.buildingId === b.id)) this.start('flood', b.id, 0.3);
        if (b) res.hurt = this.hurt(b.assignedSurvivorIds, 10, floor);
        break;
      }
      case 'epidemic': {
        const adults = state.survivors.filter(s => !s.child);
        const sick = this.pickSick(state, adults, soft); // [plan4:ST-14] shut doors shield the rooms behind them
        const sickDmg = soft ? 25 : 40;
        const ward = quarantineCapacity(state); // [plan4:BL-8] the sick held in a ward take half the harm
        if (ward > 0) res.hurt = this.hurt(sick.slice(ward).map(s => s.id), sickDmg, floor) + this.hurt(sick.slice(0, ward).map(s => s.id), sickDmg / 2, floor);
        else res.hurt = this.hurt(sick.map(s => s.id), sickDmg, floor);
        // Without the medicine to treat them, the sickest don't make it.
        if (canKill && state.resources.medicine.amount < (disasterCost(state, 'epidemic').medicine ?? 0) && sick.length) {
          const sickest = [...this.sm.state.survivors].filter(s => sick.some(x => x.id === s.id)).sort((a, c) => a.health - c.health)[0];
          if (sickest) kill(sickest.id);
        }
        break;
      }
      case 'meltdown':
      case 'steam': { // plan4:BL-24 the vent shuts and burns its crew like a melted reactor does
        if (!b) break;
        res.hurt = this.hurt(b.assignedSurvivorIds, soft ? 25 : 45, floor);
        this.setDanger({ disabled: { ...this.sm.state.danger.disabled, [b.id]: now + (soft ? DAY_MS / 4 : DAY_MS) } });
        if (canKill && b.assignedSurvivorIds.length && this.rng.chance(0.3)) kill(this.rng.pick(b.assignedSurvivorIds));
        break;
      }
    }
    if (!soft) bus.emit('disaster:struck', res);
    return res;
  }

  /** Incidents in rooms that no longer exist are dropped (demolition, rebirth). */
  prune(): void {
    const state = this.sm.state;
    const ids = new Set(state.buildings.map(b => b.id));
    if (state.incidents.some(i => !ids.has(i.buildingId))) {
      this.sm.applyDelta({ path: 'incidents', value: state.incidents.filter(i => ids.has(i.buildingId)) });
    }
  }
}

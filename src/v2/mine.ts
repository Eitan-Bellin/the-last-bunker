// v2 mine simulation: workers, elevator and porters as small state machines in world units and game seconds.
// Pure logic (no Pixi, no DOM) so tools/v2sim.ts can run it in Node; the view only reads positions and events.
import type { BaseSave } from './base.ts';
import {
  BOOST_CD_S, BOOST_MUL, BOOST_S, DIG_COST, ELEV_MGR_COST, FLOORS, MARKET_MGR_COST, MAX_LVL, OFFLINE_CAP_S,
  bulkCost, elevCap, elevSpeed, elevUpCost, floorLoad, floorMgrCost, floorUpCost, floorWorkers, marketUpCost,
  porterCap, porterSpeed, porters,
} from './econ.ts';

// --- geometry (world units; the view uses the same numbers) ---
export const WORLD_W = 720;
export const SURF_H = 470;
export const FLOOR_H = 292;
export const ROOM_W = 540;
/** Visible window of a room (the painting is cropped to its working band around the floor). */
export const ROOM_H = 268;
export const SHAFT_X = 560;
export const SHAFT_W = 160;
/** Worker x where goods are dropped (the crate by the shaft door). */
export const CRATE_X = 482;
/** Porter x at the headframe (pick-up) and at the stalls (sale). */
export const DEPOT_X = 560;
export const MARKET_X = 190;
/** Worker walking speed: 1.6 m/s at 54 units per metre. */
export const WALK = 86;
export const WORK_T = 2;
export const LOAD_T = 0.5;
export const UNLOAD_T = 0.6;
export const SELL_T = 0.6;

export const floorTop = (i: number) => SURF_H + i * FLOOR_H;
/** Elevator y (cab floor) when standing at floor i; -1 = the surface. */
export const stopY = (i: number) => (i < 0 ? SURF_H : floorTop(i) + ROOM_H);
export const spotX = (k: number) => 64 + k * 80;

export type StageId = 'elev' | 'market' | number;

export interface StageSave { lvl: number; mgr: boolean; boostUntil: number; boostReadyAt: number }
export interface FloorSave extends StageSave { crate: number }

export interface MineSave {
  v: 1;
  cash: number;
  gems: number;
  depot: number;
  time: number;
  savedAt: number;
  floors: FloorSave[];
  elev: StageSave;
  market: StageSave;
  stats: { earned: number; taps: number; playS: number };
  /** Command Center, builders, raids (added with the base layer; created on load when missing). */
  base?: BaseSave;
  /** New-bunker runs: how many, bonus points, coins earned in earlier runs. */
  prestige?: { count: number; points: number; lifetime: number };
}

export function newSave(): MineSave {
  const stage = (): StageSave => ({ lvl: 1, mgr: false, boostUntil: 0, boostReadyAt: 0 });
  return {
    v: 1, cash: 0, gems: 15, depot: 0, time: 0, savedAt: Date.now(),
    floors: [{ ...stage(), crate: 0 }],
    elev: stage(), market: stage(),
    stats: { earned: 0, taps: 0, playS: 0 },
  };
}

type WorkerPhase = 'idle' | 'out' | 'work' | 'back';
export interface Worker { k: number; phase: WorkerPhase; x: number; t: number; carry: number }
type ElevPhase = 'idle' | 'down' | 'load' | 'up' | 'unload';
export interface Elevator { phase: ElevPhase; y: number; t: number; carry: number; at: number }
type PorterPhase = 'idle' | 'go' | 'sell' | 'back';
export interface Porter { phase: PorterPhase; x: number; t: number; carry: number; wait: number }

export type MineEvent =
  | { kind: 'deposit'; floor: number; amount: number }
  | { kind: 'load'; floor: number; amount: number }
  | { kind: 'unload'; amount: number }
  | { kind: 'sell'; amount: number; x: number }
  | { kind: 'upgrade'; stage: StageId; levels: number }
  | { kind: 'hire'; stage: StageId }
  | { kind: 'boost'; stage: StageId }
  | { kind: 'dig'; floor: number };

export interface Rates { floors: number[]; floorSum: number; elev: number; market: number; income: number; bottleneck: 'floors' | 'elev' | 'market' }

const approach = (v: number, target: number, step: number) => (Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step);

export class Mine {
  s: MineSave;
  workers: Worker[][] = [];
  elev: Elevator = { phase: 'idle', y: stopY(-1), t: 0, carry: 0, at: -1 };
  porters: Porter[] = [];
  private pending = new Set<StageId>();
  /** Highest level a stage may reach (the Command Center raises it). */
  levelCap = () => MAX_LVL;
  /** Sale price multiplier (the top Command Center levels add a bonus). */
  saleMul = () => 1;
  private listeners: ((e: MineEvent) => void)[] = [];

  constructor(save: MineSave) {
    this.s = save;
    save.floors.forEach((_, i) => this.syncWorkers(i));
    this.syncPorters();
  }

  on(fn: (e: MineEvent) => void): void { this.listeners.push(fn); }
  private emit(e: MineEvent): void { for (const fn of this.listeners) fn(e); }

  stage(id: StageId): StageSave { return id === 'elev' ? this.s.elev : id === 'market' ? this.s.market : this.s.floors[id]; }
  private mul(id: StageId): number { return this.stage(id).boostUntil > this.s.time ? BOOST_MUL : 1; }

  private syncWorkers(i: number): void {
    const want = floorWorkers(this.s.floors[i].lvl);
    const ws = (this.workers[i] ??= []);
    while (ws.length < want) ws.push({ k: ws.length, phase: 'idle', x: CRATE_X - 6 * ws.length, t: 0, carry: 0 });
  }

  private syncPorters(): void {
    const want = porters(this.s.market.lvl);
    while (this.porters.length < want) this.porters.push({ phase: 'idle', x: DEPOT_X + 14 * this.porters.length, t: 0, carry: 0, wait: this.porters.length * 0.7 });
  }

  /** Is this stage waiting for a tap (no manager and nothing running)? */
  idle(id: StageId): boolean {
    if (this.stage(id).mgr || this.pending.has(id)) return false;
    if (id === 'elev') return this.elev.phase === 'idle';
    if (id === 'market') return this.porters.every(p => p.phase === 'idle');
    return this.workers[id].every(w => w.phase === 'idle');
  }

  tap(id: StageId): boolean {
    if (!this.idle(id)) return false;
    this.pending.add(id);
    this.s.stats.taps++;
    return true;
  }

  // --- buying ---
  upgradePrice(id: StageId): (lvl: number) => number {
    if (id === 'elev') return elevUpCost;
    if (id === 'market') return marketUpCost;
    return (lvl: number) => floorUpCost(id, lvl);
  }

  upgradeCost(id: StageId, n: number): number { return bulkCost(this.upgradePrice(id), this.stage(id).lvl, n); }

  upgrade(id: StageId, n: number): boolean {
    const st = this.stage(id);
    n = Math.min(n, this.levelCap() - st.lvl);
    if (n <= 0) return false;
    const cost = this.upgradeCost(id, n);
    if (cost > this.s.cash) return false;
    this.s.cash -= cost;
    st.lvl += n;
    if (typeof id === 'number') this.syncWorkers(id);
    if (id === 'market') this.syncPorters();
    this.emit({ kind: 'upgrade', stage: id, levels: n });
    return true;
  }

  mgrCost(id: StageId): number { return id === 'elev' ? ELEV_MGR_COST : id === 'market' ? MARKET_MGR_COST : floorMgrCost(id); }

  hire(id: StageId): boolean {
    const st = this.stage(id);
    const c = this.mgrCost(id);
    if (st.mgr || c > this.s.cash) return false;
    this.s.cash -= c;
    st.mgr = true;
    this.emit({ kind: 'hire', stage: id });
    return true;
  }

  canBoost(id: StageId): boolean { const st = this.stage(id); return st.mgr && st.boostReadyAt <= this.s.time; }

  boost(id: StageId): boolean {
    if (!this.canBoost(id)) return false;
    const st = this.stage(id);
    st.boostUntil = this.s.time + BOOST_S;
    st.boostReadyAt = this.s.time + BOOST_CD_S;
    this.emit({ kind: 'boost', stage: id });
    return true;
  }

  /** Price of the next floor, or null when every floor is open. */
  digCost(): number | null { const i = this.s.floors.length; return i < FLOORS.length ? DIG_COST[i] : null; }

  dig(): boolean {
    const c = this.digCost();
    if (c === null || c > this.s.cash) return false;
    this.s.cash -= c;
    this.openFloor();
    return true;
  }

  /** Adds the next floor (paid for already: a builder finished digging it). */
  openFloor(): void {
    if (this.digCost() === null) return;
    this.s.floors.push({ lvl: 1, mgr: false, boostUntil: 0, boostReadyAt: 0, crate: 0 });
    const i = this.s.floors.length - 1;
    this.syncWorkers(i);
    this.emit({ kind: 'dig', floor: i });
  }

  // --- rates (per game second, steady state) ---
  floorRate(i: number): number {
    const f = this.s.floors[i];
    const n = floorWorkers(f.lvl);
    let perS = 0;
    for (let k = 0; k < n; k++) perS += 1 / ((2 * (CRATE_X - spotX(k))) / WALK + WORK_T);
    return floorLoad(i, f.lvl) * perS;
  }

  elevRate(): number {
    const last = this.s.floors.length - 1;
    const round = (2 * (stopY(last) - stopY(-1))) / elevSpeed(this.s.elev.lvl) + this.s.floors.length * LOAD_T + UNLOAD_T;
    return elevCap(this.s.elev.lvl) / round;
  }

  marketRate(): number {
    const m = this.s.market.lvl;
    const round = (2 * (DEPOT_X - MARKET_X)) / porterSpeed(m) + SELL_T;
    return (porters(m) * porterCap(m)) / round;
  }

  rates(): Rates {
    const floors = this.s.floors.map((_, i) => this.floorRate(i));
    const floorSum = floors.reduce((a, b) => a + b, 0);
    const elev = this.elevRate();
    const market = this.marketRate();
    const income = Math.min(floorSum, elev, market) * this.saleMul();
    const low = Math.min(floorSum, elev, market);
    const bottleneck = low === floorSum ? 'floors' : low === elev ? 'elev' : 'market';
    return { floors, floorSum, elev, market, income, bottleneck };
  }

  /** Credits `seconds` away from the game for the managed stages; returns the cash earned. */
  offline(seconds: number): number {
    const dt = Math.min(seconds, OFFLINE_CAP_S);
    if (dt <= 0) return 0;
    const r = this.rates();
    this.s.floors.forEach((f, i) => { if (f.mgr) f.crate += r.floors[i] * dt; });
    if (this.s.elev.mgr) {
      let room = r.elev * dt;
      for (const f of this.s.floors) {
        const take = Math.min(f.crate, room);
        f.crate -= take;
        room -= take;
        this.s.depot += take;
      }
    }
    let earned = 0;
    if (this.s.market.mgr) {
      const sold = Math.min(this.s.depot, r.market * dt);
      this.s.depot -= sold;
      earned = sold * this.saleMul();
      this.s.cash += earned;
      this.s.stats.earned += earned;
    }
    return earned;
  }

  // --- the clock ---
  step(dt: number): void {
    this.s.time += dt;
    this.s.stats.playS += dt;
    this.s.floors.forEach((_, i) => this.stepFloor(i, dt));
    this.stepElev(dt);
    this.stepMarket(dt);
  }

  private stepFloor(i: number, dt: number): void {
    const f = this.s.floors[i];
    const go = f.mgr || this.pending.has(i);
    const m = this.mul(i);
    let started = false;
    for (const w of this.workers[i]) {
      switch (w.phase) {
        case 'idle':
          if (go) { w.phase = 'out'; started = true; }
          break;
        case 'out':
          w.x = approach(w.x, spotX(w.k), WALK * m * dt);
          if (w.x === spotX(w.k)) { w.phase = 'work'; w.t = 0; }
          break;
        case 'work':
          w.t += dt * m;
          if (w.t >= WORK_T) { w.phase = 'back'; w.carry = floorLoad(i, f.lvl); }
          break;
        case 'back':
          w.x = approach(w.x, CRATE_X, WALK * m * dt);
          if (w.x === CRATE_X) {
            f.crate += w.carry;
            this.emit({ kind: 'deposit', floor: i, amount: w.carry });
            w.carry = 0;
            w.phase = 'idle';
          }
          break;
      }
    }
    if (started) this.pending.delete(i);
  }

  private stepElev(dt: number): void {
    const e = this.elev;
    const lvl = this.s.elev.lvl;
    const m = this.mul('elev');
    const v = elevSpeed(lvl) * m * dt;
    const last = this.s.floors.length - 1;
    const anyBelow = (from: number) => this.s.floors.some((f, i) => i >= from && f.crate >= 1);
    switch (e.phase) {
      case 'idle':
        if ((this.s.elev.mgr || this.pending.has('elev')) && anyBelow(0)) {
          this.pending.delete('elev');
          e.phase = 'down';
          e.at = this.s.floors.findIndex(f => f.crate >= 1);
        }
        break;
      case 'down':
        e.y = approach(e.y, stopY(e.at), v);
        if (e.y === stopY(e.at)) { e.phase = 'load'; e.t = 0; }
        break;
      case 'load': {
        e.t += dt * m;
        if (e.t < LOAD_T) break;
        const f = this.s.floors[e.at];
        const take = Math.min(f.crate, elevCap(lvl) - e.carry);
        if (take > 0) {
          f.crate -= take;
          e.carry += take;
          this.emit({ kind: 'load', floor: e.at, amount: take });
        }
        const next = this.s.floors.findIndex((g, i) => i > e.at && g.crate >= 1);
        if (e.carry >= elevCap(lvl) - 1e-9 || e.at >= last || next < 0) e.phase = 'up';
        else { e.at = next; e.phase = 'down'; }
        break;
      }
      case 'up':
        e.y = approach(e.y, stopY(-1), v);
        if (e.y === stopY(-1)) { e.phase = 'unload'; e.t = 0; e.at = -1; }
        break;
      case 'unload':
        e.t += dt * m;
        if (e.t >= UNLOAD_T) {
          this.s.depot += e.carry;
          this.emit({ kind: 'unload', amount: e.carry });
          e.carry = 0;
          e.phase = 'idle';
        }
        break;
    }
  }

  private stepMarket(dt: number): void {
    const lvl = this.s.market.lvl;
    const m = this.mul('market');
    const v = porterSpeed(lvl) * m * dt;
    const go = this.s.market.mgr || this.pending.has('market');
    let started = false;
    for (const p of this.porters) {
      switch (p.phase) {
        case 'idle':
          p.wait -= dt;
          if (go && p.wait <= 0 && this.s.depot >= 1) {
            p.carry = Math.min(this.s.depot, porterCap(lvl));
            this.s.depot -= p.carry;
            p.phase = 'go';
            started = true;
          }
          break;
        case 'go':
          p.x = approach(p.x, MARKET_X, v);
          if (p.x === MARKET_X) { p.phase = 'sell'; p.t = 0; }
          break;
        case 'sell':
          p.t += dt * m;
          if (p.t >= SELL_T) {
            const got = p.carry * this.saleMul();
            this.s.cash += got;
            this.s.stats.earned += got;
            this.emit({ kind: 'sell', amount: got, x: p.x });
            p.carry = 0;
            p.phase = 'back';
          }
          break;
        case 'back':
          p.x = approach(p.x, DEPOT_X, v);
          if (p.x === DEPOT_X) { p.phase = 'idle'; p.wait = 0.25; }
          break;
      }
    }
    if (started) this.pending.delete('market');
  }
}

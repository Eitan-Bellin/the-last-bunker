import type { DailyOrder, DailyState, GameState, ResourceType } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import {
  CHEST_HOURS, FRAGS_PER_PLAN, ORDERS, REWARD_GOLD, REWARD_RUSH, REWARD_SILVER, actCreditScale, didFlag, getOrder, orderTier, streakBonus,
  type OrderDef, type OrderEnv,
} from '../data/orders';
import type { ResourceSystem } from './ResourceSystem';
import type { RushSystem } from './RushSystem';

/**
 * [plan4:GP-1] Daily orders. Three short goals a day, reset at 04:00 local time (not midnight: a player who plays late at night
 * must not lose the evening to a reset), with a bronze/silver/gold reward each, a day chest for finishing all three, and a streak
 * that adds up to +50% to the credits with one grace day. Progress is read from events and counters the other systems already
 * keep (see data/orders.ts); this system only owns the day, the choice of orders and the payout.
 */

/** The guided first half hour stays free of side goals; after it (or from Act II) the orders start. */
export const START_AFTER_PLAY_S = 1800;
/** The day turns over at this local hour. */
export const RESET_HOUR = 4;
/** Orders the day offers, and how many stand in reserve for the one swap. */
export const ORDERS_PER_DAY = 3;
const SPARE = 2;

const DAY_MS = 86_400_000;

/** The number of the local day that `ms` falls in, the day starting at 04:00 (days since 1970; DST-safe because it uses the calendar date of local time minus 4 hours). */
export function dayIndex(ms = Date.now()): number {
  const d = new Date(ms - RESET_HOUR * 3_600_000);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** The wall-clock time (ms) of the next reset after `ms`. */
export function nextResetAt(ms = Date.now()): number {
  const d = new Date(ms);
  const day = d.getHours() >= RESET_HOUR ? d.getDate() + 1 : d.getDate();
  return new Date(d.getFullYear(), d.getMonth(), day, RESET_HOUR, 0, 0, 0).getTime();
}

/** Small seeded generator: the day's pick must not touch the game's own random stream (a saved game and a replay must stay identical). */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const actOfState = (s: GameState): number => s.longGame?.meta.act ?? 1;

export interface DailyPick {
  orders: DailyOrder[];
  spare: string[];
}

/**
 * Chooses the day's orders: one easy, one medium and one "new" (preferring a system never finished before), none of yesterday's if
 * enough others exist, plus two in reserve. Deterministic for a given bunker and day. Fewer than three come back only when the bunker
 * offers fewer than three things at all.
 */
export function pickOrders(s: GameState, day: number, env: OrderEnv, avoid: string[] = []): DailyPick {
  const a = actOfState(s);
  const pool = ORDERS.filter(o => a >= o.fromAct && a <= (o.toAct ?? 99) && o.avail(s, env));
  const fresh = pool.filter(o => !avoid.includes(o.id));
  const usable = fresh.length >= ORDERS_PER_DAY + SPARE ? fresh : pool;
  const runIndex = s.longGame?.meta.runIndex ?? 0;
  const rnd = mulberry(Math.imul(day + 1, 0x9e3779b1) ^ Math.imul(runIndex + 7, 0x85ebca6b) ^ Math.imul((s.createdAt ?? 0) % 2147483647, 0xc2b2ae35));
  const take = (list: OrderDef[]): OrderDef | undefined => list.length ? list[Math.floor(rnd() * list.length)] : undefined;
  const chosen: OrderDef[] = [];
  const left = () => usable.filter(o => !chosen.includes(o));
  for (const tier of ['easy', 'medium', 'new'] as const) {
    const ofTier = left().filter(o => o.tier === tier);
    // The "new" order teaches: one the player never finished comes first.
    const novel = tier === 'new' ? ofTier.filter(o => o.fresh?.(s)) : [];
    const pick = take(novel.length ? novel : ofTier);
    if (pick) chosen.push(pick);
  }
  while (chosen.length < ORDERS_PER_DAY) {
    const pick = take(left()) ?? take(pool.filter(o => !chosen.includes(o)));
    if (!pick) break;
    chosen.push(pick);
  }
  const spare: OrderDef[] = [];
  for (let i = 0; i < SPARE; i++) {
    const pick = take(left().filter(o => !spare.includes(o)));
    if (pick) spare.push(pick);
  }
  return { orders: chosen.map(o => newOrder(s, o)), spare: spare.map(o => o.id) };
}

/** A fresh order: nothing done, the counter noted. */
export function newOrder(s: GameState, def: OrderDef): DailyOrder {
  return { id: def.id, p: 0, need: Math.max(1, Math.round(def.need(s))), done: false, claimed: false, b: def.counter ? def.counter(s) : 0 };
}

/** What a claim paid. */
export interface DailyClaim {
  index: number;
  id: string;
  rush: number;
  credits: number;
  /** Pieces of a blueprint added (a quarter each). */
  frag: number;
  /** Whole blueprints made from pieces. */
  blueprints: number;
  /** The share the streak added to the credits. */
  bonus: number;
}

export interface ChestClaim {
  gains: Partial<Record<ResourceType, number>>;
}

/** What the HUD chip and the cards show. */
export interface DailySummary {
  n: number;
  done: number;
  claimable: number;
  chestReady: boolean;
  streak: number;
}

const CHEST_RESOURCES: ResourceType[] = ['food', 'water', 'materials', 'knowledge'];

export class DailySystem {
  private sm: StateManager;
  private resources: ResourceSystem;
  private rush: RushSystem;
  private env: OrderEnv;
  /** While the bunker catches up on time away (GameEngine.simStart/simStop): only orders marked `offline` may move. */
  away = false;
  /** The simulator turns this off and plays the orders by hand (`forceComplete`), so "completes 1.5 of 3" is exact. */
  progressEnabled = true;
  private lastPlay = -1;
  /** Counter values taken when the player left, to take the away growth off the orders that need hands. */
  private awaySnap = new Map<string, number>();

  constructor(sm: StateManager, resources: ResourceSystem, rush: RushSystem, env: OrderEnv) {
    this.sm = sm;
    this.resources = resources;
    this.rush = rush;
    this.env = env;
    // One listener per event the orders use (a bus handler per order would walk the list again and again).
    for (const ev of new Set(ORDERS.flatMap(o => Object.keys(o.on ?? {})))) bus.on(ev, (...args: unknown[]) => this.onEvent(ev, args));
  }

  get daily(): DailyState {
    return this.sm.state.daily;
  }

  /** Orders run once the guided half hour is over (or the Act has moved on) and somebody lives in the bunker. */
  active(s: GameState = this.sm.state): boolean {
    return s.storyFlags.includes('intro:done') && s.survivors.length > 0 && (s.stats.totalPlayTime >= START_AFTER_PLAY_S || actOfState(s) >= 2);
  }

  // ---- the day --------------------------------------------------------------------------------------------------------------

  /** Online: once a second. Away: each step of the catch-up. */
  update(): void {
    const s = this.sm.state;
    if (!this.active(s)) return;
    this.ensureToday();
    if (!this.progressEnabled) return;
    this.refresh();
  }

  /** Turns the day over when the clock says so: what was finished is paid out first, then three new orders are made. */
  ensureToday(now = Date.now()): boolean {
    const s = this.sm.state;
    const today = dayIndex(now);
    const d = s.daily;
    if (d.orders.length > 0 && today <= d.day) return false;
    if (!this.active(s)) return false;
    let auto = 0;
    if (d.orders.length > 0) auto = this.settleDay();
    const prev = this.sm.state.daily.orders.map(o => o.id);
    const pick = pickOrders(this.sm.state, today, this.env, prev);
    if (pick.orders.length === 0) return false; // nothing on offer yet: look again next second
    this.sm.applyDelta({ path: 'daily', value: { ...this.sm.state.daily, day: today, orders: pick.orders, spare: pick.spare, swapped: false, chest: false } });
    bus.emit('daily:new', { day: today, auto });
    return true;
  }

  /**
   * The old day ends: whatever was finished and not yet taken is paid (gold in credits, the chest if all were done). Nobody should lose
   * what they earned because the clock turned while they were away. Returns how many orders were paid.
   */
  private settleDay(): number {
    let n = 0;
    this.sm.state.daily.orders.forEach((o, i) => { if (o.done && !o.claimed && this.claim(i, 'credits', true)) n++; });
    if (this.chestReady()) this.claimChest(true);
    return n;
  }

  // ---- progress -------------------------------------------------------------------------------------------------------------

  /** Counters and clocks, once a second. */
  private refresh(): void {
    const s = this.sm.state;
    const t = s.stats.totalPlayTime;
    const dt = this.lastPlay < 0 || this.away ? 0 : Math.min(5, Math.max(0, t - this.lastPlay));
    this.lastPlay = t;
    const orders = s.daily.orders;
    let changed = false;
    const next = orders.map(o => {
      if (o.done) return o;
      const def = getOrder(o.id);
      if (!def) return o;
      // Time away moves only the orders that are about the bunker working by itself (dig, research, food).
      if (this.away && !def.offline) return o;
      let p = o.p;
      if (def.counter) p = Math.max(p, def.counter(s) - (o.b ?? 0));
      else if (def.watch && !this.away) p = def.watch(s, o, dt);
      p = Math.min(o.need, p);
      if (p === o.p) return o;
      changed = true;
      return { ...o, p };
    });
    if (changed) this.sm.applyDelta({ path: 'daily.orders', value: next });
    this.markDone();
  }

  /** The bus event `ev` happened: orders it feeds move forward. */
  private onEvent(ev: string, args: unknown[]): void {
    const s = this.sm.state;
    if (!this.progressEnabled || !s?.daily || s.daily.orders.length === 0) return;
    let changed = false;
    const next = s.daily.orders.map(o => {
      if (o.done) return o;
      const def = getOrder(o.id);
      const worth = def?.on?.[ev];
      if (!def || !worth || (this.away && !def.offline)) return o;
      const n = worth(s, ...args);
      if (n <= 0) return o;
      changed = true;
      return { ...o, p: Math.min(o.need, o.p + n) };
    });
    if (!changed) return;
    this.sm.applyDelta({ path: 'daily.orders', value: next });
    this.markDone();
  }

  /** Orders that reached their target become done (once), with a flag so the "new" tier knows they were seen. */
  private markDone(): void {
    const s = this.sm.state;
    const finished: number[] = [];
    s.daily.orders.forEach((o, i) => { if (!o.done && o.p >= o.need) finished.push(i); });
    if (finished.length === 0) return;
    this.sm.applyDelta({ path: 'daily.orders', value: s.daily.orders.map((o, i) => (finished.includes(i) ? { ...o, p: o.need, done: true } : o)) });
    const flags = [...this.sm.state.storyFlags];
    for (const i of finished) {
      const id = this.sm.state.daily.orders[i].id;
      if (!flags.includes(didFlag(id))) flags.push(didFlag(id));
    }
    this.sm.applyDelta({ path: 'storyFlags', value: flags });
    for (const i of finished) bus.emit('daily:done', i, this.sm.state.daily.orders[i].id);
  }

  /** The player left (GameEngine.simStart): note the counters of orders that need hands. */
  beginAway(): void {
    this.away = true;
    this.awaySnap.clear();
    for (const o of this.sm.state.daily.orders) {
      const def = getOrder(o.id);
      if (def?.counter && !def.offline) this.awaySnap.set(o.id, def.counter(this.sm.state));
    }
  }

  /** The player is back (GameEngine.simStop): whatever those counters grew by while away does not count (births, rooms finished). */
  endAway(): void {
    this.away = false;
    const s = this.sm.state;
    const next = s.daily.orders.map(o => {
      const def = getOrder(o.id);
      // An order made during the absence started from the counter as it was then (its own `b`).
      const was = this.awaySnap.get(o.id) ?? o.b;
      if (!def?.counter || def.offline || was === undefined || o.done) return o;
      return { ...o, b: (o.b ?? 0) + (def.counter(s) - was) };
    });
    this.awaySnap.clear();
    this.sm.applyDelta({ path: 'daily.orders', value: next });
    this.lastPlay = -1;
  }

  // ---- rewards --------------------------------------------------------------------------------------------------------------

  /** Days in a row as of `today`: 0 when the run was broken (a missed day without the grace day left). */
  liveStreak(today = dayIndex()): number {
    const d = this.sm.state.daily;
    if (d.lastClaim < 0 || d.streak <= 0) return 0;
    const gap = today - d.lastClaim;
    if (gap <= 1) return d.streak;
    if (gap === 2 && !d.graceUsed) return d.streak;
    return 0;
  }

  /** Counts today in the streak the first time something is taken; spends the grace day when exactly one day was missed. */
  private touchStreak(): void {
    const d = this.sm.state.daily;
    const today = d.day;
    if (d.lastClaim === today) return;
    const gap = d.lastClaim < 0 ? Infinity : today - d.lastClaim;
    let streak = 1;
    let graceUsed = d.graceUsed;
    if (gap <= 1) streak = d.streak + 1;
    else if (gap === 2 && !d.graceUsed) { streak = d.streak + 1; graceUsed = true; }
    else graceUsed = false;
    // A full week in a row earns the grace day back.
    if (streak % 7 === 0) graceUsed = false;
    this.sm.applyDelta({ path: 'daily', value: { ...this.sm.state.daily, streak, lastClaim: today, graceUsed } });
  }

  /** The share added to credits today. */
  currentBonus(): number {
    const d = this.sm.state.daily;
    // The streak counts today once something was taken; the bonus is for the days before it.
    return streakBonus(d.lastClaim === d.day ? d.streak : this.liveStreak(d.day) + 1);
  }

  /** Takes the reward of order `i`. `choice` matters for gold only. */
  claim(i: number, choice: 'credits' | 'frag' = 'credits', auto = false): DailyClaim | null {
    const s = this.sm.state;
    const o = s.daily.orders[i];
    if (!o || !o.done || o.claimed) return null;
    this.touchStreak();
    const bonus = this.currentBonus();
    const scale = actCreditScale(this.sm.state);
    const tier = orderTier(o.id);
    const out: DailyClaim = { index: i, id: o.id, rush: 0, credits: 0, frag: 0, blueprints: 0, bonus };
    if (tier === 'easy') {
      out.rush = REWARD_RUSH;
      this.rush.grant(REWARD_RUSH);
    } else if (tier === 'medium' || choice === 'credits') {
      out.credits = Math.round((tier === 'medium' ? REWARD_SILVER : REWARD_GOLD) * scale * (1 + bonus));
      this.resources.gain(this.sm, { credits: out.credits });
    } else {
      const frag = this.sm.state.daily.frag + 1;
      out.frag = 1;
      if (frag >= FRAGS_PER_PLAN) {
        out.blueprints = 1;
        this.resources.gain(this.sm, { blueprints: 1 });
      }
      this.sm.applyDelta({ path: 'daily.frag', value: frag % FRAGS_PER_PLAN });
    }
    this.sm.applyDelta({ path: 'daily.orders', value: this.sm.state.daily.orders.map((x, k) => (k === i ? { ...x, claimed: true, r: tier === 'new' ? choice : undefined } : x)) });
    bus.emit('daily:claimed', out, auto);
    return out;
  }

  /** Every finished order not yet taken (gold in credits). Returns the claims. */
  claimAll(quiet = false): DailyClaim[] {
    const out: DailyClaim[] = [];
    this.sm.state.daily.orders.forEach((o, i) => { if (o.done && !o.claimed) { const c = this.claim(i, 'credits', quiet); if (c) out.push(c); } });
    return out;
  }

  /** All of today's orders are finished and the chest is still closed. */
  chestReady(s: GameState = this.sm.state): boolean {
    const d = s.daily;
    return d.orders.length > 0 && !d.chest && d.orders.every(o => o.done);
  }

  /** One hour of the bunker's own production, like the supply crate; the scrap share follows the crate too. */
  chestContents(s: GameState = this.sm.state): Partial<Record<ResourceType, number>> {
    const out: Partial<Record<ResourceType, number>> = {};
    for (const r of CHEST_RESOURCES) out[r] = Math.round(Math.max(20, s.resources[r].productionRate * 3600 * CHEST_HOURS));
    out.scrap = Math.round(Math.max(10, s.resources.scrap.cap * 0.05 * CHEST_HOURS));
    return out;
  }

  claimChest(auto = false): ChestClaim | null {
    if (!this.chestReady()) return null;
    this.touchStreak();
    const s = this.sm.state;
    const contents = this.chestContents(s);
    const before: Partial<Record<ResourceType, number>> = {};
    for (const r of Object.keys(contents) as ResourceType[]) before[r] = s.resources[r].amount;
    this.resources.gain(this.sm, contents);
    const gains: Partial<Record<ResourceType, number>> = {};
    for (const r of Object.keys(contents) as ResourceType[]) {
      const got = Math.round(this.sm.state.resources[r].amount - (before[r] ?? 0));
      if (got > 0) gains[r] = got;
    }
    this.sm.applyDelta({ path: 'daily.chest', value: true });
    bus.emit('daily:chest', { gains }, auto);
    return { gains };
  }

  // ---- the swap -------------------------------------------------------------------------------------------------------------

  canSwap(i: number): boolean {
    const d = this.sm.state.daily;
    return !d.swapped && d.spare.length > 0 && !!d.orders[i] && !d.orders[i].done;
  }

  /** Once a day an order that is not finished can be traded for one in reserve ("which three to do" is the player's call). */
  swap(i: number): boolean {
    if (!this.canSwap(i)) return false;
    const d = this.sm.state.daily;
    const [id, ...rest] = d.spare;
    const def = getOrder(id);
    if (!def) return false;
    this.sm.applyDelta({ path: 'daily', value: { ...d, orders: d.orders.map((o, k) => (k === i ? newOrder(this.sm.state, def) : o)), spare: rest, swapped: true } });
    return true;
  }

  // ---- views and test hooks -------------------------------------------------------------------------------------------------

  summary(s: GameState = this.sm.state): DailySummary {
    const d = s.daily;
    return {
      n: d.orders.length,
      done: d.orders.filter(o => o.done).length,
      claimable: d.orders.filter(o => o.done && !o.claimed).length + (this.chestReady(s) ? 1 : 0),
      chestReady: this.chestReady(s),
      streak: this.liveStreak(d.day >= 0 ? d.day : dayIndex()),
    };
  }

  /** Marks order `i` finished (the simulator's player, tests, the debug console). */
  forceComplete(i: number): boolean {
    const o = this.sm.state.daily.orders[i];
    if (!o || o.done) return false;
    this.sm.applyDelta({ path: 'daily.orders', value: this.sm.state.daily.orders.map((x, k) => (k === i ? { ...x, p: x.need } : x)) });
    this.markDone();
    return true;
  }
}

// v2 base layer (the Clash of Clans part): the Command Center levels that gate the mine, builders with real-time jobs,
// the armory (squad power) and walls (defense), raider camps to attack and raids on the bunker. Wall-clock timers, so
// jobs, squads and attacks all progress while the player is away. Pure logic: the UI only reads and calls.
import { FLOORS } from './econ.ts';
import type { Mine } from './mine.ts';
import { estimateWin, raidersFor, squadSizeFor, type BattleSetup } from './battle.ts';

export type JobKind = 'dig' | 'cc' | 'armory' | 'walls';
export interface Job { kind: JobKind; target: number; startAt: number; endAt: number }
export interface Camp { id: number; name: string; biome: string; power: number; loot: number; gems: number; respawnAt: number | null }
export interface Report { at: number; kind: 'attack' | 'defense'; win: boolean; camp?: string; loot: number; gems: number; lost: number; seen: boolean }

export interface BaseSave {
  cc: number;
  builders: number;
  jobs: Job[];
  armory: number;
  walls: number;
  camps: Camp[];
  campSeq: number;
  squad: { campId: number; returnAt: number; winChance: number } | null;
  nextRaidAt: number;
  reports: Report[];
}

// ---- tables (index = current level) ----
export const CC_MAX = 10;
/** Floors the Command Center allows at each level. */
export const CC_FLOORS = [0, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8];
/** Highest stage level (floors, elevator, market) at each Command Center level. */
export const CC_LVL_CAP = [0, 25, 50, 75, 100, 125, 150, 175, 200, 200, 200];
/** Income bonus of the top Command Center levels. */
export const CC_BONUS = [0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.25, 0.5];
const CC_COST = [0, 300, 5e3, 6e4, 9e5, 1.2e7, 1.8e8, 3e9, 6e10, 1.5e12];
const CC_TIME = [0, 60, 300, 900, 1800, 3600, 7200, 14400, 28800, 43200];
/** Seconds to dig floor i (index = floor number, 1 = the second floor). */
const DIG_TIME = [0, 30, 120, 600, 1200, 2400, 3600, 7200];
export const BUILDER_GEMS = [0, 0, 0, 250, 600];
export const MAX_BUILDERS = 4;
const RAID_EVERY_S = 2.5 * 3600;

export const squadPower = (lvl: number) => 10 * 1.55 ** (lvl - 1);
export const wallPower = (lvl: number) => 10 * 1.55 ** (lvl - 1);
const defCost = (lvl: number) => 150 * 5.5 ** (lvl - 1);
const defTime = (lvl: number) => Math.min(8 * 3600, 30 * 2 ** (lvl - 1));
/** Armory and walls can go up to two levels per Command Center level. */
export const defCap = (cc: number) => cc * 2 + 1;

const CAMP_NAMES = ['מחנה העקרבים', 'כנופיית הצינור', 'מבצר החלודה', 'שבט האבק', 'הזאבים האפורים', 'משמר הגשר', 'בוזזי הרכבת', 'מלכת הגרוטאות', 'אחים לשמש', 'הצבועים'];
const BIOMES = ['wasteland', 'ruins', 'shatteredCity', 'toxicForest', 'militaryZone', 'caves'];

export function newBase(now: number): BaseSave {
  return { cc: 1, builders: 2, jobs: [], armory: 1, walls: 1, camps: [], campSeq: 0, squad: null, nextRaidAt: now + RAID_EVERY_S * 1000, reports: [] };
}

export type BaseEvent =
  | { kind: 'jobDone'; job: Job }
  | { kind: 'report'; report: Report };

const winChance = (mine: number, theirs: number) => 1 / (1 + Math.exp(-4 * (mine / theirs - 1)));

export class Base {
  s: BaseSave;
  private mine: Mine;
  private listeners: ((e: BaseEvent) => void)[] = [];

  constructor(mine: Mine, save: BaseSave) {
    this.mine = mine;
    this.s = save;
  }

  on(fn: (e: BaseEvent) => void): void { this.listeners.push(fn); }
  private emit(e: BaseEvent): void { for (const fn of this.listeners) fn(e); }

  // ---- caps the mine obeys ----
  floorsAllowed(): number { return CC_FLOORS[this.s.cc]; }
  levelCap(): number { return CC_LVL_CAP[this.s.cc]; }
  incomeBonus(): number { return CC_BONUS[this.s.cc]; }

  // ---- builders ----
  freeBuilders(): number { return this.s.builders - this.s.jobs.length; }
  busy(kind: JobKind): Job | undefined { return this.s.jobs.find(j => j.kind === kind); }

  private start(kind: JobKind, target: number, cost: number, seconds: number, now: number): boolean {
    if (this.freeBuilders() <= 0 || this.busy(kind) || cost > this.mine.s.cash) return false;
    this.mine.s.cash -= cost;
    this.s.jobs.push({ kind, target, startAt: now, endAt: now + seconds * 1000 });
    return true;
  }

  // dig: the next floor (needs Command Center room)
  nextFloor(): number { return this.mine.s.floors.length; }
  canDigMore(): boolean { return this.nextFloor() < Math.min(FLOORS.length, this.floorsAllowed()); }
  digTime(): number { return DIG_TIME[this.nextFloor()] ?? 7200; }
  startDig(now: number): boolean {
    const c = this.mine.digCost();
    if (c === null || !this.canDigMore()) return false;
    return this.start('dig', this.nextFloor(), c, this.digTime(), now);
  }

  ccCost(): number | null { return this.s.cc < CC_MAX ? CC_COST[this.s.cc] : null; }
  ccTime(): number { return CC_TIME[this.s.cc] ?? 0; }
  startCC(now: number): boolean {
    const c = this.ccCost();
    return c !== null && this.start('cc', this.s.cc + 1, c, this.ccTime(), now);
  }

  defCost(kind: 'armory' | 'walls'): number | null { const l = this.s[kind]; return l < defCap(this.s.cc) ? defCost(l) : null; }
  defTime(kind: 'armory' | 'walls'): number { return defTime(this.s[kind]); }
  startDef(kind: 'armory' | 'walls', now: number): boolean {
    const c = this.defCost(kind);
    return c !== null && this.start(kind, this.s[kind] + 1, c, this.defTime(kind), now);
  }

  /** Gems to finish a job now: one gem per two minutes left (at least one). */
  rushGems(job: Job, now: number): number { return Math.max(1, Math.ceil((job.endAt - now) / 120000)); }
  rush(job: Job, now: number): boolean {
    const g = this.rushGems(job, now);
    if (g > this.mine.s.gems) return false;
    this.mine.s.gems -= g;
    job.endAt = now;
    this.step(now);
    return true;
  }

  builderGems(): number | null { return this.s.builders < MAX_BUILDERS ? BUILDER_GEMS[this.s.builders + 1] : null; }
  hireBuilder(): boolean {
    const g = this.builderGems();
    if (g === null || g > this.mine.s.gems) return false;
    this.mine.s.gems -= g;
    this.s.builders++;
    return true;
  }

  private finish(j: Job): void {
    if (j.kind === 'dig') this.mine.openFloor();
    else if (j.kind === 'cc') this.s.cc = j.target;
    else this.s[j.kind] = j.target;
    this.emit({ kind: 'jobDone', job: j });
  }

  // ---- raids ----
  power(): number { return squadPower(this.s.armory); }
  defense(): number { return wallPower(this.s.walls); }

  /** Keeps four camps on the map, scaled to the squad and the mine's income. */
  private refreshCamps(now: number): void {
    for (const c of this.s.camps) {
      if (c.respawnAt !== null && c.respawnAt <= now) Object.assign(c, this.makeCamp(), { id: c.id });
    }
    while (this.s.camps.length < 4) this.s.camps.push({ ...this.makeCamp(), id: ++this.s.campSeq });
  }

  private makeCamp(): Camp {
    const k = this.s.campSeq++;
    const p = this.power() * (0.6 + Math.random() * 0.95);
    const income = Math.max(2, this.mine.rates().income);
    const ratio = p / this.power();
    return {
      id: k, name: CAMP_NAMES[k % CAMP_NAMES.length], biome: BIOMES[k % BIOMES.length],
      power: p, loot: income * (240 + 600 * ratio * Math.random() + 300 * ratio), gems: Math.max(1, Math.round(ratio * 2 + Math.random() * 2)),
      respawnAt: null,
    };
  }

  private odds = new Map<string, number>();

  battleSetup(c: Camp, seed = Math.floor(Math.random() * 1e9)): BattleSetup {
    return { squadPower: this.power(), squadSize: squadSizeFor(this.s.armory), campPower: c.power, raiders: raidersFor(c.id), seed };
  }

  /** Win odds for a typical player (from simulating the battle), cached per camp and armory level. */
  chance(c: Camp): number {
    const key = `${c.id}|${c.power}|${this.s.armory}`;
    let v = this.odds.get(key);
    if (v === undefined) {
      const { seed: _s, ...setup } = this.battleSetup(c, 0);
      v = estimateWin(setup, 24);
      this.odds.set(key, v);
    }
    return v;
  }

  /** Seconds the squad rests after a battle (longer after a defeat). */
  restS(win: boolean): number { return win ? 45 : 120; }

  /** The squad can fight (not resting) and the camp stands. */
  canAttack(campId: number, now: number): boolean {
    const c = this.s.camps.find(x => x.id === campId);
    return !!c && c.respawnAt === null && (!this.s.squad || this.s.squad.returnAt <= now);
  }

  /** Books the outcome of a battle the player fought. */
  endBattle(campId: number, win: boolean, now: number): Report | null {
    const c = this.s.camps.find(x => x.id === campId);
    if (!c) return null;
    this.s.squad = { campId, returnAt: now + this.restS(win) * 1000, winChance: 0 };
    const r: Report = { at: now, kind: 'attack', win, camp: c.name, loot: win ? c.loot : 0, gems: win ? c.gems : 0, lost: 0, seen: true };
    if (win) {
      this.mine.s.cash += c.loot;
      this.mine.s.gems += c.gems;
      c.respawnAt = now + 10 * 60 * 1000;
    }
    this.pushReport(r);
    return r;
  }

  private resolveSquad(now: number): void {
    if (this.s.squad && this.s.squad.returnAt <= now) this.s.squad = null;
  }

  private resolveRaid(now: number): void {
    if (this.s.cc < 2) { this.s.nextRaidAt = Math.max(this.s.nextRaidAt, now + RAID_EVERY_S * 1000); return; }
    let guard = 0;
    while (this.s.nextRaidAt <= now && guard++ < 6) {
      const enemy = squadPower(Math.max(1, this.s.cc * 1.6 - 1)) * (0.7 + Math.random() * 0.6);
      const win = Math.random() < winChance(this.defense(), enemy);
      const m = this.mine.s;
      let lost = 0;
      if (!win) {
        const cap = Math.max(10, this.mine.rates().income * 1800);
        lost = Math.min(cap, m.depot * 0.3 + m.cash * 0.1);
        const fromDepot = Math.min(m.depot, lost * 0.6);
        m.depot -= fromDepot;
        m.cash = Math.max(0, m.cash - (lost - fromDepot));
      } else m.gems += 1;
      this.pushReport({ at: this.s.nextRaidAt, kind: 'defense', win, loot: 0, gems: win ? 1 : 0, lost, seen: false });
      this.s.nextRaidAt += RAID_EVERY_S * 1000 * (0.8 + Math.random() * 0.4);
    }
  }

  private pushReport(r: Report): void {
    this.s.reports.unshift(r);
    this.s.reports.length = Math.min(this.s.reports.length, 20);
    this.emit({ kind: 'report', report: r });
  }

  unseen(): Report[] { return this.s.reports.filter(r => !r.seen); }

  /** Advances every timer to `now` (wall-clock ms): finished jobs, the squad, raids on the bunker, camp respawns. */
  step(now: number): void {
    for (const j of [...this.s.jobs].sort((a, b) => a.endAt - b.endAt)) {
      if (j.endAt <= now) {
        this.s.jobs.splice(this.s.jobs.indexOf(j), 1);
        this.finish(j);
      }
    }
    this.resolveSquad(now);
    this.resolveRaid(now);
    this.refreshCamps(now);
  }
}

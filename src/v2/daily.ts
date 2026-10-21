// v2 daily missions: three tasks a day (picked by the date), each paying gems, and a chest once all three are claimed.
import type { Base } from './base.ts';
import type { Mine } from './mine.ts';

export type TaskKind = 'upgrades' | 'earn' | 'win' | 'build' | 'boost' | 'taps';
export interface Task { kind: TaskKind; target: number; progress: number; gems: number; claimed: boolean }
export interface DailySave { day: string; tasks: Task[]; base: number; chest: boolean }

const POOL: { kind: TaskKind; target: (lvl: number) => number; gems: number }[] = [
  { kind: 'upgrades', target: l => 20 + l * 5, gems: 4 },
  { kind: 'earn', target: () => 0, gems: 4 },
  { kind: 'win', target: () => 2, gems: 6 },
  { kind: 'build', target: () => 1, gems: 5 },
  { kind: 'boost', target: () => 3, gems: 3 },
  { kind: 'taps', target: () => 40, gems: 3 },
];

export const TASK_TEXT: Record<TaskKind, (t: string) => string> = {
  upgrades: t => `שדרגו ${t} רמות`,
  earn: t => `הרוויחו ${t} מטבעות`,
  win: t => `נצחו ב-${t} קרבות`,
  build: t => `סיימו ${t} בניות`,
  boost: t => `הפעילו ${t} זירוזים`,
  taps: t => `לחצו ${t} פעמים על המכרה`,
};

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

export class Daily {
  s: DailySave;
  private mine: Mine;
  private base: Base;

  constructor(mine: Mine, base: Base, save: DailySave | undefined, now: number) {
    this.mine = mine;
    this.base = base;
    this.s = save ?? { day: '', tasks: [], base: 0, chest: false };
    this.roll(now);
    mine.s.daily = this.s;
    mine.on(e => {
      if (e.kind === 'upgrade') this.add('upgrades', e.levels);
      else if (e.kind === 'boost') this.add('boost', 1);
      else if (e.kind === 'sell') this.add('earn', e.amount);
    });
    base.on(e => {
      if (e.kind === 'jobDone') this.add('build', 1);
      else if (e.kind === 'report' && e.report.kind === 'attack' && e.report.win) this.add('win', 1);
    });
  }

  /** New tasks when the date changed (targets scale with the mine's income). */
  roll(now: number): void {
    const d = today(now);
    if (this.s.day === d) return;
    let h = 0;
    for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const picks = [...POOL].sort((a, b) => ((h ^ (a.gems * 2654435761)) % 97) - ((h ^ (b.gems * 2654435761)) % 97)).slice(0, 3);
    const lvl = Math.max(...this.mine.s.floors.map(f => f.lvl));
    const income = Math.max(1, this.mine.rates().income);
    this.s = {
      day: d, chest: false, base: this.mine.s.stats.taps,
      tasks: picks.map(p => ({ kind: p.kind, target: p.kind === 'earn' ? Math.ceil(income * 1200) : p.target(Math.floor(lvl / 10)), progress: 0, gems: p.gems, claimed: false })),
    };
    this.mine.s.daily = this.s;
  }

  private add(kind: TaskKind, n: number): void {
    for (const t of this.s.tasks) if (t.kind === kind && !t.claimed) t.progress = Math.min(t.target, t.progress + n);
  }

  update(now: number): void {
    this.roll(now);
    const taps = this.s.tasks.find(t => t.kind === 'taps');
    if (taps && !taps.claimed) taps.progress = Math.min(taps.target, this.mine.s.stats.taps - this.s.base);
  }

  claimable(): number { return this.s.tasks.filter(t => !t.claimed && t.progress >= t.target).length + (this.chestReady() ? 1 : 0); }
  chestReady(): boolean { return !this.s.chest && this.s.tasks.length > 0 && this.s.tasks.every(t => t.claimed); }

  claim(i: number): boolean {
    const t = this.s.tasks[i];
    if (!t || t.claimed || t.progress < t.target) return false;
    t.claimed = true;
    this.mine.s.gems += t.gems;
    return true;
  }

  /** The daily chest: 15 gems and half an hour of income. */
  chestCoins(): number { return Math.max(100, this.mine.rates().income * 1800); }
  openChest(): boolean {
    if (!this.chestReady()) return false;
    this.s.chest = true;
    this.mine.s.gems += 15;
    this.mine.s.cash += this.chestCoins();
    void this.base;
    return true;
  }
}

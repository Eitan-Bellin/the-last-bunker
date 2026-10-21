// v2 goal chain: one short goal at a time in a bar above the bottom tabs ("upgrade the recycler to 10", "dig floor 3"),
// each paying gems and a little income when claimed. A fixed opening sequence teaches the game; after it the goals
// are made on the fly from the state of the mine (the next milestone of the lowest stage, the next Command Center…).
import type { Base } from './base.ts';
import { FLOORS, MILESTONES } from './econ.ts';
import type { Mine, StageId } from './mine.ts';

export type GoalSpec =
  | { k: 'lvl'; id: StageId; n: number }
  | { k: 'mgr'; id: StageId }
  | { k: 'floors'; n: number }
  | { k: 'cc'; n: number }
  | { k: 'armory' | 'walls'; n: number }
  | { k: 'win'; n: number }
  | { k: 'boost'; n: number }
  | { k: 'drops'; n: number };

export interface GoalsSave { idx: number; cur: GoalSpec | null; wins: number; boosts: number; drops: number }

/** Where tapping an unfinished goal takes the player. */
export type GoalGo = StageId | 'dig' | 'command' | 'raids' | 'none';

/** Stage names with the definite article (for "upgrade the …"). */
const THE_FLOOR = ['הממחזרת', 'החווה', 'ההידרופוניקה', 'מעבדת הזרעים', 'מפעל הרכיבים', 'בית היציקה', 'מרכז הנתונים', 'הכור'];
const theName = (id: StageId) => (id === 'elev' ? 'המעלית' : id === 'market' ? 'השוק' : THE_FLOOR[id]);
const forName = (id: StageId) => (id === 'elev' ? 'למעלית' : id === 'market' ? 'לשוק' : `ל${THE_FLOOR[id].startsWith('ה') ? THE_FLOOR[id].slice(1) : THE_FLOOR[id]}`);

const L = (id: StageId, n: number): GoalSpec => ({ k: 'lvl', id, n });
const M = (id: StageId): GoalSpec => ({ k: 'mgr', id });
const F = (n: number): GoalSpec => ({ k: 'floors', n });
const C = (n: number): GoalSpec => ({ k: 'cc', n });

/** The opening: teaches tapping, managers, digging, the Command Center and raids, in the order they matter. */
function opening(): GoalSpec[] {
  const g: GoalSpec[] = [
    L(0, 5), F(2), M('elev'), M('market'), M(0), L(0, 10), L('elev', 5), L('market', 5), L(1, 10), M(1),
    C(2), F(3), L('elev', 15), L('market', 15), { k: 'boost', n: 1 }, L(0, 25), { k: 'drops', n: 1 },
    { k: 'armory', n: 2 }, { k: 'win', n: 1 }, M(2), L(2, 10), C(3), F(4), L(1, 25), L(3, 10), M(3),
    { k: 'walls', n: 2 }, { k: 'win', n: 3 }, L('elev', 30), L('market', 30), L(0, 50),
  ];
  // floors 5-8: each needs the next Command Center, then a manager, its first milestone and pushes on the others
  for (let n = 4; n < FLOORS.length; n++) {
    g.push(C(n), F(n + 1), M(n), L(n, 10), L(n - 1, 25), L('elev', 10 * n + 10), L('market', 10 * n + 10),
      { k: 'armory', n: n }, { k: 'win', n: 2 * n }, L(n - 2, 50));
  }
  return g;
}
const OPENING = opening();

export const goalText = (g: GoalSpec): string => {
  switch (g.k) {
    case 'lvl': return `שדרגו את ${theName(g.id)} לרמה ${g.n}`;
    case 'mgr': return `שכרו מנהל ${forName(g.id)}`;
    case 'floors': return `חפרו קומה ${g.n}: ${FLOORS[g.n - 1]?.name ?? ''}`;
    case 'cc': return `שדרגו את המפקדה לרמה ${g.n}`;
    case 'armory': return `שדרגו את הנשקייה לרמה ${g.n}`;
    case 'walls': return `שדרגו את החומות לרמה ${g.n}`;
    case 'win': return g.n === 1 ? 'נצחו בקרב ראשון' : `נצחו ב-${g.n} קרבות`;
    case 'boost': return 'הפעילו זירוז של מנהל (⚡ בעיגול שלו)';
    case 'drops': return 'תפסו ארגז אספקה שנופל מהשמיים';
  }
};

export class Goals {
  s: GoalsSave;
  private mine: Mine;
  private base: Base;

  constructor(mine: Mine, base: Base, save: GoalsSave | undefined) {
    this.mine = mine;
    this.base = base;
    this.s = save ?? { idx: 0, cur: null, wins: 0, boosts: 0, drops: 0 };
    mine.s.goals = this.s;
    mine.on(e => { if (e.kind === 'boost') this.s.boosts++; });
    base.on(e => { if (e.kind === 'report' && e.report.kind === 'attack' && e.report.win) this.s.wins++; });
    this.s.cur ??= this.make();
  }

  /** A caught supply drop (counted for the drop goal). */
  dropCaught(): void { this.s.drops++; }

  get cur(): GoalSpec { return (this.s.cur ??= this.make()); }

  /** [progress, target] of the current goal. */
  progress(): [number, number] {
    const g = this.cur;
    const m = this.mine.s;
    const b = this.base.s;
    switch (g.k) {
      case 'lvl': return [Math.min(g.n, this.stageLvl(g.id)), g.n];
      case 'mgr': return [this.hasStage(g.id) && this.mine.stage(g.id).mgr ? 1 : 0, 1];
      case 'floors': return [Math.min(g.n, m.floors.length), g.n];
      case 'cc': return [Math.min(g.n, b.cc), g.n];
      case 'armory': return [Math.min(g.n, b.armory), g.n];
      case 'walls': return [Math.min(g.n, b.walls), g.n];
      case 'win': return [Math.min(g.n, this.s.wins), g.n];
      case 'boost': return [Math.min(g.n, this.s.boosts), g.n];
      case 'drops': return [Math.min(g.n, this.s.drops), g.n];
    }
  }

  done(): boolean { const [p, t] = this.progress(); return p >= t; }

  /** Gems for the current goal (bigger goals pay more). */
  gems(): number {
    const g = this.cur;
    if (g.k === 'cc' || g.k === 'floors') return 3;
    if (g.k === 'win' || g.k === 'mgr') return 2;
    if (g.k === 'lvl' && g.n >= 50) return 3;
    return this.s.idx < 6 ? 1 : 2;
  }

  /** Coins for the current goal: a minute of income (a fixed sum at the very start). */
  coins(): number { return Math.max(60, this.mine.rates().income * 60); }

  go(): GoalGo {
    const g = this.cur;
    if (g.k === 'lvl' || g.k === 'mgr') return g.id;
    if (g.k === 'floors') return 'dig';
    if (g.k === 'cc' || g.k === 'armory' || g.k === 'walls') return 'command';
    if (g.k === 'win') return 'raids';
    if (g.k === 'boost') { const i = this.mine.s.floors.findIndex(f => f.mgr); return i >= 0 ? i : this.mine.s.elev.mgr ? 'elev' : 'none'; }
    return 'none';
  }

  /** Pays the goal and moves to the next one; returns what was paid. */
  claim(): { gems: number; coins: number } | null {
    if (!this.done()) return null;
    const pay = { gems: this.gems(), coins: this.coins() };
    this.mine.s.gems += pay.gems;
    this.mine.s.cash += pay.coins;
    this.s.idx++;
    this.s.cur = this.make();
    return pay;
  }

  private hasStage(id: StageId): boolean { return typeof id !== 'number' || id < this.mine.s.floors.length; }
  private stageLvl(id: StageId): number { return this.hasStage(id) ? this.mine.stage(id).lvl : 0; }

  /** The goal at the current index: the next opening goal not already met, else one made from the mine's state. */
  private make(): GoalSpec {
    while (this.s.idx < OPENING.length) {
      const g = OPENING[this.s.idx];
      this.s.cur = g;
      if (!this.done()) return g;
      this.s.idx++; // already reached (a returning player, or done out of order): skip it unpaid
    }
    return this.endless();
  }

  /** After the opening: the next milestone of the stage furthest behind, sometimes the next Command Center or a raid. */
  private endless(): GoalSpec {
    const b = this.base.s;
    const k = this.s.idx % 5;
    if (k === 2 && this.base.ccCost() !== null) return C(b.cc + 1);
    if (k === 4) return { k: 'win', n: this.s.wins + 2 };
    const cap = this.mine.levelCap();
    const ids: StageId[] = ['elev', 'market', ...this.mine.s.floors.map((_, i) => i)];
    const open = ids.filter(id => this.mine.stage(id).lvl < cap);
    if (!open.length) return b.cc < 10 ? C(b.cc + 1) : { k: 'win', n: this.s.wins + 3 };
    const id = open.reduce((a, c) => (this.mine.stage(c).lvl < this.mine.stage(a).lvl ? c : a));
    const lvl = this.mine.stage(id).lvl;
    const n = Math.min(cap, MILESTONES.find(x => x > lvl) ?? lvl + 25);
    return L(id, n);
  }
}

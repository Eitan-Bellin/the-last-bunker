import type { GameState, SurvivorState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { SeededRandom } from '../core/Random';
import { bus } from '../core/EventBus';
import type { PopulationSystem } from './PopulationSystem';
import { STAT_KEYS } from './PopulationSystem';
import { specMax, specOf } from '../data/specializations';
import { effectiveLevel, getDef } from '../data/buildingDefs';
import { graduateStatOf, roomChildGrowth } from '../data/roomEffects'; // [plan4:BL-4]

/** How often the bunker's social life is checked, and its pace. */
const CHECK_SECONDS = 30;
const COUPLE_CHANCE = 0.015;
const CHILD_CHANCE = 0.025;
const CHILD_COOLDOWN = 2400;
const MAX_CHILDREN = 2;
/** A birth is a bunker-wide celebration, not a production line: at most one per this many seconds. */
const BIRTH_GAP = 900;
/** A child grows up after this much play time (halved by family suites). */
export const CHILDHOOD_SECONDS = 2400;

export interface CoupleFormed {
  a: SurvivorState;
  b: SurvivorState;
}

export interface ChildBorn {
  child: SurvivorState;
  parents: [SurvivorState, SurvivorState];
}

/**
 * Sprint 6 families: residents who are happy and settled pair up, couples raise children,
 * and children grow into adults who inherit their parents' strengths.
 */
export class FamilySystem {
  private acc = 0;

  private sm: StateManager;
  private rng: SeededRandom;
  private population: PopulationSystem;

  constructor(sm: StateManager, rng: SeededRandom, population: PopulationSystem) {
    this.sm = sm;
    this.rng = rng;
    this.population = population;
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < CHECK_SECONDS) return;
    const span = this.acc;
    this.acc = 0;
    const state = this.sm.state;
    if (state.survivors.length < 2) return;
    this.accrueSchool(state, span);
    this.growUp(state);
    // Long offline stretches roll the dice a few times, not once per 30 s.
    const rolls = Math.min(4, Math.max(1, Math.floor(span / CHECK_SECONDS)));
    for (let i = 0; i < rolls; i++) {
      this.tryCouple();
      this.tryChild();
    }
  }

  private adults(state: GameState): SurvivorState[] {
    return state.survivors.filter(s => !s.child);
  }

  /** Growing-up speed: the family suites' role or the best nursery, whichever is faster (1 with neither). */
  childGrowth(state: GameState): number {
    return Math.max(specMax(state, 'childGrowth', 'quarters'), roomChildGrowth(state)); // [plan4:BL-4]
  }

  /** [plan4:BL-4] Children in a school (a room with graduateStat) log their hours; a nursery only holds them. */
  private accrueSchool(state: GameState, seconds: number): void {
    const inSchool = (s: SurvivorState): boolean => {
      if (!s.child || !s.assignedBuildingId) return false;
      const b = state.buildings.find(x => x.id === s.assignedBuildingId);
      return !!b && graduateStatOf(b) > 0 && effectiveLevel(b) > 0;
    };
    if (!state.survivors.some(inSchool)) return;
    this.sm.applyDelta({
      path: 'survivors',
      value: state.survivors.map(s => (inSchool(s) ? { ...s, schoolTime: (s.schoolTime ?? 0) + seconds } : s)),
    });
  }

  /** [plan4:BL-4] Stat points a graduate gets: 0 unless they spent 60% of their childhood in school, then the school's graduateStat (an academy role raises it). */
  private graduateBonus(state: GameState, s: SurvivorState): number {
    const age = state.stats.totalPlayTime - (s.bornAt ?? state.stats.totalPlayTime);
    if ((s.schoolTime ?? 0) <= 0 || (s.schoolTime ?? 0) < 0.6 * age) return 0;
    let best = 0;
    for (const b of state.buildings) {
      if (b.isConstructing && b.level === 1) continue;
      const base = graduateStatOf(b);
      if (base > 0 && getDef(b.type)) best = Math.max(best, base, specOf(b)?.graduateStat ?? 0);
    }
    return best;
  }

  /** 0..1 how far a child is from growing up. */
  growthOf(state: GameState, s: SurvivorState): number {
    if (!s.child) return 1;
    const age = state.stats.totalPlayTime - (s.bornAt ?? state.stats.totalPlayTime);
    return Math.min(1, (age * this.childGrowth(state)) / CHILDHOOD_SECONDS);
  }

  private growUp(state: GameState): void {
    const grown = state.survivors.filter(s => s.child && this.growthOf(state, s) >= 1);
    if (!grown.length) return;
    const ids = new Set(grown.map(g => g.id));
    this.sm.applyDelta({
      path: 'survivors',
      value: this.sm.state.survivors.map(s => {
        if (!ids.has(s.id)) return s;
        const grownUp = { ...s, child: false, happiness: Math.max(s.happiness, 70) };
        // [plan4:BL-4] A schooled child grows up a little better: +1 (or more) in a random stat, up to 10.
        const bonus = this.graduateBonus(this.sm.state, s);
        if (bonus > 0) {
          const stat = this.rng.pick(STAT_KEYS);
          grownUp.stats = { ...s.stats, [stat]: Math.max(s.stats[stat], Math.min(10, s.stats[stat] + bonus)) };
        }
        return grownUp;
      }),
    });
    for (const g of grown) bus.emit('family:grownUp', this.sm.state.survivors.find(s => s.id === g.id));
  }

  private tryCouple(): void {
    const state = this.sm.state;
    const singles = this.adults(state).filter(s => !s.partnerId && s.happiness > 55 && s.health > 40 && !s.isOnMission);
    if (singles.length < 2 || !this.rng.chance(COUPLE_CHANCE * Math.min(3, singles.length / 2))) return;
    const [a, b] = this.rng.shuffle(singles);
    // Siblings and parent/child never pair.
    if (this.related(a, b)) return;
    this.sm.applyDelta({
      path: 'survivors',
      value: state.survivors.map(s => (s.id === a.id ? { ...s, partnerId: b.id } : s.id === b.id ? { ...s, partnerId: a.id } : s)),
    });
    const now = state.stats.totalPlayTime;
    this.sm.applyDelta({ path: 'moraleBuffs', value: [...this.sm.state.moraleBuffs, { value: 4, expiresAt: now + 300 }] });
    bus.emit('family:couple', { a, b } satisfies CoupleFormed);
  }

  private related(a: SurvivorState, b: SurvivorState): boolean {
    const pa = a.parentIds ?? [], pb = b.parentIds ?? [];
    return pa.includes(b.id) || pb.includes(a.id) || pa.some(p => pb.includes(p));
  }

  private tryChild(): void {
    const state = this.sm.state;
    if (state.survivors.length >= state.maxPopulation) return;
    if (state.resources.food.amount < state.resources.food.cap * 0.4 || state.resources.water.amount < state.resources.water.cap * 0.4) return;
    const now = state.stats.totalPlayTime;
    const lastBirth = state.survivors.reduce((m, s) => Math.max(m, s.lastChildAt ?? -1e9), -1e9);
    if (now - lastBirth < BIRTH_GAP) return;
    const seen = new Set<string>();
    for (const a of this.adults(state)) {
      if (!a.partnerId || seen.has(a.id)) continue;
      const b = state.survivors.find(s => s.id === a.partnerId);
      if (!b) continue;
      seen.add(a.id).add(b.id);
      if (a.happiness < 60 || b.happiness < 60 || a.isOnMission || b.isOnMission) continue;
      if (now - Math.max(a.lastChildAt ?? -1e9, b.lastChildAt ?? -1e9) < CHILD_COOLDOWN) continue;
      const kids = state.survivors.filter(s => s.parentIds?.includes(a.id) && s.parentIds?.includes(b.id)).length;
      if (kids >= MAX_CHILDREN || !this.rng.chance(CHILD_CHANCE)) continue;
      const child = this.makeChild(a, b, now);
      this.sm.applyDelta({
        path: 'survivors',
        value: this.sm.state.survivors.map(s => (s.id === a.id || s.id === b.id ? { ...s, lastChildAt: now } : s)),
      });
      this.population.addSurvivor(this.sm, child);
      bus.emit('family:child', { child, parents: [a, b] } satisfies ChildBorn);
      return;
    }
  }

  /** A newborn: the parents' average strengths, give or take. */
  private makeChild(a: SurvivorState, b: SurvivorState, now: number): SurvivorState {
    const base = this.population.createSurvivor(this.rng);
    const stats = { ...base.stats };
    for (const k of STAT_KEYS) stats[k] = Math.max(1, Math.min(12, Math.round((a.stats[k] + b.stats[k]) / 2 + this.rng.nextInt(-1, 1))));
    const traits = this.rng.chance(0.5) ? [this.rng.pick([...a.traits, ...b.traits, ...base.traits].filter(Boolean))].filter(Boolean) : base.traits;
    return { ...base, stats, traits, child: true, bornAt: now, parentIds: [a.id, b.id], happiness: 80, partnerId: null };
  }

  /** Clears a dead resident out of their partner's record. */
  forget(deadId: string): void {
    const state = this.sm.state;
    if (!state.survivors.some(s => s.partnerId === deadId)) return;
    const now = state.stats.totalPlayTime;
    this.sm.applyDelta({ path: 'survivors', value: state.survivors.map(s => (s.partnerId === deadId ? { ...s, partnerId: null } : s)) });
    this.sm.applyDelta({ path: 'moraleBuffs', value: [...this.sm.state.moraleBuffs, { value: -10, expiresAt: now + 600 }] });
  }

  /** Families for the family tree: couples (or single parents) with their children, oldest first. */
  families(state: GameState): { parents: SurvivorState[]; children: SurvivorState[] }[] {
    const out: { parents: SurvivorState[]; children: SurvivorState[] }[] = [];
    const done = new Set<string>();
    for (const s of state.survivors) {
      if (done.has(s.id) || s.child) continue;
      const partner = s.partnerId ? state.survivors.find(p => p.id === s.partnerId) : undefined;
      const parents = partner ? [s, partner] : [s];
      const children = state.survivors.filter(c => c.parentIds?.some(p => parents.some(x => x.id === p)));
      if (!partner && children.length === 0) continue;
      parents.forEach(p => done.add(p.id));
      out.push({ parents, children });
    }
    return out;
  }
}

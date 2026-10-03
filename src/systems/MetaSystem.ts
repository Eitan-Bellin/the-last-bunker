import type { GameState, ResourceType } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { ResourceSystem } from './ResourceSystem';
import { bus } from '../core/EventBus';
import { ACHIEVEMENTS } from '../data/achievements';
import { PRESTIGE_UPGRADES, upgradeCost } from '../data/prestige';
import { MAX_FLOORS } from '../data/zones';
import { hasFeature } from './ResearchSystem';

/** Project Genesis gate (the design's "big decision"): the research plus a grown, era-3 bunker. */
export const GENESIS_MIN_SURVIVORS = 40;
export const GENESIS_MIN_ERA = 3;
/** The raw score is divided down so a first rebirth pays about 150–300 against a ~3,900 shop. */
const REBIRTH_DIVISOR = 4;

export interface RebirthRequirement {
  /** i18n key of the line, e.g. 'genesis.reqSurvivors'. */
  key: string;
  met: boolean;
  current: number;
  target: number;
}

/** Achievements and the Project Genesis (prestige) upgrade shop. */
export class MetaSystem {
  private sm: StateManager;
  private resources: ResourceSystem;

  constructor(sm: StateManager, resources: ResourceSystem) {
    this.sm = sm;
    this.resources = resources;
  }

  checkAchievements(): void {
    const state = this.sm.state;
    for (const a of ACHIEVEMENTS) {
      if (state.achievements.includes(a.id) || !a.check(state)) continue;
      this.sm.applyDelta({ path: 'achievements', value: [...this.sm.state.achievements, a.id] });
      this.resources.gain(this.sm, a.reward);
      bus.emit('achievement', a.id);
    }
  }

  /** Every condition for Genesis, so the UI can show exactly what is still missing. */
  rebirthRequirements(state: GameState): RebirthRequirement[] {
    const research = hasFeature(state, 'genesis');
    const pop = state.survivors.length;
    const era = state.era ?? 0;
    return [
      { key: 'genesis.reqResearch', met: research, current: research ? 1 : 0, target: 1 },
      { key: 'genesis.reqSurvivors', met: pop >= GENESIS_MIN_SURVIVORS, current: pop, target: GENESIS_MIN_SURVIVORS },
      { key: 'genesis.reqEra', met: era >= GENESIS_MIN_ERA, current: era, target: GENESIS_MIN_ERA },
    ];
  }

  canRebirth(state: GameState): boolean {
    return this.rebirthRequirements(state).every(r => r.met);
  }

  /** Isotope-7 awarded for a rebirth now; grows with everything achieved this run. */
  rebirthGain(state: GameState): number {
    const researched = Object.values(state.research).filter(r => r.completed).length;
    const explored = state.explorationMap.filter(h => h.explored).length;
    const raw = 5 + Math.sqrt(state.stats.totalFoodProduced / 20) + state.survivors.length * 2 + researched * 2 + explored
      + state.buildings.reduce((s, b) => s + b.level, 0);
    return Math.floor((raw / REBIRTH_DIVISOR) * (1 + 0.1 * state.prestige.rebirthCount));
  }

  /**
   * Head start for a new run (called once from GameEngine's new-game setup):
   * Quick Start stock (120 materials + 30 scrap per level) and Pre-dug levels.
   */
  applyStartBonuses(sm: StateManager): void {
    const up = sm.state.prestige.upgrades;
    const quick = up['quickStart'] ?? 0;
    if (quick > 0) {
      const bonus: Partial<Record<ResourceType, number>> = { materials: 120 * quick, scrap: 30 * quick };
      for (const [r, v] of Object.entries(bonus) as [ResourceType, number][]) {
        sm.applyDelta({ path: `resources.${r}.amount`, value: sm.state.resources[r].amount + v });
      }
    }
    const dug = up['preDug'] ?? 0;
    if (dug > 0) sm.applyDelta({ path: 'currentFloors', value: Math.min(MAX_FLOORS, sm.state.currentFloors + dug) });
  }

  isotope(state: GameState): number {
    return Math.floor(state.resources.isotope7.amount);
  }

  upgradeLevel(state: GameState, id: string): number {
    return state.prestige.upgrades[id] ?? 0;
  }

  buy(id: string): boolean {
    const state = this.sm.state;
    const def = PRESTIGE_UPGRADES.find(u => u.id === id);
    if (!def) return false;
    const level = this.upgradeLevel(state, id);
    if (level >= def.maxLevel) return false;
    const cost = upgradeCost(def, level);
    if (this.isotope(state) < cost) return false;
    this.sm.applyDelta({ path: 'resources.isotope7.amount', value: state.resources.isotope7.amount - cost });
    this.sm.applyDelta({ path: 'prestige.upgrades', value: { ...state.prestige.upgrades, [id]: level + 1 } });
    return true;
  }
}

import type { GameState, SurvivorState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import { masteryMultiplier } from '../data/mastery';
import type { BuildingSystem } from './BuildingSystem';
import type { PopulationSystem } from './PopulationSystem';

/** Diggers are stored like a project crew (assignedBuildingId = 'p_dig'), so they count as on duty everywhere. */
export const DIG_CREW = 'p_dig';

/**
 * [Long game] Digging a new floor takes time and a crew (long-game plan, pillar A): the cost is paid when the dig starts
 * (BuildingSystem.dig), then the crew works the rock, online and while away. People on the dig are off their rooms,
 * so every dig is also a choice about who is spared.
 */
export class DigSystem {
  private sm: StateManager;
  private buildings: BuildingSystem;
  private population: PopulationSystem;

  constructor(sm: StateManager, buildings: BuildingSystem, population: PopulationSystem) {
    this.sm = sm;
    this.buildings = buildings;
    this.population = population;
  }

  active(state: GameState): boolean {
    return state.longGame?.dig.floor != null;
  }

  crew(state: GameState): SurvivorState[] {
    return state.survivors.filter(s => s.assignedBuildingId === DIG_CREW);
  }

  /** How many people the running dig wants. */
  wanted(state: GameState): number {
    const d = state.longGame?.dig;
    if (!d || d.floor == null) return 0;
    // The crew size is set by the floor being dug (currentFloors has not grown yet).
    return this.buildings.digCrew(state);
  }

  /** 0..1 of full speed: the share of the crew on site, times their mastery. */
  speed(state: GameState): number {
    const want = this.wanted(state);
    if (want <= 0) return 0;
    const w = this.crew(state).filter(s => !s.isOnMission && !s.child);
    if (w.length === 0) return 0;
    return Math.min(1, w.length / want) * masteryMultiplier(w);
  }

  /** Seconds left at the current speed (Infinity with no crew). */
  eta(state: GameState): number {
    const d = state.longGame?.dig;
    const sp = this.speed(state);
    if (!d || d.floor == null || sp <= 0) return Infinity;
    return Math.max(0, d.total - d.progress) / sp;
  }

  assign(survivorId: string): boolean {
    const state = this.sm.state;
    const s = state.survivors.find(x => x.id === survivorId);
    if (!s || s.child || s.isOnMission || !this.active(state)) return false;
    if (s.assignedBuildingId === DIG_CREW) return true;
    if (this.crew(state).length >= this.wanted(state)) return false;
    this.population.assignSurvivorToBuilding(this.sm, survivorId, null);
    this.sm.applyDelta({ path: 'survivors', value: this.sm.state.survivors.map(x => (x.id === survivorId ? { ...x, assignedBuildingId: DIG_CREW } : x)) });
    return true;
  }

  unassign(survivorId: string): void {
    this.population.assignSurvivorToBuilding(this.sm, survivorId, null);
  }

  /** Fills the crew: idle adults first, then the least skilled workers of the fullest rooms. */
  autoStaff(): number {
    let added = 0;
    for (let guard = 0; guard < 8; guard++) {
      const state = this.sm.state;
      if (!this.active(state) || this.crew(state).length >= this.wanted(state)) break;
      const free = state.survivors.filter(s => !s.child && !s.isOnMission && s.assignedBuildingId !== DIG_CREW);
      const idle = free.find(s => !s.assignedBuildingId);
      const pick = idle ?? free
        .filter(s => s.assignedBuildingId && !s.assignedBuildingId.startsWith('p_') && !s.assignedBuildingId.startsWith('r_'))
        .sort((a, b) => {
          const ra = state.buildings.find(x => x.id === a.assignedBuildingId)?.assignedSurvivorIds.length ?? 0;
          const rb = state.buildings.find(x => x.id === b.assignedBuildingId)?.assignedSurvivorIds.length ?? 0;
          return rb - ra || a.level - b.level;
        })[0];
      if (!pick || !this.assign(pick.id)) break;
      added++;
    }
    return added;
  }

  update(dt: number): void {
    const state = this.sm.state;
    const d = state.longGame?.dig;
    if (!d || d.floor == null) return;
    const progress = d.progress + dt * this.speed(state);
    if (progress < d.total) {
      this.sm.applyDelta({ path: 'longGame.dig.progress', value: progress });
      return;
    }
    // Done: the crew goes back to idle (the player or the bot puts them back to work) and the floor opens.
    this.sm.applyDeltas([
      { path: 'longGame.dig', value: { floor: null, paid: [], progress: 0, total: 0, crew: [] } },
      { path: 'survivors', value: state.survivors.map(s => (s.assignedBuildingId === DIG_CREW ? { ...s, assignedBuildingId: null } : s)) },
    ]);
    this.buildings.finishDig(this.sm);
    bus.emit('dig:done', d.floor);
  }
}

import type { GameState, SurvivorState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { DigState } from '../core/state/longGame';
import { bus } from '../core/EventBus';
import { masteryMultiplier } from '../data/mastery';
import { getDef } from '../data/buildingDefs';
import { digAt, digSlotCount } from '../data/wings';
import type { BuildingSystem } from './BuildingSystem';
import type { PopulationSystem } from './PopulationSystem';

/** Diggers are stored like a project crew (assignedBuildingId = 'p_dig'), so they count as on duty everywhere. [plan4:ST-3] The second slot's crew is 'p_dig2'. */
export const DIG_CREW = 'p_dig';
export const DIG_CREW2 = 'p_dig2';
const SLOT_CREW = [DIG_CREW, DIG_CREW2];
const SLOT_PATH = ['longGame.dig', 'longGame.dig2'];

const emptyDig = (): DigState => ({ floor: null, paid: [], progress: 0, total: 0, crew: [], kind: 'floor' });

/**
 * [Long game] Digging a new floor takes time and a crew (long-game plan, pillar A): the cost is paid when the dig starts
 * (BuildingSystem.dig), then the crew works the rock, online and while away. People on the dig are off their rooms,
 * so every dig is also a choice about who is spared.
 * [plan4:ST-3] A dig is a new floor or a wing step; there are two slots (the second opens with Parallel Digging), each with its own crew.
 * Methods that take a `slot` default to the primary dig: the floor dig if one is running, else the first running dig, else slot 0.
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

  /** Is any dig running? */
  active(state: GameState): boolean {
    return this.slots(state).length > 0;
  }

  /** The slots with a dig running (a dig stays in its slot even if the research that opened it were lost). */
  slots(state: GameState): number[] {
    const out: number[] = [];
    for (let i = 0; i < Math.max(digSlotCount(state), 2); i++) if (digAt(state, i)?.floor != null) out.push(i);
    return out;
  }

  /** The dig the single-dig UI talks about: the floor dig, else the first running dig, else slot 0. */
  primary(state: GameState): number {
    const run = this.slots(state);
    return run.find(i => digAt(state, i)?.kind !== 'wing') ?? run[0] ?? 0;
  }

  /** The dig running in a slot, if any. */
  dig(state: GameState, slot: number = this.primary(state)): DigState | undefined {
    const d = digAt(state, slot);
    return d && d.floor != null ? d : undefined;
  }

  crew(state: GameState, slot: number = this.primary(state)): SurvivorState[] {
    const id = SLOT_CREW[slot] ?? DIG_CREW;
    return state.survivors.filter(s => s.assignedBuildingId === id);
  }

  /** How many people a running dig wants (0 with no dig in the slot). */
  wanted(state: GameState, slot: number = this.primary(state)): number {
    // The crew size is set by what is being dug (currentFloors has not grown yet).
    return this.buildings.crewFor(state, this.dig(state, slot));
  }

  /** 0..1 of full speed: the share of the crew on site, times their mastery. */
  speed(state: GameState, slot: number = this.primary(state)): number {
    const want = this.wanted(state, slot);
    if (want <= 0) return 0;
    const w = this.crew(state, slot).filter(s => !s.isOnMission && !s.child);
    if (w.length === 0) return 0;
    return Math.min(1, w.length / want) * masteryMultiplier(w);
  }

  /** Seconds left at the current speed (Infinity with no crew). */
  eta(state: GameState, slot: number = this.primary(state)): number {
    const d = this.dig(state, slot);
    const sp = this.speed(state, slot);
    if (!d || sp <= 0) return Infinity;
    return Math.max(0, d.total - d.progress) / sp;
  }

  /** Puts a person on a dig crew: the given slot, or the first running dig that still wants people. */
  assign(survivorId: string, slot?: number): boolean {
    const state = this.sm.state;
    const s = state.survivors.find(x => x.id === survivorId);
    if (!s || s.child || s.isOnMission || !this.active(state)) return false;
    const on = SLOT_CREW.indexOf(s.assignedBuildingId ?? '');
    if (on >= 0 && (slot === undefined || slot === on)) return true;
    const to = slot ?? this.slots(state).find(i => this.crew(state, i).length < this.wanted(state, i));
    if (to === undefined || !this.dig(state, to) || this.crew(state, to).length >= this.wanted(state, to)) return false;
    this.population.assignSurvivorToBuilding(this.sm, survivorId, null);
    this.sm.applyDelta({ path: 'survivors', value: this.sm.state.survivors.map(x => (x.id === survivorId ? { ...x, assignedBuildingId: SLOT_CREW[to] } : x)) });
    return true;
  }

  unassign(survivorId: string): void {
    this.population.assignSurvivorToBuilding(this.sm, survivorId, null);
  }

  /**
   * Fills the crews of both digs: idle adults first, then the least skilled workers of the fullest rooms. It never takes the last
   * hand from a room that keeps people alive (power, water, food).
   */
  autoStaff(): number {
    let added = 0;
    for (let guard = 0; guard < 16; guard++) {
      const state = this.sm.state;
      const slot = this.slots(state).find(i => this.crew(state, i).length < this.wanted(state, i));
      if (slot === undefined) break;
      const free = state.survivors.filter(s => !s.child && !s.isOnMission && !SLOT_CREW.includes(s.assignedBuildingId ?? ''));
      const idle = free.find(s => !s.assignedBuildingId);
      const vital = (id: string) => {
        const b = state.buildings.find(x => x.id === id);
        const prod = b ? getDef(b.type)?.production : undefined;
        return !!b && !!prod && (!!prod.power || !!prod.water || !!prod.food) && b.assignedSurvivorIds.length <= 1;
      };
      const pick = idle ?? free
        .filter(s => s.assignedBuildingId && !s.assignedBuildingId.startsWith('p_') && !s.assignedBuildingId.startsWith('r_') && !vital(s.assignedBuildingId))
        .sort((a, b) => {
          const ra = state.buildings.find(x => x.id === a.assignedBuildingId)?.assignedSurvivorIds.length ?? 0;
          const rb = state.buildings.find(x => x.id === b.assignedBuildingId)?.assignedSurvivorIds.length ?? 0;
          return rb - ra || a.level - b.level;
        })[0];
      if (!pick || !this.assign(pick.id, slot)) break;
      added++;
    }
    return added;
  }

  update(dt: number): void {
    for (const slot of this.slots(this.sm.state)) this.step(slot, dt);
  }

  private step(slot: number, dt: number): void {
    const state = this.sm.state;
    const d = this.dig(state, slot);
    if (!d) return;
    const progress = d.progress + dt * this.speed(state, slot);
    if (progress < d.total) {
      this.sm.applyDelta({ path: `${SLOT_PATH[slot]}.progress`, value: progress });
      return;
    }
    // Done: the crew goes back to idle (the player or the bot puts them back to work) and the floor (or the wing step) opens.
    const crewId = SLOT_CREW[slot];
    this.sm.applyDeltas([
      { path: SLOT_PATH[slot], value: emptyDig() },
      { path: 'survivors', value: state.survivors.map(s => (s.assignedBuildingId === crewId ? { ...s, assignedBuildingId: null } : s)) },
    ]);
    this.buildings.finishDig(this.sm, d);
    bus.emit('dig:done', d.floor, d.kind ?? 'floor', d.side);
  }
}

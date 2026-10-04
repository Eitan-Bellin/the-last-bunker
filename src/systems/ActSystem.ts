import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import { ACTS, MAX_ACT, actComplete, actOf } from '../data/acts';
import type { BuildingSystem } from './BuildingSystem';

/**
 * [Long game] Moves the run to the next Act once every goal of the current one is met and its charter projects are built.
 * A new Act raises the ceilings (room level, people, depth); the beds that were held back fill up again.
 * The last Act of the release never "completes" here: finishing it is what opens Genesis (MetaSystem).
 */
export class ActSystem {
  private sm: StateManager;
  private buildings: BuildingSystem;

  constructor(sm: StateManager, buildings: BuildingSystem) {
    this.sm = sm;
    this.buildings = buildings;
  }

  update(): void {
    const state = this.sm.state;
    const lg = state.longGame;
    if (!lg) return;
    const act = actOf(state);
    if (act.id >= MAX_ACT || !actComplete(state, act)) return;
    const next = ACTS[act.id];
    this.sm.applyDeltas([
      { path: 'longGame.meta.act', value: next.id },
      { path: 'longGame.meta.actSince', value: lg.meta.worldT },
    ]);
    this.buildings.recalculateMaxPopulation(this.sm);
    bus.emit('act:advance', next.id);
  }

  /** Release 1: Genesis needs the last Act's goals and charter done. */
  finalActComplete(): boolean {
    const state = this.sm.state;
    const act = actOf(state);
    return act.id >= MAX_ACT && actComplete(state, act);
  }
}

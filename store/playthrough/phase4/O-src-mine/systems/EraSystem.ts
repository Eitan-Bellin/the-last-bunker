import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import { ERAS, eraComplete, eraOf } from '../data/eras';

/** Moves the bunker through its eras (Remnant → Restoration → Colony → Undercity) as goals are met. */
export class EraSystem {
  private sm: StateManager;

  constructor(sm: StateManager) {
    this.sm = sm;
  }

  update(): void {
    const state = this.sm.state;
    const era = eraOf(state);
    if (era.id >= ERAS.length - 1 || !eraComplete(era, state)) return;
    this.sm.applyDelta({ path: 'era', value: era.id + 1 });
    bus.emit('era:advance', era.id + 1);
  }

  /** Silently applies every era already earned (old saves, offline progress). */
  catchUp(): void {
    for (let i = 0; i < ERAS.length; i++) {
      const era = eraOf(this.sm.state);
      if (era.id >= ERAS.length - 1 || !eraComplete(era, this.sm.state)) return;
      this.sm.applyDelta({ path: 'era', value: era.id + 1 });
    }
  }
}

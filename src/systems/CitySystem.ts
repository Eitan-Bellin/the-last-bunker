import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import { createCity, normalizeCity, revealedAreaIds, sortedIds, type CityState } from '../core/state/city';
import { pocketById, pocketStratum, strataReached } from '../data/strata';

/**
 * [world:C0] The city's discovery bookkeeping (architecture 1.5 and 4). ECONOMY-NEUTRAL: it writes only `state.city`, pays nothing, costs
 * nothing, has no tick (it is not in GameEngine.tick, so the sim's step list and every run stay identical) and the sim bot never calls it.
 * - `markSeen(id)`: the player looked at an area (clears its "new" pin). Emits `city:seen`.
 * - `find(pocketId)`: a tap on a glimpsed pocket (its stratum reached). Emits `city:found`. Cosmetic only (proposal P1: no reward by default).
 */
export class CitySystem {
  private sm: StateManager;

  constructor(sm: StateManager) {
    this.sm = sm;
  }

  /** The slice as saved (a state from an older engine path without one reads as empty). */
  city(): CityState {
    return this.sm.state.city ?? createCity();
  }

  /** Areas revealed by logic that the player has not acknowledged yet (the "new" pins). */
  unseen(): string[] {
    const seen = new Set(this.city().seen);
    return revealedAreaIds(this.sm.state).filter(id => !seen.has(id));
  }

  /** Marks areas seen. Returns how many were new. */
  markSeen(...ids: string[]): number {
    const c = this.city();
    const add = ids.filter(id => typeof id === 'string' && id && !c.seen.includes(id));
    if (!add.length) return 0;
    this.sm.applyDelta({ path: 'city', value: normalizeCity({ ...c, seen: sortedIds([...c.seen, ...add]) }) });
    for (const id of add) bus.emit('city:seen', id);
    return add.length;
  }

  /** True when the pocket exists, its stratum has been reached and it is not found yet. */
  canFind(pocketId: string): boolean {
    const p = pocketById(pocketId), s = pocketStratum(pocketId);
    if (!p || s === null) return false;
    if (!strataReached(this.sm.state.currentFloors).includes(s)) return false;
    return !this.city().found.includes(pocketId);
  }

  /** Finds a glimpsed pocket (cosmetic). Returns false when it cannot be found (unknown, not reached yet, or already found). */
  find(pocketId: string): boolean {
    if (!this.canFind(pocketId)) return false;
    const c = this.city();
    this.sm.applyDelta({ path: 'city', value: normalizeCity({ ...c, found: [...c.found, pocketId], seen: [...c.seen, pocketId] }) });
    bus.emit('city:found', pocketId);
    return true;
  }
}

import type { StateManager } from '../core/StateManager';
import type { ResourceType } from '../core/GameState';
import type { ResourceSystem } from './ResourceSystem';
import { homeTribute } from '../data/scenarios';

/** Seconds between payments (the tribute is per hour; it is paid in minute-sized parts). */
const ROUND = 60;

/**
 * [P3-5] The bunkers of earlier timelines ("homes") send a share of the current Act's income every hour (data/scenarios.ts).
 * From Act II (the first Act of a new timeline is left alone, so its opening half hour stays as tuned). Runs on world time,
 * online and while away.
 */
export class HomeSystem {
  private sm: StateManager;
  private resources: ResourceSystem;
  private clock = 0;

  constructor(sm: StateManager, resources: ResourceSystem) {
    this.sm = sm;
    this.resources = resources;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.clock < ROUND) return;
    const step = this.clock;
    this.clock = 0;
    const state = this.sm.state;
    if ((state.longGame?.meta.act ?? 1) < 2) return;
    const hourly = homeTribute(state);
    const gain: Partial<Record<ResourceType, number>> = {};
    for (const [r, v] of Object.entries(hourly) as [ResourceType, number][]) gain[r] = (v * step) / 3600;
    if (Object.keys(gain).length > 0) this.resources.gain(this.sm, gain);
  }
}

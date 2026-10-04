import { hasFeature } from './ResearchSystem';
import type { StateManager } from '../core/StateManager';
import type { GameState } from '../core/GameState';
import { bus } from '../core/EventBus';
import { difficultyOf } from '../data/difficulty';
import { SEASONS, seasonAt, seasonsActive } from '../data/seasons';

/**
 * [Long game] The threat director (long-game plan, pillar B). A meter (0-100) follows how tempting and how visible the
 * bunker is: full stores, a loud radio, a big crowd, a later Act. Raids come more often and harder as it rises, and a
 * breather after a hard hit or a death holds new raids back so a bad day never turns into a spiral.
 * It runs on world time, online and away, and also announces the turn of the seasons.
 */
export const THREAT_PER_HOUR = 6;

export function threatTarget(state: GameState): number {
  const tracked = ['food', 'water', 'materials', 'scrap', 'components', 'alloys'] as const;
  let fill = 0, n = 0;
  for (const r of tracked) {
    const res = state.resources[r];
    if (!res || !(res.cap > 0)) continue;
    fill += Math.min(1, res.amount / res.cap);
    n++;
  }
  const wealth = n ? fill / n : 0;
  let radio = 0;
  for (const b of state.buildings) if (b.type === 'radioTower' && !b.isConstructing) radio += b.level;
  const act = state.longGame?.meta.act ?? 1;
  const raw = 10 + 30 * wealth + 1.5 * radio + 0.15 * state.survivors.length + 6 * act + (state.storyFlags.includes('project:radioMast') ? 8 : 0);
  return Math.max(0, Math.min(100, raw * difficultyOf(state).threat));
}

/** Raids come this many times more often than the base pace (1 at a meter of 50). */
export function threatPace(state: GameState): number {
  // [P3] The Diplomacy doctrine keeps a fifth of the gangs away.
  return (0.5 + (state.longGame?.threat.meter ?? 50) / 100) * (hasFeature(state, 'diplomacy') ? 0.8 : 1);
}

/** Raiders' strength factor from the meter and the season. */
export function threatStrength(state: GameState): number {
  const meter = state.longGame?.threat.meter ?? 50;
  const season = seasonsActive(state) ? seasonAt(state).def.raid : 1;
  return (0.85 + 0.3 * meter / 100) * season;
}

/** True while a breather holds new raids back. */
export function inBreather(state: GameState): boolean {
  const t = state.longGame?.threat;
  return !!t && t.breatherUntil > (state.longGame?.meta.worldT ?? 0);
}

export class ThreatSystem {
  private sm: StateManager;
  private clock = 0;

  constructor(sm: StateManager) {
    this.sm = sm;
    // A hard hit or a death: the meter drops and the raiders keep away for a while.
    bus.on('raid:resolved', (r: unknown) => {
      const key = (r as { key: string }).key;
      if (key === 'loseBig' || key === 'loseSmall') this.breather(key === 'loseBig' ? 1 : 0.5);
    });
    bus.on('survivor:died', () => this.breather(1));
  }

  /** Starts (or extends) a breather of the difficulty's length, times `share`. */
  breather(share: number): void {
    const lg = this.sm.state.longGame;
    if (!lg) return;
    const until = lg.meta.worldT + difficultyOf(this.sm.state).breatherHours * 3600 * share;
    this.sm.applyDeltas([
      { path: 'longGame.threat.breatherUntil', value: Math.max(lg.threat.breatherUntil, until) },
      { path: 'longGame.threat.meter', value: Math.max(0, lg.threat.meter - 20 * share) },
    ]);
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.clock < 60) return;
    const step = this.clock;
    this.clock = 0;
    const state = this.sm.state;
    const lg = state.longGame;
    if (!lg) return;
    const target = threatTarget(state);
    const meter = lg.threat.meter;
    const move = Math.sign(target - meter) * Math.min(Math.abs(target - meter), THREAT_PER_HOUR * step / 3600);
    if (Math.abs(move) > 0.01) this.sm.applyDelta({ path: 'longGame.threat.meter', value: meter + move });
    // The turn of the seasons (told once, when the world clock crosses into a new one).
    if (seasonsActive(state)) {
      const { index } = seasonAt(state);
      if (index !== lg.season.index) {
        this.sm.applyDelta({ path: 'longGame.season.index', value: index });
        bus.emit('season:change', SEASONS[index].id);
      }
    }
  }
}

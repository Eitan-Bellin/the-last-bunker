import type { DisasterKind, GameState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { SeededRandom } from '../core/Random';
import { DAY_MS, isQuiet } from './DeathSystem';
import { raidStrength, type EventSystem } from './EventSystem';
import type { IncidentSystem } from './IncidentSystem';
import type { DeathSystem } from './DeathSystem';

/**
 * [Danger C4] Danger while the player is away, in its soft version: half the usual frequency, people get hurt
 * (never below 15 health), nothing is destroyed, and nobody dies unless a danger has gone unanswered for more than
 * 24 hours (and then at most one death per return). The safety net: a player who sleeps through a raid
 * comes back to a hurt bunker, not a graveyard.
 */
const AWAY_FREQUENCY = 0.5;
/** Raids and disasters a day for an engaged player, before the away discount. */
const RAIDS_PER_DAY: Record<number, number> = { 2: 1, 3: 2 };
const DISASTERS_PER_DAY = 1 / 2.5;

export interface AwayDangerReport {
  raids: number;
  raidsLost: number;
  disasters: DisasterKind[];
  hurt: number;
  died: string[];
}

interface AwayEvent {
  /** Seconds after leaving. */
  t: number;
  type: 'raid' | 'disaster';
  /** A danger that was already ticking when the player left (not a new roll). */
  pending: boolean;
  disasterId?: string;
}

export class AwayDanger {
  private sm: StateManager;
  private rng: SeededRandom;
  private events: EventSystem;
  private incidents: IncidentSystem;
  private death: DeathSystem;

  constructor(sm: StateManager, rng: SeededRandom, events: EventSystem, incidents: IncidentSystem, death: DeathSystem) {
    this.death = death;
    this.sm = sm;
    this.rng = rng;
    this.events = events;
    this.incidents = incidents;
  }

  /** Plays out `seconds` of absence. Returns what happened (for the welcome-back screen). */
  run(seconds: number): AwayDangerReport {
    const report: AwayDangerReport = { raids: 0, raidsLost: 0, disasters: [], hurt: 0, died: [] };
    const state0 = this.sm.state;
    if (seconds < 60 || (state0.era ?? 0) < 2 && !state0.danger.raid && state0.danger.disasters.length === 0) return report;
    const end = Date.now();
    const start = end - seconds * 1000;
    const play = state0.stats.totalPlayTime;
    const list: AwayEvent[] = [];

    // What was already counting down when the player left comes due first.
    if (state0.danger.raid) {
      const left = Math.max(0, state0.danger.raid.hitAt - play);
      if (left <= seconds) list.push({ t: left, type: 'raid', pending: true });
    }
    for (const dz of state0.danger.disasters) {
      const left = Math.max(0, dz.deadline - play);
      if (left <= seconds) list.push({ t: left, type: 'disaster', pending: true, disasterId: dz.id });
    }
    // New rolls, at half the usual pace.
    if ((state0.era ?? 0) >= 2) {
      const raidRate = (RAIDS_PER_DAY[Math.min(3, state0.era)] ?? 1) * AWAY_FREQUENCY / 86400;
      const disasterRate = DISASTERS_PER_DAY * AWAY_FREQUENCY / 86400;
      for (const [rate, type] of [[raidRate, 'raid'], [disasterRate, 'disaster']] as const) {
        if (state0.danger.raid && type === 'raid') continue;
        if (state0.danger.disasters.length > 0 && type === 'disaster') continue;
        let t = 0;
        for (;;) {
          t += -Math.log(1 - this.rng.next()) / rate;
          if (t >= seconds) break;
          list.push({ t, type, pending: false });
          if (list.length > 6) break;
        }
      }
    }
    list.sort((a, b) => a.t - b.t);

    let deathBudget = 1;
    for (const ev of list) {
      const state = this.sm.state;
      const when = start + ev.t * 1000;
      // The breather after a death holds for new rolls too.
      if (!ev.pending && (isQuiet(state, when) || (state.danger.disastersPausedUntil > when && ev.type === 'disaster'))) continue;
      if (this.sm.state.survivors.length === 0) break;
      // Unanswered danger: from the first one nobody reacted to, a day later deaths become possible.
      const ignored = this.sm.state.danger.ignoredSince;
      const allowDeath = deathBudget > 0 && ignored !== null && when - ignored > DAY_MS;
      if (ignored === null) this.sm.applyDelta({ path: 'danger', value: { ...this.sm.state.danger, ignoredSince: when } });
      if (ev.type === 'raid') {
        if (!this.sm.state.danger.raid) {
          const raid = { hitAt: play, strength: raidStrength(this.sm.state, this.rng.next()) };
          this.sm.applyDelta({ path: 'danger', value: { ...this.sm.state.danger, raid } });
        }
        const res = this.events.resolveRaid('fight', { soft: true, allowDeath });
        if (!res) continue;
        report.raids++;
        if (res.key === 'loseSmall' || res.key === 'loseBig') report.raidsLost++;
        report.hurt += res.injured.length;
        if (res.died) { report.died.push(res.died); deathBudget--; }
        else if (allowDeath && deathBudget > 0 && res.injured.length > 0 && this.ignoredToll()) { deathBudget--; this.lose(report); }
      } else {
        const dz = ev.disasterId ? this.sm.state.danger.disasters.find(x => x.id === ev.disasterId) : this.rollDisaster(this.sm.state);
        if (!dz) continue;
        const res = this.incidents.strike(dz, 'soft', allowDeath);
        report.disasters.push(res.kind);
        report.hurt += res.hurt;
        if (res.died.length) { report.died.push(...res.died); deathBudget -= res.died.length; }
        else if (allowDeath && deathBudget > 0 && res.hurt > 0 && this.ignoredToll()) { deathBudget--; this.lose(report); }
      }
    }
    return report;
  }

  /** After more than a day of ignored danger, an injury sometimes turns fatal (most of the time). */
  private ignoredToll(): boolean {
    return this.rng.chance(0.65);
  }

  /** The most badly hurt adult does not recover. */
  private lose(report: AwayDangerReport): void {
    const weakest = [...this.sm.state.survivors].filter(s => !s.child).sort((a, b) => a.health - b.health)[0];
    if (weakest && this.death.kill(weakest.id)) report.died.push(weakest.name);
  }

  /** A random disaster the bunker could suffer, without ever putting it on the countdown. */
  private rollDisaster(state: GameState): { id: string; kind: DisasterKind; buildingId: string | null; startedAt: number; deadline: number } | null {
    const pool = this.incidents.disasterPool(state);
    if (pool.length === 0) return null;
    const kinds = [...new Set(pool.map(p => p.kind))];
    const kind = this.rng.pick(kinds);
    const room = this.rng.pick(pool.filter(p => p.kind === kind));
    return { id: 'away', kind, buildingId: room.buildingId, startedAt: 0, deadline: 0 };
  }
}

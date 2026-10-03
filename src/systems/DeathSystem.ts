import type { Fallen, GameState, Grief, SurvivorState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';

/**
 * [Danger C5] Meaningful death: every loss is remembered (memorial modal, plaque at the entrance), mourned
 * (morale), and followed by a breather (no bad events for 6 hours; no disasters for a day after more than
 * 3 deaths in a day) so one death can never snowball into a spiral.
 * Times here are wall-clock ms (a "day" is a real day, so it counts the hours the player is away too).
 */
export const DAY_MS = 86_400_000;
export const QUIET_MS = 6 * 3_600_000;
/** More deaths than this within a day pauses every disaster for a day. */
const DEATHS_PER_DAY_LIMIT = 3;
/** Mood: the whole bunker, and the family of the one who died. */
const MOURN_ALL = -15;
const MOURN_FAMILY = -30;
const CEREMONY_BONUS = 5;
/** The shared meal of a ceremony. */
export const CEREMONY_COST = { food: 25 };

/** After a death (or while the day's deaths are too many) nothing new goes wrong. */
export function isQuiet(state: GameState, now = Date.now()): boolean {
  return (state.danger?.quietUntil ?? 0) > now;
}

export function disastersPaused(state: GameState, now = Date.now()): boolean {
  return (state.danger?.disastersPausedUntil ?? 0) > now;
}

/** The mourning (or ceremony glow) a survivor feels right now. */
export function griefFor(state: GameState, id: string, now = Date.now()): number {
  let sum = 0;
  for (const g of state.danger?.grief ?? []) {
    if (now < g.from || now >= g.until) continue;
    if (g.ids && !g.ids.includes(id)) continue;
    sum += g.value;
  }
  return sum;
}

export class DeathSystem {
  private sm: StateManager;

  constructor(sm: StateManager) {
    this.sm = sm;
  }

  /** Takes a living person out of the bunker (the same bookkeeping as starving to death) and announces it. */
  kill(id: string): boolean {
    const state = this.sm.state;
    const s = state.survivors.find(x => x.id === id);
    if (!s) return false;
    this.sm.applyDelta({ path: 'survivors', value: state.survivors.filter(x => x.id !== id) });
    this.sm.applyDelta({
      path: 'buildings',
      value: this.sm.state.buildings.map(b => (b.assignedSurvivorIds.includes(id)
        ? { ...b, assignedSurvivorIds: b.assignedSurvivorIds.filter(x => x !== id) } : b)),
    });
    bus.emit('survivor:died', s);
    return true;
  }

  /** Called for every death (raid, disaster, hunger): the memorial, the mourning and the breather. */
  onDeath(s: SurvivorState, now = Date.now()): void {
    const state = this.sm.state;
    const d = state.danger;
    const job = s.assignedBuildingId ? state.buildings.find(b => b.id === s.assignedBuildingId)?.type ?? null : null;
    const fallen: Fallen = {
      id: s.id, name: s.name, portraitIndex: s.portraitIndex, portrait: s.portrait, child: s.child, job, level: s.level, at: now,
    };
    const times = [...d.deathTimes.filter(t => now - t < DAY_MS), now];
    // A first answer before the player chooses: the long mourning of simply carrying on.
    const grief: Grief[] = [...d.grief.filter(g => g.until > now), { value: MOURN_ALL, from: now, until: now + 2 * DAY_MS, ids: null, tag: s.id }];
    const family = state.survivors
      .filter(o => o.id === s.partnerId || (s.parentIds ?? []).includes(o.id) || (o.parentIds ?? []).includes(s.id))
      .map(o => o.id);
    if (family.length) grief.push({ value: MOURN_FAMILY, from: now, until: now + 3 * DAY_MS, ids: family });
    this.sm.applyDelta({
      path: 'danger',
      value: {
        ...d,
        fallen: [...d.fallen, fallen].slice(-24),
        memorialQueue: [...d.memorialQueue, fallen],
        deathTimes: times,
        grief,
        quietUntil: Math.max(d.quietUntil, now + QUIET_MS),
        disastersPausedUntil: times.length > DEATHS_PER_DAY_LIMIT ? Math.max(d.disastersPausedUntil, now + DAY_MS) : d.disastersPausedUntil,
      },
    });
    bus.emit('danger:death', fallen);
  }

  /** The player's answer to a memorial: a ceremony (shorter mourning, then a lift) or carrying on. */
  answerMemorial(choice: 'ceremony' | 'carryOn', resources: { spend: (sm: StateManager, c: Record<string, number>) => boolean }): boolean {
    const d = this.sm.state.danger;
    const f = d.memorialQueue[0];
    if (!f) return false;
    let grief = d.grief;
    if (choice === 'ceremony') {
      if (!resources.spend(this.sm, CEREMONY_COST)) return false;
      grief = d.grief.map(g => (g.tag === f.id ? { ...g, until: g.from + DAY_MS } : g));
      const base = d.grief.find(g => g.tag === f.id);
      const from = base ? base.from + DAY_MS : f.at + DAY_MS;
      grief = [...grief, { value: CEREMONY_BONUS, from, until: from + DAY_MS, ids: null }];
    }
    this.sm.applyDelta({ path: 'danger', value: { ...this.sm.state.danger, grief, memorialQueue: d.memorialQueue.slice(1) } });
    return true;
  }
}

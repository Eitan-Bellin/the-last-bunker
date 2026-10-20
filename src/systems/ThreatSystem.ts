import { hasMutator } from '../data/mutators';
import { lawThreat } from '../data/laws';
import { doctrineRaidPace, hasFeature } from './ResearchSystem';
import { scenarioOf } from '../data/scenarios';
import type { StateManager } from '../core/StateManager';
import type { GameState, ResourceType } from '../core/GameState';
import { bus } from '../core/EventBus';
import { difficultyOf } from '../data/difficulty';
import { SEASONS, seasonAt, seasonsActive } from '../data/seasons';
import { designOf } from '../data/projects';
import { ACT_CURRENCY } from '../data/pricing'; // [phase4b]
import { OVERFLOW_CREDITS } from '../data/resources'; // [phase4b]

/**
 * [Long game] The threat director (long-game plan, pillar B). A meter (0-100) follows how tempting and how visible the
 * bunker is: full stores, a loud radio, a big crowd, a later Act. Raids come more often and harder as it rises, and a
 * breather after a hard hit or a death holds new raids back so a bad day never turns into a spiral.
 * It runs on world time, online and away, and also announces the turn of the seasons.
 */
export const THREAT_PER_HOUR = 6;

// ---- [phase4b] Exposure (C4): the meter the player sees, its four drivers and two levers ----

/** The goods whose fill makes the bunker look rich (the "stores" driver). */
const TRACKED = ['food', 'water', 'materials', 'scrap', 'components', 'alloys'] as const;
/** "Hide the stores": the share of each store's cap kept in sight; what is above it is handed to the Act's work. */
export const HIDE_STORES_SHARE = 0.6;
/** Exposure each lever takes off on top of what it removes from its own driver. */
export const HIDE_STORES_CUT = 6;
export const RADIO_SILENCE_CUT = 4;
/** Outposts held out there show the bunker: this much each, at most OUTPOST_MAX of them counted. */
const OUTPOST_EXPOSURE = 1.5;
const OUTPOST_MAX = 8;
/** Hidden goods come back as the Act's currency at this share of their worth (worth = resources.ts overflowCredits). */
const HIDE_RATE = 0.5;

/** The four drivers the player can see and move, the rest (the Act, laws, doctrines), the levers' cut and the total: all on the meter's scale. */
export interface ExposureDrivers {
  stores: number;
  radio: number;
  people: number;
  outposts: number;
  /** The Act, laws, doctrines, keystones, the scenario: the part no lever moves. */
  rest: number;
  /** What the two levers take off (0 or negative). */
  levers: number;
  total: number;
}

function heldOutposts(state: GameState): number {
  const list = (state.longGame?.world.outposts ?? []) as { readyAt?: number }[];
  const now = state.longGame?.meta.worldT ?? 0;
  return list.filter(o => (o?.readyAt ?? 0) <= now).length;
}

/**
 * The threat meter's target split into its drivers. `levers` overrides the bunker's own lever settings, so the Exposure sheet can say
 * "in your bunker: from 62 to 48" before the tap.
 */
export function exposureDrivers(state: GameState, levers: { hideStores?: boolean; radioSilence?: boolean } = {}): ExposureDrivers {
  const t = state.longGame?.threat;
  const hide = levers.hideStores ?? !!t?.hideStores;
  const silent = levers.radioSilence ?? !!t?.radioSilence;
  const cur = actCurrency(state);
  let fill = 0, n = 0;
  for (const r of TRACKED) {
    const res = state.resources[r];
    if (!res || !(res.cap > 0)) continue;
    // The Act's own currency is never hidden (it is what the Act is built with), so it counts in full.
    fill += Math.min(hide && r !== cur ? HIDE_STORES_SHARE : 1, res.amount / res.cap);
    n++;
  }
  const wealth = n ? fill / n : 0;
  let radioLv = 0;
  for (const b of state.buildings) if (b.type === 'radioTower' && !b.isConstructing) radioLv += b.level;
  const act = state.longGame?.meta.act ?? 1;
  const mast = state.storyFlags.includes('project:radioMast') ? (designOf(state, 'radioMast') === 'b' ? 4 : 8) : 0;
  const stores = 30 * wealth;
  const radio = silent ? 0 : 1.5 * radioLv + mast;
  const people = 0.15 * state.survivors.length;
  const outposts = OUTPOST_EXPOSURE * Math.min(OUTPOST_MAX, heldOutposts(state));
  const bastion = (state.prestige.upgrades['ksBastion'] ? 15 : 0) - (hasMutator(state, 'restless') ? 20 : 0); // [P5] keystone, mutator
  // [P2-1] The surface doctrines: Isolationism hides the bunker (-25%), Expansionism shows it (+10).
  const doctrine = (hasFeature(state, 'expansionism') ? 10 : 0) + (scenarioOf(state).threat ?? 0); // [P3-5] the scenario
  const rest = 10 + 6 * act + lawThreat(state) - bastion + doctrine;
  const cut = -((hide ? HIDE_STORES_CUT : 0) + (silent ? RADIO_SILENCE_CUT : 0));
  const k = difficultyOf(state).threat * (hasFeature(state, 'isolationism') ? 0.75 : 1);
  const total = Math.max(0, Math.min(100, (stores + radio + people + outposts + rest + cut) * k));
  return { stores: stores * k, radio: radio * k, people: people * k, outposts: outposts * k, rest: rest * k, levers: cut * k, total };
}

export function threatTarget(state: GameState): number {
  return exposureDrivers(state).total;
}

/** [phase4b] The Act's currency (materials in Acts I-II, then the tier-2 good the Act brings). */
export function actCurrency(state: GameState): ResourceType {
  const act = state.longGame?.meta.act ?? 1;
  return ACT_CURRENCY[Math.min(ACT_CURRENCY.length - 1, Math.max(1, act))];
}

/**
 * [phase4b] "Hide the stores": every tracked store above HIDE_STORES_SHARE of its cap (not the Act's own currency) is moved out of sight
 * and handed to the Act's work, coming back as the Act's currency at HIDE_RATE of its worth (the phase-3 Act rooms turn spare basics
 * into it the same way). Returns what would be moved and what it becomes.
 */
export function hideStoresTrim(state: GameState): { from: Partial<Record<ResourceType, number>>; to: ResourceType; gained: number } {
  const to = actCurrency(state);
  const from: Partial<Record<ResourceType, number>> = {};
  let gained = 0;
  const worthTo = OVERFLOW_CREDITS[to] ?? 0;
  for (const r of TRACKED) {
    if (r === to) continue;
    const res = state.resources[r];
    if (!res || !(res.cap > 0)) continue;
    const extra = Math.floor(res.amount - res.cap * HIDE_STORES_SHARE);
    if (extra < 1) continue;
    from[r] = extra;
    if (worthTo > 0) gained += extra * (OVERFLOW_CREDITS[r] ?? 0) / worthTo * HIDE_RATE;
  }
  return { from, to, gained: Math.floor(gained) };
}

/** [phase4b] True while the radio is silent: nobody new finds the door. */
export function radioSilent(state: GameState): boolean {
  return !!state.longGame?.threat.radioSilence;
}

/** Raids come this many times more often than the base pace (1 at a meter of 50). */
export function threatPace(state: GameState): number {
  // [P3] The Diplomacy doctrine keeps a fifth of the gangs away.
  return (0.5 + (state.longGame?.threat.meter ?? 50) / 100) * (hasFeature(state, 'diplomacy') ? 0.8 : 1) * doctrineRaidPace(state); // [phase4] Fortress: rarer
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

  /** [phase4b] The two Exposure levers. Hiding the stores trims them at once, so the player sees the goods move. */
  setHideStores(on: boolean): void {
    if (!this.sm.state.longGame) return;
    this.sm.applyDelta({ path: 'longGame.threat.hideStores', value: on });
    if (on) this.trim();
  }

  setRadioSilence(on: boolean): void {
    if (!this.sm.state.longGame) return;
    this.sm.applyDelta({ path: 'longGame.threat.radioSilence', value: on });
  }

  /** [phase4b] Moves what is above the hidden share into the Act's currency (see hideStoresTrim). */
  private trim(): void {
    const state = this.sm.state;
    const t = hideStoresTrim(state);
    const deltas: { path: string; value: number }[] = [];
    for (const [r, v] of Object.entries(t.from) as [ResourceType, number][]) deltas.push({ path: `resources.${r}.amount`, value: state.resources[r].amount - v });
    const to = state.resources[t.to];
    if (to && t.gained > 0) deltas.push({ path: `resources.${t.to}.amount`, value: Math.min(Math.max(to.cap, to.amount), to.amount + t.gained) });
    if (deltas.length) this.sm.applyDeltas(deltas);
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.clock < 60) return;
    const step = this.clock;
    this.clock = 0;
    const lg = this.sm.state.longGame;
    if (!lg) return;
    if (lg.threat.hideStores) this.trim(); // [phase4b] once a minute, online and away
    const state = this.sm.state;
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

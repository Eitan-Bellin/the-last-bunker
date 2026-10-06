import { lawArrivals, lawDefense } from '../data/laws';
import { roomSlots } from '../data/buildingDefs';
import { seasonEffects } from '../data/seasons';
import { inBreather, threatPace, threatStrength } from './ThreatSystem';
import type { RaidKind, RaidStance, Ruin } from '../core/GameState';
import { difficultyOf } from '../data/difficulty';
import type { GameState, ResourceType, SurvivorState } from '../core/GameState';
import { projectArrivalSpeed } from '../data/projects'; // [LateGame B1]
import type { StateManager } from '../core/StateManager';
import type { SeededRandom } from '../core/Random';
import type { ResourceSystem } from './ResourceSystem';
import type { PopulationSystem } from './PopulationSystem';
import { bus } from '../core/EventBus';
import type { ExplorationSystem } from './ExplorationSystem';
import type { IncidentSystem } from './IncidentSystem';
import { effectiveLevel, getDef, workforceMultiplier } from '../data/buildingDefs';
import { hasFeature } from './ResearchSystem';
import { incidentBlocks } from '../data/incidents';
import { specMax, specTotal } from '../data/specializations';
import { projectDefense } from '../data/projects'; // [Danger C1] the Wall project
import { isQuiet, type DeathSystem } from './DeathSystem';

type Resources = Partial<Record<ResourceType, number>>;

export interface EventChoice {
  key: string;
  cost?: Resources;
  /** Free beds this choice needs (true = 1). */
  requiresSpace?: boolean | number;
}

export interface EventResult {
  key: string;
  gains?: Resources;
  /** People hurt by the outcome (a lost raid). */
  injured?: { name: string; damage: number }[];
}

interface Ctx {
  sm: StateManager;
  rng: SeededRandom;
  resources: ResourceSystem;
  population: PopulationSystem;
  exploration?: ExplorationSystem;
  incidents?: IncidentSystem;
  death?: DeathSystem;
}

/** A number from an event's saved data (older saves may lack the newer fields). */
function num(data: Record<string, unknown>, key: string, fallback: number): number {
  const v = data[key];
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/** A share of a resource's storage cap, so offers keep their weight as the bunker grows (S7). */
function capShare(state: GameState, r: ResourceType, share: number, min = 1): number {
  const cap = state.resources[r]?.cap;
  return Math.max(min, Math.round((typeof cap === 'number' && isFinite(cap) ? cap : 100) * share));
}

/** Drops zero entries so a cost row never shows "0 scrap". */
function nonZero(res: Resources): Resources {
  return Object.fromEntries(Object.entries(res).filter(([, v]) => (v ?? 0) > 0)) as Resources;
}

interface EventDef {
  id: string;
  weight: number;
  once?: boolean;
  condition?: (state: GameState) => boolean;
  init?: (state: GameState, ctx: Ctx) => Record<string, unknown>;
  choices: (data: Record<string, unknown>) => EventChoice[];
  resolve: (choice: string, data: Record<string, unknown>, ctx: Ctx) => EventResult;
  /** The choice made for the player when nobody answers in time (default: the last one that is possible, usually "decline"). */
  fallback?: string;
  /** Never decided for the player (it waits however long it takes). */
  noExpire?: boolean;
}

/** [Long game] Seconds of play an event waits in the Decision Inbox before its safe default is taken. */
export const EVENT_DEADLINE = 600;

/** When the event on the table expires (play time), or null if it never does. */
export function eventDeadline(ev: { id: string; at?: number } | null | undefined): number | null {
  if (!ev || ev.at === undefined || EVENTS.find(e => e.id === ev.id)?.noExpire) return null;
  return ev.at + EVENT_DEADLINE;
}

/** What expiring an event did (for the inbox toast). */
export interface EventExpired { id: string; key: string; data: Record<string, unknown>; result: EventResult }

const MORALE_BUFF_DURATION = 300;

function addMoraleBuff(ctx: Ctx, value: number): void {
  const now = ctx.sm.state.stats.totalPlayTime;
  ctx.sm.applyDelta({ path: 'moraleBuffs', value: [...ctx.sm.state.moraleBuffs, { value, expiresAt: now + MORALE_BUFF_DURATION }] });
}

function updateSurvivor(ctx: Ctx, id: string, patch: Partial<SurvivorState>): void {
  ctx.sm.applyDelta({
    path: 'survivors',
    value: ctx.sm.state.survivors.map(s => (s.id === id ? { ...s, ...patch } : s)),
  });
}

const EVENTS: EventDef[] = [
  {
    // Nobody left: a small group finds the open door. Guarantees the game can always go on.
    id: 'refugees',
    weight: 1000,
    condition: s => s.survivors.length === 0 && s.maxPopulation > 0,
    init: (_s, ctx) => {
      const group = [ctx.population.createSurvivor(ctx.rng), ctx.population.createSurvivor(ctx.rng)];
      return { group, name: group[0].name, nameB: group[1].name };
    },
    choices: () => [{ key: 'welcome' }],
    resolve: (_c, data, ctx) => {
      for (const s of data.group as SurvivorState[]) ctx.population.addSurvivor(ctx.sm, s);
      const gains = { food: 40, water: 40 };
      ctx.resources.gain(ctx.sm, gains);
      return { key: 'welcome', gains };
    },
  },
  {
    id: 'wanderer',
    weight: 3,
    condition: s => s.survivors.length < s.maxPopulation,
    init: (s, ctx) => {
      const survivor = ctx.population.createSurvivor(ctx.rng);
      // A small bunker takes anyone in, hungry or not.
      return { survivor, name: survivor.name, free: s.survivors.length < 5 ? 1 : 0 };
    },
    choices: (data) => [{ key: 'accept', cost: data.free ? undefined : { food: 10 }, requiresSpace: true }, { key: 'refuse' }],
    resolve: (choice, data, ctx) => {
      if (choice === 'accept') {
        ctx.population.addSurvivor(ctx.sm, data.survivor as SurvivorState);
        return { key: 'accept' };
      }
      return { key: 'refuse' };
    },
  },
  {
    // Only through the door clock: two people who travelled together, taken in as a pair or split up.
    id: 'group',
    weight: 0,
    condition: () => false,
    init: (s, ctx) => {
      const group = [ctx.population.createSurvivor(ctx.rng), ctx.population.createSurvivor(ctx.rng)];
      return { group, name: group[0].name, nameB: group[1].name, free: s.survivors.length < 5 ? 1 : 0 };
    },
    choices: (data) => [
      { key: 'accept', cost: data.free ? undefined : { food: 20 }, requiresSpace: 2 },
      { key: 'one', cost: data.free ? undefined : { food: 10 }, requiresSpace: 1 },
      { key: 'refuse' },
    ],
    resolve: (choice, data, ctx) => {
      const group = data.group as SurvivorState[];
      if (choice === 'refuse') return { key: 'refuse' };
      for (const s of choice === 'accept' ? group : group.slice(0, 1)) ctx.population.addSurvivor(ctx.sm, s);
      return { key: choice };
    },
  },
  {
    id: 'stash',
    weight: 2,
    // 10-20% of the materials cap, and now and then some salvage too.
    init: (s, ctx) => ({
      amount: capShare(s, 'materials', 0.1 + ctx.rng.next() * 0.1, 20),
      scrap: ctx.rng.chance(0.4) ? capShare(s, 'scrap', 0.05 + ctx.rng.next() * 0.05, 5) : 0,
    }),
    choices: () => [{ key: 'take' }],
    resolve: (_c, data, ctx) => {
      const gains = nonZero({ materials: num(data, 'amount', 30), scrap: num(data, 'scrap', 0) });
      ctx.resources.gain(ctx.sm, gains);
      return { key: 'take', gains };
    },
  },
  {
    id: 'pipeLeak',
    weight: 1.5,
    condition: s => s.buildings.some(b => b.type === 'waterPump'),
    choices: () => [{ key: 'fix', cost: { materials: 10 } }, { key: 'ignore' }],
    resolve: (choice, _d, ctx) => {
      if (choice === 'fix') return { key: 'fix' };
      const lost = Math.floor(ctx.sm.state.resources.water.amount * 0.3);
      ctx.resources.gain(ctx.sm, { water: -lost });
      return { key: 'ignore', gains: { water: -lost } };
    },
  },
  {
    id: 'argument',
    weight: 1.5,
    condition: s => s.survivors.length >= 2,
    init: (s, ctx) => {
      const [a, b] = ctx.rng.shuffle(s.survivors);
      return { nameA: a.name, nameB: b.name };
    },
    choices: () => [{ key: 'mediate', cost: { food: 5 } }, { key: 'ignore' }],
    resolve: (choice, _d, ctx) => {
      addMoraleBuff(ctx, choice === 'mediate' ? 8 : -8);
      return { key: choice };
    },
  },
  {
    id: 'trader',
    weight: 1.5,
    // Deals sized to the bunker's storage; each visit also brings one rare offer: salvage or a blueprint.
    init: (s, ctx) => ({
      food: capShare(s, 'food', 0.12, 15),
      mat: capShare(s, 'materials', 0.15 + ctx.rng.next() * 0.05, 30),
      water: capShare(s, 'water', 0.12, 15),
      med: capShare(s, 'medicine', 0.2, 5),
      rare: ctx.rng.chance(0.5) ? 'scrap' : 'blueprint',
      scrap: capShare(s, 'scrap', 0.1 + ctx.rng.next() * 0.1, 20),
      bpMat: capShare(s, 'materials', 0.35, 80),
      bpScrap: capShare(s, 'scrap', 0.15, 30),
    }),
    choices: (data) => [
      { key: 'tradeFood', cost: { food: num(data, 'food', 15) } },
      { key: 'tradeWater', cost: { water: num(data, 'water', 15) } },
      ...(data.rare === 'scrap'
        ? [{ key: 'tradeScrap', cost: { food: num(data, 'food', 15), water: num(data, 'water', 15) } }]
        : data.rare === 'blueprint' ? [{ key: 'tradeBlueprint', cost: { materials: num(data, 'bpMat', 80), scrap: num(data, 'bpScrap', 30) } }] : []),
      { key: 'decline' },
    ],
    resolve: (choice, data, ctx) => {
      let gains: Resources | undefined;
      if (choice === 'tradeFood') gains = { materials: num(data, 'mat', 30) };
      if (choice === 'tradeWater') gains = { medicine: num(data, 'med', 5) };
      if (choice === 'tradeScrap') gains = { scrap: num(data, 'scrap', 20) };
      if (choice === 'tradeBlueprint') gains = { blueprints: 1 };
      if (gains) ctx.resources.gain(ctx.sm, gains);
      return { key: choice, gains };
    },
  },
  {
    id: 'powerSurge',
    weight: 1,
    condition: s => s.buildings.some(b => b.type === 'generator' && !b.isConstructing),
    choices: () => [{ key: 'shutdown' }, { key: 'risk' }],
    resolve: (choice, _d, ctx) => {
      if (choice === 'shutdown') {
        const lost = ctx.sm.state.resources.power.amount;
        ctx.resources.gain(ctx.sm, { power: -lost });
        return { key: 'shutdown', gains: { power: -Math.floor(lost) } };
      }
      if (ctx.rng.chance(0.5)) {
        const lost = Math.min(20, Math.floor(ctx.sm.state.resources.materials.amount));
        ctx.resources.gain(ctx.sm, { materials: -lost });
        return { key: 'riskBad', gains: { materials: -lost } };
      }
      return { key: 'riskGood' };
    },
  },
  {
    id: 'sickness',
    weight: 1,
    condition: s => s.survivors.length >= 1,
    init: (s, ctx) => {
      const v = ctx.rng.pick(s.survivors);
      return { survivorId: v.id, name: v.name };
    },
    choices: () => [{ key: 'medicine', cost: { medicine: 3 } }, { key: 'rest' }],
    resolve: (choice, data, ctx) => {
      const sv = ctx.sm.state.survivors.find(s => s.id === data.survivorId);
      if (!sv) return { key: 'gone' };
      if (choice === 'medicine') {
        updateSurvivor(ctx, sv.id, { health: 100 });
        return { key: 'medicine' };
      }
      updateSurvivor(ctx, sv.id, { health: Math.max(1, sv.health - 30) });
      return { key: 'rest' };
    },
  },
  {
    id: 'radioSignal',
    weight: 4,
    once: true,
    condition: s => s.stats.totalPlayTime > 600,
    choices: () => [{ key: 'listen' }],
    resolve: (_c, _d, ctx) => {
      const gains = { knowledge: 5 };
      ctx.resources.gain(ctx.sm, gains);
      return { key: 'listen', gains };
    },
  },
  {
    id: 'radioSignal2',
    weight: 5,
    once: true,
    condition: s => s.storyFlags.includes('event:radioSignal') && s.buildings.some(b => b.type === 'radioTower' && !b.isConstructing),
    choices: () => [{ key: 'reply' }],
    resolve: (_c, _d, ctx) => {
      const gains = { knowledge: 20, blueprints: 1 };
      ctx.resources.gain(ctx.sm, gains);
      return { key: 'reply', gains };
    },
  },
  {
    id: 'radioSignal3',
    weight: 5,
    once: true,
    condition: s => s.storyFlags.includes('event:radioSignal2') && s.stats.totalPlayTime > 3600,
    choices: () => [{ key: 'mark' }],
    resolve: (_c, _d, ctx) => {
      ctx.exploration?.revealPoi('genesisVault', 6);
      return { key: 'mark' };
    },
  },
  {
    // [Danger C1] Raids now come on their own clock with a warning (see raidTick); this stays so an older save's open dialog still resolves.
    id: 'raiders',
    weight: 1.3,
    noExpire: true,
    condition: () => false,
    init: (s, ctx) => {
      const strength = Math.round(12 + s.buildings.length * 2 + s.stats.totalPlayTime / 900 + ctx.rng.nextInt(0, 8));
      // The toll is paid in what hurts: food and scrap (S7), so paying is a real cost, not spare materials.
      const tributeFood = Math.max(10, Math.round(s.resources.food.amount * 0.2));
      const tributeScrap = Math.round(s.resources.scrap.amount * 0.2);
      return { strength, tributeFood, tributeScrap };
    },
    choices: (data) => [
      { key: 'fight' },
      { key: 'tribute', cost: nonZero({ food: num(data, 'tributeFood', 10), scrap: num(data, 'tributeScrap', 0) }) },
    ],
    resolve: (choice, data, ctx) => {
      if (choice === 'tribute') return { key: 'tribute' };
      const state = ctx.sm.state;
      const defense = bunkerDefense(state);
      const strength = num(data, 'strength', 20);
      if (ctx.rng.next() < defense / (defense + strength)) {
        const gains = { scrap: capShare(state, 'scrap', 0.08 + ctx.rng.next() * 0.08, 10) };
        ctx.resources.gain(ctx.sm, gains);
        return { key: 'fightWin', gains };
      }
      // A lost fight: a quarter of the scrap is gone, one or two defenders are hurt and some raiders stay inside.
      const lostScrap = Math.floor(state.resources.scrap.amount * 0.25);
      if (lostScrap > 0) ctx.resources.gain(ctx.sm, { scrap: -lostScrap });
      const defenders = ctx.rng.shuffle(state.survivors.filter(s => !s.isOnMission && !s.child));
      const injured: { name: string; damage: number }[] = [];
      for (const v of defenders.slice(0, ctx.rng.chance(0.5) ? 2 : 1)) {
        const health = Math.max(5, v.health - 35);
        updateSurvivor(ctx, v.id, { health });
        injured.push({ name: v.name, damage: Math.round(v.health - health) });
      }
      ctx.incidents?.startBreach();
      return { key: 'fightLose', gains: lostScrap > 0 ? { scrap: -lostScrap } : undefined, injured };
    },
  },
];

/**
 * [P2] Defense in three parts. Walls: the door, the fortified-door research, the Wall and other projects, room roles.
 * Guards: armories (scaled by their crew) and whoever is posted there. Residents: everyone else pitching in.
 */
export function defenseParts(state: GameState): { walls: number; guards: number; residents: number } {
  let walls = 5, guards = 0, residents = 0;
  for (const b of state.buildings) {
    const d = getDef(b.type)?.effects?.defense;
    const level = effectiveLevel(b);
    if (!d || level <= 0 || incidentBlocks(state, b)) continue;
    guards += (d.base + d.perLevel * (level - 1)) * workforceMultiplier(state, b);
  }
  if (hasFeature(state, 'fortifiedDoor')) walls += 15;
  walls += specTotal(state, 'defense');
  if (state.storyFlags.includes('gideon:joined')) guards += 10;
  // [Danger C1] Residents help a little; whoever is posted at an armory fights much harder. The Wall adds 50.
  for (const s of state.survivors) {
    if (s.isOnMission || s.child) continue;
    residents += s.stats.strength * 0.15;
    if (s.traits.includes('paranoid')) residents += 3; // always watching the door
  }
  for (const b of state.buildings) {
    if (b.type !== 'armory' || b.isConstructing || incidentBlocks(state, b)) continue;
    for (const id of b.assignedSurvivorIds) {
      const g = state.survivors.find(s => s.id === id);
      if (g && !g.isOnMission && !g.child) guards += 2 + g.stats.strength * 0.4;
    }
  }
  walls += projectDefense(state);
  // [P3] Research and doctrines.
  if (hasFeature(state, 'tripwires')) walls += 15;
  if (hasFeature(state, 'fortress')) walls *= 1.5;
  if (hasFeature(state, 'rangers')) guards *= 1.4;
  if (hasFeature(state, 'armorPlating')) guards *= 1.2;
  if (hasFeature(state, 'militia')) residents *= 2;
  const law = lawDefense(state);
  return { walls: walls * law, guards: guards * law, residents };
}

/** [P2] How much each part counts against each kind of raider (walls stop scavengers, guards stop marauders). */
export const DEFENSE_WEIGHTS: Record<RaidKind, { walls: number; guards: number }> = {
  scavengers: { walls: 1.5, guards: 0.7 },
  marauders: { walls: 0.6, guards: 1.5 },
};
/** [P2] Sending the guards out makes them fight harder (and get hurt more). */
export const SALLY_GUARDS = 1.4;

/** Total defense; against a known kind of raider (and stance) the parts are weighted. */
export function bunkerDefense(state: GameState, kind?: RaidKind, stance: RaidStance = 'hold'): number {
  const p = defenseParts(state);
  if (!kind) return Math.round(p.walls + p.guards + p.residents);
  const w = DEFENSE_WEIGHTS[kind];
  return Math.round(p.walls * w.walls + p.guards * w.guards * (stance === 'sally' ? SALLY_GUARDS : 1) + p.residents);
}

// ---- [Danger C1] era-scaled raids: a warning, five minutes to react, and outcome tiers ----

/** Seconds between the lookout's warning and the raid reaching the door. */
export const RAID_WARNING = 300;
/** Play seconds between raids for a player online ~2 h a day: about one a day in era 2, two in era 3. */
const RAID_GAP: Record<number, number> = { 2: 7200, 3: 3600 };
/**
 * [Q11] Raids grow with the run's Act, not with the era (the era stops at 3 around day 7, so the danger used to stop
 * growing there). Per Act: play seconds between raids, and raids a day away (before the away discount).
 * A bunker from before the long game keeps its era table.
 */
const ACT_RAIDS: Record<number, { gap: number; perDay: number }> = {
  2: { gap: 7200, perDay: 1 }, 3: { gap: 6000, perDay: 1.5 }, 4: { gap: 5000, perDay: 2 },
  5: { gap: 4200, perDay: 2 }, 6: { gap: 3600, perDay: 2 }, 7: { gap: 3600, perDay: 2 },
};
const RAIDS_PER_DAY_ERA: Record<number, number> = { 2: 1, 3: 2 };

export function raidProfile(state: GameState): { gap: number; perDay: number } {
  const lg = state.longGame;
  if (lg && !lg.meta.legacy) return ACT_RAIDS[Math.min(7, Math.max(2, lg.meta.act))];
  const era = Math.min(3, Math.max(2, state.era ?? 2));
  return { gap: RAID_GAP[era] ?? 7200, perDay: RAIDS_PER_DAY_ERA[era] ?? 1 };
}

/** The plan's strength formula is tuned against the bunker's real defense (see store/sim/C-*.json). */
export const RAID_SCALE = 1.25;
/** A bigger bunker draws bigger gangs: strength grows with the crowd as 1 + pop / this. */
const RAID_CROWD = 15;
/** A defeat by this factor or more is a rout: a guard may die. */
const ROUT_RATIO = 1.5;
const GUARD_DEATH_CHANCE = 0.25;

export interface RaidResult {
  key: 'win' | 'winCaptive' | 'loseSmall' | 'loseBig' | 'tribute' | 'hidden';
  strength: number;
  defense: number;
  /** [P2] Who came and how the bunker met them. */
  kind?: RaidKind;
  stance?: RaidStance;
  /** [P2] The room wrecked in a rout (its type). */
  wrecked?: string;
  gains?: Resources;
  injured: { name: string; damage: number }[];
  /** The guard who fell in a rout (the memorial follows). */
  died?: string;
  captive?: string;
}

/** What the lookout sees coming: 10 + 9 per Act (8 per era in an older bunker) + 0.15 per resident, ±25%, scaled to the bunker, the threat and the season. */
export function raidStrength(state: GameState, roll = 0.5): number {
  const lg = state.longGame;
  // [Q11] 9 per Act in a long game (was 8 per era: flat from day 7), the old 8 per era for older bunkers.
  const level = lg && !lg.meta.legacy ? 9 * lg.meta.act : 8 * Math.max(0, state.era ?? 0);
  const base = 10 + level + 0.15 * state.survivors.length;
  return Math.max(10, Math.round(base * RAID_SCALE * (1 + state.survivors.length / RAID_CROWD) * (0.75 + roll * 0.5)
    * difficultyOf(state).raidStrength * threatStrength(state)));
}

/** [P2] Chance the raid is won against the stated strength (the scout's estimate shown to the player): 0 or 1, it is decided by the numbers. */
export function raidOdds(state: GameState, stance: RaidStance = 'hold'): number | null {
  const raid = state.danger.raid;
  if (!raid) return null;
  if (stance === 'hide') return 0;
  return bunkerDefense(state, raid.kind, stance) >= raid.strength ? 1 : 0;
}

/** The toll that sends the raiders away: a fifth of the food and scrap. */
export function raidTribute(state: GameState): Resources {
  // [P3] The Diplomacy doctrine halves the toll.
  const k = hasFeature(state, 'diplomacy') ? 0.1 : 0.2;
  return nonZero({
    food: Math.max(10, Math.round(state.resources.food.amount * k)),
    scrap: Math.round(state.resources.scrap.amount * k),
  });
}

function radioLevels(state: GameState): number {
  let n = 0;
  for (const b of state.buildings) if (b.type === 'radioTower') n += Math.max(0, effectiveLevel(b)) * (b.assignedSurvivorIds.length > 0 ? 1 : 0.5);
  return n;
}

const MIN_GAP = 180;
const MAX_GAP = 420;

/**
 * Seconds until the next knock on the door. Few people are left out there, so the small bunker fills fast
 * (the beds are the real limit) and a big one waits longer and must call them with the radio.
 * Word spreads: a happy bunker draws people, a hungry or miserable one turns them away.
 */
export function arrivalGap(state: GameState, roll = 0.5): number {
  const n = state.survivors.length;
  const base = n < 5 ? 75 : n < 10 ? 120 : n < 16 ? 300 : n < 25 ? 480 : n < 40 ? 840 : 1200;
  const radio = Math.max(0.5, 1 - radioLevels(state) * 0.08) / specMax(state, 'recruitMult', 'radioTower');
  const morale = n ? state.survivors.reduce((a, s) => a + s.happiness, 0) / n : 50;
  const mood = morale >= 70 ? 0.8 : morale < 35 ? 1.4 : 1;
  const hunger = state.resources.food.amount <= 0 || state.resources.water.amount <= 0 ? 2 : 1;
  // [LateGame B1] the field radio mast project brings newcomers faster
  // [P2] More people travel in spring, fewer in winter.
  const season = (seasonEffects(state)?.arrivals ?? 1) * (hasFeature(state, 'longRangeRadio') ? 0.8 : 1) * lawArrivals(state);
  return Math.round(base * radio * mood * hunger * season * (0.75 + roll * 0.5) / projectArrivalSpeed(state));
}

export class EventSystem {
  private ctx: Ctx;

  constructor(sm: StateManager, rng: SeededRandom, resources: ResourceSystem, population: PopulationSystem) {
    this.ctx = { sm, rng, resources, population };
  }

  setExploration(exploration: ExplorationSystem): void {
    this.ctx.exploration = exploration;
  }

  setIncidents(incidents: IncidentSystem): void {
    this.ctx.incidents = incidents;
  }

  // ---- [Danger C1] raids ----

  setDeath(death: DeathSystem): void {
    this.ctx.death = death;
  }

  private setDanger(patch: Partial<GameState['danger']>): void {
    this.ctx.sm.applyDelta({ path: 'danger', value: { ...this.ctx.sm.state.danger, ...patch } });
  }

  /** The gap to the next raid; the story shifts it (the Rust Clan raids more when treated badly). */
  private raidGap(state: GameState): number {
    const flags = state.storyFlags;
    let w = 1;
    if (flags.includes('gideon:enemy')) w *= 1.8;
    if (flags.includes('gideon:paid')) w *= 0.6;
    if (flags.includes('gideon:joined') || flags.includes('gideon:beaten')) w *= 0.35;
    const base = raidProfile(state).gap;
    // [P2] The threat director sets the pace.
    return Math.round((base / w / threatPace(state)) * (0.7 + this.ctx.rng.next() * 0.6));
  }

  scheduleRaid(): void {
    this.setDanger({ nextRaidAt: this.ctx.sm.state.stats.totalPlayTime + this.raidGap(this.ctx.sm.state) });
  }

  /** The lookout spots them: the clock starts, and the player may pay, post guards, or fight. */
  startRaid(): { hitAt: number; strength: number } {
    const state = this.ctx.sm.state;
    // [P2] The scout report: who is coming is known at once (the forecast is exact).
    const kind: RaidKind = this.ctx.rng.chance(0.5) ? 'scavengers' : 'marauders';
    const warning = RAID_WARNING + (hasFeature(state, 'watchtower') ? 180 : 0); // [P3] the watchtower sees them sooner
    const raid = { hitAt: state.stats.totalPlayTime + warning, strength: raidStrength(state, this.ctx.rng.next()), kind, stance: 'hold' as RaidStance };
    this.setDanger({ raid });
    bus.emit('raid:warning', raid);
    return raid;
  }

  private raidTick(): void {
    const state = this.ctx.sm.state;
    const d = state.danger;
    const now = state.stats.totalPlayTime;
    if ((state.era ?? 0) < 2) return;
    if (d.raid) {
      if (now >= d.raid.hitAt) this.resolveRaid('fight');
      return;
    }
    if (d.nextRaidAt === 0) {
      this.scheduleRaid();
      return;
    }
    if (now < d.nextRaidAt) return;
    // The breather after a death or a hard hit, and nobody to defend an empty bunker.
    if (isQuiet(state) || inBreather(state) || state.survivors.length < 3) {
      this.setDanger({ nextRaidAt: now + 900 });
      return;
    }
    this.startRaid();
  }

  /**
   * [P2] Raiders wreck a working room on the top levels (never beds, halls or districts): it turns into a ruin that,
   * once restored, comes back at the same level and role. Returns the room type, or null if nothing could be wrecked.
   */
  private wreckRoom(): string | null {
    const sm = this.ctx.sm;
    const state = sm.state;
    const pick = this.ctx.rng.shuffle(state.buildings.filter(b => !b.isConstructing && b.position.floor <= 1 && b.type !== 'quarters'
      && b.type !== 'elevator' && !getDef(b.type)?.effects?.maxPopulation && roomSlots(b.type) <= 3 && getDef(b.type)?.maxLevel === 10))[0];
    if (!pick) return null;
    const w = roomSlots(pick.type);
    const d = state.danger;
    const level = pick.level;
    const ruin: Ruin = {
      id: `r_raid${d.nextId}`, floor: pick.position.floor, x: pick.position.x, w, kind: 'wreck', restoresTo: pick.type, flooded: false,
      progress: 0, total: Math.round(600 + 400 * level), started: false, lore: null,
      restoresLevel: level, restoresSpec: pick.specialization ?? null,
      cost: { materials: Math.round(40 * level * level), scrap: 5 * level },
    };
    this.setDanger({ nextId: d.nextId + 1 });
    const crew = new Set(pick.assignedSurvivorIds);
    sm.applyDelta({ path: 'buildings', value: state.buildings.filter(x => x.id !== pick.id) });
    sm.applyDelta({ path: 'survivors', value: sm.state.survivors.map(s => (crew.has(s.id) ? { ...s, assignedBuildingId: null } : s)) });
    sm.applyDelta({ path: 'ruins', value: [...sm.state.ruins, ruin] });
    this.ctx.incidents?.prune();
    bus.emit('building:demolished', pick.id);
    return pick.type;
  }

  /** [P2] The player's stance for the coming raid. */
  setStance(stance: RaidStance): void {
    const raid = this.ctx.sm.state.danger.raid;
    if (raid) this.setDanger({ raid: { ...raid, stance } });
  }

  /** Seconds left before the raiders arrive (null = none coming). */
  raidEta(): number | null {
    const state = this.ctx.sm.state;
    return state.danger.raid ? Math.max(0, state.danger.raid.hitAt - state.stats.totalPlayTime) : null;
  }

  canPayTribute(): boolean {
    const state = this.ctx.sm.state;
    return !!state.danger.raid && this.ctx.resources.canAfford(state, raidTribute(state) as Record<string, number>);
  }

  /** The player's answer to the warning: pay them off. */
  payTribute(): RaidResult | null {
    if (!this.canPayTribute()) return null;
    return this.resolveRaid('tribute');
  }

  /**
   * The raiders arrive. Outcome by the gap between their strength and the defense:
   * a win (loot, sometimes a captive who joins), a small loss (1-2 hurt and a breach), or a rout
   * (as a small loss, plus a 25% chance a guard dies). `soft` is the away version: nobody dies unless
   * allowed, and no raiders stay inside.
   */
  resolveRaid(choice: 'fight' | 'tribute', opts: { soft?: boolean; allowDeath?: boolean } = {}): RaidResult | null {
    const sm = this.ctx.sm;
    const state = sm.state;
    const raid = state.danger.raid;
    if (!raid) return null;
    const strength = raid.strength;
    const stance: RaidStance = opts.soft ? 'hold' : raid.stance ?? 'hold';
    const defense = bunkerDefense(state, raid.kind, stance);
    const result: RaidResult = { key: 'tribute', strength, defense, injured: [], kind: raid.kind, stance };
    if (choice === 'fight' && stance === 'hide') {
      // Everyone below: nobody is hurt, but the raiders take their pick of the stores.
      result.key = 'hidden';
      const lost = { scrap: -Math.floor(state.resources.scrap.amount * 0.3), food: -Math.floor(state.resources.food.amount * 0.15), materials: -Math.floor(state.resources.materials.amount * 0.1) };
      this.ctx.resources.gain(sm, lost);
      result.gains = nonZero(lost);
    } else if (choice === 'tribute') {
      this.ctx.resources.spend(sm, raidTribute(state) as Record<string, number>);
      this.setDanger({ ignoredSince: null });
    } else if (defense >= strength) {
      const gains = { scrap: capShare(state, 'scrap', 0.08 + this.ctx.rng.next() * 0.08, 10) };
      this.ctx.resources.gain(sm, gains);
      result.key = 'win';
      result.gains = gains;
      if (!opts.soft && state.survivors.length < state.maxPopulation && this.ctx.rng.chance(0.15)) {
        const captive = this.ctx.population.createSurvivor(this.ctx.rng);
        this.ctx.population.addSurvivor(sm, captive);
        result.key = 'winCaptive';
        result.captive = captive.name;
      }
    } else {
      const rout = strength >= defense * ROUT_RATIO;
      result.key = rout ? 'loseBig' : 'loseSmall';
      const lostScrap = Math.floor(state.resources.scrap.amount * (opts.soft ? 0.12 : 0.25));
      if (lostScrap > 0) {
        this.ctx.resources.gain(sm, { scrap: -lostScrap });
        result.gains = { scrap: -lostScrap };
      }
      const guards = new Set(state.buildings.filter(b => b.type === 'armory').flatMap(b => b.assignedSurvivorIds));
      const defenders = this.ctx.rng.shuffle(state.survivors.filter(s => !s.isOnMission && !s.child))
        .sort((a, b) => Number(guards.has(b.id)) - Number(guards.has(a.id)));
      const floor = opts.soft ? 15 : 5;
      for (const v of defenders.slice(0, (this.ctx.rng.chance(0.5) ? 2 : 1) + (stance === 'sally' ? 1 : 0))) {
        const health = Math.max(floor, v.health - (opts.soft ? 25 : 35));
        updateSurvivor(this.ctx, v.id, { health });
        result.injured.push({ name: v.name, damage: Math.round(v.health - health) });
      }
      const mayDie = (opts.allowDeath ?? !opts.soft) && !isQuiet(sm.state) && !!this.ctx.death;
      if (rout && mayDie && defenders.length && this.ctx.rng.chance(GUARD_DEATH_CHANCE)) {
        const fallen = defenders[0];
        if (this.ctx.death!.kill(fallen.id, 'raid')) result.died = fallen.name;
      }
      if (!opts.soft) this.ctx.incidents?.startBreach();
      // [P2] A rout wrecks a room by the door (it comes back at its old level once restored).
      if (rout && !opts.soft && difficultyOf(state).roomDamage && !hasFeature(state, 'bunkerDoctrine')) result.wrecked = this.wreckRoom() ?? undefined;
    }
    this.setDanger({ raid: null });
    this.scheduleRaid();
    if (!opts.soft) bus.emit('raid:resolved', result); // the away version is told on the welcome screen instead
    return result;
  }

  update(): void {
    this.raidTick(); // [Danger C1]
    this.expireTick();
    const state = this.ctx.sm.state;
    // An empty bunker doesn't wait for the usual gap.
    if (!state.activeEvent && state.survivors.length === 0 && state.nextEventAt > state.stats.totalPlayTime + 45) {
      this.ctx.sm.applyDelta({ path: 'nextEventAt', value: state.stats.totalPlayTime + 45 });
    }
    // Newcomers keep coming on their own clock while there are free beds; a full bunker makes them wait.
    const now = state.stats.totalPlayTime;
    if (state.survivors.length >= state.maxPopulation) {
      if (state.nextArrivalAt < now + 20) this.ctx.sm.applyDelta({ path: 'nextArrivalAt', value: now + 20 });
    } else if (!state.activeEvent && state.survivors.length > 0 && now >= state.nextArrivalAt) {
      // Now and then a pair travels together, once there are beds for both.
      const pair = state.survivors.length >= 6 && state.maxPopulation - state.survivors.length >= 2 && this.ctx.rng.chance(0.2);
      const def = EVENTS.find(e => e.id === (pair ? 'group' : 'wanderer'))!;
      const data = { ...def.init!(state, this.ctx), knock: 1 };
      this.ctx.sm.applyDelta({ path: 'activeEvent', value: { id: def.id, data, at: now } });
      bus.emit('event:triggered', def.id);
      return;
    }
    if (state.activeEvent || state.stats.totalPlayTime < state.nextEventAt) return;

    const candidates = EVENTS.filter(e =>
      (!e.once || !state.storyFlags.includes(`event:${e.id}`)) && (!e.condition || e.condition(state)),
    );
    if (candidates.length === 0) {
      this.scheduleNext();
      return;
    }

    const flags = state.storyFlags;
    const weightOf = (e: EventDef) => {
      let w = e.weight + (e.id === 'wanderer' ? radioLevels(state) * 2 * specMax(state, 'recruitMult', 'radioTower') : 0);
      // The story shapes the world: friends trade more, the Rust Clan raids according to how it was treated.
      if (e.id === 'wanderer' && flags.includes('terminus:ally')) w *= 1.4;
      if (e.id === 'trader' && flags.includes('terminus:ally')) w *= 1.5;
      if (e.id === 'raiders') {
        if (flags.includes('gideon:enemy')) w *= 1.8;
        if (flags.includes('gideon:paid')) w *= 0.6;
        if (flags.includes('gideon:joined') || flags.includes('gideon:beaten')) w *= 0.35;
      }
      return w;
    };
    const total = candidates.reduce((sum, e) => sum + weightOf(e), 0);
    let roll = this.ctx.rng.next() * total;
    let picked = candidates[0];
    for (const e of candidates) {
      roll -= weightOf(e);
      if (roll <= 0) { picked = e; break; }
    }

    const data = picked.init?.(state, this.ctx) ?? {};
    this.ctx.sm.applyDelta({ path: 'activeEvent', value: { id: picked.id, data, at: state.stats.totalPlayTime } });
    bus.emit('event:triggered', picked.id);
  }

  /**
   * [Long game] An event nobody answered in time takes its safe default (the inbox shows it as decided).
   * The clock is play time, so it never runs out while the player is away.
   */
  private expireTick(): void {
    const state = this.ctx.sm.state;
    const ev = state.activeEvent;
    if (!ev) return;
    const now = state.stats.totalPlayTime;
    if (ev.at === undefined) {
      this.ctx.sm.applyDelta({ path: 'activeEvent', value: { ...ev, at: now } });
      return;
    }
    const due = eventDeadline(ev);
    if (due === null || now < due) return;
    const def = EVENTS.find(e => e.id === ev.id);
    const choices = def?.choices(ev.data) ?? [];
    const order = [...(def?.fallback ? choices.filter(c => c.key === def.fallback) : []), ...[...choices].reverse()];
    for (const c of order) {
      if (!this.isChoiceAvailable(c)) continue;
      const result = this.resolve(c.key);
      if (result) {
        bus.emit('event:expired', { id: ev.id, key: c.key, data: ev.data, result } satisfies EventExpired);
        return;
      }
    }
    // Nothing possible (cannot happen for today's events): let it wait rather than loop.
    this.ctx.sm.applyDelta({ path: 'activeEvent', value: { ...ev, at: now } });
  }

  getChoices(): EventChoice[] {
    const ev = this.ctx.sm.state.activeEvent;
    if (!ev) return [];
    return EVENTS.find(e => e.id === ev.id)?.choices(ev.data) ?? [];
  }

  isChoiceAvailable(choice: EventChoice): boolean {
    const state = this.ctx.sm.state;
    if (choice.cost && !this.ctx.resources.canAfford(state, choice.cost as Record<string, number>)) return false;
    if (choice.requiresSpace && state.survivors.length + Number(choice.requiresSpace) > state.maxPopulation) return false;
    return true;
  }

  resolve(choiceKey: string): EventResult | null {
    const state = this.ctx.sm.state;
    const ev = state.activeEvent;
    if (!ev) return null;
    const def = EVENTS.find(e => e.id === ev.id);
    const choice = def?.choices(ev.data).find(c => c.key === choiceKey);
    if (!def || !choice || !this.isChoiceAvailable(choice)) return null;

    if (choice.cost) this.ctx.resources.spend(this.ctx.sm, choice.cost as Record<string, number>);
    const result = def.resolve(choiceKey, ev.data, this.ctx);

    this.ctx.sm.applyDelta({ path: 'activeEvent', value: null });
    if (def.once) {
      this.ctx.sm.applyDelta({ path: 'storyFlags', value: [...this.ctx.sm.state.storyFlags, `event:${def.id}`] });
    }
    // A knock at the door runs on its own clock and doesn't push back the other events.
    if (ev.data.knock) {
      const s = this.ctx.sm.state;
      this.ctx.sm.applyDelta({ path: 'nextArrivalAt', value: s.stats.totalPlayTime + arrivalGap(s, this.ctx.rng.next()) });
    }
    if (!ev.data.knock) this.scheduleNext();
    return result;
  }

  private scheduleNext(): void {
    const state = this.ctx.sm.state;
    const now = state.stats.totalPlayTime;
    const factor = Math.max(0.5, 1 - radioLevels(state) * 0.08);
    this.ctx.sm.applyDelta({ path: 'nextEventAt', value: now + Math.round(this.ctx.rng.nextInt(MIN_GAP, MAX_GAP) * factor) });
  }
}

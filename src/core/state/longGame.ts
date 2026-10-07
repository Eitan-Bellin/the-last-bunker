/**
 * The long game's state slices. Each lane owns its slice (see the long-game plan, section 12): it may change its own
 * interface, create and migrate functions here and nothing else in GameState. Every slice is additive: an older save
 * gets the defaults, and nothing a player already has is ever taken away by a migration.
 */

export type Difficulty = 'settler' | 'warden' | 'last';

/** Where the run stands: the Act (the long game's chapter), difficulty, scenario and the world clock. */
export interface MetaState {
  /** 1..7 (Remnant, Restoration, Colony, Undercity, Upper Dawn, Republic, Genesis). Eras stay the visual mapping. */
  act: number;
  /** World time (worldT) when the current Act began. */
  actSince: number;
  difficulty: Difficulty;
  /** The easiest difficulty this run was ever played on (achievements and Legacy read it). */
  diffLowest: Difficulty;
  scenario: string;
  mutators: string[];
  /** 0 for the first timeline, +1 per Genesis. */
  runIndex: number;
  /** Seconds of world time: online play plus credited time away. Seasons, contracts and threat run on it. */
  worldT: number;
  /** True for a bunker that came from a save made before the long game (it skipped the new early systems). */
  legacy: boolean;
  /** [P3-5, save v6] Bunkers of earlier timelines that still send part of the income home (see data/scenarios.ts). */
  homes: { scenario: string; act: number; run: number; ending?: string }[];
}

/** [Economy lane] Digging a new floor: paid in stages, takes time and a crew. */
export interface DigState {
  floor: number | null;
  paid: number[];
  progress: number;
  total: number;
  crew: string[];
  /** [plan4:ST-3] What is being dug: a new floor (the default, also for saves from before) or a side wing of `floor`. */
  kind?: 'floor' | 'wing';
  /** [plan4:ST-3] Which wing of `floor` (kind 'wing'). */
  side?: 'w' | 'e';
}

/** [Danger lane] The threat director. */
export interface ThreatState {
  meter: number;
  seq: number;
  nextAt: number;
  /** No new threat before this worldT (a breather after a hard hit, or after the long-game update). */
  breatherUntil: number;
  scars: string[];
}

/** [Danger lane] Seasons (about four real days each). */
export interface SeasonState {
  index: number;
  startedAt: number;
}

/**
 * [Society lane] Laws, political capital and the factions inside the bunker.
 * [plan4:GP-12] The fields marked [reserved] here and in WorldState are checked: nothing reads or writes them (only their zero defaults).
 * They stay in the type because saves already hold them; removing them would change the save format for no gain.
 */
export interface PolicyState {
  laws: string[];
  /** [reserved: saved, not used yet] Political capital (the Council; see the balance plan, N4). */
  capital: number;
  /** [reserved: saved, not used yet] Faction approval. */
  approval: Record<string, number>;
  /** [reserved: saved, not used yet] World time until which a faction strike lasts. */
  strikeUntil: number;
}

/** [World lane] Regions, outposts, treaties and contracts outside. */
export interface WorldState {
  /** [reserved: saved, not used yet] Named map regions (balance plan, N9). */
  regions: Record<string, unknown>;
  outposts: unknown[];
  /** [reserved: saved, not used yet] Treaties with the outside partners (balance plan, N8). */
  treaties: Record<string, unknown>;
  contracts: unknown[];
  seq: number;
  /** [P4] World time of the next contract offer (0 = not scheduled yet). */
  nextContractAt?: number;
}

/** [UX lane] One card in the Decision Inbox. */
export interface InboxItem {
  id: number;
  kind: string;
  /** World time it arrived and (if any) when it expires; destructive items never expire. */
  at: number;
  deadline: number | null;
  urgent: boolean;
  /** The choice applied if the deadline passes (a safe default). */
  fallback: string | null;
  data: Record<string, unknown>;
}

export interface InboxState {
  items: InboxItem[];
  seq: number;
}

/** [UX lane] Standing orders that take routine off the player's hands. */
export interface ForemanState {
  orders: Record<string, unknown>;
  /** [plan4:GP-8] Door keys ("floor:x") the 'sealOnAlarm' order shut and has not yet opened again (optional: absent in older saves). */
  sealed?: string[];
}

/** [Q14] One line of the Chronicle (src/systems/ChronicleSystem.ts). */
export interface ChronicleEntry {
  /** World seconds when it happened. */
  t: number;
  /** What kind of milestone ('act', 'project', 'chapter', 'doctrine', ...). */
  k: string;
  id?: string;
  n?: number;
  /** The run (timeline) it belongs to: 0 for the first, +1 per Genesis. */
  run: number;
}

export interface LongGameState {
  meta: MetaState;
  dig: DigState;
  /** [plan4:ST-3] The second dig, open after the Parallel Digging research (absent in older saves; migrateLongGame fills it). */
  dig2?: DigState;
  threat: ThreatState;
  season: SeasonState;
  policy: PolicyState;
  world: WorldState;
  inbox: InboxState;
  foreman: ForemanState;
  /** [Q14, save v6] The run's milestones; kept across Genesis so earlier timelines stay in the book. */
  chronicle: ChronicleEntry[];
}

export function createLongGame(): LongGameState {
  return {
    meta: { act: 1, actSince: 0, difficulty: 'warden', diffLowest: 'warden', scenario: 'bunker17', mutators: [], runIndex: 0, worldT: 0, legacy: false, homes: [] },
    dig: { floor: null, paid: [], progress: 0, total: 0, crew: [], kind: 'floor' },
    // [plan4:ST-3] The second dig slot (opens with the Parallel Digging research).
    dig2: { floor: null, paid: [], progress: 0, total: 0, crew: [], kind: 'floor' },
    threat: { meter: 0, seq: 0, nextAt: 0, breatherUntil: 0, scars: [] },
    season: { index: 0, startedAt: 0 },
    policy: { laws: [], capital: 0, approval: {}, strikeUntil: 0 },
    world: { regions: {}, outposts: [], treaties: {}, contracts: [], seq: 0 },
    inbox: { items: [], seq: 0 },
    foreman: { orders: {} },
    chronicle: [],
  };
}

/** A week of world time: the breather a bunker from before the update gets before any new threat. */
const UPDATE_BREATHER = 7 * 86_400;

/**
 * Fills in the long game for a loaded save. A save from before it (no `longGame`) is placed in the Act its era matches
 * (era 0..3 -> Act 1..4), marked legacy, plays on the middle difficulty and gets a week's breather.
 */
export function migrateLongGame(saved: Partial<LongGameState> | undefined, era: number, playTime: number, prestigeRuns: number): LongGameState {
  const fresh = createLongGame();
  if (!saved) {
    const worldT = playTime;
    fresh.meta = { ...fresh.meta, act: Math.min(4, Math.max(1, era + 1)), actSince: worldT, worldT, legacy: true, runIndex: prestigeRuns };
    fresh.threat.breatherUntil = worldT + UPDATE_BREATHER;
    fresh.season.startedAt = worldT;
    return fresh;
  }
  return {
    meta: { ...fresh.meta, ...saved.meta },
    dig: { ...fresh.dig, ...saved.dig },
    dig2: { ...fresh.dig2!, ...saved.dig2 },
    threat: { ...fresh.threat, ...saved.threat },
    season: { ...fresh.season, ...saved.season },
    policy: { ...fresh.policy, ...saved.policy },
    world: { ...fresh.world, ...saved.world },
    inbox: { ...fresh.inbox, ...saved.inbox },
    foreman: { ...fresh.foreman, ...saved.foreman },
    chronicle: Array.isArray(saved.chronicle) ? saved.chronicle : [],
  };
}

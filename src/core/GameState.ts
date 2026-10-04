import { createLongGame, migrateLongGame, type LongGameState } from './state/longGame';

export interface ResourceState {
  amount: number;
  cap: number;
  productionRate: number;
  consumptionRate: number;
}

export type ResourceType =
  | 'food'
  | 'water'
  | 'power'
  | 'materials'
  | 'medicine'
  | 'knowledge'
  | 'scrap'
  | 'isotope7'
  | 'blueprints'
  | 'vaultCoins'
  // Long game, tier 2 refined goods (see src/data/resources.ts).
  | 'components'
  | 'alloys'
  | 'data'
  | 'influence'
  | 'seedCores'
  // [Economy A1] Trade credits: what storage overflow turns into (no cap); spent in the shop.
  | 'credits';

export interface Position {
  x: number;
  y: number;
  floor: number;
}

export type BuildingType =
  | 'quarters'
  | 'farm'
  | 'waterPump'
  | 'generator'
  | 'storage'
  | 'medbay'
  | 'workshop'
  | 'canteen'
  | 'waterPurifier'
  | 'trainingRoom'
  | 'laboratory'
  | 'radioTower'
  | 'armory'
  | 'hydroponics'
  | 'reactor'
  | 'elevator'
  | 'cave'
  | 'lake'
  | 'metro'
  | 'atrium'
  | 'reactorHall';

export interface BuildingInstance {
  id: string;
  type: BuildingType;
  level: number;
  position: Position;
  assignedSurvivorIds: string[];
  constructionProgress: number;
  constructionTotal: number;
  isConstructing: boolean;
  specialization: string | null;
  /** [Danger C3] Wear in percent (0-100) on rooms of level 3+; "Maintain" resets it. Absent = 0. */
  wear?: number;
  /** [Long game] World time until which the room is changing its role (it produces nothing meanwhile). */
  retoolUntil?: number;
}

export interface SurvivorStats {
  strength: number;
  intelligence: number;
  agility: number;
  charisma: number;
  endurance: number;
}

export interface SurvivorState {
  id: string;
  name: string;
  portraitIndex: number;
  level: number;
  xp: number;
  stats: SurvivorStats;
  health: number;
  happiness: number;
  assignedBuildingId: string | null;
  traits: string[];
  equipment: string[];
  isOnMission: boolean;
  /** Family (Sprint 6): partner, parents, and childhood. */
  partnerId?: string | null;
  parentIds?: string[];
  child?: boolean;
  bornAt?: number;
  lastChildAt?: number;
  /** Fixed painted portrait for story characters who join (e.g. 'p07'). */
  portrait?: string;
  /** [LateGame B3] Mastery: seconds of work in a role (rank 1-5 derives from it), and the specialization chosen at rank 5. */
  mxp?: number;
  spec?: string;
}

export interface ResearchNode {
  id: string;
  completed: boolean;
  progress: number;
  total: number;
  isResearching: boolean;
}

export interface ExplorationHex {
  x: number;
  y: number;
  revealed: boolean;
  biome: string;
  poi: string | null;
  explored: boolean;
}

/** One line in an expedition's travel log. */
export interface JournalEntry {
  /** Seconds into the trip. */
  t: number;
  key: string;
  vars?: Record<string, string | number>;
}

/** A decision the team radios home about while out on the surface. */
export interface MissionEvent {
  id: string;
  /** Fraction of the trip at which it happens. */
  at: number;
  choice?: string;
}

export interface ActiveMission {
  id: string;
  hexX: number;
  hexY: number;
  survivorIds: string[];
  type: string;
  progress: number;
  total: number;
  journal?: JournalEntry[];
  event?: MissionEvent;
  lootMult?: number;
  injuryMod?: number;
  /** Set while the team waits for the player's answer; seconds waited so far. */
  waiting?: boolean;
  waited?: number;
  bonusLoot?: Partial<Record<ResourceType, number>>;
  recruit?: boolean;
  /** A long haul (×6 time, ×4 loot): the trip that fills a night away. */
  long?: boolean;
  /** [LateGame B2] A trade caravan: the partner it visits and the cargo it carries. */
  partner?: string;
  cargo?: Partial<Record<ResourceType, number>>;
}

export interface PrestigeState {
  rebirthCount: number;
  ascensionCount: number;
  transcendenceCount: number;
  totalIsotope7Earned: number;
  upgrades: Record<string, number>;
  /** Story chapters already seen in an earlier timeline (kept across Genesis, so a replay can be skipped). Absent in older saves. */
  storySeen?: string[];
}

export interface GameSettings {
  language: 'en' | 'he';
  musicVolume: number;
  sfxVolume: number;
  notificationsEnabled: boolean;
  autoSave: boolean;
}

export interface GameStats {
  totalPlayTime: number;
  totalFoodProduced: number;
  totalBuildingsBuilt: number;
  totalSurvivorsRecruited: number;
  totalMissionsCompleted: number;
  totalCrisesSurvived: number;
  totalPrestigeResets: number;
}

export interface ActiveEvent {
  id: string;
  data: Record<string, unknown>;
  /** Play time it was posted (the answer deadline counts from here). Absent in older saves. */
  at?: number;
}

export interface MissionReport {
  id: string;
  hexX: number;
  hexY: number;
  success: boolean;
  firstVisit: boolean;
  loot: Partial<Record<ResourceType, number>>;
  injuries: { id: string; name: string; damage: number }[];
  recruitName: string | null;
  poi: string | null;
  biome?: string;
  journal?: JournalEntry[];
}

export type IncidentKind = 'fire' | 'flood' | 'blackout' | 'roaches' | 'breach';

/** A crisis inside one room (Sprint 6): it stops the room and grows until the crew puts it down. */
export interface Incident {
  id: string;
  kind: IncidentKind;
  buildingId: string;
  /** 0..1, grows while unattended; at 1 it does real harm. */
  severity: number;
  /** 0..1 progress of putting it out. */
  progress: number;
  startedAt: number;
  /** Seconds spent at full severity (unattended crises eventually burn out). */
  peak?: number;
  spread?: boolean;
}

// ---- [Danger] raids, disasters, maintenance and mourning (LATEGAME-PLAN part C) ----

export type DisasterKind = 'collapse' | 'deepFlood' | 'epidemic' | 'meltdown';

/** A disaster with a countdown: handle it before the deadline or it strikes. */
export interface Disaster {
  id: string;
  kind: DisasterKind;
  /** The room it threatens (null for the epidemic, which threatens everyone). */
  buildingId: string | null;
  startedAt: number;
  /** In play seconds (totalPlayTime), like every other clock in the game. */
  deadline: number;
}

/** Someone the bunker lost: the memorial modal and the plaque at the entrance. */
export interface Fallen {
  id: string;
  name: string;
  portraitIndex: number;
  portrait?: string;
  child?: boolean;
  /** The room they worked in (picks the sentence in the memorial). */
  job: BuildingType | null;
  level: number;
  /** Wall-clock ms. */
  at: number;
}

/** A mood penalty (or bonus) with wall-clock bounds; ids = null means the whole bunker. */
export interface Grief {
  value: number;
  from: number;
  until: number;
  ids: string[] | null;
  /** The fallen person this mourning belongs to (a ceremony reshapes it). */
  tag?: string;
}

/** [P2] Who is coming: many light scavengers (walls stop them) or a few hard marauders (guards stop them). */
export type RaidKind = 'scavengers' | 'marauders';
/** [P2] How the bunker meets them: hold the door, send the guards out, or hide everyone below and let them take what they find. */
export type RaidStance = 'hold' | 'sally' | 'hide';

export interface DangerState {
  disasters: Disaster[];
  /** An approaching raid: it hits at hitAt (play seconds); until then the player can pay or prepare. */
  raid: { hitAt: number; strength: number; kind?: RaidKind; stance?: RaidStance } | null;
  /** Play-second clocks; 0 = not scheduled yet. */
  nextRaidAt: number;
  nextDisasterAt: number;
  /** Wall-clock ms. After a death: no new bad events until then; and no disasters for a day after >3 deaths in a day. */
  quietUntil: number;
  disastersPausedUntil: number;
  deathTimes: number[];
  fallen: Fallen[];
  /** Deaths whose memorial the player has not yet answered. */
  memorialQueue: Fallen[];
  grief: Grief[];
  /** Rooms shut down until the given wall-clock ms (a reactor after a meltdown). */
  disabled: Record<string, number>;
  /** Wall-clock ms of the first danger that struck while away and was never answered (the offline safety net). */
  ignoredSince: number | null;
  nextId: number;
}

export function createDanger(): DangerState {
  return {
    disasters: [], raid: null, nextRaidAt: 0, nextDisasterAt: 0, quietUntil: 0, disastersPausedUntil: 0,
    deathTimes: [], fallen: [], memorialQueue: [], grief: [], disabled: {}, ignoredSince: null, nextId: 1,
  };
}

export interface MoraleBuff {
  value: number;
  expiresAt: number;
}

export type RuinKind = 'collapsed' | 'debris' | 'flooded' | 'wreck';

/** A blocked stretch of a floor that survivors clear by hand (Sprint 2: the Remnant). */
export interface Ruin {
  id: string;
  floor: number;
  x: number;
  w: number;
  kind: RuinKind;
  /** A wrecked room comes back as this building when cleared. */
  restoresTo: BuildingType | null;
  flooded: boolean;
  progress: number;
  total: number;
  started: boolean;
  lore: string | null;
  /** [P2] A room wrecked by raiders comes back at its old level and role. */
  restoresLevel?: number;
  restoresSpec?: string | null;
  /** [P2] Its own price and work (instead of the ruin kind's). */
  cost?: Partial<Record<ResourceType, number>>;
}

export interface GameState {
  version: number;
  timestamp: number;
  createdAt: number;
  resources: Record<ResourceType, ResourceState>;
  buildings: BuildingInstance[];
  survivors: SurvivorState[];
  research: Record<string, ResearchNode>;
  /** Research waiting its turn after the active one (cost already paid; continues offline). */
  researchQueue: string[];
  /** [P3] What each queued node was paid (a Eureka can change the price before it starts or is cancelled). */
  researchPaid?: Record<string, Record<string, number>>;
  /** Levels of the repeatable Refinement research, by refinement id. */
  refinements: Record<string, number>;
  /** Baseline for relative endless objectives ("+N from now"), captured when a step begins. */
  objectiveBase: { step: number; value: number } | null;
  explorationMap: ExplorationHex[];
  activeMissions: ActiveMission[];
  prestige: PrestigeState;
  /** The long game: Act, difficulty, world clock and the newer systems' slices (src/core/state/longGame.ts). Absent before v5. */
  longGame: LongGameState;
  settings: GameSettings;
  stats: GameStats;
  achievements: string[];
  storyFlags: string[];
  currentFloors: number;
  maxPopulation: number;
  tensionValue: number;
  lastEventTime: number;
  randomSeed: number;
  tutorialStep: number;
  activeEvent: ActiveEvent | null;
  nextEventAt: number;
  /** When the next newcomer knocks on the door (while there is room). */
  nextArrivalAt: number;
  moraleBuffs: MoraleBuff[];
  powerRatio: number;
  missionReports: MissionReport[];
  ruins: Ruin[];
  ruinsCleared: number;
  /** Lore entries found, in order of discovery. */
  lore: string[];
  /** Lore found but not yet opened by the player. */
  loreUnread: string[];
  era: number;
  incidents: Incident[];
  nextIncidentAt: number;
  /** Newcomers who arrived while the player was away; they wait at the door for an answer (offline S6). */
  doorWaiting: SurvivorState[];
  /** Away seconds already counted toward the next newcomer at the door. */
  awayDoorClock: number;
  /** Daily supply drop (NICE3): the local day it was last opened and the run of days in a row. */
  supplyDrop: { day: string | null; streak: number };
  /** Rush charges: each skips 15 minutes of building, research or an expedition (see RushSystem). */
  rush: number;
  /** [Danger] raids, disasters, mourning (older saves start calm). */
  danger: DangerState;
  // [Economy A2/A3] Credits shop purchases (reset daily / weekly) and the big project fed by overflow while away.
  shop: ShopState;
  activeProjectId: string | null;
  // [LateGame B1-B4] big projects, trade, weekly challenge (older saves start empty).
  lateGame: LateGameState;
}

/** Credits-shop bookkeeping: purchases today (price ramp resets at local midnight) and isotope bought this week. */
export interface ShopState {
  day: string | null;
  bought: Record<string, number>;
  week: string | null;
  weekBought: Record<string, number>;
}

/** [LateGame B1] Progress of one big project: the stage in work, what has been delivered to it and the crew work done (seconds at full crew). */
export interface ProjectProgress {
  stage: number;
  paid: Partial<Record<ResourceType, number>>;
  work: number;
}

/** [LateGame B1-B4] Big projects, trade relations, the weekly challenge and paid trainings. */
export interface LateGameState {
  projects: Record<string, ProjectProgress>;
  /** Stages finished in all projects together (counts for the weekly challenge). */
  stagesDone: number;
  trade: { deals: Record<string, number>; specials: string[]; caravans: number; lost: number };
  weekly: { week: string | null; id: string | null; base: Record<string, number>; done: boolean; won: number; cosmetics: string[] };
  trained: number;
}

export function createLateGame(): LateGameState {
  return {
    projects: {}, stagesDone: 0,
    trade: { deals: {}, specials: [], caravans: 0, lost: 0 },
    weekly: { week: null, id: null, base: {}, done: false, won: 0, cosmetics: [] },
    trained: 0,
  };
}

export const SAVE_VERSION = 5;

export function migrateState(saved: GameState): GameState {
  const fresh = createInitialState();
  const merged = { ...fresh, ...saved } as GameState;
  merged.stats = { ...fresh.stats, ...saved.stats };
  merged.resources = { ...fresh.resources, ...saved.resources };
  merged.version = fresh.version;
  merged.currentFloors = Math.max(saved.currentFloors ?? 1, fresh.currentFloors);
  if ((saved.version ?? 1) < 4) {
    // Bunkers from before the restoration update were never ruined and have already been "entered".
    merged.ruins = [];
    merged.storyFlags = [...new Set([...(saved.storyFlags ?? []), 'intro:done'])];
  }
  merged.ruins = merged.ruins ?? [];
  merged.lore = merged.lore ?? [];
  merged.loreUnread = merged.loreUnread ?? [];
  // Research queue, refinements and relative objectives (balance pass): older saves start empty.
  merged.researchQueue = merged.researchQueue ?? [];
  merged.refinements = merged.refinements ?? {};
  merged.objectiveBase = merged.objectiveBase ?? null;
  merged.incidents = merged.incidents ?? [];
  merged.nextIncidentAt = merged.nextIncidentAt ?? (merged.stats.totalPlayTime + 600);
  merged.nextArrivalAt = merged.nextArrivalAt ?? (merged.stats.totalPlayTime + 30);
  merged.doorWaiting = merged.doorWaiting ?? [];
  merged.awayDoorClock = merged.awayDoorClock ?? 0;
  merged.supplyDrop = merged.supplyDrop ?? { day: null, streak: 0 };
  merged.rush = merged.rush ?? 3; // older saves get the starter charges
  // [Danger] older saves start with no raid or disaster on the clock.
  merged.danger = { ...createDanger(), ...(saved.danger ?? {}) };
  // [Economy] credits shop and the active project (older saves start with none).
  merged.shop = { day: saved.shop?.day ?? null, bought: saved.shop?.bought ?? {}, week: saved.shop?.week ?? null, weekBought: saved.shop?.weekBought ?? {} };
  merged.activeProjectId = merged.activeProjectId ?? null;
  // [LateGame] big projects, trade, weekly challenge.
  merged.lateGame = { ...createLateGame(), ...(saved.lateGame ?? {}) };
  merged.lateGame.trade = { ...createLateGame().trade, ...merged.lateGame.trade };
  merged.lateGame.weekly = { ...createLateGame().weekly, ...merged.lateGame.weekly };
  if (!merged.resources.credits) merged.resources.credits = { ...fresh.resources.credits };
  // [Long game] v5: Act, difficulty, world clock and the empty slices of the newer systems.
  merged.longGame = migrateLongGame(saved.longGame, saved.era ?? 0, merged.stats.totalPlayTime ?? 0, merged.prestige?.rebirthCount ?? 0);
  return merged;
}

export function createInitialState(): GameState {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    timestamp: now,
    createdAt: now,
    resources: {
      food: { amount: 150, cap: 150, productionRate: 0, consumptionRate: 0 },
      water: { amount: 100, cap: 100, productionRate: 0, consumptionRate: 0 },
      power: { amount: 10, cap: 50, productionRate: 0, consumptionRate: 0 },
      materials: { amount: 70, cap: 200, productionRate: 0, consumptionRate: 0 },
      medicine: { amount: 5, cap: 30, productionRate: 0, consumptionRate: 0 },
      knowledge: { amount: 0, cap: 100, productionRate: 0, consumptionRate: 0 },
      scrap: { amount: 10, cap: 200, productionRate: 0, consumptionRate: 0 },
      isotope7: { amount: 0, cap: Infinity, productionRate: 0, consumptionRate: 0 },
      blueprints: { amount: 0, cap: Infinity, productionRate: 0, consumptionRate: 0 },
      vaultCoins: { amount: 0, cap: Infinity, productionRate: 0, consumptionRate: 0 },
      credits: { amount: 0, cap: Infinity, productionRate: 0, consumptionRate: 0 },
      components: { amount: 0, cap: 0, productionRate: 0, consumptionRate: 0 },
      alloys: { amount: 0, cap: 0, productionRate: 0, consumptionRate: 0 },
      data: { amount: 0, cap: 0, productionRate: 0, consumptionRate: 0 },
      influence: { amount: 0, cap: 0, productionRate: 0, consumptionRate: 0 },
      seedCores: { amount: 0, cap: 0, productionRate: 0, consumptionRate: 0 },
    },
    buildings: [],
    survivors: [],
    research: {},
    researchQueue: [],
    refinements: {},
    objectiveBase: null,
    explorationMap: [],
    activeMissions: [],
    prestige: {
      rebirthCount: 0,
      ascensionCount: 0,
      transcendenceCount: 0,
      totalIsotope7Earned: 0,
      upgrades: {},
    },
    settings: {
      language: 'en',
      musicVolume: 0.7,
      sfxVolume: 1.0,
      notificationsEnabled: true,
      autoSave: true,
    },
    stats: {
      totalPlayTime: 0,
      totalFoodProduced: 0,
      totalBuildingsBuilt: 0,
      totalSurvivorsRecruited: 0,
      totalMissionsCompleted: 0,
      totalCrisesSurvived: 0,
      totalPrestigeResets: 0,
    },
    achievements: [],
    storyFlags: [],
    currentFloors: 3,
    maxPopulation: 0,
    tensionValue: 0,
    lastEventTime: now,
    randomSeed: Math.floor(Math.random() * 2147483647),
    tutorialStep: 0,
    activeEvent: null,
    nextEventAt: 240,
    nextArrivalAt: 60,
    moraleBuffs: [],
    powerRatio: 1,
    missionReports: [],
    ruins: [],
    ruinsCleared: 0,
    lore: [],
    loreUnread: [],
    era: 0,
    incidents: [],
    nextIncidentAt: 900,
    doorWaiting: [],
    awayDoorClock: 0,
    supplyDrop: { day: null, streak: 0 },
    rush: 3,
    danger: createDanger(), // [Danger]
    shop: { day: null, bought: {}, week: null, weekBought: {} },
    activeProjectId: null,
    lateGame: createLateGame(),
    longGame: createLongGame(),
  };
}

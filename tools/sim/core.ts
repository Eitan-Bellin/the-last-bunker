import { GameEngine } from '../../src/core/GameEngine';
import { bus } from '../../src/core/EventBus';
import type { BuildingType, GameState, ResourceType, SurvivorState } from '../../src/core/GameState';
import { BUILDABLE_TYPES, getDef, isHall } from '../../src/data/buildingDefs';
import { allowedFloors } from '../../src/data/zones';
import * as researchData from '../../src/data/research';
import { isBuildingUnlocked } from '../../src/systems/ResearchSystem';
import { CHAPTERS, getChapter } from '../../src/data/story';
import { nextDistrict } from '../../src/data/districts';
import * as surfaceData from '../../src/data/surface';
import { ERAS } from '../../src/data/eras';
import { specsFor } from '../../src/data/specializations';
import { expeditionEvent } from '../../src/data/expeditionEvents';
import { bunkerDefense } from '../../src/systems/EventSystem'; // [Danger bot]
import {
  buildColumn, buildDoor, closeEmergencyDoors, columnBlock, columnCost, doorBlock, doorCost, fireCodeFloors, infraUnlocked, openAllDoors, roomEdgeBoundaries, troubleOn,
} from '../../src/systems/InfraSystem'; // [plan4:ST-14/15]
import { infraOfKind, shutDoorCount } from '../../src/systems/doors'; // [plan4:ST-14/15]

/**
 * Balance simulator core (NICE4), shared by the Node runner (tools/sim/run.mjs) and the browser page
 * (tools/balance.html). It drives the REAL engine and systems headless: the online step is derived from
 * GameEngine.tick() itself, and a return after time away goes through a real save + GameEngine.init()
 * (offline simulation, door, era catch-up), with an in-memory save so nothing ever touches IndexedDB.
 * Everything the economy agents may add is feature-detected, never assumed.
 */

/** 'neglect' (Danger): casual sessions, but the player never reacts to raid warnings, disasters or wear (tests the safety net). */
export type SimMode = 'greedy' | 'casual' | 'engaged' | 'neglect';

/** The part of the Danger state the bot reads (feature-detected: older engines have none). */
interface DangerLike {
  raid: { hitAt: number; strength: number } | null;
  disasters: { id: string; kind: string }[];
  memorialQueue?: unknown[];
}

export interface SimOptions {
  mode: SimMode;
  seed: number;
  /** Greedy length (online hours). */
  hours?: number;
  /** Casual/engaged length (calendar days). */
  days?: number;
  /** Seconds between bot decisions while online (greedy 5, sessions 10). */
  think?: number;
  /** How a return after time away is processed: a real app start (default) or the tab-visible path. */
  returnMode?: 'restart' | 'resume';
  /** [Danger] A control run with raids, disasters, wear and away danger switched off (compare Genesis timing). */
  noDanger?: boolean;
  /** [P2] Difficulty picked at the start (settler / warden / last), when the engine has one. */
  difficulty?: string;
  /** Concurrent expedition teams when the engine has no limit of its own. */
  teams?: number;
  /** Press Genesis this many times (the bot buys nothing in the shop) and keep playing: the second timeline's milestones go to `timeline2`. */
  rebirths?: number;
  /** Return the final game state as save JSON (`finalSave`), e.g. to test save migrations on real games. */
  dumpSave?: boolean;
  onProgress?: (fraction: number, label: string) => void;
  /** Lets a browser page breathe between chunks. */
  yieldFn?: () => Promise<void>;
}

export interface Milestone { play: number; wall: number }

export interface Sample {
  label: string; wallH: number; playH: number; era: number; pop: number; maxPop: number; kids: number; floors: number;
  buildings: number; levels: number; research: number; explored: number; morale: number; minHp: number; step: number;
  iso: number; res: Record<string, [number, number, number]>;
}

export interface OfflineEntry {
  wallH: number; awayMin: number; gained: Record<string, number>; wasted: Record<string, number>; wastedEstimated: boolean;
  arrivals: number; doorAdmitted: number; missions: number; research: number; starvingOnReturn: boolean; extra: Record<string, unknown>;
}

export interface SimResult {
  seed: number; mode: SimMode; wallSeconds: number; playSeconds: number; runMs: number;
  milestones: Record<string, Milestone>;
  /** With --rebirths: milestones of the timeline after Genesis (times counted from the rebirth). */
  timeline2?: Record<string, Milestone>;
  rebirths?: number;
  genesis: { wall: number; play: number; payout: number } | null;
  rebirthPayoutEnd: number;
  samples: Sample[];
  capShare: Record<string, number>;
  famineSeconds: number; thirstSeconds: number;
  deaths: { total: number; famine: number; other: number; causes?: Record<string, number> };
  injuries: { expedition: number; raid: number; sickness: number };
  /** [Danger] raids, disasters, upkeep, away danger and when each death happened (wall days). */
  danger: {
    raids: Record<string, number>; disasterStarted: number; disasterHandled: number; disasterStruck: Record<string, number>;
    tributes: number; maintained: number; away: { raids: number; raidsLost: number; disasters: number; hurt: number; died: number };
    deathDays: number[]; minPop: number; minPopDay: number;
    /** [strength, defense, pop, era] at each raid warning (tuning aid). */
    raidLog: number[][];
    /** [P2] Raid outcomes by kind of raider and stance: "marauders/hold/win". */
    byKind?: Record<string, number>;
  };
  incidents: number; missions: number; missionFails: number; kids: number;
  arrivals: { accepted: number; refused: number; doorAdmitted: number };
  events: Record<string, number>;
  chapters: { id: string; wall: number; play: number }[];
  chaptersTotal: number;
  idle: { share: number; gapsOver5m: number; longest: [number, number][] };
  offline: OfflineEntry[];
  lastProgress: Milestone; stallWallH: number; stallPlayH: number;
  objectivesDone: number;
  supplyDrops: number;
  /** [LateGame] project stages finished, caravans home/lost, weekly challenges won, trainings and the final rank counts. */
  lateGame?: { stages: number; caravansOk: number; caravansLost: number; weekly: number; trained: number; rank5: number; projectsDone: number };
  final: Record<string, unknown>;
  bot: { actions: Record<string, number>; pulledForRuins: number; journalReads: number; queuedResearch: number; longTrips: number };
  warnings: string[];
  stepList: string[];
}

const TRACKED: ResourceType[] = ['food', 'water', 'power', 'materials', 'knowledge', 'scrap', 'medicine'];
const CORE: BuildingType[] = ['generator', 'waterPump', 'farm'];
/** The cautious road answer the old bot used; anything new falls back to the event's first option. */
const EXP_FIRST: Record<string, string> = {
  lockedDoor: 'leave', stranger: 'pass', storm: 'shelter', cache: 'light', tracks: 'avoid', spores: 'around', collapse: 'back', drone: 'hide',
};
/** Preferred dialog answers; unknown events take the first available choice. */
const EVENT_PREF: Record<string, string[]> = {
  wanderer: ['accept', 'refuse'], group: ['accept', 'one', 'refuse'], raiders: ['fight', 'tribute'], refugees: ['welcome'],
};
/** Events the bot was written against (the rest are handled generically and reported once). */
const KNOWN_EVENTS = new Set(['refugees', 'wanderer', 'group', 'stash', 'pipeLeak', 'argument', 'trader', 'powerSurge', 'sickness', 'radioSignal', 'radioSignal2', 'radioSignal3', 'raiders']);
/** Play sessions as [hour of day, minutes]; the very first session of the game runs `first` minutes. */
export const PATTERNS: Record<'casual' | 'engaged' | 'neglect', { first: number; s: [number, number][] }> = {
  // ~45 min/day: a 40-min first session, then 15/10/10/10-min check-ins.
  casual: { first: 40, s: [[0, 15], [3.5, 10], [13, 10], [18, 10]] },
  // ~2 h/day in 8 sessions.
  engaged: { first: 60, s: [[0, 20], [2, 15], [4, 15], [12.5, 15], [15, 15], [17, 15], [20, 15], [22, 10]] },
  // [Danger] the same visits as casual; what differs is that the bot ignores warnings and upkeep.
  neglect: { first: 40, s: [[0, 15], [3.5, 10], [13, 10], [18, 10]] },
};

// ---- determinism -------------------------------------------------------------------------------

/** Seeds Math.random and freezes Date.now onto a simulated clock (survivors and map use both before any seed applies). */
export function installDeterminism(seed: number): { clock: { now: number }; restore: () => void } {
  const origRandom = Math.random;
  const origNow = Date.now;
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // A different start per seed so the map (seeded from createdAt) differs between seeds.
  const clock = { now: Date.UTC(2026, 0, 1) + (seed % 100000) * 7_777_777 };
  Date.now = () => Math.floor(clock.now);
  return { clock, restore: () => { Math.random = origRandom; Date.now = origNow; } };
}

/** Stands in for SaveManager: the simulator must never touch the player's IndexedDB save. */
class MemorySave {
  private data: string | null = null;
  async saveJson(json: string): Promise<void> { this.data = json; }
  async snapshotPrev(): Promise<boolean> { return true; }
  async loadSafe(): Promise<{ status: string; state: GameState | null }> {
    return this.data ? { status: 'ok', state: JSON.parse(this.data) as GameState } : { status: 'missing', state: null };
  }
  async load(): Promise<GameState | null> { return this.data ? (JSON.parse(this.data) as GameState) : null; }
  async readBackup(): Promise<GameState | null> { return null; }
  async listBackups(): Promise<unknown[]> { return []; }
  async deleteSave(): Promise<void> { this.data = null; }
  async hasSave(): Promise<boolean> { return this.data !== null; }
  exportSave(state: GameState): string { return JSON.stringify(state); }
  importSave(): GameState | null { return null; }
}

// Optional engine APIs that other agents add; every one is feature-detected.
type Fn = (...args: unknown[]) => unknown;
type Loose = Record<string, unknown>;
const fn = (o: unknown, k: string): Fn | null => {
  const v = (o as Loose | null)?.[k];
  return typeof v === 'function' ? (v as Fn).bind(o) : null;
};

/** One step = every system call GameEngine.tick() makes, at dt seconds, in the same order. */
function buildStepper(e: GameEngine, warnings: string[]): { names: string[]; run: (dt: number) => void } {
  const eng = e as unknown as Loose;
  // Newer engines expose their step list directly: the open game, time away and this simulator then run the same code.
  const advance = fn(e, 'advance');
  const names = fn(e, 'systemNames');
  if (advance && names) return { names: names() as string[], run: (dt: number) => { advance(dt, 'online'); } };
  const tick = (Object.getPrototypeOf(e) as Loose).tick;
  const src = typeof tick === 'function' ? tick.toString() : '';
  type Call = { sys: string; method: string; kind: 'none' | 'dt' | 'sm' | 'smdt' };
  const calls: Call[] = [];
  for (const m of src.matchAll(/this\.(\w+)\.(\w+)\(([^()]*)\)/g)) {
    const [, sys, method, args] = m;
    if (sys === 'stateManager' || typeof (eng[sys] as Loose | undefined)?.[method] !== 'function') continue;
    const a = args.trim();
    // tick() hands the state manager over as `sm` (a local alias) or as `this.stateManager`.
    const kind: Call['kind'] = a === '' ? 'none' : /\b(sm|stateManager)\b/.test(a) ? (a.includes(',') ? 'smdt' : 'sm') : 'dt';
    calls.push({ sys, method, kind });
  }
  if (calls.length < 5) {
    warnings.push('could not read GameEngine.tick(); using the built-in step list');
    calls.length = 0;
    for (const s of ['resourceSystem', 'buildingSystem', 'populationSystem', 'researchSystem']) calls.push({ sys: s, method: 'update', kind: 'smdt' });
    calls.splice(3, 0, { sys: 'eventSystem', method: 'update', kind: 'none' });
    for (const s of ['explorationSystem', 'restorationSystem', 'incidentSystem', 'familySystem']) calls.push({ sys: s, method: 'update', kind: 'dt' });
    calls.push({ sys: 'metaSystem', method: 'checkAchievements', kind: 'none' });
    for (const s of ['objectiveSystem', 'eraSystem', 'storySystem']) calls.push({ sys: s, method: 'update', kind: 'none' });
  }
  const sm = e.stateManager;
  const bound = calls.map(c => {
    const o = eng[c.sys] as Loose;
    const f = (o[c.method] as Fn).bind(o);
    if (c.kind === 'none') return () => f();
    if (c.kind === 'dt') return (dt: number) => f(dt);
    if (c.kind === 'sm') return () => f(sm);
    return (dt: number) => f(sm, dt);
  });
  return {
    names: calls.map(c => `${c.sys}.${c.method}(${c.kind})`),
    run: (dt: number) => {
      for (const b of bound) b(dt);
      sm.applyDelta({ path: 'stats.totalPlayTime', value: sm.state.stats.totalPlayTime + dt });
    },
  };
}

let noDangerRun = false; // [Danger] set from SimOptions.noDanger

/** Builds an engine and remembers the bus listeners it registered, so a discarded engine can be detached. */
function constructEngine(): { e: GameEngine; detach: () => void } {
  const offs: (() => void)[] = [];
  const orig = bus.on;
  bus.on = function (this: typeof bus, ev: string, h: (...args: unknown[]) => void) {
    const off = orig.call(this, ev, h);
    offs.push(off);
    return off;
  } as typeof bus.on;
  let e: GameEngine;
  try {
    e = new GameEngine();
  } finally {
    bus.on = orig;
  }
  (e as unknown as { saveManager: unknown }).saveManager = new MemorySave();
  if (noDangerRun) {
    const x = e as unknown as Record<string, Record<string, unknown>>;
    x.eventSystem.raidTick = () => undefined;
    x.incidentSystem.updateDisasters = () => undefined;
    x.maintenanceSystem.update = () => undefined;
    x.awayDanger.run = () => ({ raids: 0, raidsLost: 0, disasters: [], hurt: 0, died: [] });
  }
  return { e, detach: () => offs.forEach(f => f()) };
}

const fmtH = (s: number) => +(s / 3600).toFixed(2);

// ---- the run -----------------------------------------------------------------------------------

export async function runSim(o: SimOptions): Promise<SimResult> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  noDangerRun = !!o.noDanger;
  const det = installDeterminism(o.seed);
  const warnings: string[] = [];
  const warnOnce = new Set<string>();
  const warn = (msg: string) => { if (!warnOnce.has(msg)) { warnOnce.add(msg); if (warnings.length < 40) warnings.push(msg); } };

  let { e, detach } = constructEngine();
  let sm = e.stateManager;
  e.rng.seed = o.seed;
  (e as unknown as { setupNewGame: () => void }).setupNewGame();
  sm.applyDelta({ path: 'storyFlags', value: [...sm.state.storyFlags, 'intro:done'] });
  if (o.difficulty) fn(e, 'setDifficulty')?.(o.difficulty);
  let stepper = buildStepper(e, warnings);
  const stepList = stepper.names;

  const thinkEvery = Math.max(1, Math.round(o.think ?? (o.mode === 'greedy' ? 5 : 10)));
  const state = () => sm.state;
  const play = () => sm.state.stats.totalPlayTime;
  let wall = 0;

  // ---- metrics ----
  const R = {
    milestones: {} as Record<string, Milestone>,
    genesis: null as SimResult['genesis'],
    samples: [] as Sample[],
    capTicks: {} as Record<string, number>, capSamples: 0,
    famine: 0, thirst: 0,
    deaths: { total: 0, famine: 0, other: 0, causes: {} as Record<string, number> },
    injuries: { expedition: 0, raid: 0, sickness: 0 },
    incidents: 0, missions: 0, missionFails: 0, kids: 0,
    danger: {
      raids: {} as Record<string, number>, disasterStarted: 0, disasterHandled: 0, disasterStruck: {} as Record<string, number>,
      tributes: 0, maintained: 0, away: { raids: 0, raidsLost: 0, disasters: 0, hurt: 0, died: 0 },
      deathDays: [] as number[], minPop: Infinity, minPopDay: 0, raidLog: [] as number[][], byKind: {} as Record<string, number>,
    },
    arrivals: { accepted: 0, refused: 0, doorAdmitted: 0 },
    events: {} as Record<string, number>,
    chapters: [] as SimResult['chapters'],
    gaps: [] as [number, number][], lastAct: 0, onlineSeconds: 0,
    offline: [] as OfflineEntry[],
    lastProgressKey: '', lastProgress: { play: 0, wall: 0 },
    objectivesDone: 0, supplyDrops: 0,
    projectStages: 0, caravans: { ok: 0, lost: 0 }, weeklyDone: 0, // [LateGame]
    bot: { actions: {} as Record<string, number>, pulledForRuins: 0, journalReads: 0, queuedResearch: 0, longTrips: 0 },
  };
  /** After a rebirth the milestones of the new timeline are kept apart, with times counted from the rebirth. */
  let timelineStart = 0;
  let rebirthsDone = 0;
  let rebirthPending = false;
  const timeline2: Record<string, Milestone> = {};
  const mark = (k: string) => {
    if (rebirthsDone === 0) { if (!R.milestones[k]) R.milestones[k] = { play: Math.round(play()), wall: Math.round(wall) }; return; }
    if (!timeline2[k]) timeline2[k] = { play: Math.round(play()), wall: Math.round(wall - timelineStart) };
  };
  const acted = (kind: string) => {
    R.bot.actions[kind] = (R.bot.actions[kind] ?? 0) + 1;
    const p = play();
    if (p - R.lastAct >= 60) R.gaps.push([Math.round(R.lastAct), Math.round(p - R.lastAct)]);
    R.lastAct = p;
  };

  let pendingStory: string | null = null;
  let lastOffline: Loose | null = null;
  const offs = [
    bus.on('era:advance', (era: unknown) => mark(`era ${era} ${ERAS[era as number]?.key ?? ''}`.trim())),
    bus.on('act:advance', (act: unknown) => mark(`act ${act}`)), // [Long game]
    bus.on('ending', (id: unknown) => mark(`ending ${id}`)), // [P5]
    bus.on('research:complete', (id: unknown) => { const f = (researchData.RESEARCH as unknown as { id: string; fork?: string }[]).find(r => r.id === id)?.fork; if (f) mark(`doctrine ${id}`); }), // [P3]
    bus.on('survivor:died', (_s: unknown, cause: unknown) => {
      R.deaths.total++;
      const c = String(cause ?? 'other');
      R.deaths.causes![c] = (R.deaths.causes![c] ?? 0) + 1;
      const s = state();
      if (s.resources.food.amount <= 0 || s.resources.water.amount <= 0) R.deaths.famine++; else R.deaths.other++;
      mark('first death');
      R.danger.deathDays.push(+(wall / 86400).toFixed(2));
    }),
    // [Danger] raid outcomes, disasters, away danger
    bus.on('raid:resolved', (r: unknown) => {
      const x = r as { key: string; kind?: string; stance?: string };
      R.danger.raids[x.key] = (R.danger.raids[x.key] ?? 0) + 1;
      if (x.kind) {
        const out = x.key.startsWith('win') ? 'win' : x.key;
        const k = `${x.kind}/${x.stance ?? 'hold'}/${out}`;
        R.danger.byKind![k] = (R.danger.byKind![k] ?? 0) + 1;
      }
    }),
    bus.on('disaster:start', () => { R.danger.disasterStarted++; }),
    bus.on('disaster:handled', () => { R.danger.disasterHandled++; }),
    bus.on('disaster:struck', (r: unknown) => { const k = (r as { kind: string }).kind; R.danger.disasterStruck[k] = (R.danger.disasterStruck[k] ?? 0) + 1; }),
    bus.on('danger:away', (r: unknown) => {
      const a = r as { raids: number; raidsLost: number; disasters: unknown[]; hurt: number; died: unknown[] };
      R.danger.away.raids += a.raids; R.danger.away.raidsLost += a.raidsLost; R.danger.away.disasters += a.disasters.length;
      R.danger.away.hurt += a.hurt; R.danger.away.died += a.died.length;
    }),
    bus.on('incident:start', () => R.incidents++),
    bus.on('story:chapter', (id: unknown) => { pendingStory = id as string; }),
    bus.on('story:done', (id: unknown) => { R.chapters.push({ id: id as string, wall: Math.round(wall), play: Math.round(play()) }); mark(`story ${id}`); }),
    bus.on('family:child', () => { R.kids++; mark('first child'); }),
    bus.on('floor:dug', (f: unknown) => mark(`floor B${(f as number) + 1}`)),
    bus.on('mission:complete', (r: unknown) => {
      const rep = r as { success: boolean; injuries?: unknown[] };
      R.missions++;
      if (!rep.success) R.missionFails++;
      R.injuries.expedition += rep.injuries?.length ?? 0;
      mark('first expedition back');
    }),
    bus.on('research:complete', (id: unknown) => mark(`research ${id}`)),
    bus.on('objective:complete', () => { R.objectivesDone++; }),
    bus.on('project:stage', () => { R.projectStages++; mark('first project stage'); }),
    bus.on('project:done', (id: unknown) => mark(`project ${id} done`)),
    bus.on('caravan:complete', (r: unknown) => { const c = r as { ok: boolean }; if (c.ok) R.caravans.ok++; else R.caravans.lost++; mark('first caravan home'); }),
    bus.on('weekly:done', () => { R.weeklyDone++; mark('first weekly challenge'); }),
    bus.on('survivor:rank', (_s: unknown, rk: unknown) => { if (rk === 5) mark('first rank-5 worker'); }),
    bus.on('ruin:cleared', () => { if (state().ruins.length === 0) mark('all ruins cleared'); }),
    bus.on('event:triggered', (id: unknown) => { R.events[id as string] = (R.events[id as string] ?? 0) + 1; }),
    bus.on('offline:processed', (rep: unknown) => { lastOffline = rep as Loose; }),
  ];

  const researchDone = (s: GameState) => {
    const base = Object.values(s.research).filter(r => r.completed).length;
    const ref = (s as unknown as { refinements?: Record<string, number> }).refinements;
    return base + (ref ? Object.values(ref).reduce((a, b) => a + b, 0) : 0);
  };
  const sample = (label: string) => {
    const s = state();
    const res: Record<string, [number, number, number]> = {};
    // [Long game] tier-2 goods too, when the engine has them.
    for (const k of [...TRACKED, 'components', 'alloys'] as ResourceType[]) {
      const r = s.resources[k];
      if (!r) continue;
      res[k] = [Math.round(r.amount), Math.round(r.cap), +(r.productionRate - r.consumptionRate).toFixed(2)];
    }
    const adults = s.survivors.filter(x => !x.child);
    R.samples.push({
      label, wallH: fmtH(wall), playH: fmtH(play()), era: s.era ?? 0, pop: s.survivors.length, maxPop: s.maxPopulation,
      kids: s.survivors.length - adults.length, floors: s.currentFloors, buildings: s.buildings.length,
      levels: s.buildings.reduce((a, b) => a + b.level, 0), research: researchDone(s),
      explored: s.explorationMap.filter(h => h.explored).length - 1,
      morale: Math.round(s.survivors.reduce((a, x) => a + x.happiness, 0) / Math.max(1, s.survivors.length)),
      minHp: Math.round(s.survivors.length ? Math.min(...s.survivors.map(x => x.health)) : 0), step: s.tutorialStep,
      iso: e.metaSystem.rebirthGain(s), res,
    });
  };
  const trackProgress = () => {
    const s = state();
    const key = [s.era, s.currentFloors, s.buildings.length, s.buildings.reduce((a, b) => a + b.level, 0), researchDone(s), s.maxPopulation].join('|');
    if (key !== R.lastProgressKey) { R.lastProgressKey = key; R.lastProgress = { play: Math.round(play()), wall: Math.round(wall) }; }
    for (const p of [5, 10, 20, 30, 40, 50, 75, 100]) if (s.survivors.length >= p) mark(`population ${p}`);
    if (s.survivors.length < R.danger.minPop && wall > 3 * 86400) { R.danger.minPop = s.survivors.length; R.danger.minPopDay = +(wall / 86400).toFixed(2); }
    if (!R.genesis && e.metaSystem.canRebirth(s)) {
      mark('GENESIS available');
      R.genesis = { wall: Math.round(wall), play: Math.round(play()), payout: e.metaSystem.rebirthGain(s) };
    }
    // A player who wants the next timeline presses Genesis as soon as it is on offer.
    if (rebirthsDone < (o.rebirths ?? 0) && e.metaSystem.canRebirth(s)) rebirthPending = true;
  };

  // ---- the bot ----
  const ex = () => e.explorationSystem as unknown as Loose;
  const rsys = () => e.researchSystem as unknown as Loose;
  const net = (r: ResourceType) => state().resources[r].productionRate - state().resources[r].consumptionRate;
  const free = (sv: SurvivorState) => !sv.isOnMission && !sv.child;

  // ---- [Danger bot] raid warnings, disasters, maintenance and memorials ----
  // The neglect player sits through sessions like a casual one but never reacts to a warning or to wear.
  const reacts = o.mode !== 'neglect';
  /** A real player misses some warnings (phone in a pocket): the bot answers 80% of them. */
  const noticed = new Map<string, boolean>();
  const notice = (key: string) => {
    if (!noticed.has(key)) noticed.set(key, Math.random() < 0.8);
    return noticed.get(key)!;
  };
  const respondDanger = () => {
    const s0 = state();
    const d0 = (s0 as unknown as { danger?: DangerLike }).danger;
    if (!d0) return;
    // Everyone taps through a memorial; only a player who cares holds the ceremony (it costs a shared meal).
    for (let i = 0; i < 6 && ((state() as unknown as { danger: DangerLike }).danger.memorialQueue?.length ?? 0) > 0; i++) {
      const ds = (e as unknown as { deathSystem?: { answerMemorial: (c: string, r: unknown) => boolean } }).deathSystem;
      if (!ds || !((reacts && ds.answerMemorial('ceremony', e.resourceSystem)) || ds.answerMemorial('carryOn', e.resourceSystem))) break;
    }
    if (!reacts) return;
    // [plan4:ST-14] Trouble (a fire, an epidemic, a raid on the way): shut the doors around it; when it is over, open them again (shut doors draw power).
    if (infraUnlocked(state(), 'bulkhead')) {
      if (troubleOn(state())) { if (closeEmergencyDoors(sm) > 0) acted('doors'); }
      else if (shutDoorCount(state()) > 0 && openAllDoors(sm) > 0) acted('doors');
    }
    const d = (state() as unknown as { danger: DangerLike }).danger;
    // A raid is coming: post guards, and pay the toll if the door still looks too weak.
    const freshRaid = !!d.raid && !noticed.has(`raid:${d.raid.hitAt}`);
    if (d.raid && notice(`raid:${d.raid.hitAt}`)) {
      // [P2] The scout says who is coming: weigh the defense against that kind (older engines ignore the extra arguments).
      const kind = (d.raid as { kind?: string }).kind as Parameters<typeof bunkerDefense>[1];
      const defOf = (stance: 'hold' | 'sally' = 'hold') => (bunkerDefense as (s: unknown, k?: unknown, st?: unknown) => number)(state(), kind, stance);
      let def = defOf();
      if (freshRaid && R.danger.raidLog.length < 40) R.danger.raidLog.push([d.raid.strength, def, state().survivors.length, state().era]);
      if (def < d.raid.strength) {
        const armory = state().buildings.find(b => b.type === 'armory' && !b.isConstructing);
        if (armory) {
          for (const sv of state().survivors.filter(x => !x.assignedBuildingId && free(x))) {
            if (!e.populationSystem.assignSurvivorToBuilding(sm, sv.id, armory.id)) break;
            acted('guard');
          }
        }
        def = defOf();
      }
      const setStance = fn(e.eventSystem, 'setStance');
      if (def < d.raid.strength && setStance && kind) {
        // Still short: send the guards out if that is enough, else pay, else hide everyone below.
        if (defOf('sally') >= d.raid.strength) { setStance('sally'); acted('stance'); }
        else if (e.eventSystem.canPayTribute()) { e.eventSystem.payTribute(); R.danger.tributes++; acted('tribute'); }
        else { setStance('hide'); acted('stance'); }
      } else if (def < d.raid.strength && e.eventSystem.canPayTribute()) { e.eventSystem.payTribute(); R.danger.tributes++; acted('tribute'); }
    }
    for (const dz of d.disasters) {
      if (!notice(`dz:${dz.id}`)) continue;
      if (!e.incidentSystem.handleBlock(dz.id) && e.incidentSystem.handle(dz.id)) acted('disaster');
    }
    const maintain = (e as unknown as { maintenanceSystem?: { maintain: (id: string) => boolean } }).maintenanceSystem;
    if (maintain) {
      for (const b of state().buildings) {
        if ((b as unknown as { wear?: number }).wear !== undefined && (b as unknown as { wear: number }).wear >= 30 && maintain.maintain(b.id)) { R.danger.maintained++; acted('maintain'); }
      }
    }
  };

  const resolveDialogs = () => {
    respondDanger(); // [Danger bot]
    const s = state();
    // People who gathered at the door while we were away (S6).
    const answerDoor = fn(e, 'answerDoor');
    const waiting = (s as unknown as { doorWaiting?: unknown[] }).doorWaiting;
    if (answerDoor && waiting && waiting.length > 0) {
      const n = Number(answerDoor(true)) || 0;
      R.arrivals.doorAdmitted += n;
      R.arrivals.accepted += n;
      if (n > 0) acted('door');
    }
    if (s.activeEvent) {
      const id = s.activeEvent.id;
      const choices = e.eventSystem.getChoices();
      const avail = choices.filter(c => e.eventSystem.isChoiceAvailable(c));
      const prefs = EVENT_PREF[id];
      if (!KNOWN_EVENTS.has(id)) warn(`new event "${id}" seen; the bot took the first available choice`);
      const pick = (prefs ? prefs.map(k => avail.find(c => c.key === k)).find(Boolean) : undefined) ?? avail[0];
      if (pick) {
        const res = e.eventSystem.resolve(pick.key);
        if (id === 'wanderer' || id === 'group') {
          if (pick.key === 'refuse') R.arrivals.refused += id === 'group' ? 2 : 1;
          else R.arrivals.accepted += pick.key === 'accept' && id === 'group' ? 2 : 1;
          if (id === 'group' && pick.key === 'one') R.arrivals.refused++;
        }
        if (res?.key === 'fightLose') R.injuries.raid++;
        if (id === 'sickness' && res?.key === 'rest') R.injuries.sickness++;
      } else if (choices.length) {
        warn(`event "${id}": no affordable choice`);
      }
    }
    if (pendingStory) {
      const ch = getChapter(pendingStory);
      const key = ch?.choices?.find(c => e.storySystem.canChoose(ch.id, c.key))?.key ?? null;
      e.storySystem.finish(pendingStory, ch?.choices?.length ? key ?? ch.choices[ch.choices.length - 1].key : null);
      pendingStory = null;
    }
    const asking = e.explorationSystem.waitingMission();
    if (asking?.event) {
      const ev = expeditionEvent(asking.event.id);
      const key = EXP_FIRST[asking.event.id] && ev?.options.some(x => x.key === EXP_FIRST[asking.event!.id]) ? EXP_FIRST[asking.event.id] : ev?.options[0]?.key;
      if (key) e.explorationSystem.choose(asking.id, key);
    }
    while (state().missionReports.length) e.explorationSystem.dismissReport();
    for (const inc of state().incidents) if (inc.severity > 0.5 && e.incidentSystem.canQuickFix(inc.id)) e.incidentSystem.quickFix(inc.id);
    // A human opens the journal when a note arrives (this is what the "read the note" objective waits for).
    const unread = state().loreUnread ?? [];
    if (unread.length) {
      for (const id of [...unread]) e.restorationSystem.markRead(id);
      R.bot.journalReads += unread.length;
    }
    // The daily supply drop (NICE3), when the game has one: a player opens the crate when it's there.
    const supply = (e as unknown as Loose).supplySystem;
    const ready = fn(supply, 'isReady'), claim = fn(supply, 'claim');
    if (ready && claim && ready(state()) && claim()) { R.supplyDrops++; acted('supplyDrop'); }
  };

  /** Puts hands on a started ruin that has none: an idle survivor, else someone pulled off a room job. */
  const staffRuins = () => {
    const s = state();
    for (const r of s.ruins.filter(x => x.started)) {
      if (e.restorationSystem.workers(state(), r.id).length > 0) continue;
      const idle = state().survivors.filter(x => !x.assignedBuildingId && free(x) && x.health > 20);
      let pick = idle[0];
      if (!pick) {
        const st = state();
        const crew = (id: string | null) => st.buildings.find(b => b.id === id)?.assignedSurvivorIds.length ?? 0;
        const isCore = (id: string | null) => CORE.includes(st.buildings.find(b => b.id === id)?.type as BuildingType);
        pick = st.survivors.filter(x => free(x) && x.health > 20 && x.assignedBuildingId && !x.assignedBuildingId.startsWith('r_'))
          .sort((a, b) => crew(b.assignedBuildingId) - crew(a.assignedBuildingId) || Number(isCore(a.assignedBuildingId)) - Number(isCore(b.assignedBuildingId)))[0];
        if (pick) R.bot.pulledForRuins++;
      }
      if (pick && e.restorationSystem.assign(r.id, pick.id)) acted('staffRuin');
    }
  };

  const startResearch = () => {
    const ids = [...researchData.RESEARCH.map(r => r.id)];
    const refinements = (researchData as unknown as Loose).REFINEMENTS as { id: string }[] | undefined;
    const refIds = new Set((refinements ?? []).map(r => r.id));
    ids.push(...refIds);
    const defOf = fn(e.researchSystem, 'defOf');
    const costK = (id: string) => {
      const d = (defOf ? defOf(state(), id) : researchData.RESEARCH.find(r => r.id === id)) as { cost?: Record<string, number> } | undefined;
      return d?.cost?.knowledge ?? 0;
    };
    // [P3] Doctrine forks: each seed follows one path per fork (seed 1 the first option, seed 2 the second...).
    const all = researchData.RESEARCH as unknown as { id: string; fork?: string }[];
    const forks = [...new Set(all.map(r => r.fork).filter(Boolean))] as string[];
    const chosen = new Set(forks.map((f, fi) => { const opts = all.filter(r => r.fork === f); return opts[(o.seed + fi) % opts.length].id; }));
    const onPath = (id: string) => { const f = all.find(r => r.id === id)?.fork; return !f || chosen.has(id); };
    // Main tree first (cheapest), endless refinements only when nothing else is open; fill the queue if there is one.
    for (let i = 0; i < 6; i++) {
      const next = ids.filter(id => onPath(id) && e.researchSystem.canStart(state(), id))
        .sort((a, b) => Number(refIds.has(a)) - Number(refIds.has(b)) || costK(a) - costK(b))[0];
      if (!next) break;
      const hadActive = !!e.researchSystem.activeId(state());
      if (!e.researchSystem.start(sm, next)) break;
      if (hadActive) R.bot.queuedResearch++;
      acted('research');
      if (!fn(rsys(), 'queue')) break;
    }
  };

  const findSpot = (type: BuildingType) => {
    const s = state();
    for (const f of allowedFloors(type, s.currentFloors)) {
      const pos = e.buildingSystem.findFreeSpot(type, f, s);
      if (pos) return pos;
    }
    return null;
  };

  /** [plan4] The rooms of the redesign's first wave: the bot builds them last and upgrades them last (core rooms carry the Act goals). */
  const NEW_ROOMS: BuildingType[] = ['batteryBank', 'commons', 'library', 'recycler', 'condenser', 'mushroomFarm', 'gatePost', 'barracks', 'solarArray', 'windTurbine', 'watchtower']; // [plan4:ST-16] the last three stand on the surface row
  const hallsStillFit = (type: BuildingType, pos: { x: number; y: number; floor: number }) => {
    const s = state();
    const fake = { id: 'b_fake', type, level: 1, position: pos, assignedSurvivorIds: [], constructionProgress: 0, constructionTotal: 1, isConstructing: true, specialization: null };
    const after = { ...s, buildings: [...s.buildings, fake] } as GameState;
    // A hall is two levels tall: it often has no spot until the next floor is dug, so judge it with that floor counted in (when the Act lets it come).
    const block = e.buildingSystem.digBlock(s);
    const extra = block === 'act' || block === 'max' ? 0 : 1;
    for (const hall of ['atrium', 'reactorHall'] as BuildingType[]) {
      if (!isBuildingUnlocked(s, hall) || s.buildings.some(b => b.type === hall)) continue;
      const spot = (st: GameState) => { const g = { ...st, currentFloors: st.currentFloors + extra } as GameState; return allowedFloors(hall, g.currentFloors).some(f => !!e.buildingSystem.findFreeSpot(hall, f, g)); };
      if (spot(s) && !spot(after)) return false;
    }
    return true;
  };
  let noSpaceFor: BuildingType | null = null;
  /** [plan4:ST-3] Rooms standing when the last wing step was started: the next step waits until something was built in the room it made. */
  let roomsAtLastWing = -1;
  const build = () => {
    const s = state();
    const want: BuildingType[] = [];
    const obj = e.objectiveSystem.current(s);
    if (obj.action?.kind === 'build') want.push(obj.action.type);
    if (net('power') < 0.5) want.push('generator');
    if (net('water') < 0.2) want.push('waterPump');
    if (net('food') < 0.2) want.push('farm');
    if (s.survivors.length >= s.maxPopulation - 1) want.push('quarters');
    // Storage first when the next dig (or an upgrade) costs more than the bunker can even hold.
    const dig = e.buildingSystem.digCost(s);
    const capBlocked = Object.entries(dig).some(([r, v]) => v > (s.resources[r as ResourceType]?.cap ?? Infinity));
    if (capBlocked) want.push('storage');
    want.push('workshop', 'laboratory', 'canteen', 'storage', 'radioTower', 'medbay', 'hydroponics', 'waterPurifier', 'armory', 'trainingRoom', 'reactor', 'atrium', 'reactorHall');
    // [plan4:BL-9..14,19,33] The first eight new rooms come last (core rooms first), and only once their research is done AND their Act has come:
    // isBuildingUnlocked covers the research; the copy limit is the smaller of the bot's own and the room's maxCopies (placeBlock enforces maxCopies too).
    const act = (s as unknown as { longGame?: { meta: { act: number } } }).longGame?.meta.act ?? 1;
    const pop = s.survivors.length;
    const newRoomLimit: Partial<Record<BuildingType, number>> = {};
    const wantNew = (type: BuildingType, fromAct: number, limit: number, when = true) => {
      if (act < fromAct || !when) return;
      newRoomLimit[type] = limit;
      want.push(type);
    };
    wantNew('commons', 2, 1);
    wantNew('mushroomFarm', 2, act >= 4 ? 3 : 2, net('food') < 2 || act >= 3);
    wantNew('condenser', 2, act >= 4 ? 2 : 1, net('water') < 1.5 || act >= 3);
    wantNew('batteryBank', 2, act >= 4 ? 2 : 1);
    wantNew('library', 2, act >= 4 ? 2 : 1);
    wantNew('gatePost', 2, act >= 4 ? 2 : 1);
    wantNew('recycler', 3, 1, s.resources.scrap.amount < s.resources.scrap.cap * 0.6);
    wantNew('barracks', 3, act >= 5 ? 2 : 1, pop >= s.maxPopulation - 3);
    // [plan4:ST-16] The surface row (open from Act II): panels while power is thin, a turbine once the gusts are worth a room, a lookout against raids.
    // findSpot walks allowedFloors, which for these is floor -1 only (a gate post takes floor 0 first, then the row).
    wantNew('solarArray', 2, act >= 4 ? 3 : 2, net('power') < 3 || act >= 3);
    wantNew('windTurbine', 3, act >= 5 ? 3 : 1, net('power') < 3 || act >= 4);
    wantNew('watchtower', 3, act >= 5 ? 2 : 1);
    noSpaceFor = null;
    for (const type of want) {
      if (!BUILDABLE_TYPES.includes(type) || !isBuildingUnlocked(s, type)) continue;
      const count = s.buildings.filter(b => b.type === type).length;
      const limit = newRoomLimit[type] ?? (type === 'quarters' ? 8 : CORE.includes(type) ? 4 : isHall(type) ? 1 : 2);
      if (count >= Math.min(limit, getDef(type)?.maxCopies ?? Infinity)) continue;
      const cost = e.buildingSystem.getBuildCost(type, s);
      if (!e.resourceSystem.canAfford(s, cost)) continue;
      const pos = findSpot(type);
      if (!pos) { if (!NEW_ROOMS.includes(type)) noSpaceFor = noSpaceFor ?? type; continue; } // [plan4] a new room with no fitting spot (no deep floor yet) must not trigger digging
      // [plan4] A new room never takes the last spot a hall (atrium, reactor hall: blueprint-gated, built when the blueprints come) could still use.
      if (NEW_ROOMS.includes(type) && !hallsStillFit(type, pos)) continue;
      e.resourceSystem.spend(sm, cost);
      if (e.buildingSystem.placeBuilding(type, pos, sm)) { mark(`built ${type}`); acted('build'); }
      break;
    }
    return capBlocked;
  };

  /**
   * [plan4:ST-14/15] The safety works: an emergency stairwell for every deep floor under the fire code, a couple of vent stacks for a crowded bunker,
   * and bulkhead doors beside the rooms that burn. Only out of a surplus (what is left after paying stays at 30% of storage).
   */
  const infraBuild = () => {
    const s = state();
    const act = (s as unknown as { longGame?: { meta: { act: number } } }).longGame?.meta.act ?? 1;
    const surplus = (cost: Record<string, number>) => Object.entries(cost).every(([r, v]) => { const x = s.resources[r as ResourceType]; return !x || x.amount - v >= 0.3 * x.cap; });
    if (infraUnlocked(s, 'stairwell')) {
      const bad = fireCodeFloors(s);
      if (bad.length) {
        const cost = columnCost(s, 'stairwell', 1);
        const tries = [Math.min(bad[0] + 1, s.currentFloors - 1), bad[0]];
        const f = tries.find(t => columnBlock(s, 'stairwell', t, 1) === null);
        if (f !== undefined && surplus(cost) && e.resourceSystem.canAfford(s, cost) && buildColumn(sm, e.resourceSystem, 'stairwell', f, 1) === null) { mark('first stairwell'); acted('infra'); return; }
      }
    }
    if (infraUnlocked(s, 'ventStack') && s.survivors.length >= 16 && infraOfKind(s, 'ventStack').length < (act >= 5 ? 3 : 2)) {
      const cost = columnCost(s, 'ventStack', 1);
      let f = -1;
      for (let t = s.currentFloors - 1; t >= 0 && f < 0; t--) if (columnBlock(s, 'ventStack', t, 1) === null) f = t;
      if (f >= 0 && surplus(cost) && e.resourceSystem.canAfford(s, cost) && buildColumn(sm, e.resourceSystem, 'ventStack', f, 1) === null) { mark('first vent stack'); acted('infra'); return; }
    }
    if (infraUnlocked(s, 'bulkhead') && act >= 3 && infraOfKind(s, 'bulkhead').length < (act >= 4 ? 4 : 2)) {
      const cost = doorCost();
      if (!surplus(cost) || !e.resourceSystem.canAfford(s, cost)) return;
      const hot = new Set(['generator', 'reactor', 'batteryBank', 'recycler', 'reactorHall']);
      for (const b of s.buildings) {
        if (b.isConstructing || !hot.has(b.type)) continue;
        for (const x of roomEdgeBoundaries(b)) {
          if (doorBlock(s, b.position.floor, x) === null && buildDoor(sm, e.resourceSystem, b.position.floor, x) === null) { mark('first bulkhead'); acted('infra'); return; }
        }
      }
    }
  };

  const upgrade = (capBlocked: boolean) => {
    const s = state();
    // canUpgrade(b, state) holds the Act's level ceiling in newer engines (older ones ignore the state).
    const canUp = (b: typeof s.buildings[number]) => e.buildingSystem.canUpgrade(b, s)
      && e.resourceSystem.canAfford(s, e.buildingSystem.getUpgradeCost(b));
    if (capBlocked) {
      const st = s.buildings.filter(b => b.type === 'storage' && canUp(b)).sort((a, b) => a.level - b.level)[0];
      if (st) { e.resourceSystem.spend(sm, e.buildingSystem.getUpgradeCost(st)); e.buildingSystem.upgradeBuilding(st.id, sm); acted('upgrade'); return; }
    }
    if (s.resources.materials.amount > s.resources.materials.cap * 0.7) {
      const up = [...s.buildings].filter(canUp).sort((a, b) => Number(NEW_ROOMS.includes(a.type)) - Number(NEW_ROOMS.includes(b.type)) || a.level - b.level)[0]; // [plan4] new rooms last
      if (up) { e.resourceSystem.spend(sm, e.buildingSystem.getUpgradeCost(up)); e.buildingSystem.upgradeBuilding(up.id, sm); acted('upgrade'); mark('first upgrade'); }
    }
  };

  /** [Long game] Rooms the bot keeps in a tier-2 role once its Act opens: role id -> how many. */
  const tier2Roles = (): [string, number][] => {
    const act = (state() as unknown as { longGame?: { meta: { act: number } } }).longGame?.meta.act ?? 0;
    const out: [string, number][] = [];
    if (act >= 3) out.push(['assemblyLine', act >= 4 ? 3 : 2]);
    if (act >= 4) out.push(['arcFurnace', 2]);
    if (act >= 5) out.push(['dataVault', 2]);
    if (act >= 6) out.push(['councilHall', 2]);
    if (act >= 7) out.push(['seedForge', 1]);
    return out;
  };
  const specializeAndDig = () => {
    const bsys = e.buildingSystem as unknown as Loose;
    const roles = tier2Roles();
    const wantRole = (type: BuildingType): string | null => {
      for (const [id, n] of roles) {
        const sp = specsFor(type).find(x => x.id === id);
        if (!sp) continue;
        if (state().buildings.filter(b => b.specialization === id).length < n) return id;
      }
      return null;
    };
    for (const b of state().buildings) {
      if (e.buildingSystem.canSpecialize(state(), b.id) && e.resourceSystem.canAfford(state(), e.buildingSystem.specCost())) {
        const pick = wantRole(b.type) ?? specsFor(b.type).filter(x => !(x as unknown as { act?: number }).act)[0]?.id;
        if (!pick) continue;
        e.resourceSystem.spend(sm, e.buildingSystem.specCost());
        e.buildingSystem.specialize(sm, b.id, pick);
        mark('first specialization'); acted('specialize');
      }
    }
    // A tier-2 role still missing and no fresh room for it: refit the highest specialized room of that type.
    const canRetool = fn(bsys, 'canRetool'), retool = fn(bsys, 'retool'), retoolCost = fn(bsys, 'retoolCost');
    if (canRetool && retool && retoolCost) {
      for (const [id, n] of roles) {
        if (state().buildings.filter(b => b.specialization === id).length >= n) continue;
        const cand = state().buildings.filter(b => b.specialization && b.specialization !== id && !roles.some(([r]) => r === b.specialization) && canRetool(state(), b.id, id))
          .sort((a, b) => b.level - a.level)[0];
        const cost = retoolCost() as Record<string, number>;
        if (cand && e.resourceSystem.canAfford(state(), cost)) {
          e.resourceSystem.spend(sm, cost);
          if (retool(sm, cand.id, id)) { acted('retool'); mark(`first ${id}`); }
        }
      }
    }
    const s = state();
    // Older engines dig only when crowded; with Acts the bot digs as deep as the Act allows (the Act goals ask for depth).
    const digSys = (e as unknown as Loose).digSystem as Loose | undefined;
    const crowded = s.buildings.length / Math.max(1, s.currentFloors) > 4.5 || noSpaceFor !== null || !!digSys;
    // [plan4:ST-3/ST-5] No place for a wanted room: widen a wing when that makes room cheaper (per slot) than a new floor, or when no floor can be dug
    // (the Act's depth cap). A new floor is 12 slots, a wing step 2. Feature-detected: older engines have no wings.
    const wingStep = fn(bsys, 'digWing'), wingList = fn(bsys, 'wingOptions');
    if (wingStep && wingList && noSpaceFor !== null && s.buildings.length > roomsAtLastWing) {
      const price = (c: Record<string, number>) => Object.values(c).reduce((a, v) => a + v, 0);
      const blockNow = e.buildingSystem.digBlock ? e.buildingSystem.digBlock(s) : null;
      const floorPerSlot = blockNow === 'act' || blockNow === 'max' ? Infinity : price(e.buildingSystem.digCost(s)) / 12;
      const zone = allowedFloors(noSpaceFor, s.currentFloors);
      const opts = (wingList(s) as { floor: number; side: 'w' | 'e'; cost: Record<string, number>; block: string | null }[])
        // Only out of a surplus (like upgrades): what is left after paying must stay at 40% of storage, so a wing never starves the next floor or Act.
        .filter(w => w.block === null && zone.includes(w.floor)
          && Object.entries(w.cost).every(([r, v]) => { const x = s.resources[r as ResourceType]; return !x || x.amount - v >= 0.4 * x.cap; }))
        .sort((a, b) => price(a.cost) - price(b.cost) || (a.side === 'e' ? 0 : 1) - (b.side === 'e' ? 0 : 1) || a.floor - b.floor);
      const w = opts[0];
      if (w && price(w.cost) / 2 < floorPerSlot && wingStep(sm, w.floor, w.side)) { roomsAtLastWing = s.buildings.length; mark('first wing'); acted('wing'); }
    }
    if (crowded && e.buildingSystem.canDig(s) && e.resourceSystem.canAfford(s, e.buildingSystem.digCost(s))) {
      e.resourceSystem.spend(sm, e.buildingSystem.digCost(s));
      e.buildingSystem.dig(sm);
      acted('dig');
    }
    if (digSys && fn(digSys, 'autoStaff')?.()) acted('digStaff');
    // [Long game] An engaged player hands routine to the Foreman as soon as it takes orders.
    const foreman = (e as unknown as Loose).foremanSystem as Loose | undefined;
    if (foreman && fn(foreman, 'available')?.(state())) for (const o of ['maintain', 'deposit', 'staff']) if (!fn(foreman, 'isOn')?.(state(), o)) fn(foreman, 'set')?.(o, true);
    const d = nextDistrict(state());
    if (d && e.resourceSystem.canAfford(state(), d.cost as Record<string, number>)) {
      e.resourceSystem.spend(sm, d.cost as Record<string, number>);
      e.buildingSystem.digDistrict(sm, d.kind);
      mark(`district ${d.kind}`); acted('district');
    }
  };

  const ruinsAndStaff = () => {
    const s = state();
    if (!s.ruins.some(r => r.started)) {
      const obj = e.objectiveSystem.current(s);
      const target = obj.action?.kind === 'ruin' ? obj.action.restoresTo : undefined;
      const order = [...(target ? [target] : []), ...CORE];
      const r = order.map(t => s.ruins.find(x => x.restoresTo === t && e.restorationSystem.canStart(s, x))).find(Boolean)
        ?? s.ruins.find(x => e.restorationSystem.canStart(s, x));
      if (r && e.restorationSystem.start(r.id)) acted('ruin');
    }
    staffRuins();
    const restoringCore = state().ruins.some(r => r.started && CORE.includes(r.restoresTo as BuildingType));
    for (const sv of state().survivors) {
      if (sv.assignedBuildingId || !free(sv)) continue;
      const st = state();
      const r = st.ruins.find(x => x.started && e.restorationSystem.canAssign(st, x.id));
      if (restoringCore && r) { e.restorationSystem.assign(r.id, sv.id); continue; }
      const short = (['food', 'water', 'power'] as ResourceType[]).filter(k => net(k) < 0.2);
      const rooms = st.buildings.filter(x => !x.isConstructing && x.assignedSurvivorIds.length < (getDef(x.type)?.maxWorkers ?? 0));
      const producesShort = (t: BuildingType) => short.some(k => !!getDef(t)?.production?.[k]);
      const b = rooms.find(x => producesShort(x.type)) ?? rooms[0];
      if (b) e.populationSystem.assignSurvivorToBuilding(sm, sv.id, b.id);
      else if (r) e.restorationSystem.assign(r.id, sv.id);
    }
  };

  const longTrips = !!(surfaceData as unknown as Loose).LONG_TRIP_TIME;
  const expeditions = (long: boolean) => {
    const s = state();
    if (!e.explorationSystem.isUnlocked(s) || s.survivors.length < 6) return;
    const teamsFull = fn(ex(), 'teamsFull');
    const inReach = fn(ex(), 'inReach');
    const full = () => (teamsFull ? !!teamsFull(state()) : state().activeMissions.length >= (o.teams ?? 2));
    for (let guard = 0; guard < 6 && !full(); guard++) {
      const st = state();
      const busy = new Set(st.activeMissions.map(m => `${m.hexX},${m.hexY}`));
      const ok = (h: typeof st.explorationMap[number]) => h.revealed && h.biome !== 'bunker' && !busy.has(`${h.x},${h.y}`) && (!inReach || !!inReach(st, h));
      const dist = (h: { x: number; y: number }) => surfaceData.hexDistance(h.x, h.y);
      let hex = st.explorationMap.filter(h => ok(h) && !h.explored).sort((a, b) => dist(a) - dist(b))[0];
      // Map done: scavenge known ground when scrap runs low (scrap only comes from outside).
      if (!hex && st.resources.scrap.amount < st.resources.scrap.cap * 0.5) hex = st.explorationMap.filter(h => ok(h) && h.explored).sort((a, b) => dist(b) - dist(a))[0];
      const size = st.survivors.length >= 20 ? 3 : 2;
      const team = st.survivors.filter(x => free(x) && x.health > 60).sort((a, b) => b.stats.strength - a.stats.strength).slice(0, size).map(x => x.id);
      if (!hex || team.length < 2) return;
      const sent = long ? (e.explorationSystem.send as unknown as Fn)(hex, team, true) : e.explorationSystem.send(hex, team);
      if (!sent) return;
      if (long) R.bot.longTrips++;
      mark('first expedition out');
      acted('expedition');
    }
  };

  // [Economy A2] Bot: buy from the credits shop when credits allow: blueprints, scrap when low, research speed-ups, extra crate.
  const shopBuy = () => {
    const shop = (e as unknown as Loose).shopSystem as { buy?: (id: string) => boolean } | undefined;
    if (!shop?.buy) return;
    const s = state();
    const order = ['blueprint', 'researchBoost', 'projectBoost'];
    if (s.resources.scrap.amount < s.resources.scrap.cap * 0.4) order.push('scrap20');
    order.push('crate');
    for (const id of order) {
      for (let i = 0; i < 5 && shop.buy(id); i++) acted('shop');
    }
  };

  // ---- [LateGame] big projects, trade caravans, mastery training (all feature-detected) ----
  /** Funds and staffs the active big project: hand-delivers what the stores can spare and fills the crew. */
  /** [P4] Takes every contract the bunker can afford without dropping a store below 30%, and sends free hands on crew jobs. */
  const takeContracts = () => {
    const inbox = (e as unknown as Loose).inboxSystem as Loose | undefined;
    if (!inbox) return;
    const items = (state() as unknown as { longGame?: { inbox: { items: { id: number; kind: string; data: Record<string, unknown> }[] } } }).longGame?.inbox.items ?? [];
    for (const it of items.filter(i => i.kind === 'contract')) {
      const give = (it.data.give ?? {}) as Record<string, number>;
      const s = state();
      const safe = Object.entries(give).every(([r, v]) => (s.resources[r as ResourceType]?.amount ?? 0) - v >= (s.resources[r as ResourceType]?.cap ?? 0) * 0.3);
      if (!safe) continue;
      if (fn(inbox, 'resolve')?.(it.id, 'accept')) { acted('contract'); mark('first contract'); }
    }
  };

  /** [P4] Claims an outpost when the Act allows one and the bunker can pay. */
  const buildOutposts = () => {
    const os = (e as unknown as Loose).outpostSystem as Loose | undefined;
    if (!os) return;
    const s = state();
    const hexes = s.explorationMap.filter(h => h.explored && h.biome !== 'bunker' && !fn(os, 'block')?.(s, h.x, h.y))
      .sort((a, b) => surfaceData.hexDistance(a.x, a.y) - surfaceData.hexDistance(b.x, b.y));
    const h = hexes[0];
    if (h && e.resourceSystem.canAfford(s, fn(os, 'cost')?.(s) as Record<string, number>) && fn(os, 'build')?.(h.x, h.y)) { acted('outpost'); mark('first outpost'); }
    for (const o of (fn(os, 'list')?.(state()) as { id: number; damaged: boolean }[] ?? [])) if (o.damaged && fn(os, 'repair')?.(o.id)) acted('outpostRepair');
  };

  const lgProjects = () => {
    const ps = (e as unknown as Loose).projectSystem as Loose | undefined;
    if (!ps) return;
    const s = state();
    const active = (s as unknown as { activeProjectId?: string | null }).activeProjectId;
    if (!active) return; // ProjectSystem picks the first open project itself
    if (fn(ps, 'autoStaff')?.(active)) acted('projectStaff');
    const given = fn(ps, 'deposit')?.(active) as Record<string, number> | undefined;
    if (given && Object.keys(given).length) acted('projectDeposit');
  };

  const PARTNER_IDS = ['terminus', 'clan', 'noa'];
  /** Sends one caravan at a time (never filling every team slot) and opens relation specials as they unlock. */
  const lgCaravans = () => {
    const x = ex();
    const send = fn(x, 'sendCaravan'), can = fn(x, 'canSendCaravan');
    if (!send || !can) return;
    const s = state();
    for (const pid of PARTNER_IDS) for (let n = 1; n <= 5; n++) if (fn(x, 'canSpecial')?.(state(), pid, n) && fn(x, 'doSpecial')?.(pid, n)) acted('tradeSpecial');
    // Trade only once the map is mostly explored: a bot that trades first starves the expeditions the eras wait for.
    const left = s.explorationMap.filter(h => !h.explored).length;
    if (s.survivors.length < 8 || (left > 150 && s.era < 3) || s.activeMissions.some(m => (m as unknown as { type: string }).type === 'caravan')) return;
    const teamsFull = fn(x, 'teamsFull');
    if (teamsFull?.(s)) return;
    const pair = s.survivors.filter(v => free(v) && v.health > 60).sort((a, b) => b.stats.charisma - a.stats.charisma).slice(0, 2).map(v => v.id);
    if (pair.length < 2) return;
    // Partners with the lowest relation first: every deal counts toward the next level.
    const deals = (s as unknown as { lateGame?: { trade?: { deals?: Record<string, number> } } }).lateGame?.trade?.deals ?? {};
    for (const pid of [...PARTNER_IDS].sort((a, b) => (deals[a] ?? 0) - (deals[b] ?? 0))) {
      for (const tier of ['l', 'm', 's']) {
        if (can(state(), pid, pair, tier) && send(pid, pair, tier)) { acted('caravan'); mark('first caravan out'); return; }
      }
    }
  };

  /** Paid quick training for the most experienced workers who can still rank up, and the rank-5 specialization. */
  const lgTrain = () => {
    const pop = e.populationSystem as unknown as Loose;
    const canTrain = fn(pop, 'canTrain'), train = fn(pop, 'train');
    if (!canTrain || !train) return;
    const s = state();
    if (s.resources.knowledge.amount < s.resources.knowledge.cap * 0.5) return;
    const mxp = (v: SurvivorState) => (v as unknown as { mxp?: number }).mxp ?? 0;
    for (let i = 0; i < 2; i++) {
      const pick = state().survivors.filter(v => canTrain(state(), e.resourceSystem, v)).sort((a, b) => mxp(b) - mxp(a))[0];
      if (!pick || !train(sm, e.resourceSystem, pick.id)) break;
      acted('train');
    }
    for (const v of state().survivors) if (mxp(v) >= 259200 && !(v as unknown as { spec?: string }).spec && fn(pop, 'chooseSpec')?.(sm, v.id, 'master')) { acted('spec'); mark('first mastery specialization'); }
  };

  /** Wall time after which free teams are kept home for the long haul at the end of the session. */
  let holdTeamsAfter = Infinity;
  const think = () => {
    try {
      resolveDialogs();
      ruinsAndStaff();
      startResearch();
      shopBuy();
      const capBlocked = build();
      infraBuild(); // [plan4:ST-14/15]
      upgrade(capBlocked);
      specializeAndDig();
      ruinsAndStaff();
      lgProjects(); lgTrain(); // [LateGame]
      takeContracts(); buildOutposts(); // [P4]
      // [P3] Laws: each seed keeps its own order of preference.
      const enact = fn(e, 'enactLaw');
      if (enact) { const order = ['freeSchools', 'doubleShifts', 'openDoors', 'rationing', 'martialLaw', 'dayOfRest']; for (let k = 0; k < order.length; k++) if (enact(order[(k + o.seed) % order.length])) acted('law'); }
      if (wall < holdTeamsAfter) { lgCaravans(); expeditions(false); } // [LateGame] caravans first, one at a time
    } catch (err) {
      warn(`bot error: ${String((err as Error)?.stack ?? err).split('\n').slice(0, 2).join(' | ')}`);
    }
    trackProgress();
  };
  /** A returning player does everything that's waiting before settling in. */
  const thinkBurst = () => {
    for (let i = 0; i < 15; i++) {
      const before = Object.values(R.bot.actions).reduce((a, b) => a + b, 0);
      think();
      if (Object.values(R.bot.actions).reduce((a, b) => a + b, 0) === before) break;
    }
  };

  // ---- time ----
  let stepErrors = 0;
  const runOnline = async (seconds: number, onHour?: () => void) => {
    const end = wall + seconds;
    let t = 0;
    while (wall < end - 1e-9) {
      if (rebirthPending) {
        rebirthPending = false;
        await e.rebirth();
        rebirthsDone++;
        timelineStart = wall;
        stepper = buildStepper(e, warnings);
      }
      try {
        stepper.run(1);
      } catch (err) {
        if (stepErrors++ < 3) warn(`step error: ${String((err as Error)?.stack ?? err).split('\n').slice(0, 2).join(' | ')}`);
      }
      wall += 1;
      det.clock.now += 1000;
      R.onlineSeconds++;
      const s = state();
      if (s.resources.food.amount <= 0) R.famine++;
      if (s.resources.water.amount <= 0) R.thirst++;
      if (++t % thinkEvery === 0) think();
      if (t % 10 === 0) {
        R.capSamples++;
        for (const k of TRACKED) if (s.resources[k].amount >= s.resources[k].cap - 0.01) R.capTicks[k] = (R.capTicks[k] ?? 0) + 1;
      }
      if (Math.floor(wall) % 3600 === 0) { onHour?.(); if (o.yieldFn) await o.yieldFn(); }
    }
  };

  /** Leaves for `gap` seconds and comes back the way a real player does. */
  const away = async (gap: number) => {
    // The night shift: a player who leaves for hours sends the teams on long hauls if the game has them.
    if (gap >= 2 * 3600 && longTrips) expeditions(true);
    const s = state();
    const eff = Number(fn(e, 'offlineEfficiency')?.() ?? 0.8);
    const netBefore = Object.fromEntries(TRACKED.map(k => [k, s.resources[k].productionRate - s.resources[k].consumptionRate]));
    const before = Object.fromEntries(TRACKED.map(k => [k, s.resources[k].amount]));
    lastOffline = null;
    if (o.returnMode === 'resume' && fn(e, 'simulate')) {
      det.clock.now += gap * 1000;
      lastOffline = fn(e, 'simulate')!(Math.min(gap, 86400), eff) as Loose;
    } else {
      await e.forceSave();
      det.clock.now += gap * 1000;
      const mem = (e as unknown as { saveManager: MemorySave }).saveManager;
      detach();
      ({ e, detach } = constructEngine());
      (e as unknown as { saveManager: MemorySave }).saveManager = mem;
      sm = e.stateManager;
      await e.init();
      pendingStory = null;
      stepper = buildStepper(e, warnings);
      if (stepper.names.join() !== stepList.join()) warn('step list changed after a restart');
    }
    wall += gap;
    const st = state();
    const rep = (lastOffline ?? (e as unknown as { offlineReport?: Loose }).offlineReport ?? {}) as Loose;
    const gained = Object.fromEntries(Object.entries((rep.gained as Record<string, number>) ?? {}).map(([k, v]) => [k, Math.round(v)]));
    let wasted = (rep.wasted as Record<string, number> | undefined) ?? undefined;
    const estimated = !wasted;
    if (!wasted) {
      // Older engines don't report it: estimate from the rates before leaving (power is a flow, not a store).
      wasted = {};
      for (const k of TRACKED.filter(r => r !== 'power')) {
        const pot = netBefore[k] * Math.min(gap, 86400) * eff;
        const got = st.resources[k].amount - before[k];
        if (pot > 0 && pot - got >= 1) wasted[k] = Math.round(pot - got);
      }
    }
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rep)) if (!['seconds', 'gained', 'wasted'].includes(k)) extra[k] = Array.isArray(v) ? v.length : v;
    R.offline.push({
      wallH: fmtH(wall), awayMin: Math.round(gap / 60), gained, wasted, wastedEstimated: estimated,
      arrivals: Number(rep.arrivals ?? 0), doorAdmitted: 0, missions: Number(rep.missions ?? 0),
      research: Array.isArray(rep.research) ? rep.research.length : Number(rep.research ?? 0),
      starvingOnReturn: st.resources.food.amount <= 0 || st.resources.water.amount <= 0, extra,
    });
  };

  // ---- player models ----
  const totalWall = o.mode === 'greedy' ? (o.hours ?? 48) * 3600 : (o.days ?? 7) * 86400;
  const progress = (label: string) => o.onProgress?.(Math.min(1, wall / totalWall), label);
  if (o.mode === 'greedy') {
    sample('start');
    const marks = [5 / 60, 0.25, 0.5];
    for (const h of marks) { await runOnline(h * 3600 - wall); sample(`${Math.round(h * 60)}m`); }
    while (wall < totalWall) {
      await runOnline(Math.min(3600 - (wall % 3600), totalWall - wall));
      sample(`${Math.round(wall / 3600)}h`);
      progress(`${Math.round(wall / 3600)}h`);
    }
  } else {
    const pat = PATTERNS[o.mode];
    const sessions: [number, number][] = [];
    for (let d = 0; d < (o.days ?? 7); d++) pat.s.forEach(([h, min], i) => sessions.push([d * 86400 + h * 3600, (d === 0 && i === 0 ? pat.first : min) * 60]));
    let n = 0;
    for (const [i, [start, dur]] of sessions.entries()) {
      // With long hauls in the game, a player about to leave for hours keeps the last-third teams for the night trip.
      const nextGap = (sessions[i + 1]?.[0] ?? totalWall) - (start + dur);
      holdTeamsAfter = longTrips && nextGap >= 2 * 3600 ? start + dur * (2 / 3) : Infinity;
      if (wall < start) {
        await away(start - wall);
        const before = R.arrivals.doorAdmitted;
        sample(`d${Math.floor(start / 86400)} return`);
        thinkBurst();
        R.offline[R.offline.length - 1].doorAdmitted = R.arrivals.doorAdmitted - before;
      } else {
        thinkBurst();
      }
      if (n === 0) {
        for (const m of [5, 15, 30]) if (m * 60 <= dur) { await runOnline(m * 60 - wall); sample(`${m}m`); }
        if (wall < dur) await runOnline(dur - wall);
      } else {
        await runOnline(dur, () => sample(`${fmtH(wall)}h online`));
      }
      n++;
      thinkBurst();
      sample(`d${Math.floor(start / 86400)} s${n} end`);
      progress(`day ${Math.floor(start / 86400) + 1} session ${n}`);
    }
    // Close out the last day so wall time is the full length.
    if (wall < totalWall) { await away(totalWall - wall); sample('end'); }
  }
  trackProgress();

  // ---- result ----
  const s = state();
  offs.forEach(f => f());
  detach();
  det.restore();
  const capShare: Record<string, number> = {};
  for (const k of TRACKED) capShare[k] = R.capSamples ? +((R.capTicks[k] ?? 0) / R.capSamples).toFixed(3) : 0;
  const idleTotal = R.gaps.reduce((a, g) => a + g[1], 0);
  const result: SimResult = {
    seed: o.seed, mode: o.mode, wallSeconds: Math.round(wall), playSeconds: Math.round(play()),
    runMs: Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0),
    milestones: R.milestones, timeline2: rebirthsDone > 0 ? timeline2 : undefined, rebirths: rebirthsDone, genesis: R.genesis, rebirthPayoutEnd: e.metaSystem.rebirthGain(s),
    samples: R.samples, capShare, famineSeconds: R.famine, thirstSeconds: R.thirst, deaths: R.deaths, injuries: R.injuries,
    danger: { ...R.danger, minPop: R.danger.minPop === Infinity ? s.survivors.length : R.danger.minPop },
    incidents: R.incidents, missions: R.missions, missionFails: R.missionFails, kids: R.kids, arrivals: R.arrivals, events: R.events,
    chapters: R.chapters, chaptersTotal: CHAPTERS.length,
    idle: {
      share: R.onlineSeconds ? +(idleTotal / R.onlineSeconds).toFixed(3) : 0,
      gapsOver5m: R.gaps.filter(g => g[1] >= 300).length,
      longest: [...R.gaps].sort((a, b) => b[1] - a[1]).slice(0, 5),
    },
    offline: R.offline, lastProgress: R.lastProgress,
    stallWallH: fmtH(wall - R.lastProgress.wall), stallPlayH: fmtH(play() - R.lastProgress.play),
    objectivesDone: R.objectivesDone, supplyDrops: R.supplyDrops,
    lateGame: {
      stages: R.projectStages, caravansOk: R.caravans.ok, caravansLost: R.caravans.lost, weekly: R.weeklyDone,
      trained: (s as unknown as { lateGame?: { trained?: number } }).lateGame?.trained ?? 0,
      rank5: s.survivors.filter(v => ((v as unknown as { mxp?: number }).mxp ?? 0) >= 259200).length,
      projectsDone: s.storyFlags.filter(f => f.startsWith('project:')).length,
    },
    final: {
      era: s.era, floors: s.currentFloors, buildings: s.buildings.length, levels: s.buildings.reduce((a, b) => a + b.level, 0),
      pop: s.survivors.length, maxPop: s.maxPopulation, research: researchDone(s), researchNodes: researchData.RESEARCH.length,
      explored: s.explorationMap.filter(h => h.explored).length - 1, mapHexes: s.explorationMap.length - 1,
      tutorialStep: s.tutorialStep, objective: e.objectiveSystem.current(s).id, achievements: s.achievements.length,
      ruinsLeft: s.ruins.length, lore: s.lore.length,
      rooms: Object.entries(s.buildings.reduce((m, b) => { m[b.type] = (m[b.type] ?? 0) + 1; return m; }, {} as Record<string, number>)).map(([k, v]) => `${k}×${v}`).join(' '),
      res: Object.fromEntries(TRACKED.map(k => [k, `${Math.round(s.resources[k].amount)}/${Math.round(s.resources[k].cap)}`])),
    },
    bot: R.bot, warnings, stepList,
    ...(o.dumpSave ? { finalSave: JSON.stringify(e.stateManager.state) } : {}),
  };
  return result;
}

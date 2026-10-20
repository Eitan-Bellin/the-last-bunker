import type { GameState } from '../core/GameState';
import { getProject, projectDone, stagesDone } from './projects';
import { relationLevel } from './trade';

/**
 * The long game's Acts (long-game plan, section 5): the run's chapters. Eras stay the bunker's look and story beats;
 * Acts set how far the bunker may grow (room level, people, floors) and what it must achieve to move on. Each Act
 * ends with its charter: big projects (src/data/projects.ts, `charter`) built in stages with resources and crew.
 * There are seven Acts (ACTS below, MAX_ACT); Genesis opens when the last Act is complete. [plan4:GP-12]
 */
/** [Q2] What kind of work a goal is, so the guide (src/systems/Guide.ts) can say what blocks it and where to go. */
export type GoalKind = 'era' | 'ruins' | 'research' | 'dig' | 'levels' | 'pop' | 'outposts' | 'influence' | 'seedVault';

export interface ActGoal {
  kind: GoalKind;
  /** For 'levels' goals: the room level (Mk) the goal counts. */
  level?: number;
  text: Record<'he' | 'en', string>;
  progress: (s: GameState) => [number, number];
}

export interface ActDef {
  id: number;
  name: Record<'he' | 'en', string>;
  tagline: Record<'he' | 'en', string>;
  /** Highest room level (Mk) in this Act. */
  levelCap: number;
  /** Most people the bunker can hold in this Act (beds beyond it stay empty). */
  popCap: number;
  /** Deepest floor count that may be dug in this Act. */
  floorCap: number;
  /** What it takes to finish this Act (the charter projects are added to these). */
  goals: ActGoal[];
  /** Projects that make up this Act's charter. */
  charter: string[];
  /** [UX] What this Act opens, in plain words (shown on its title card). */
  opens?: Record<'he' | 'en', string>;
  /** [phase5] The Act's signature problem: one goal that is an event or a choice, not a counter (see SignatureDef). */
  signature?: SignatureDef;
}

/**
 * [phase5] An Act's signature problem (economy-pacing fix 6): announced on the Act card and as a goal line, set up by a story beat in the
 * middle of the Act (`beat`, at about half of the Act's other goals, fix 10), and closed by its own chapter (`chapter`). Every outcome of
 * that chapter counts (a worse outcome is still an outcome): the goal is "the chapter was told", so a failed siege or a lost vote never
 * leaves a save stuck. The chapter waits `delay` world seconds after the beat ("they come tomorrow"), less once everything else is done.
 */
export interface SignatureDef {
  id: string;
  icon: string;
  /** The goal line. */
  text: Record<'he' | 'en', string>;
  /** The problem the bunker faces, in one sentence (shown on the Act card). */
  problem: Record<'he' | 'en', string>;
  /** The story chapter that resolves it (story.ts); the goal is met once it was told. */
  chapter: string;
  /** The mid-Act chapter that sets it up (Acts II-VII). */
  beat?: string;
  /** World seconds between the beat and the signature chapter (the warning). */
  delay?: number;
}

/** [phase5] Share of the Act's other goals (and charter stages) at which the mid-Act beat comes. */
export const BEAT_AT = 0.5;
/** [phase5] Once every other goal is met, the signature waits at most this long after its beat. */
export const SIGNATURE_LATE_DELAY = 2 * 3600;
/** [phase5] Act IV: the lookouts see the army a day before it reaches the Wall. */
export const SIEGE_WARNING = 24 * 3600;

/** [phase5] Numbers kept in the run's story flags (`<key>:<n>`): reset by Genesis with the flags, no new save field. */
export function flagNum(s: GameState, key: string): number | null {
  const f = s.storyFlags.find(x => x.startsWith(`${key}:`));
  if (!f) return null;
  const n = Number(f.slice(key.length + 1));
  return Number.isFinite(n) ? n : null;
}

/** [phase5] The run is in exactly this Act of a long game (older bunkers keep their old story timing). */
export function inAct(s: GameState, n: number): boolean {
  return !!s.longGame && !s.longGame.meta.legacy && s.longGame.meta.act === n;
}

/**
 * [phase5] How far the Act is, 0..1: its counter goals and its charter projects (by stages), the signature left out.
 * The mid-Act beat comes at BEAT_AT.
 */
export function actProgress(state: GameState, act: ActDef = actOf(state)): number {
  const parts = [
    ...act.goals.map(g => { const [c, t] = g.progress(state); return Math.min(1, c / Math.max(1, t)); }),
    ...act.charter.map(id => { const def = getProject(id); return def ? Math.min(1, stagesDone(state, id) / def.stages.length) : 1; }),
  ];
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 1;
}

/** [phase5] A signature is met once its chapter was told (any outcome). */
export function signatureProgress(state: GameState, sig: SignatureDef): [number, number] {
  return [state.storyFlags.includes(`story:${sig.chapter}`) ? 1 : 0, 1];
}

/** [phase5] World time the Act's beat was told (ActSystem keeps it as a flag), or null. */
export function beatAt(state: GameState, actId: number): number | null {
  return flagNum(state, `sig:beat${actId}`);
}

/** [phase5] Has the signature chapter's moment come: the beat told, then the warning's delay (shorter once the rest of the Act is done). */
export function signatureDue(state: GameState, actId: number): boolean {
  const sig = ACTS[actId - 1]?.signature;
  if (!sig || !inAct(state, actId)) return false;
  if (!sig.beat) return true;
  return state.storyFlags.includes(`story:${sig.beat}`) && signatureEta(state, actId) === 0;
}

/** [phase5] World seconds until the signature chapter's moment (null: the beat has not come yet). */
export function signatureEta(state: GameState, actId: number): number | null {
  const sig = ACTS[actId - 1]?.signature;
  if (!sig?.beat || !inAct(state, actId)) return null;
  const at = beatAt(state, actId);
  if (at === null) return null;
  const delay = actProgress(state) >= 1 ? Math.min(sig.delay ?? 0, SIGNATURE_LATE_DELAY) : sig.delay ?? 0;
  return Math.max(0, at + delay - (state.longGame?.meta.worldT ?? 0));
}

/** [phase5] The law the colony passed first in this run (Act III's signature), kept as a flag by ActSystem. */
export function firstLaw(state: GameState): string | null {
  return state.storyFlags.find(f => f.startsWith('law:first:'))?.slice(10) ?? null;
}

/** [phase5] The mid-Act beat's moment: this Act, about half done, and its signature not yet told. */
export function beatDue(state: GameState, actId: number): boolean {
  const sig = ACTS[actId - 1]?.signature;
  return !!sig && inAct(state, actId) && !state.storyFlags.includes(`story:${sig.chapter}`) && actProgress(state) >= BEAT_AT;
}

const researched = (s: GameState) => Object.values(s.research).filter(r => r.completed).length;
const allCleared = (s: GameState): [number, number] => {
  // A cleared ruin leaves the list: done = cleared, left = what still stands.
  const left = s.ruins?.length ?? 0;
  const done = s.ruinsCleared ?? 0;
  return left === 0 ? [1, 1] : [done, done + left];
};
const atLeast = (have: number, want: number): [number, number] => [Math.min(have, want), want];
/** Rooms at or above a level. */
const roomsAt = (s: GameState, level: number) => s.buildings.filter(b => b.level >= level && !(b.isConstructing && b.level === level)).length;

export const ACTS: ActDef[] = [
  {
    id: 1,
    name: { he: 'מערכה I · לשרוד', en: 'Act I · Survive' },
    tagline: { he: 'להחזיר חיים למקום מת', en: 'Bring a dead place back to life' },
    levelCap: 3, popCap: 12, floorCap: 5,
    goals: [
      // [phase3] Said as what it takes, not as an era number: the guide lists the steps under it (Guide.ts 'era').
      { kind: 'era', text: { he: 'הפעילו את הבונקר והגיעו ל־10 ניצולים', en: 'Get the bunker running and reach 10 survivors' }, progress: s => atLeast(s.era ?? 0, 2) },
      { kind: 'ruins', text: { he: 'פנו את כל ההריסות', en: 'Clear every ruin' }, progress: allCleared },
      // [phase5] The Reactor Theory goal gave way to the signature (two counters at most); the research itself is unchanged.
    ],
    charter: ['vaultSeal'],
    // [phase5] Act I's moment: the first knock on the door (chapter 3, "The Toll"). No beat: Act I is short and full of chapters.
    signature: {
      id: 'toll', icon: '[[door]]', chapter: 'toll',
      text: { he: 'ענו לשבט החלודה בדלת', en: 'Answer the Rust Clan at the door' },
      problem: { he: 'האורות שלכם נראים מבחוץ, ומישהו כבר בדרך לדלת.', en: 'Your lights can be seen from outside, and someone is already on the way to the door.' },
    },
  },
  {
    id: 2,
    name: { he: 'מערכה II · לשקם', en: 'Act II · Rebuild' },
    tagline: { he: 'מבונקר לבית', en: 'From a bunker to a home' },
    levelCap: 5, popCap: 40, floorCap: 8, // [phase3] 40 (was 30): casual players sat ~10 days at a full house
    goals: [
      // [phase5] "Dig 8 levels" dropped (the floor cap still stops at 8): the winter is the Act's third goal.
      { kind: 'research', text: { he: 'חקרו קידוח עמוק (חפירה מהירה ב־25%)', en: 'Research Deep Drilling (digs 25% faster)' }, progress: s => [s.research.deepDrilling?.completed ? 1 : 0, 1] }, // [phase4]
      { kind: 'levels', level: 5, text: { he: '10 חדרים ברמה 5', en: '10 rooms at level 5' }, progress: s => atLeast(roomsAt(s, 5), 10) },
    ],
    charter: ['radioMast', 'purifier'],
    signature: {
      id: 'winter', icon: '[[snow]]', beat: 'frost', chapter: 'winter', delay: 12 * 3600,
      text: { he: 'עברו את החורף הראשון', en: 'Get through the first winter' },
      problem: { he: 'החורף הראשון מתקרב, והמחנה של שבט החלודה ליד הנהר לא ישרוד אותו.', en: 'The first winter is coming, and the Rust Clan\'s camp by the river will not survive it.' },
    },
    // [phase3] Caravans wait for Act III (with the outposts), the seasons for Act IV.
    opens: { he: 'נפתחים: מנהל העבודה, ופרשות הדרכים של החשמל והמזון, ובהמשך המערכה חוזים עם העולם בחוץ. החלטות שאינן דחופות מחכות בהודעות.', en: 'Opens: the Foreman, the power and food crossroads, and later in the Act contracts with the world outside. Decisions that can wait now wait in Messages.' },
  },
  {
    id: 3,
    name: { he: 'מערכה III · להתיישב', en: 'Act III · Settle' },
    tagline: { he: 'קהילה שמייצרת בעצמה', en: 'A community that makes its own' },
    levelCap: 7, popCap: 65, floorCap: 11,
    goals: [
      // [phase5] The era goal ("Grow into a city under the ground", a goal inside a goal, met in Act II by the sims) gave way to the
      // colony's first law; "dig 11" stays: it paces the Act (dropping it shortened Act III by up to 24% in the 70-day sims).
      { kind: 'dig', text: { he: 'חפרו 11 קומות', en: 'Dig 11 levels' }, progress: s => atLeast(s.currentFloors, 11) },
      { kind: 'levels', level: 7, text: { he: '8 חדרים ברמה 7', en: '8 rooms at level 7' }, progress: s => atLeast(roomsAt(s, 7), 8) },
    ],
    charter: ['greenhouse', 'archive', 'metroTunnel'],
    signature: {
      id: 'firstLaw', icon: '[[books]]', beat: 'quarrel', chapter: 'firstLaw',
      text: { he: 'בחרו את החוק שיגדיר את המושבה', en: 'Choose the law that defines the colony' },
      problem: { he: 'שלוש קבוצות מתחת לגג אחד, ואין אף כלל שכולם הסכימו עליו. לפני שהעיר גדלה, היא צריכה חוק.', en: 'Three groups under one roof, and not one rule they all agreed on. Before the city grows, it needs a law.' },
    },
    // [phase3] One system at a time (SYSTEM_SCHEDULE): components and the society doctrine now, the first law after 2 days, outposts
    // and caravans after 4, the defense doctrine after 6.
    opens: { he: 'נפתחים: רכיבים (פס הרכבה בבית המלאכה) ודוקטרינת חברה. אחרי יומיים החוק הראשון, אחרי 4 ימים מאחזים ושיירות, ואחר כך דוקטרינת הגנה.', en: 'Opens: components (Assembly Line in the workshop) and the society doctrine. The first law follows in 2 days, outposts and caravans in 4, then the defense doctrine.' },
  },
  {
    id: 4,
    name: { he: 'מערכה IV · להתרחב', en: 'Act IV · Expand' },
    tagline: { he: 'עיר שלמה מתחת לעולם', en: 'A whole city beneath the world' },
    levelCap: 9, popCap: 110, floorCap: 14,
    goals: [
      // [phase5] "Dig 14 levels" dropped: the siege is the Act's third goal.
      // [ux-wp2 M1] 4 rooms (was 6): the Mk9 wait was days of nothing to decide.
      { kind: 'levels', level: 9, text: { he: '4 חדרים ברמה 9', en: '4 rooms at level 9' }, progress: s => atLeast(roomsAt(s, 9), 4) },
      { kind: 'pop', text: { he: 'הגיעו ל־90 ניצולים', en: 'Reach 90 survivors' }, progress: s => atLeast(s.survivors.length, 90) },
    ],
    charter: ['wall', 'deepFoundry'],
    // [phase5] A scripted siege in three waves (ActSystem.resolveSiege): warned a day ahead by the beat, met by the bunker's defense.
    signature: {
      id: 'siege', icon: '[[armory]]', beat: 'ridge', chapter: 'siege', delay: SIEGE_WARNING,
      text: { he: 'החזיקו את החומה במצור', en: 'Hold the Wall in the siege' },
      problem: { he: 'האורות של העיר נראים עכשיו מהרכס, ומישהו שם בחוץ אוסף צבא.', en: 'The city\'s lights can be seen from the ridge now, and someone out there is gathering an army.' },
    },
    opens: { he: 'נפתחים: סגסוגות (כבשן קשת בגנרטור), חדרים עד רמה 9, עוד מאחזים, ועונות השנה.', en: 'Opens: alloys (Arc Furnace in the generator), rooms up to level 9, more outposts, and the seasons.' }, // [phase3] seasons
  },
  {
    id: 5,
    name: { he: 'מערכה V · לעלות', en: 'Act V · Rise' },
    tagline: { he: 'שחר מעל האפר', en: 'Dawn above the ash' },
    levelCap: 10, popCap: 150, floorCap: 17,
    goals: [
      { kind: 'outposts', text: { he: 'החזיקו 3 מאחזים', en: 'Hold 3 outposts' }, progress: s => atLeast(((s.longGame?.world.outposts ?? []) as unknown[]).length, 3) },
      // [phase5] "Dig 17 levels" dropped: the northern expedition is the Act's third goal.
      // [ux-wp2 M1] 5 rooms (was 8).
      { kind: 'levels', level: 10, text: { he: '5 חדרים ברמה 10', en: '5 rooms at level 10' }, progress: s => atLeast(roomsAt(s, 10), 5) },
    ],
    charter: ['surfaceGate', 'skyDome'],
    signature: {
      id: 'north', icon: '[[map]]', beat: 'signal', chapter: 'northStation', delay: 12 * 3600,
      text: { he: 'הגיעו לאות מהצפון', en: 'Reach the signal in the north' },
      problem: { he: 'מעבר לקצה המפה משהו משדר את אותו אות, שוב ושוב: תחנה מלפני האפר, או מלכודת.', en: 'Beyond the edge of the map something sends the same signal, over and over: a station from before the ashes, or a trap.' },
    },
    opens: { he: 'נפתחים: נתונים (כספת נתונים במעבדה), רמה 10, חוק שני.', en: 'Opens: data (Data Vault in the lab), level 10, a second law.' },
  },
  {
    id: 6,
    name: { he: 'מערכה VI · למשול', en: 'Act VI · Govern' },
    tagline: { he: 'רפובליקה בין שכנים', en: 'A republic among neighbours' },
    levelCap: 10, popCap: 190, floorCap: 20,
    goals: [
      // [phase5] "Gather 1,500 influence" became the vote (influence is spent on it, not hoarded).
      { kind: 'pop', text: { he: 'הגיעו ל־150 ניצולים', en: 'Reach 150 survivors' }, progress: s => atLeast(s.survivors.length, 150) },
      { kind: 'dig', text: { he: 'חפרו 20 קומות', en: 'Dig 20 levels' }, progress: s => atLeast(s.currentFloors, 20) },
    ],
    charter: ['tradeLeague', 'constitution'],
    signature: {
      id: 'vote', icon: '[[books]]', beat: 'factions', chapter: 'firstVote', delay: 12 * 3600,
      text: { he: 'ההצבעה: מי ינהל את העיר', en: 'The vote: who will govern the city' },
      problem: { he: 'העיר תצביע על מי ינהל אותה. השפעה קונה קולות, ומי שמתעלם ממנה מאבד אמון.', en: 'The city will vote on who governs it. Influence buys voices, and whoever ignores it loses trust.' },
    },
    opens: { he: 'נפתחים: השפעה (אולם המועצה בחדר האוכל), חוק שלישי.', en: 'Opens: influence (Council Hall in the canteen), a third law.' },
  },
  {
    id: 7,
    name: { he: 'מערכה VII · בראשית', en: 'Act VII · Genesis' },
    tagline: { he: 'מה שיעבור לעולם הבא', en: 'What will cross into the next world' },
    levelCap: 10, popCap: 190, floorCap: 24,
    goals: [
      // [phase5] "Dig 24 levels" dropped: what crosses in the Ark is the Act's third goal.
      { kind: 'pop', text: { he: 'הגיעו ל־170 ניצולים', en: 'Reach 170 survivors' }, progress: s => atLeast(s.survivors.length, 170) },
      { kind: 'seedVault', text: { he: 'השלימו את כספת הזרעים (מחקר)', en: 'Complete the Seed Vault (research)' }, progress: s => [s.research.seedVault?.completed ? 1 : 0, 1] },
    ],
    charter: ['ark', 'genesisCore'],
    signature: {
      id: 'ark', icon: '[[isotope7]]', beat: 'lastCensus', chapter: 'arkChapter',
      text: { he: 'החליטו מה עובר בתיבה', en: 'Decide what crosses in the Ark' },
      problem: { he: 'בתיבה יש מקום לדבר אחד גדול ולשניים קטנים. כל השאר יישאר מאחור.', en: 'The Ark has room for one big thing and two small ones. Everything else stays behind.' },
    },
    opens: { he: 'נפתחים: ליבות זרע (כור הזרעים), התיבה וליבת בראשית.', en: 'Opens: seed cores (the Seed Forge), the Ark and the Genesis Core.' },
  },
];

/** The deepest the bunker can ever go in this release, and the highest room level. */
export const MAX_ACT = ACTS.length;

const DAY = 86_400;

/** [phase3] The systems an Act opens one at a time (economy-pacing fix 7). */
export type SystemId = 'inbox' | 'foreman' | 'laws' | 'outposts' | 'contracts' | 'caravans' | 'doctrine2' | 'seasons';

/**
 * [phase3] When each system opens: its Act, and how long (world seconds) after that Act begins. Generalizes the old [Q7]
 * `lateActTwoSystems` stagger: Act II opens the Inbox and the Foreman on day 0 and contracts after 2.5 days; Act III opens one thing
 * at a time (laws +2 days, outposts and caravans +4 days, the second doctrine fork +6 days); the seasons wait for Act IV.
 * Every later Act has them all from its first day.
 */
export const SYSTEM_SCHEDULE: Record<SystemId, { act: number; after: number }> = {
  inbox: { act: 2, after: 0 },
  foreman: { act: 2, after: 0 },
  laws: { act: 3, after: 2 * DAY },
  outposts: { act: 3, after: 4 * DAY },
  // [phase3] Contracts stay in Act II (+2.5 days, as [Q7]): moving them to Act III took Act II's main materials income away and the
  // engaged sims reached Act III at day 11.5 instead of 7.7 (+50%). The lead may move them once Act II pays its charters another way.
  contracts: { act: 2, after: 2.5 * DAY },
  caravans: { act: 3, after: 4 * DAY },
  doctrine2: { act: 3, after: 6 * DAY },
  seasons: { act: 4, after: 0 },
};

/** [phase3] The doctrine forks that wait for a scheduled system (the others open with their research node's Act). */
export const FORK_SYSTEM: Record<string, SystemId> = { defense: 'doctrine2' };

/** [phase3] Research ids of the delayed fork, for "already in use" below. */
const DELAYED_FORK_NODES = ['fortress', 'rangers', 'diplomacy'];

/**
 * [phase3] A save from before the schedule must not lose what it already uses: a law in force, an outpost held, a contract waiting
 * in the inbox, a caravan on the road, or a delayed doctrine chosen keeps that system open.
 */
function inUse(state: GameState, id: SystemId): boolean {
  const lg = state.longGame!;
  switch (id) {
    case 'laws': return (lg.policy?.laws?.length ?? 0) > 0;
    case 'outposts': return ((lg.world?.outposts ?? []) as unknown[]).length > 0;
    case 'contracts': return (lg.inbox?.items ?? []).some(i => i.kind === 'contract');
    case 'caravans': return (state.activeMissions ?? []).some(m => m.type === 'caravan');
    case 'doctrine2': return DELAYED_FORK_NODES.some(r => !!(state.research[r]?.completed || state.research[r]?.isResearching));
    default: return false;
  }
}

/** [phase3] Is this system open in this run now? Bunkers from before the long game keep the old rule (everything from Act II). */
export function systemOpen(state: GameState, id: SystemId): boolean {
  const lg = state.longGame;
  if (!lg) return false;
  const at = SYSTEM_SCHEDULE[id];
  if (lg.meta.legacy) return lg.meta.act >= Math.min(at.act, 2);
  if (lg.meta.act > at.act) return true;
  if (lg.meta.act < at.act) return false;
  return inUse(state, id) || lg.meta.worldT - lg.meta.actSince >= at.after;
}

/** [phase3] World seconds until a system opens in the current Act (0: open; Infinity: a later Act). */
export function systemOpensIn(state: GameState, id: SystemId): number {
  if (systemOpen(state, id)) return 0;
  const lg = state.longGame;
  const at = SYSTEM_SCHEDULE[id];
  if (!lg || lg.meta.act !== at.act) return Infinity;
  return Math.max(0, at.after - (lg.meta.worldT - lg.meta.actSince));
}

/** [phase3] A doctrine fork that waits for its scheduled system (FORK_SYSTEM). */
export function forkOpen(state: GameState, fork: string): boolean {
  const sys = FORK_SYSTEM[fork];
  return !sys || systemOpen(state, sys);
}

/**
 * [Q7] Kept for its callers (ContractSystem.active, orders, seasons): the contracts' schedule (Act II + 2.5 days).
 * [phase3] seasons.ts should ask `systemOpen(state, 'seasons')` (Act IV) instead.
 */
export function lateActTwoSystems(state: GameState): boolean {
  return systemOpen(state, 'contracts');
}

export function actOf(state: GameState): ActDef {
  const n = state.longGame?.meta.act ?? 1;
  return ACTS[Math.min(ACTS.length, Math.max(1, n)) - 1];
}

/** Every goal of the Act, charter projects included, with its progress. */
export function actGoals(state: GameState, act: ActDef = actOf(state)): { text: Record<'he' | 'en', string>; progress: [number, number]; project?: string; signature?: string }[] {
  return [
    ...act.goals.map(g => ({ text: g.text, progress: g.progress(state) })),
    // [phase5] The signature problem counts like a goal: met once its chapter was told, whatever the outcome.
    ...(act.signature ? [{ text: act.signature.text, progress: signatureProgress(state, act.signature), signature: act.signature.id }] : []),
    ...act.charter.map(id => ({ text: { he: '', en: '' }, progress: [projectDone(state, id) ? 1 : 0, 1] as [number, number], project: id })),
  ];
}

export function actComplete(state: GameState, act: ActDef = actOf(state)): boolean {
  return actGoals(state, act).every(g => g.progress[0] >= g.progress[1]);
}

/** A room type's highest level right now: its own top level, held to the Act's ceiling. */
export function levelCapFor(state: GameState, defMax: number): number {
  // Rooms with fewer levels (districts and halls: 5) count each level as two Mk steps.
  return Math.min(defMax, Math.max(1, Math.floor((actOf(state).levelCap * defMax) / 10)));
}

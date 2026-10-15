/**
 * [ux-redesign W3a] The "What now?" advisor: which ONE thing the objective strip shows, in this order:
 *   1. crisis   - a store empties within CRISIS_S, a raid on its way, a room incident, a power deficit
 *   2. collect  - something waits to be taken (decisions, the supply crate, the day's reward)
 *   3. goal     - the active objective (the tutorial step, then the Act's step from Guide.ts)
 *   4. upgrade  - idle research, then an upgrade the stores can pay for now
 * A crisis that the active goal (or, during the first steps, an upcoming tutorial step) fixes is not a separate line: the goal takes the
 * crisis slot with its countdown, so the tutorial and the alarm never pull the player two ways.
 * [phase1] Early game (the tutorial, or Act I): crisis > goal, and nothing to collect on the strip at all (the bell's badge carries it),
 * so the supply crate never detours the player off the tutorial goal.
 * Pure: plain numbers in, an ordered list out (no DOM, no i18n, no game state). Tested by tools/sim/advisor-test.mjs.
 */

/** A store that empties within this many seconds is a crisis (the HUD tile's danger threshold, HUD.ts DANGER_S). */
export const CRISIS_S = 180;
/** A net flow closer to zero than this (per second) is steady: nothing runs out. */
export const STEADY = 0.005;
/** The idle hint waits this long after the last touch (logic timing, not a motion token). */
export const IDLE_HINT_MS = 9000;
/** The idle hint shows at most this many times for one advisor line. */
export const IDLE_HINT_MAX = 3;
/** The first-session spotlight covers this many tutorial steps of a new game. */
export const FTUE_STEPS = 5;
/** A save with more play than this (s) is not a first session, even without the profile flag. */
export const FTUE_MAX_PLAY_S = 1200;
/** No offer / permission card in the first minutes of a game (s of play). */
export const PROMPT_QUIET_S = 300;
/** How many goals the expanded strip lists. */
export const MAX_GOALS = 3;

export type AdvisorKind = 'crisis' | 'collect' | 'goal' | 'upgrade';

export interface StoreFlow {
  id: string;
  amount: number;
  /** Production minus consumption, per second. */
  net: number;
}

export interface AdvisorInput {
  /** The stores that can starve the bunker (food, water, the power reserve). A power deficit without a falling reserve uses `powerRatio`. */
  stores: StoreFlow[];
  /** Supplied / demanded power (1 = enough). */
  powerRatio: number;
  /** Power is used at all (a bunker with no consumers has no deficit). */
  powerUsed: boolean;
  raid: boolean;
  incidents: number;
  collect: { inbox: number; supply: boolean; daily: number };
  /** The active objective; `fixes` = the resources its room (or, in the first steps, an upcoming step's room) produces. */
  goal: { id: string; fixes: string[] } | null;
  idleResearch: boolean;
  upgrade: boolean;
  /** [phase1] The tutorial or Act I is running: collect items stay off the strip (bell badge only). */
  early?: boolean;
}

export interface AdvisorPick {
  kind: AdvisorKind;
  /** Stable id of the line: 'raid', 'incident', 'store:food', 'power', 'inbox', 'supply', 'daily', 'goal:<id>', 'research', 'upgrade'. */
  key: string;
  /** For a store / power crisis (also on a goal that took the crisis slot). */
  resource?: string;
  /** Seconds until the store is empty (store crises). */
  seconds?: number;
  /** A goal that stands in for a crisis it fixes. */
  urgent?: boolean;
}

/** Seconds until a store is empty at its current flow; Infinity when it is steady or rising. */
export function timeToEmpty(amount: number, net: number): number {
  if (!(net < -STEADY)) return Infinity;
  return Math.max(0, amount) / -net;
}

/** The crises, most pressing first: a raid, a room incident, the store that empties soonest, then a power deficit. */
export function crises(input: AdvisorInput): AdvisorPick[] {
  const out: AdvisorPick[] = [];
  if (input.raid) out.push({ kind: 'crisis', key: 'raid' });
  if (input.incidents > 0) out.push({ kind: 'crisis', key: 'incident' });
  const short = input.stores
    .map(s => ({ s, t: timeToEmpty(s.amount, s.net) }))
    .filter(x => x.t < CRISIS_S)
    .sort((a, b) => a.t - b.t);
  for (const { s, t } of short) out.push({ kind: 'crisis', key: `store:${s.id}`, resource: s.id, seconds: t });
  if (input.powerUsed && input.powerRatio < 0.99 && !short.some(x => x.s.id === 'power')) out.push({ kind: 'crisis', key: 'power', resource: 'power' });
  return out;
}

/** Everything the advisor could say, in order. The strip shows the first; the expanded list draws on the rest. */
export function adviseOrder(input: AdvisorInput): AdvisorPick[] {
  const out: AdvisorPick[] = [];
  const goalKey = input.goal ? `goal:${input.goal.id}` : '';
  let goalUsed = false;
  for (const c of crises(input)) {
    if (input.goal && c.resource && input.goal.fixes.includes(c.resource)) {
      // The goal deals with this one: it takes the crisis slot (once), with the countdown.
      if (!goalUsed) out.push({ kind: 'goal', key: goalKey, resource: c.resource, seconds: c.seconds, urgent: true });
      goalUsed = true;
      continue;
    }
    out.push(c);
  }
  if (!input.early) {
    if (input.collect.inbox > 0) out.push({ kind: 'collect', key: 'inbox' });
    if (input.collect.supply) out.push({ kind: 'collect', key: 'supply' });
    if (input.collect.daily > 0) out.push({ kind: 'collect', key: 'daily' });
  }
  if (input.goal && !goalUsed) out.push({ kind: 'goal', key: goalKey });
  if (input.idleResearch) out.push({ kind: 'upgrade', key: 'research' });
  if (input.upgrade) out.push({ kind: 'upgrade', key: 'upgrade' });
  return out;
}

/** The one line for the strip (null: nothing to advise, the strip keeps the objective as before). */
export function advise(input: AdvisorInput): AdvisorPick | null {
  return adviseOrder(input)[0] ?? null;
}

// ---- first session ------------------------------------------------------------------------------------------------------------

export interface FtueInput {
  /** The profile (device) flag: the tutorial was finished or skipped once. */
  profileDone: boolean;
  tutorialStep: number;
  playSeconds: number;
}

/** The first-session spotlight leads this step (only a new player, only the first FTUE_STEPS steps, only an early save). */
export function ftueActive(f: FtueInput): boolean {
  return !f.profileDone && f.tutorialStep < FTUE_STEPS && f.playSeconds < FTUE_MAX_PLAY_S;
}

/** The player is past the first session (sets the profile flag, so other slots and new games stay quiet). */
export function ftueFinished(f: FtueInput): boolean {
  return f.tutorialStep >= FTUE_STEPS || f.playSeconds >= FTUE_MAX_PLAY_S;
}

// ---- idle hint ----------------------------------------------------------------------------------------------------------------

export interface IdleInput {
  /** ms since the last touch, key or wheel. */
  idleMs: number;
  ftue: boolean;
  crisis: boolean;
  /** A sheet, a dialog, placement, the intro, the story, the tour: never then. */
  blocked: boolean;
  /** Times the hint already showed for this advisor line. */
  shown: number;
}

export function idleHintDue(i: IdleInput): boolean {
  return (i.ftue || i.crisis) && !i.blocked && i.idleMs >= IDLE_HINT_MS && i.shown < IDLE_HINT_MAX;
}

// ---- offers and permissions ---------------------------------------------------------------------------------------------------

/** Install / battery / backup / notification cards wait until the game has run this long. */
export function promptAllowed(playSeconds: number): boolean {
  return playSeconds >= PROMPT_QUIET_S;
}

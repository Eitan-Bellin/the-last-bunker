/**
 * [ux-redesign w2a] The rules of interruptions, as pure functions (no DOM, no game state), so tools/sim/popup-test.mjs can check them:
 * which dialog goes first, when one may land, what the back button closes, when a store is worth a warning, how toasts queue.
 * The game reads them; they never change a game rule (rates, rewards and saves are untouched).
 */
import { MS } from './kit/tokens';

/** A dialog that just opened ignores taps this long (a tap meant for the screen under it must not pick a choice blind). */
export const MODAL_TAP_GUARD_MS = 250; // [phase1] was 600; a press that began before the dialog is swallowed regardless (tapBlocked)
/** [phase1] Window event fired (synchronously) whenever a dialog layer opens: Modal.show, the story scene, the lore reader. */
export const MODAL_OPEN_EVENT = 'lastbunker:dialog-open';
/** No dialog opens by itself within this long of the player's last touch, drag, wheel or key. */
export const GESTURE_QUIET_MS = 1500;
/** A sheet that starts to open or close counts as moving for this long. */
export const SHEET_SETTLE_MS = 450;
/** A sheet left open and untouched this long no longer holds ordinary dialogs back. */
export const SHEET_IDLE_MS = 20_000;
/**
 * [ux-redesign w2fix] An emergency that has waited this long no longer waits for a quiet moment after the last touch (a player who
 * keeps tapping would otherwise never see it). It still waits for a finger to lift and for a placement to end.
 */
export const CRITICAL_PATIENCE_MS = 4000;
/**
 * [ux-redesign w3fix] A tutorial spotlight holds ordinary dialogs back, but not forever: one that has waited this long lands anyway
 * (the spotlight steps aside for it and comes back when the screen is calm). Logic timing, not a motion token.
 */
export const SPOTLIGHT_PATIENCE_MS = 20_000;
/**
 * [phase1] After a welcome-back closes, no other ordinary dialog (or tip card) opens by itself for this long: the returning player first
 * does what they came back for. Emergencies still come. Logic timing, not a motion token.
 */
export const RETURNING_QUIET_MS = 120_000;
/** [phase1] Offers (phone battery saver, install, backup) wait until THIS session has run this long (s), whatever the save's age. */
export const OFFER_SESSION_S = 600;

/** [phase1] The quiet stretch after a welcome-back holds this source back (`closedAt`: when the welcome closed, -Infinity: never). */
export function returningQuiet(now: number, closedAt: number, critical: boolean): boolean {
  return !critical && now - closedAt < RETURNING_QUIET_MS;
}

/** [phase1] An offer may come only once this session has lasted OFFER_SESSION_S. */
export function offerSessionReady(sessionSeconds: number): boolean {
  return sessionSeconds >= OFFER_SESSION_S;
}

/** A pointer whose "up" was lost stops blocking after this long. */
export const LOST_POINTER_MS = 12_000;

// ---- priorities -------------------------------------------------------------------------------------------------------------

/**
 * The brief's order: crisis > offline rewards > level up / feature unlock > daily bonus > offer. Story decisions (events, radio calls,
 * reports, chapters) sit between the welcome and the unlocks, where they already were. Inside a tier the source's own priority keeps
 * the old order.
 */
export type PopupTier = 'crisis' | 'offline' | 'story' | 'unlock' | 'daily' | 'offer';
export const TIER_BASE: Record<PopupTier, number> = { crisis: 5000, offline: 4000, story: 3000, unlock: 2000, daily: 1000, offer: 0 };
/** Offers (install the app, power saver, back up) at most this many per session. */
export const OFFERS_PER_SESSION = 1;

export interface Ranked {
  id: string;
  priority: number;
  tier?: PopupTier;
}

export function rankOf(s: Ranked): number {
  return TIER_BASE[s.tier ?? 'story'] + s.priority;
}

/** Best first. Stable for equal ranks. */
export function orderSources<T extends Ranked>(list: readonly T[]): T[] {
  return list.map((s, i) => ({ s, i })).sort((a, b) => rankOf(b.s) - rankOf(a.s) || a.i - b.i).map(x => x.s);
}

/** Drops offers once the session has had its share. */
export function allowedNow<T extends Ranked>(list: readonly T[], offersShown: number): T[] {
  return list.filter(s => s.tier !== 'offer' || offersShown < OFFERS_PER_SESSION);
}

// ---- the gate ---------------------------------------------------------------------------------------------------------------

export interface GateInput {
  now: number;
  critical: boolean;
  placing: boolean;
  touring: boolean;
  pointersDown: number;
  lastGestureAt: number;
  ceremony: boolean;
  panelOpen: boolean;
  sheetMovingUntil: number;
  tipShowing: boolean;
  /** [ux-redesign w3fix] A tutorial spotlight is up (onboarding). Holds ordinary dialogs until they waited SPOTLIGHT_PATIENCE_MS. */
  spotlightShowing?: boolean;
  /** [ux-redesign w2fix] How long this dialog has been ready and held back (ms; 0 or absent = it just became ready). */
  waitedMs?: number;
  /** [ux-redesign final F6] This dialog is an offer (install, power saver, backup). */
  offer?: boolean;
  /** [final F6] A crisis is on (a fire, a raid, the advisor's urgent pick). */
  crisis?: boolean;
  /** [final F6] The bunker is still working through an absence, or its welcome-back has not been shown yet. */
  returning?: boolean;
}

/** Why a dialog may not land right now ('' = it may). Emergencies ignore an open sheet and push a tip away; nothing ignores a finger. */
export function gateBlock(g: GateInput): string {
  if (g.placing) return 'placement';
  if (g.touring) return 'tour';
  if (g.pointersDown > 0) return 'finger';
  const patient = g.critical && (g.waitedMs ?? 0) > CRITICAL_PATIENCE_MS;
  if (!patient && g.now - g.lastGestureAt < GESTURE_QUIET_MS) return 'gesture';
  if (g.now < g.sheetMovingUntil) return 'sheetMoving';
  if (g.ceremony) return 'ceremony';
  if (!g.critical && g.panelOpen && g.now - g.lastGestureAt < SHEET_IDLE_MS) return 'sheet';
  if (!g.critical && g.tipShowing) return 'tip';
  if (!g.critical && g.spotlightShowing && (g.waitedMs ?? 0) <= SPOTLIGHT_PATIENCE_MS) return 'spotlight';
  // [ux-redesign final F6] An offer never comes ahead of a welcome-back or into a crisis: it waits for a calm moment (no patience).
  if (g.offer && g.returning) return 'returning';
  if (g.offer && g.crisis) return 'crisis';
  return '';
}

/**
 * A tap (pointer click) on a dialog is swallowed when it was meant for what was there before. Keyboard clicks (detail 0) pass.
 * [phase1] The real hazard is a press that STARTED before the dialog (or its new content) appeared: that one is swallowed whatever its
 * timing (`downAt` = the time of the pointerdown that led to this click; -Infinity when the dialog never saw one). A press that started
 * on the open dialog passes, unless it came inside the first MODAL_TAP_GUARD_MS (now 250 ms, was 600: a reflex tap on the fade-in).
 */
export function tapBlocked(openedAt: number, now: number, detail: number, downAt = now): boolean {
  if (detail === 0) return false;
  return downAt < openedAt || now - openedAt < MODAL_TAP_GUARD_MS;
}

/** [phase1] A press starting this soon after the dialog appeared gets no pressed look (it will be swallowed: no "press, no result"). */
export function pressGuarded(openedAt: number, downAt: number): boolean {
  return downAt < openedAt || downAt - openedAt < MODAL_TAP_GUARD_MS;
}

// ---- back / Escape ----------------------------------------------------------------------------------------------------------

export interface BackInput {
  touring: boolean;
  modalOpen: boolean;
  /** The open dialog's "dismiss" choice (null: a decision; back does nothing). */
  modalDismiss: number | null;
  placing: boolean;
  readerOpen: boolean;
  surfaceOpen: boolean;
  sheetOpen: boolean;
  /** [ux-redesign w3fix] A small floating list is open: the strip's goals list, a locked tab's popover, the HUD's alerts list. */
  popoverOpen?: boolean;
  /** [ux-redesign w3fix] A tutorial spotlight is up. */
  spotlight?: boolean;
}

export type BackAction = 'tour' | 'modalDismiss' | 'modalStay' | 'popover' | 'spotlight' | 'placement' | 'reader' | 'surface' | 'sheet' | 'leave';

/**
 * What the phone's back button (or Escape) does: always the top layer only. [w3fix] A floating list closes before anything under it;
 * a spotlight takes back as "stay" (`spotlight`: nothing happens, never "Leave the game?"; Skip is the way out of the tutorial).
 */
export function backAction(b: BackInput): BackAction {
  if (b.touring) return 'tour';
  if (b.modalOpen) return b.modalDismiss === null ? 'modalStay' : 'modalDismiss';
  if (b.popoverOpen) return 'popover';
  if (b.spotlight) return 'spotlight';
  if (b.placing) return 'placement';
  if (b.readerOpen) return 'reader';
  if (b.surfaceOpen) return 'surface';
  if (b.sheetOpen) return 'sheet';
  return 'leave';
}

/** The action back/Escape presses: the one named, or the only one of an info dialog. Never a decision, never a disabled choice. */
export function dismissIndex(actions: readonly { disabled?: boolean }[], dismiss: number | 'none' | undefined): number | null {
  if (dismiss === 'none') return null;
  const i = dismiss ?? (actions.length === 1 ? 0 : -1);
  if (i < 0 || i >= actions.length || actions[i].disabled) return null;
  return i;
}

// ---- store warnings ---------------------------------------------------------------------------------------------------------

/** Warn when a store empties within this many seconds at the current rate; forget the warning once it is this far away again. */
export const LOW_WARN_S = 180;
export const LOW_CLEAR_S = 300;
/** The same store does not warn twice within this long. */
export const LOW_REPEAT_MS = 90_000;

export type LowStep = 'warn' | 'clear' | 'keep';

/** `net` = production minus consumption per second. A rising store never warns (and an old warning is forgotten). */
export function lowStoreStep(amount: number, net: number, warned: boolean, msSinceWarn: number): LowStep {
  if (net >= 0) return warned ? 'clear' : 'keep';
  const secondsLeft = amount / -net;
  if (!warned) return amount > 0 && secondsLeft < LOW_WARN_S && msSinceWarn >= LOW_REPEAT_MS ? 'warn' : 'keep';
  return secondsLeft > LOW_CLEAR_S ? 'clear' : 'keep';
}

// ---- toasts -----------------------------------------------------------------------------------------------------------------

export type LaneKind = 'info' | 'good' | 'bad' | 'critical';
/** One toast on screen; the rest wait in line. */
export const LANE_VISIBLE = 1;
/** With others waiting, a toast leaves after this long (it has been read by then): the --toast-hold token. */
export const LANE_MIN_MS = MS['toast-hold'];

/** The leading icon token the toast style already draws (a11y.css: check for good, warning for bad, cross for critical). */
const STYLE_ICON: Partial<Record<LaneKind, RegExp>> = {
  good: /^\s*\[\[check\]\]\s*/,
  bad: /^\s*(\[\[warning\]\]|⚠️?)\s*/,
  critical: /^\s*(\[\[warning\]\]|⚠️?)\s*/,
};

/** One icon per toast: drops a leading icon that repeats the one the toast's kind already shows ("⚠ ⚠" becomes "⚠"). */
export function oneIcon(text: string, kind: LaneKind): string {
  const re = STYLE_ICON[kind];
  return re ? text.replace(re, '') : text;
}

/** Index of the waiting toast to show next: the most important, the oldest among equals. While paused only a critical one may go. */
export function nextInLane(queue: readonly { kind: LaneKind }[], paused: boolean): number {
  const RANK: Record<LaneKind, number> = { info: 0, good: 1, bad: 2, critical: 3 };
  let best = -1;
  for (let i = 0; i < queue.length; i++) {
    if (paused && queue[i].kind !== 'critical') continue;
    if (best < 0 || RANK[queue[i].kind] > RANK[queue[best].kind]) best = i;
  }
  return best;
}

// ---- folding ----------------------------------------------------------------------------------------------------------------

/** Goals completed within this window are told as one line. */
export const GOAL_FOLD_MS = 1200;

/** One line for a batch of finished goals: the goal itself when alone, else a count. */
export function goalLine(names: readonly string[], one: (name: string) => string, many: (n: number) => string): string {
  return names.length === 1 ? one(names[0]) : many(names.length);
}

// ---- the "closed while saving" note ----------------------------------------------------------------------------------------

/** A save that is at most this much older than the last one asked for is not worth a warning (autosave runs every 30 s). */
export const STALE_SAVE_MS = 60_000;

/**
 * True when the stored game is really older than the last save the previous session asked for. `savedAt` is the stored game's own
 * time stamp (null when unknown: then the old two-stamp rule decides).
 */
export function saveLooksStale(pending: number, saved: number, savedAt: number | null): boolean {
  if (pending <= saved) return false;
  if (savedAt === null) return true;
  return pending - savedAt > STALE_SAVE_MS;
}

// ---- welcome back -----------------------------------------------------------------------------------------------------------

/** "Welcome back" only after an absence longer than this (seconds); people at the door are asked about regardless. */
export const WELCOME_MIN_AWAY_S = 600;

/** [ux-redesign w2fix] `hadDanger`: a raid or disaster struck while away (or someone was hurt): the report shows however short the absence. */
export function wantsWelcome(awaySeconds: number | null, doorWaiting: number, hadDanger = false): boolean {
  return doorWaiting > 0 || (awaySeconds !== null && hadDanger) || (awaySeconds ?? 0) > WELCOME_MIN_AWAY_S;
}

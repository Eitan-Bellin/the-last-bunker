#!/usr/bin/env node
// [ux-redesign w2a] Interruption rules test: src/ui/popupRules.ts (the dialog queue's order and offer cap, the dialog gate, the tap
// guard of a fresh dialog ([phase1] pre-open presses only), the quiet after a welcome-back, [phase2] the interruption budget and the first-knock rule, what back closes, store warnings, the one-toast lane, folding, the stale-save note, welcome back).
// Exit 1 on any problem. Usage: node tools/sim/popup-test.mjs
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { file } = await bundleSim({ tag: 'popup', entry: join(ROOT, 'src', 'ui', 'popupRules.ts') });
const P = await import(pathToFileURL(file).href);
try { rmSync(file); } catch { /* cache file */ }

const problems = [];
const ok = (cond, what) => { if (!cond) problems.push(what); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- priorities: crisis > offline > story > unlock > daily > offer; inside a tier the old priority -------------------------------
const sources = [
  { id: 'install', priority: 3, tier: 'offer' },
  { id: 'welcome', priority: 100, tier: 'offline' },
  { id: 'system', priority: 20, tier: 'unlock' },
  { id: 'daily', priority: 1, tier: 'daily' },
  { id: 'danger', priority: 70, tier: 'crisis' },
  { id: 'memorial', priority: 90, tier: 'crisis' },
  { id: 'event', priority: 60, tier: 'story' },
  { id: 'backup', priority: 2, tier: 'offer' },
];
eq(P.orderSources(sources).map(s => s.id), ['memorial', 'danger', 'welcome', 'event', 'system', 'daily', 'install', 'backup'], 'priority order');
eq(P.orderSources([{ id: 'a', priority: 5 }, { id: 'b', priority: 5 }]).map(s => s.id), ['a', 'b'], 'stable for equal ranks');

// ---- one offer per session ------------------------------------------------------------------------------------------------------
eq(P.allowedNow(sources, 0).filter(s => s.tier === 'offer').length, 2, 'offers allowed before the first');
eq(P.allowedNow(sources, P.OFFERS_PER_SESSION).filter(s => s.tier === 'offer').length, 0, 'no offer after the session had one');
eq(P.allowedNow(sources, 5).length, sources.length - 2, 'only offers are capped');

// ---- one at a time: a simulated queue opens the best ready source, never two while one is open --------------------------------------
{
  let open = null;
  const shown = [];
  let offers = 0;
  const ready = new Set(['install', 'backup', 'system', 'event', 'welcome']);
  const step = () => {
    if (open) return;
    const list = P.allowedNow(P.orderSources(sources), offers).filter(s => ready.has(s.id));
    if (!list.length) return;
    open = list[0];
    if (open.tier === 'offer') offers++;
    ready.delete(open.id);
    shown.push(open.id);
  };
  for (let i = 0; i < 20; i++) { step(); step(); if (i % 2) open = null; }
  eq(shown, ['welcome', 'event', 'system', 'install'], 'one at a time, best first, one offer');
}

// ---- the gate ---------------------------------------------------------------------------------------------------------------------
const base = { now: 100_000, critical: false, placing: false, touring: false, pointersDown: 0, lastGestureAt: 0, ceremony: false, panelOpen: false, sheetMovingUntil: 0, tipShowing: false };
eq(P.gateBlock(base), '', 'calm screen: open');
eq(P.gateBlock({ ...base, lastGestureAt: base.now - 1000 }), 'gesture', '1 s after a tap: wait');
eq(P.gateBlock({ ...base, lastGestureAt: base.now - 1499 }), 'gesture', '1.499 s after a tap: wait');
eq(P.gateBlock({ ...base, lastGestureAt: base.now - P.GESTURE_QUIET_MS }), '', '1.5 s after a tap: open');
eq(P.gateBlock({ ...base, pointersDown: 1 }), 'finger', 'finger down');
// [final F6] offers wait for calm: never ahead of a welcome-back, never into a crisis (and no patience lets them through)
eq(P.gateBlock({ ...base, offer: true, returning: true, waitedMs: 600_000 }), 'returning', 'an offer waits while an absence is worked through');
eq(P.gateBlock({ ...base, offer: true, crisis: true, waitedMs: 600_000 }), 'crisis', 'an offer waits out a fire');
eq(P.gateBlock({ ...base, offer: true }), '', 'a calm moment: the offer may land');
eq(P.gateBlock({ ...base, crisis: true, returning: true }), '', 'crisis/returning flags only hold offers');
eq(P.gateBlock({ ...base, critical: true, pointersDown: 1 }), 'finger', 'even a crisis waits for a finger');
eq(P.gateBlock({ ...base, placing: true, critical: true }), 'placement', 'placement holds everything');
eq(P.gateBlock({ ...base, sheetMovingUntil: base.now + 10 }), 'sheetMoving', 'sheet still moving');
eq(P.gateBlock({ ...base, ceremony: true }), 'ceremony', 'ceremony on screen');
eq(P.gateBlock({ ...base, panelOpen: true, lastGestureAt: base.now - 5000 }), 'sheet', 'sheet in use holds ordinary dialogs');
eq(P.gateBlock({ ...base, panelOpen: true, lastGestureAt: base.now - 5000, critical: true }), '', 'a crisis comes over a sheet');
eq(P.gateBlock({ ...base, panelOpen: true, lastGestureAt: base.now - P.SHEET_IDLE_MS - 1 }), '', 'an idle sheet stops holding');
eq(P.gateBlock({ ...base, tipShowing: true }), 'tip', 'a tip holds an ordinary dialog');
eq(P.gateBlock({ ...base, tipShowing: true, critical: true }), '', 'a crisis pushes a tip away');
// [ux-redesign w2fix] an emergency that waited over CRITICAL_PATIENCE_MS stops waiting for a quiet moment, never for a finger or a placement
const tapping = { ...base, critical: true, lastGestureAt: base.now - 200 };
eq(P.gateBlock({ ...tapping, waitedMs: 1000 }), 'gesture', 'a fresh crisis waits for a quiet moment');
eq(P.gateBlock({ ...tapping, waitedMs: P.CRITICAL_PATIENCE_MS }), 'gesture', 'a crisis at exactly the patience limit still waits');
eq(P.gateBlock({ ...tapping, waitedMs: P.CRITICAL_PATIENCE_MS + 1 }), '', 'a crisis that waited over 4 s lands between taps');
eq(P.gateBlock({ ...tapping, waitedMs: 60_000, pointersDown: 1 }), 'finger', 'a patient crisis still waits for the finger');
eq(P.gateBlock({ ...tapping, waitedMs: 60_000, placing: true }), 'placement', 'a patient crisis still waits for a placement');
eq(P.gateBlock({ ...base, lastGestureAt: base.now - 200, waitedMs: 60_000 }), 'gesture', 'an ordinary dialog never skips the quiet moment');
// [ux-redesign w3fix] a tutorial spotlight holds an ordinary dialog only until it has waited SPOTLIGHT_PATIENCE_MS; a crisis never waits for it
eq(P.gateBlock({ ...base, spotlightShowing: true }), 'spotlight', 'a spotlight holds a fresh ordinary dialog');
eq(P.gateBlock({ ...base, spotlightShowing: true, waitedMs: P.SPOTLIGHT_PATIENCE_MS }), 'spotlight', 'a spotlight still holds at exactly the patience limit');
eq(P.gateBlock({ ...base, spotlightShowing: true, waitedMs: P.SPOTLIGHT_PATIENCE_MS + 1 }), '', 'a dialog that waited past the patience limit lands over a spotlight');
eq(P.gateBlock({ ...base, spotlightShowing: true, critical: true }), '', 'a crisis comes over a spotlight at once');
eq(P.gateBlock({ ...base, spotlightShowing: true, waitedMs: 60_000, lastGestureAt: base.now - 200 }), 'gesture', 'a patient dialog still waits for a quiet moment');
eq(P.gateBlock({ ...base, spotlightShowing: false, waitedMs: 0 }), '', 'no spotlight: open');

// ---- tap guard of a fresh dialog ----------------------------------------------------------------------------------------------------
// [phase1] only a press that began before the dialog appeared (or a reflex tap in the first 250 ms) is swallowed
eq(P.MODAL_TAP_GUARD_MS, 250, 'guard is 250 ms');
ok(P.tapBlocked(1000, 1000 + 100, 1), 'tap 100 ms after open is swallowed');
ok(!P.tapBlocked(1000, 1000 + 300, 1, 1000 + 260), 'a press that started on the open dialog passes at 300 ms');
ok(P.tapBlocked(1000, 1000 + 2000, 1, 990), 'a press that started before the dialog opened is swallowed, however late it lifts');
ok(P.tapBlocked(1000, 1000 + 400, 1, -Infinity), 'a click with no pointerdown on the dialog is swallowed');
ok(!P.tapBlocked(1000, 1000 + P.MODAL_TAP_GUARD_MS, 1), 'tap at the guard edge passes');
ok(!P.tapBlocked(1000, 1000 + 10, 0), 'keyboard click passes at once');
ok(P.pressGuarded(1000, 1100) && !P.pressGuarded(1000, 1000 + P.MODAL_TAP_GUARD_MS), 'no pressed look inside the guard only');

// ---- [phase1] returning player: two quiet minutes after the welcome; offers by session time -----------------------------------------
ok(P.returningQuiet(10_000, 5_000, false), 'ordinary dialog held right after the welcome');
ok(!P.returningQuiet(10_000, 5_000, true), 'an emergency still comes');
ok(!P.returningQuiet(5_000 + P.RETURNING_QUIET_MS, 5_000, false), 'two minutes later dialogs flow again');
ok(!P.returningQuiet(10_000, -Infinity, false), 'no welcome this session: no hold');
ok(!P.offerSessionReady(599) && P.offerSessionReady(600), 'offers wait for ten minutes of this session');

// ---- [phase2] the interruption budget: one ordinary auto-dialog per 3 min (5 min until 30 min after the tutorial) ---------------------
eq(P.BUDGET_GAP_MS, 180_000, 'budget gap is 3 minutes');
eq(P.BUDGET_GAP_EARLY_MS, 300_000, 'early budget gap is 5 minutes');
eq(P.budgetGapMs(120, null), P.BUDGET_GAP_EARLY_MS, 'during the tutorial: the early gap');
eq(P.budgetGapMs(1000 + P.BUDGET_EARLY_S - 1, 1000), P.BUDGET_GAP_EARLY_MS, 'just under 30 min after the tutorial: still early');
eq(P.budgetGapMs(1000 + P.BUDGET_EARLY_S, 1000), P.BUDGET_GAP_MS, '30 min after the tutorial: 3 minutes');
ok(!P.budgetBlocks(1000, -Infinity, P.BUDGET_GAP_MS, false), 'nothing opened yet: the first ordinary dialog passes');
ok(P.budgetBlocks(1000 + 60_000, 1000, P.BUDGET_GAP_MS, false), '1 min after the last one: an ordinary dialog waits');
ok(P.budgetBlocks(1000 + P.BUDGET_GAP_MS - 1, 1000, P.BUDGET_GAP_MS, false), 'just under the gap: still waits');
ok(!P.budgetBlocks(1000 + P.BUDGET_GAP_MS, 1000, P.BUDGET_GAP_MS, false), 'at the gap: it may land');
ok(!P.budgetBlocks(1000 + 10, 1000, P.BUDGET_GAP_MS, true), 'an emergency (or exempt source) always passes');
// A simulated half hour after the tutorial: a pile of ordinary sources every 30 s, one emergency at 4 min. The budget lets one ordinary
// dialog through per gap, the emergency at once (spending nothing), and nothing is lost (the rest wait, still ready).
{
  const gap = P.BUDGET_GAP_EARLY_MS;
  let last = -Infinity;
  const opened = [];
  const waiting = [];
  for (let t = 0; t <= 30 * 60_000; t += 30_000) {
    waiting.push({ id: `soft@${t}`, critical: false });
    if (t === 240_000) waiting.unshift({ id: 'raid', critical: true });
    const top = waiting[0];
    if (P.budgetBlocks(t, last, gap, top.critical)) continue;
    waiting.shift();
    opened.push({ id: top.id, t });
    if (!top.critical) last = t;
  }
  const soft = opened.filter(o => o.id !== 'raid');
  ok(soft.every((o, i) => i === 0 || o.t - soft[i - 1].t >= gap), 'ordinary auto-dialogs are at least the gap apart');
  ok(soft.length <= Math.floor(30 * 60_000 / gap) + 1, `at most one per gap in 30 min (got ${soft.length})`);
  eq(opened.find(o => o.id === 'raid')?.t, 240_000, 'the emergency lands at once');
  eq(soft.length + waiting.filter(w => !w.critical).length, 61, 'nothing is dropped: the rest still wait');
}

// ---- [phase2] the door: only the first knock of a game is a dialog -------------------------------------------------------------------
eq(P.knockWay(false, false, true), 'dialog', 'the first knock opens its dialog (it teaches the door)');
eq(P.knockWay(false, true, true), 'dialog', 'the first knock is a dialog even with "let them in by themselves" on');
eq(P.knockWay(true, false, true), 'card', 'a later knock is a card, not a dialog');
eq(P.knockWay(true, true, true), 'auto', 'auto on and a bed free: they walk in');
eq(P.knockWay(true, true, false), 'card', 'auto on but no bed (or the food is short): a card');
eq(P.knockWay(true, false, false), 'card', 'nothing possible: still a card (its button opens the details)');

// ---- back closes the top layer only -------------------------------------------------------------------------------------------------
const b0 = { touring: false, modalOpen: false, modalDismiss: null, placing: false, readerOpen: false, surfaceOpen: false, sheetOpen: false };
eq(P.backAction({ ...b0, modalOpen: true, modalDismiss: 0, sheetOpen: true }), 'modalDismiss', 'back closes an info dialog, not the sheet under it');
eq(P.backAction({ ...b0, modalOpen: true, modalDismiss: null, sheetOpen: true }), 'modalStay', 'back leaves a decision alone');
eq(P.backAction({ ...b0, touring: true, modalOpen: true, modalDismiss: 0 }), 'tour', 'the tour first');
eq(P.backAction({ ...b0, placing: true, sheetOpen: true }), 'placement', 'placement before sheets');
eq(P.backAction({ ...b0, readerOpen: true, sheetOpen: true }), 'reader', 'the lore page over its sheet');
eq(P.backAction({ ...b0, sheetOpen: true }), 'sheet', 'a sheet');
eq(P.backAction(b0), 'leave', 'nothing open');
// [ux-redesign w3fix] the goals list / lock popover close first; a spotlight is never "Leave the game?"
eq(P.backAction({ ...b0, popoverOpen: true, sheetOpen: true }), 'popover', 'a floating list closes before the sheet under it');
eq(P.backAction({ ...b0, popoverOpen: true }), 'popover', 'the goals list closes, not "leave"');
eq(P.backAction({ ...b0, modalOpen: true, modalDismiss: 0, popoverOpen: true }), 'modalDismiss', 'a dialog over a list goes first');
eq(P.backAction({ ...b0, spotlight: true }), 'spotlight', 'back on a spotlight stays');
eq(P.backAction({ ...b0, spotlight: true, sheetOpen: true }), 'spotlight', 'back on a spotlight over a sheet stays');
eq(P.backAction({ ...b0, spotlight: true, popoverOpen: true }), 'popover', 'a list above the spotlight closes first');
eq(P.dismissIndex([{}], undefined), 0, 'one-button dialog is info');
eq(P.dismissIndex([{}, {}], undefined), null, 'two choices: a decision by default');
eq(P.dismissIndex([{}, {}], 1), 1, 'named "Later"');
eq(P.dismissIndex([{}], 'none'), null, 'explicit decision');
eq(P.dismissIndex([{ disabled: true }], undefined), null, 'never a disabled choice');

// ---- store warnings: time to empty under 3 minutes, never while rising, one icon -------------------------------------------------------
eq(P.lowStoreStep(5, 0.24, false, Infinity), 'keep', 'rising food (+0.24/s) never warns, however low');
eq(P.lowStoreStep(50, -0.07, false, Infinity), 'keep', '12 minutes from empty: no warning');
eq(P.lowStoreStep(50, -0.5, false, Infinity), 'warn', '100 s from empty: warn');
eq(P.lowStoreStep(50, -0.5, true, 1000), 'keep', 'warned once is enough');
eq(P.lowStoreStep(50, 0.1, true, 1000), 'clear', 'the rate turned positive: forget the warning');
eq(P.lowStoreStep(500, -0.5, true, 1000), 'clear', 'far from empty again: forget it');
eq(P.lowStoreStep(50, -0.5, false, 1000), 'keep', 'not twice within the repeat window');
eq(P.lowStoreStep(0, -0.5, false, Infinity), 'keep', 'already empty: the "out of" toast says it');
eq(P.oneIcon('[[warning]] Food is running low', 'bad'), 'Food is running low', 'bad toast: one warning icon');
eq(P.oneIcon('[[check]] Built', 'good'), 'Built', 'good toast: one check icon');
eq(P.oneIcon('[[warning]] Note', 'info'), '[[warning]] Note', 'info toast keeps its icon');

// ---- one-toast lane -------------------------------------------------------------------------------------------------------------------
eq(P.LANE_VISIBLE, 1, 'one toast on screen');
eq(P.nextInLane([{ kind: 'info' }, { kind: 'bad' }, { kind: 'good' }, { kind: 'bad' }], false), 1, 'most important, oldest first');
eq(P.nextInLane([{ kind: 'info' }, { kind: 'good' }], true), -1, 'nothing during placement');
eq(P.nextInLane([{ kind: 'info' }, { kind: 'critical' }], true), 1, 'critical even during placement');

// ---- folding ----------------------------------------------------------------------------------------------------------------------------
eq(P.goalLine(['A'], n => `done ${n}`, n => `${n} goals`), 'done A', 'one goal: its name');
eq(P.goalLine(['A', 'B', 'C'], n => `done ${n}`, n => `${n} goals`), '3 goals', 'three at once: one line');

// ---- the stale-save note --------------------------------------------------------------------------------------------------------------
eq(P.saveLooksStale(1000, 2000, null), false, 'last save landed');
eq(P.saveLooksStale(100_000, 50_000, 100_500), false, 'write landed, page closed before the note: no warning');
eq(P.saveLooksStale(100_000, 50_000, 80_000), false, 'an autosave 20 s earlier is safe: no warning');
eq(P.saveLooksStale(500_000, 50_000, 60_000), true, 'stored game minutes older: warn');
eq(P.saveLooksStale(500_000, 50_000, null), true, 'unknown stamp: old rule');

// ---- welcome back ------------------------------------------------------------------------------------------------------------------------
eq(P.wantsWelcome(60, 0), false, '1 minute away: no welcome');
eq(P.wantsWelcome(600, 0), false, '10 minutes away: no welcome');
eq(P.wantsWelcome(601, 0), true, 'over 10 minutes: welcome');
eq(P.wantsWelcome(60, 2), true, 'people at the door are asked about');
eq(P.wantsWelcome(null, 0), false, 'no report, no door: nothing');
eq(P.wantsWelcome(120, 0, true), true, '[w2fix] 2 minutes away with a raid: the report shows');
eq(P.wantsWelcome(120, 0, false), false, '[w2fix] 2 minutes away, nothing happened: no report');
eq(P.wantsWelcome(null, 0, true), false, '[w2fix] no report at all: nothing to show');

// ---- [final F1] who holds a page part inert: spotlight + dialog + sheet ------------------------------------------------------------
{
  const { file: f2 } = await bundleSim({ tag: 'inert', entry: join(ROOT, 'src', 'ui', 'inertOwners.ts') });
  const I = await import(pathToFileURL(f2).href);
  try { rmSync(f2); } catch { /* cache file */ }
  const node = (cls, tag = 'DIV') => {
    const attrs = new Set();
    return {
      inert: false, tagName: tag, parentElement: null, cls,
      matches: (sel) => sel.split(',').map(x => x.trim()).some(x => x === `.${cls}` || x === `#${cls}`),
      hasAttribute: (a) => attrs.has(a), removeAttribute: (a) => attrs.delete(a),
      toggleAttribute: (a, on) => { if (on) attrs.add(a); else attrs.delete(a); return on; },
    };
  };
  const hud = node('hud'), canvas = node('game-canvas'), modal = node('modal-overlay'), story = node('story-overlay'), toast = node('toast-stack'), script = node('x', 'SCRIPT');
  const body = [hud, canvas, modal, story, toast, script];
  // The spotlight's walk never takes a dialog, story, toast or script layer (the crate dialog stayed dead because it did).
  const spotHeld = body.filter(n => I.shouldInert(n, '.ob-hand'));
  eq(spotHeld.map(n => n.cls), ['hud', 'game-canvas'], 'spotlight inerts only the page, never a dialog layer');
  for (const n of spotHeld) I.holdInert(n, 'spotlight');
  // A dialog opens over the step: it holds the same parts too, and its own layer is forced live.
  modal.inert = true; modal.toggleAttribute('aria-hidden', true);
  const modalHeld = body.filter(n => n !== modal && I.shouldInert(n));
  eq(modalHeld.map(n => n.cls), ['hud', 'game-canvas'], 'a dialog takes over parts the spotlight holds');
  for (const n of modalHeld) I.holdInert(n, 'modal');
  I.forceLive(modal);
  eq([modal.inert, modal.hasAttribute('aria-hidden')], [false, false], 'Modal.show clears inert and aria-hidden on its own layer');
  // The spotlight goes while the dialog is up: the page stays inert (the dialog still holds it), the dialog stays live.
  for (const n of spotHeld) I.dropInert(n, 'spotlight');
  eq([hud.inert, canvas.inert, modal.inert], [true, true, false], 'spotlight release with a dialog up: page inert, dialog live');
  // The dialog closes: everything is live again, nothing leaks.
  for (const n of modalHeld) I.dropInert(n, 'modal');
  eq([hud.inert, canvas.inert], [false, false], 'dialog close after spotlight release: nothing left inert');
  // The other order: dialog closes first, the spotlight still holds the page.
  I.holdInert(hud, 'spotlight'); I.holdInert(hud, 'modal'); I.dropInert(hud, 'modal');
  eq(hud.inert, true, 'dialog closes under a spotlight: the spotlight still holds the page');
  I.dropInert(hud, 'spotlight');
  eq(hud.inert, false, 'then the spotlight lets go: live');
  // A sheet holds the HUD; the spotlight comes and goes; the sheet still holds it.
  I.holdInert(hud, 'sheet'); I.holdInert(hud, 'spotlight'); I.dropInert(hud, 'spotlight');
  eq(hud.inert, true, 'spotlight release leaves a sheet-held part inert');
  I.dropInert(hud, 'sheet');
  // A part made inert by something outside the registry is foreign: never taken, never freed.
  const foreign = node('other'); foreign.inert = true;
  eq(I.shouldInert(foreign), false, 'a foreign inert part is left alone');
  eq(I.inertHolders(hud), [], 'no holder left');
}

if (problems.length) {
  console.error(`popup-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('popup-test OK');

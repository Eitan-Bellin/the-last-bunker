import { i18n } from '../../i18n/I18nManager';
import { el } from '../dom';
import type { GameApp } from '../../app';
import type { GameState } from '../../core/GameState';
import { relaxedMs } from '../../utils/a11y'; // plan4:AC-13

/**
 * [plan4:UX-11] Gesture tips: each one shows once, at the moment it is useful, as a small card above the nav (never a dialog, never over a gesture).
 * "Seen" lives in the save's storyFlags as `tip:<id>` (additive: no new state, no version bump; `tip:drag` is the old hold-a-survivor tip, so
 * saves that already saw it stay quiet). A tip is also marked seen without showing when the player proves they know it (they pinched,
 * double-tapped, or carried a survivor). Settings has "Show the tips again", which clears the flags.
 */
export type TipId = 'pinch' | 'dbltap' | 'hold' | 'wing';

interface TipDef {
  id: TipId;
  flag: string;
  textKey: string;
  /** Which ghost-finger animation the card draws. */
  ghost: 'pinch' | 'dbltap' | 'hold' | 'wing';
  /** The moment this tip is useful (checked only in a calm moment). */
  due: (s: GameState, t: TipsController) => boolean;
}

/** Wings are drawn once the layout has any; before that the Act II sign is the cue (the soft wording does not promise a particular marker). */
export function wingsAvailable(s: GameState): boolean {
  return Object.keys(s.layout?.ext ?? {}).length > 0 || (s.longGame?.meta.act ?? 1) >= 2;
}

/** In order of teaching: the first due one shows. */
const TIPS: TipDef[] = [
  // After the first restoration the player has a bunker worth moving around.
  { id: 'pinch', flag: 'tip:pinch', textKey: 'tip.pinch', ghost: 'pinch', due: s => (s.ruinsCleared ?? 0) >= 1 },
  // After the player has opened a couple of rooms by tapping.
  { id: 'dbltap', flag: 'tip:dbltap', textKey: 'tip.dbltap', ghost: 'dbltap', due: (_s, t) => t.roomTaps >= 2 },
  // The old "tip:drag": once there is someone to move (after the first restoration).
  { id: 'hold', flag: 'tip:drag', textKey: 'tip.drag', ghost: 'hold', due: s => (s.ruinsCleared ?? 0) >= 1 && s.survivors.length >= 2 },
  { id: 'wing', flag: 'tip:wing', textKey: 'tip.wing', ghost: 'wing', due: s => wingsAvailable(s) && s.currentFloors >= 4 },
];

/** Time between two tips (ms): they teach one thing at a time. */
const GAP_MS = 40_000;
const SHOW_MS = 14_000;
const CHECK_MS = 700;
/** [ux-wp3 C1] A tip put away for a dialog or a sheet comes back this long after the screen is calm again (not the full gap). */
const RETRY_MS = 8_000;

export class TipsController {
  private app: GameApp;
  /** Taps on rooms this session (the double-tap tip waits for a couple). */
  roomTaps = 0;
  private lastTipAt = -Infinity;
  private lastCheck = 0;
  private card: HTMLElement | null = null;
  /** [ux-wp3 C1] The tip on screen (marked seen only once it was read: dismissed, or left up for its whole time). */
  private cardDef: TipDef | null = null;
  private hideTimer = 0;
  private downs: { t: number; x: number; y: number }[] = [];

  constructor(app: GameApp) {
    this.app = app;
  }

  /** Watches the canvas for the gestures the tips teach: someone who already does them never sees the tip. */
  install(): void {
    document.addEventListener('pointerdown', e => {
      const canvas = e.target instanceof Element && e.target.id === 'game-canvas';
      if (!canvas) return;
      const now = performance.now();
      this.downs = this.downs.filter(d => now - d.t < 400);
      // A second finger on the canvas while the first is down: a pinch (or a two-finger pan, as good a sign that they know multitouch).
      if (!e.isPrimary) { this.learned('pinch'); return; }
      // Two taps close in time and place: a double tap.
      if (this.downs.some(d => Math.hypot(e.clientX - d.x, e.clientY - d.y) < 40 && now - d.t < 320)) this.learned('dbltap');
      this.downs.push({ t: now, x: e.clientX, y: e.clientY });
    }, { capture: true, passive: true });
  }

  private seen(flag: string): boolean {
    return this.app.state.storyFlags.includes(flag);
  }

  private mark(flag: string): void {
    if (this.seen(flag)) return;
    this.app.engine.stateManager.applyDelta({ path: 'storyFlags', value: [...this.app.state.storyFlags, flag] });
  }

  /** The player did the thing: no need to teach it. */
  learned(id: TipId): void {
    const def = TIPS.find(t => t.id === id);
    if (!def || !this.app.state || this.seen(def.flag)) return;
    this.mark(def.flag);
  }

  /** The player tapped a room (the double-tap tip counts these). */
  noteRoomTap(): void {
    this.roomTaps++;
  }

  /** "Show the tips again": forget what was seen. */
  reset(): void {
    const s = this.app.state;
    this.app.engine.stateManager.applyDelta({ path: 'storyFlags', value: s.storyFlags.filter(f => !TIPS.some(t => t.flag === f)) });
    this.roomTaps = 0;
    this.lastTipAt = -Infinity;
    this.app.engine.requestSave();
  }

  get isShowing(): boolean {
    return !!this.card;
  }

  /** Called every frame; looks about twice a second. Shows at most one tip, and only in a calm moment. */
  update(now: number): void {
    const app = this.app;
    // [ux-wp3 C1] A dialog, a sheet, a story card came up over the tip: put it away unread, it comes back later.
    if (this.card && (app.modal.isVisible || app.anyPanelOpen() || app.storyOpen || app.welcomeOpen || app.introPlaying || app.placementMode
      || app.loreReader.isVisible || app.storyDialog.isVisible)) {
      this.defer();
      return;
    }
    if (now - this.lastCheck < CHECK_MS) return;
    this.lastCheck = now;
    const s = app.state;
    if (this.card || now - this.lastTipAt < GAP_MS) return;
    if (!s.storyFlags.includes('intro:done') || app.introPlaying || app.storyOpen || app.modal.isVisible || app.welcomeOpen) return;
    if (app.placementMode || app.anyPanelOpen() || !app.dialogGate(false)) return;
    const next = TIPS.find(t => !this.seen(t.flag) && t.due(s, this));
    if (next) this.show(next);
  }

  private show(def: TipDef): void {
    // [ux-wp3 C1] Not marked seen here: a tip covered by a dialog a second later must not be lost for good.
    this.cardDef = def;
    this.lastTipAt = performance.now();
    const card = el('div', `gesture-tip tip-${def.ghost}`);
    card.setAttribute('role', 'status');
    const ghost = el('div', `tip-ghost g-${def.ghost}`);
    ghost.setAttribute('aria-hidden', 'true');
    ghost.append(el('b', 'tip-trail'), el('i', 'tip-f1'), el('i', 'tip-f2'), el('u', 'tip-ring'));
    const text = el('p', 'tip-text', i18n.t(def.textKey));
    const more = el('button', 'btn btn-secondary tip-btn', i18n.t('tip.more'));
    more.addEventListener('click', () => { this.hide(true); this.app.openBook('touch'); });
    const ok = el('button', 'btn btn-primary tip-btn', i18n.t('tip.ok'));
    ok.addEventListener('click', () => this.hide(true));
    const row = el('div', 'tip-actions');
    row.append(more, ok);
    card.append(ghost, text, row);
    document.body.appendChild(card);
    this.card = card;
    requestAnimationFrame(() => card.classList.add('in'));
    this.app.audio.play('paper');
    this.hideTimer = window.setTimeout(() => this.hide(true), relaxedMs(SHOW_MS)); // plan4:AC-13 (up for its whole time, nothing over it: read)
  }

  /** [ux-wp3 C1] Puts the tip away unread (something else took the screen): it shows again in a calm moment. */
  defer(): void {
    if (!this.card) return;
    this.hide(false);
    this.lastTipAt = performance.now() - GAP_MS + RETRY_MS;
  }

  /** `read`: the player saw it through (a button, or the whole time on screen), so it is marked seen. */
  hide(read = true): void {
    window.clearTimeout(this.hideTimer);
    const card = this.card;
    const def = this.cardDef;
    this.card = null;
    this.cardDef = null;
    if (!card) return;
    if (read && def) this.mark(def.flag);
    card.classList.remove('in');
    this.lastTipAt = performance.now();
    window.setTimeout(() => card.remove(), 300);
  }
}

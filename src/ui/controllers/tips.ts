import { i18n } from '../../i18n/I18nManager';
import { el } from '../dom';
import type { GameApp } from '../../app';
import type { GameState } from '../../core/GameState';
import { relaxedMs } from '../../utils/a11y'; // plan4:AC-13
import { kButton } from '../kit';

/**
 * [ux-redesign w2a #7] Tips are taught once per player, not once per save: what was seen is also kept on the device (one key for every
 * slot, so a new game or another slot does not teach the pinch again). The save's storyFlags still count (older saves stay quiet).
 */
const PROFILE_KEY = 'lastbunker_tips_seen';

function profileSeen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function setProfileSeen(flags: string[]): void {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(flags)); } catch { /* storage blocked: the save's flags still work */ }
}

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

/**
 * [ux-redesign W3a] The ghost finger the tip cards draw, also used by the onboarding idle hint (src/ui/onboarding): a translucent disc
 * (two for the pinch), a trail and a ring, animated by checkin.css under full motion only.
 */
export function ghostHand(kind: TipDef['ghost'], extraClass = ''): HTMLElement {
  const ghost = el('div', `tip-ghost g-${kind}${extraClass ? ` ${extraClass}` : ''}`);
  ghost.setAttribute('aria-hidden', 'true');
  ghost.append(el('b', 'tip-trail'), el('i', 'tip-f1'), el('i', 'tip-f2'), el('u', 'tip-ring'));
  return ghost;
}

/**
 * [phase2] A news card: a non-blocking card in the tip slot (above the nav) for things that used to open a dialog of their own (a find,
 * a knock at the door after the first, what's new, a system that opened mid-Act). It hides by itself; whatever it offered stays
 * reachable from the bell or the journal, so nothing is lost when it goes. One at a time, in the order they came.
 */
export interface NewsCard {
  /** Same key = same card (queued once; `dropNews` takes it back). */
  key: string;
  icon: string;
  text: string;
  /** One or two buttons in the first row (the last one is the main one); more go to a second row. */
  actions: { label: string; primary?: boolean; onPress: () => void }[];
  /** Shows even in the quiet minutes after a welcome-back (a knock at the door). */
  urgent?: boolean;
  /** It hid by itself, unanswered (the bell or journal still has it). */
  onTimeout?: () => void;
  /** Still worth showing (checked when its turn comes; false drops it). */
  valid?: () => boolean;
  /** The sound it comes with (default: paper). */
  sound?: Parameters<GameApp['audio']['play']>[0];
}

/** [phase2] A news card stays up this long (relaxed timing doubles it), and the next one waits this long after it. */
const NEWS_MS = 12_000;
const NEWS_GAP_MS = 4_000;

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
  /** [phase2] News cards waiting their turn, and the one on screen (shares the tip slot: one card at a time). */
  private news: NewsCard[] = [];
  private newsDef: NewsCard | null = null;
  private lastNewsAt = -Infinity;

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
    return this.app.state.storyFlags.includes(flag) || profileSeen().includes(flag);
  }

  private mark(flag: string): void {
    const mine = profileSeen();
    if (!mine.includes(flag)) setProfileSeen([...mine, flag]);
    if (this.app.state.storyFlags.includes(flag)) return;
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
    setProfileSeen(profileSeen().filter(f => !TIPS.some(t => t.flag === f)));
    this.roomTaps = 0;
    this.lastTipAt = -Infinity;
    this.app.engine.requestSave();
  }

  /** [ux-redesign W3a] A tip card itself is on screen (not counting the onboarding spotlight). */
  get cardShowing(): boolean {
    return !!this.card;
  }

  /**
   * A tip card is on screen (ordinary dialogs wait for it). [ux-redesign w3fix] The onboarding spotlight is no longer folded in here: it
   * is its own gate input (popupRules `spotlightShowing`), which stops holding a dialog back after SPOTLIGHT_PATIENCE_MS.
   */
  get isShowing(): boolean {
    return !!this.card;
  }

  /** [phase2] Queues a news card (a card with the same key already waiting or showing is kept, not doubled). */
  pushNews(card: NewsCard): void {
    if (this.newsDef?.key === card.key || this.news.some(n => n.key === card.key)) return;
    this.news.push(card);
  }

  /** [phase2] Takes a news card back (answered elsewhere: the dialog, the bell). */
  dropNews(key: string): void {
    this.news = this.news.filter(n => n.key !== key);
    if (this.newsDef?.key === key) this.hide(false);
  }

  /** [phase2] A news card with this key is waiting or on screen. */
  hasNews(key: string): boolean {
    return this.newsDef?.key === key || this.news.some(n => n.key === key);
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
    if (app.onboarding?.holdsScreen) return; // [ux-redesign W3a] one teacher at a time
    // [phase2] News first (a knock at the door may come in the quiet minutes after a welcome-back; the rest waits them out).
    if (!this.card && this.news.length && now - this.lastNewsAt >= NEWS_GAP_MS && this.calm()) {
      this.news = this.news.filter(n => n.valid?.() !== false);
      const quiet = !!app.dialogs?.quietAfterWelcome(now);
      const at = this.news.findIndex(n => n.urgent || !quiet);
      if (at >= 0 && app.dialogGate(false)) {
        this.lastCheck = now;
        this.showNews(this.news.splice(at, 1)[0]);
        return;
      }
    }
    if (app.dialogs?.quietAfterWelcome(now)) return; // [phase1] nothing auto in the first two minutes after a welcome-back
    this.lastCheck = now;
    const s = app.state;
    if (this.card || now - this.lastTipAt < GAP_MS || now - this.lastNewsAt < NEWS_GAP_MS) return;
    if (!s.storyFlags.includes('intro:done') || !this.calm() || !app.dialogGate(false)) return;
    const next = TIPS.find(t => !this.seen(t.flag) && t.due(s, this));
    if (next) this.show(next);
  }

  /** Nothing else holds the screen (a tip or a news card may come up). */
  private calm(): boolean {
    const app = this.app;
    if (!app.state?.storyFlags.includes('intro:done')) return false;
    return !(app.introPlaying || app.storyOpen || app.modal.isVisible || app.welcomeOpen || app.placementMode || app.anyPanelOpen()
      || app.loreReader.isVisible || app.storyDialog.isVisible);
  }

  /** [phase2] A news card in the tip slot: icon, one line, its buttons; it hides by itself (the bell or journal keeps what it offered). */
  private showNews(n: NewsCard): void {
    this.newsDef = n;
    const card = el('div', 'gesture-tip news-card');
    card.setAttribute('role', 'status');
    const icon = el('span', 'news-icon', n.icon);
    icon.setAttribute('aria-hidden', 'true');
    card.append(icon, el('p', 'tip-text', n.text));
    const btn = (a: NewsCard['actions'][number]) => kButton({
      variant: a.primary ? 'primary' : 'secondary', className: `${a.primary ? 'btn-primary' : 'btn-secondary'} tip-btn`, label: a.label,
      onPress: () => { this.hide(false); a.onPress(); },
    });
    const first = n.actions.slice(0, 2), rest = n.actions.slice(2);
    const row = el('div', 'tip-actions');
    row.append(...first.map(btn));
    card.appendChild(row);
    if (rest.length) {
      const row2 = el('div', 'tip-actions');
      row2.append(...rest.map(btn));
      card.appendChild(row2);
    }
    document.body.appendChild(card);
    this.card = card;
    requestAnimationFrame(() => card.classList.add('in'));
    this.app.audio.play(n.sound ?? 'paper');
    this.hideTimer = window.setTimeout(() => { const d = this.newsDef; this.hide(false); d?.onTimeout?.(); }, relaxedMs(NEWS_MS));
  }

  private show(def: TipDef): void {
    // [ux-wp3 C1] Not marked seen here: a tip covered by a dialog a second later must not be lost for good.
    this.cardDef = def;
    this.lastTipAt = performance.now();
    const card = el('div', `gesture-tip tip-${def.ghost}`);
    card.setAttribute('role', 'status');
    const ghost = ghostHand(def.ghost);
    const text = el('p', 'tip-text', i18n.t(def.textKey));
    // [ux-redesign w2a] Kit buttons (action on release, 48 px hit area).
    const more = kButton({ variant: 'secondary', className: 'btn-secondary tip-btn', label: i18n.t('tip.more'), onPress: () => { this.hide(true); this.app.openBook('touch'); } });
    const ok = kButton({ variant: 'primary', className: 'btn-primary tip-btn', label: i18n.t('tip.ok'), onPress: () => this.hide(true) });
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
    this.app.onboarding?.defer(); // [ux-redesign W3a] an emergency dialog puts the spotlight away too (it comes back when calm)
    if (!this.card) return;
    // [phase2] A news card put away by a dialog goes back to the front of the line (not lost).
    const news = this.newsDef;
    this.hide(false);
    if (news) { this.news.unshift(news); return; }
    this.lastTipAt = performance.now() - GAP_MS + RETRY_MS;
  }

  /** `read`: the player saw it through (a button, or the whole time on screen), so it is marked seen. */
  hide(read = true): void {
    window.clearTimeout(this.hideTimer);
    const card = this.card;
    const def = this.cardDef;
    const news = this.newsDef;
    this.card = null;
    this.cardDef = null;
    this.newsDef = null;
    if (!card) return;
    if (read && def) this.mark(def.flag);
    card.classList.remove('in');
    if (news) this.lastNewsAt = performance.now(); // [phase2] a news card does not push the next gesture tip back by the full gap
    else this.lastTipAt = performance.now();
    window.setTimeout(() => card.remove(), 300);
  }
}

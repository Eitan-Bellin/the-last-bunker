import type { GameApp } from '../../app';
import type { NavKey, SpotKey } from '../HUD';
import { RESEARCH } from '../../data/research';
import { i18n } from '../../i18n/I18nManager';
import { el } from '../dom';
import { kButton } from '../kit';
import { Advisor } from './advisor';
import { ftueActive, ftueFinished, idleHintDue, type FtueInput } from './advisorRules';
import { IdleHand, Spotlight, type SpotStep } from './spotlight';
import { MODAL_OPEN_EVENT } from '../popupRules';
import '../../styles/onboarding.css';

/**
 * [ux-redesign W3a] Onboarding: the "What now?" advisor on the objective strip, the idle hint, the first-session spotlight, progressive
 * reveal of the nav (locked tabs say what opens them), and the "Tutorial again" walkthrough. Reads the state only.
 *
 * What a player has been taught lives on the device, not in a save (like the tips, controllers/tips.ts): `lastbunker_onboarding`
 * = { done, skipped, seen[] }. `done`: the first session is over (or was skipped), so a new game or another slot stays quiet.
 * `skipped`: "Skip tutorial" also stops the later one-time spotlights. `seen`: the one-time guided steps already shown.
 *
 * It runs on its own timer (TICK_MS) and wires itself to the HUD once the app has set its handlers, so app.ts only creates it.
 */
const PROFILE_KEY = 'lastbunker_onboarding';
/** How often the controller looks (ms; logic timing, not motion). */
const TICK_MS = 250;
/** A spotlight whose element stays off screen this long ends (ms). */
const LOST_MS = 1500;
/** After the strip routed to a wrecked room, how long the spotlight waits for its sheet's start button (ms). */
const START_WAIT_MS = 3000;
/** A lock popover closes by itself after this long (ms). */
const POP_MS = 6000;

interface Profile { done: boolean; skipped: boolean; seen: string[] }

function readProfile(): Profile {
  try {
    const v = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Partial<Profile> | null;
    return { done: !!v?.done, skipped: !!v?.skipped, seen: Array.isArray(v?.seen) ? v.seen.filter((x): x is string => typeof x === 'string') : [] };
  } catch { return { done: false, skipped: false, seen: [] }; }
}

function writeProfile(p: Profile): void {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* storage blocked: this session still remembers */ }
}

type Stage =
  | { kind: 'strip'; key: string }
  | { kind: 'start'; key: string; until: number }
  | { kind: 'guide'; id: string }
  | { kind: 'walk'; i: number };

interface Guided { id: string; target: () => HTMLElement | null; text: string }

/** Nav tabs that can be closed early on. Research is not one: it runs without a Laboratory (the lab speeds it up and makes knowledge). */
const LOCKABLE: NavKey[] = ['surface', 'research']; // [phase2] research: locked until a lab is built (HUD.navLockText)
const navTab = (key: string) => document.querySelector<HTMLElement>(`#hud-nav .hx-tab[data-key="${key}"]`);

export class OnboardingController {
  private app: GameApp;
  readonly advisor: Advisor;
  private spot: Spotlight | null = null;
  private hand: IdleHand | null = null;
  private installed = false;
  private profile = readProfile();
  private stage: Stage | null = null;
  /** Strip spotlights already answered this session (`step:<tutorial step>`). */
  private answered = new Set<string>();
  private queue: Guided[] = [];
  private lastTouch = performance.now();
  private handShown = new Map<string, number>();
  private handKey = '';
  private lostSince = 0;
  private locked = new Map<NavKey, boolean>();
  private pop: HTMLElement | null = null;
  private popKey: NavKey | null = null;
  private popTimer = 0;
  private offPopOutside: (() => void) | null = null;
  private origNav: ((key: NavKey) => void) | null = null;
  /**
   * [ux-redesign w3fix] Something covers the bunker (app.ts passes its `covered` check: every sheet including the structure list, a
   * dialog, placement, the tour, a story scene). Until it is set, the open sheets alone.
   */
  covered: (() => boolean) | null = null;

  constructor(app: GameApp) {
    this.app = app;
    this.advisor = new Advisor(app);
    window.setInterval(() => this.tick(), TICK_MS);
    // [phase1] A dialog, story scene or lore page opening puts the spotlight away at once (it used to wait for the next tick, and its
    // blockers, z 90 over the dialog's z 40, ate the first taps). It comes back when the screen is calm.
    window.addEventListener(MODAL_OPEN_EVENT, () => this.defer());
  }

  /** A spotlight is up: ordinary dialogs and tip cards wait (TipsController.isShowing). */
  get holdsScreen(): boolean {
    return !!this.spot?.isVisible;
  }

  /** [ux-redesign w3fix] A locked tab's popover is open (back / Escape close it first). */
  get popOpen(): boolean {
    return !!this.pop;
  }

  /** Something urgent takes the screen: put the spotlight away; it comes back when the screen is calm. */
  defer(): void {
    this.spot?.hide();
    this.hand?.hide();
  }

  // ---- wiring -------------------------------------------------------------------------------------------------------------------

  private tick(): void {
    if (!this.installed && !this.install()) return;
    try {
      this.update(performance.now());
    } catch (e) {
      console.warn('[onboarding]', e);
    }
  }

  private install(): boolean {
    const app = this.app;
    const hud = app.hud;
    if (!hud || !hud.onNav || !app.engine?.stateManager?.state || !app.modal) return false;
    this.installed = true;
    hud.advisor = () => this.advisor.advice().view;
    hud.goals = () => this.advisor.goals();
    hud.onObjectiveTap = () => this.advisor.advice(true).go();
    this.origNav = hud.onNav;
    hud.onNav = (key: NavKey) => {
      if (this.lockTap(key)) return;
      this.closePop();
      this.origNav?.(key);
    };
    const touched = (): void => {
      this.lastTouch = performance.now();
      this.hand?.hide();
    };
    for (const t of ['pointerdown', 'keydown', 'wheel'] as const) document.addEventListener(t, touched, { capture: true, passive: true });
    this.spot = new Spotlight();
    this.hand = new IdleHand();
    return true;
  }

  private ftueInput(): FtueInput {
    const s = this.app.state;
    return { profileDone: this.profile.done, tutorialStep: s.tutorialStep ?? 0, playSeconds: s.stats.totalPlayTime };
  }

  private saveProfile(patch: Partial<Profile>): void {
    this.profile = { ...this.profile, ...patch };
    writeProfile(this.profile);
  }

  private seen(id: string): boolean {
    return this.profile.seen.includes(id);
  }

  private markSeen(id: string): void {
    if (!this.seen(id)) this.saveProfile({ seen: [...this.profile.seen, id] });
  }

  /** The screen is free for teaching: no dialog, story, intro, placement, ceremony or tour. Sheets are judged separately. */
  private calm(): boolean {
    const a = this.app;
    return a.state.storyFlags.includes('intro:done') && !a.introPlaying && !a.modal.isVisible && !a.welcomeOpen && !a.storyOpen
      && !a.loreReader.isVisible && !a.storyDialog.isVisible && !a.placementMode && !a.ceremonyActive()
      && !document.body.classList.contains('tour-on') && !document.body.classList.contains('intro-active');
  }

  // ---- every tick ---------------------------------------------------------------------------------------------------------------

  private update(now: number): void {
    const f = this.ftueInput();
    // A player past the first session (this save or an earlier one) is a returning player on this device from now on.
    if (!this.profile.done && ftueFinished(f)) this.saveProfile({ done: true });
    this.refreshLocks();
    const calm = this.calm();
    const panel = this.covered?.() ?? this.app.anyPanelOpen();
    if (!calm) {
      this.spot?.hide();
      this.hand?.hide();
      this.closePop();
      return;
    }
    const step = this.desired(f, panel, now);
    // A gesture tip card waits for the spotlight (it is put away unread and comes back in a calm moment).
    if (step && this.app.tips.cardShowing) this.app.tips.defer();
    if (step) this.showStage(step.stage, step.spot, now);
    else if (this.spot?.isVisible) {
      this.spot.hide();
      // [w3fix] The "Tutorial again" walk only pauses while a panel is open: it goes on from the same step when the panel closes.
      if (this.stage?.kind !== 'walk') this.stage = null;
    }
    this.idleHint(now, f, panel);
  }

  /** Which spotlight should be up now, if any. */
  private desired(f: FtueInput, panel: boolean, now: number): { stage: Stage; spot: SpotStep } | null {
    const st = this.stage;
    // "Tutorial again" walkthrough.
    if (st?.kind === 'walk') {
      const steps = this.walkSteps();
      if (st.i >= steps.length) { this.stage = null; return null; }
      if (panel) return null;
      const w = steps[st.i];
      return { stage: st, spot: { target: w.target, text: w.text, mode: 'next', nextLabel: i18n.t(st.i === steps.length - 1 ? 'ux3a.done' : 'ux3a.next') } };
    }
    // First session: the strip, then (for a wrecked room) the sheet's start button.
    if (ftueActive(f)) {
      if (st?.kind === 'start') {
        const btn = this.startButton();
        if (btn) return { stage: st, spot: { target: () => this.startButton(), text: i18n.t('ux3a.spot.start'), mode: 'tap' } };
        if (now < st.until && panel) return null;
        this.stage = null;
      }
      // [phase1] Only the scripted tutorial steps get a spotlight, once each (keyed on the step, not on the advisor line): a crisis or a
      // crate taking the strip no longer re-locks the screen; those get the idle hand. The step's goal must be what the strip shows.
      const pick = this.advisor.advice().pick;
      const key = `step:${f.tutorialStep}`;
      if (!panel && pick?.kind === 'goal' && !this.answered.has(key) && !this.goalsOpen()) {
        return { stage: { kind: 'strip', key }, spot: { target: () => this.app.hud.objectiveTarget, text: i18n.t('ux3a.spot.strip'), mode: 'tap' } };
      }
      return null;
    }
    // One-time guided steps (a tab that just opened, a new system's button).
    if (this.profile.skipped) this.queue = [];
    while (this.queue.length && this.seen(this.queue[0].id)) this.queue.shift();
    const g = this.queue[0];
    if (g && !panel) return { stage: { kind: 'guide', id: g.id }, spot: { target: g.target, text: g.text, mode: 'tap' } };
    return null;
  }

  private sameStage(a: Stage | null, b: Stage): boolean {
    return !!a && JSON.stringify({ ...a, until: 0 }) === JSON.stringify({ ...b, until: 0 });
  }

  private showStage(stage: Stage, step: SpotStep, now: number): void {
    const spot = this.spot!;
    const target = step.target();
    // An element that stays off screen ends the step (a sheet closed under it, the tab bar hidden).
    if (!target || target.getBoundingClientRect().width === 0) {
      if (!this.lostSince) this.lostSince = now;
      if (now - this.lostSince > LOST_MS) { this.finishStage(stage); this.lostSince = 0; }
      return;
    }
    this.lostSince = 0;
    if (spot.isVisible && this.sameStage(this.stage, stage)) return;
    this.stage = stage;
    spot.show(step, {
      onTap: () => this.tapped(stage),
      onNext: () => this.next(),
      onSkip: () => this.skip(),
    });
  }

  /** The player tapped the element in the cut-out. */
  private tapped(stage: Stage): void {
    this.hand?.hide();
    if (stage.kind === 'strip') {
      this.answered.add(stage.key);
      const pick = this.advisor.advice().pick;
      const o = this.app.engine.objectiveSystem.current(this.app.state);
      // A wrecked room's sheet opens: its start button is the second half of the step.
      this.stage = pick?.kind === 'goal' && o.action?.kind === 'ruin' ? { kind: 'start', key: stage.key, until: performance.now() + START_WAIT_MS } : null;
      this.spot?.hide();
      return;
    }
    this.finishStage(stage);
  }

  private finishStage(stage: Stage): void {
    if (stage.kind === 'guide') this.markSeen(stage.id);
    if (stage.kind === 'strip') this.answered.add(stage.key);
    this.stage = null;
    this.spot?.hide();
  }

  private next(): void {
    const st = this.stage;
    if (st?.kind !== 'walk') return;
    const n = st.i + 1;
    if (n >= this.walkSteps().length) { this.stage = null; this.spot?.hide(); this.saveProfile({ done: true }); return; }
    this.stage = { kind: 'walk', i: n };
    this.spot?.hide();
  }

  /** "Skip tutorial": the first session is over for this player, and no more spotlights. */
  private skip(): void {
    this.saveProfile({ done: true, skipped: true });
    this.queue = [];
    this.stage = null;
    this.spot?.hide();
    this.hand?.hide();
  }

  private startButton(): HTMLElement | null {
    const b = document.querySelector<HTMLElement>('.sheet-overlay.open .building-sheet button.btn-wide');
    return b && b.getAttribute('aria-disabled') !== 'true' ? b : null;
  }

  private goalsOpen(): boolean {
    return !!document.getElementById('adv-goals');
  }

  // ---- idle hint ----------------------------------------------------------------------------------------------------------------

  private idleHint(now: number, f: FtueInput, panel: boolean): void {
    const hand = this.hand!;
    const spotOn = !!this.spot?.isVisible;
    const key = spotOn ? `spot:${JSON.stringify(this.stage)}` : `strip:${this.advisor.advice().pick?.key ?? ''}`;
    if (hand.isVisible) {
      if (key !== this.handKey || panel || this.pop) hand.hide();
      return;
    }
    const due = idleHintDue({
      idleMs: now - this.lastTouch,
      ftue: ftueActive(f) && !this.profile.skipped,
      crisis: this.advisor.crisis(),
      blocked: panel || !!this.pop || this.goalsOpen() || (spotOn && this.spot?.targetEl === null),
      shown: this.handShown.get(key) ?? 0,
    });
    if (!due) return;
    const target = spotOn ? this.spot!.targetEl : this.app.hud.objectiveTarget;
    if (!target) return;
    this.handKey = key;
    this.handShown.set(key, (this.handShown.get(key) ?? 0) + 1);
    hand.show(target);
  }

  // ---- progressive reveal -------------------------------------------------------------------------------------------------------

  /** Why a nav tab is not open yet ("Opens with ..."), or null when it is. */
  private lockText(key: NavKey): string | null {
    const s = this.app.state;
    if (key === 'surface') {
      if (this.app.engine.explorationSystem.isUnlocked(s)) return null;
      const node = RESEARCH.find(r => r.effects.some(e => e.type === 'feature' && e.feature === 'surface'));
      return i18n.t('ux2d.surface.needs', { name: node ? node.name[i18n.currentLocale] ?? node.name.en : '' });
    }
    if (key === 'research') return this.app.hud.navLockText('research'); // [phase2]
    return null;
  }

  private refreshLocks(): void {
    for (const key of LOCKABLE) {
      const text = this.lockText(key);
      const now = text !== null;
      const was = this.locked.get(key);
      const tab = navTab(key);
      if (!tab) continue;
      if (was !== now) {
        tab.classList.toggle('ob-locked', now);
        let badge = tab.querySelector<HTMLElement>('.ob-lock');
        if (now && !badge) {
          badge = el('span', 'ob-lock', '[[lock]]');
          badge.setAttribute('aria-hidden', 'true');
          tab.querySelector('.hx-tab__icon')?.appendChild(badge);
        }
        if (badge) badge.hidden = !now;
        if (now) tab.setAttribute('aria-description', text);
        else tab.removeAttribute('aria-description');
        // Opened while playing (not on load): a short pulse on the tab and, once per player, a guided tap on it.
        if (was === true && !now) this.unlocked(key, tab);
        this.locked.set(key, now);
      } else if (now && tab.getAttribute('aria-description') !== text) tab.setAttribute('aria-description', text);
    }
  }

  private unlocked(key: NavKey, tab: HTMLElement): void {
    tab.classList.remove('ob-unlock');
    void tab.offsetWidth;
    tab.classList.add('ob-unlock');
    tab.addEventListener('animationend', () => tab.classList.remove('ob-unlock'), { once: true });
    this.app.audio.play('powerUp');
    this.enqueue({ id: `unlock:${key}`, target: () => navTab(key), text: i18n.t(`ux3a.unlock.${key}`) });
  }

  private enqueue(g: Guided): boolean {
    if (this.profile.skipped || this.seen(g.id) || this.queue.some(q => q.id === g.id)) return false;
    this.queue.push(g);
    return true;
  }

  /** A locked tab was tapped: a one-line popover says what opens it, with a way to see more. True when it handled the tap. */
  private lockTap(key: NavKey): boolean {
    const text = this.lockText(key);
    if (text === null) return false;
    if (this.popKey === key) { this.closePop(); return false; } // a second tap opens the panel (the way there)
    this.closePop();
    const tab = navTab(key);
    if (!tab) return false;
    this.app.audio.play('click');
    const pop = el('div', 'ob-pop');
    pop.setAttribute('role', 'status');
    pop.appendChild(el('p', 'ob-pop__text', `[[lock]] ${text}`));
    pop.appendChild(kButton({
      variant: 'secondary', className: 'btn-secondary ob-pop__btn', label: i18n.t('ux3a.lock.show'),
      onPress: () => { this.closePop(); this.origNav?.(key); },
    }));
    document.body.appendChild(pop);
    this.pop = pop;
    this.popKey = key;
    const r = tab.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const w = pop.offsetWidth;
    pop.style.left = `${Math.min(Math.max(16, r.left + r.width / 2 - w / 2), vw - w - 16)}px`;
    pop.style.bottom = `${vh - r.top + 8}px`;
    requestAnimationFrame(() => pop.classList.add('in'));
    const outside = (e: PointerEvent): void => {
      if (e.target instanceof Node && (pop.contains(e.target) || tab.contains(e.target))) return;
      this.closePop();
    };
    document.addEventListener('pointerdown', outside, { capture: true });
    this.offPopOutside = () => document.removeEventListener('pointerdown', outside, { capture: true });
    this.popTimer = window.setTimeout(() => this.closePop(), POP_MS);
    return true;
  }

  closePop(): void {
    window.clearTimeout(this.popTimer);
    this.offPopOutside?.();
    this.offPopOutside = null;
    this.pop?.remove();
    this.pop = null;
    this.popKey = null;
  }

  /**
   * A "new system" card was read (controllers/systems.ts): a one-time guided tap on the button where it lives.
   * Returns false when this player already had it (or skipped the tutorial).
   */
  guideTo(spot: SpotKey, id: string): boolean {
    const target = (): HTMLElement | null => spot === 'inbox' ? document.querySelector<HTMLElement>('.hx-alerts') : spot === 'season' ? document.querySelector<HTMLElement>('.hx-act')
      : spot === 'era' ? document.querySelector<HTMLElement>('.hx-act') : navTab(spot);
    return this.enqueue({ id: `sys:${id}`, target, text: i18n.t('ux3a.guide.here') });
  }

  // ---- "Tutorial again" ---------------------------------------------------------------------------------------------------------

  private walkSteps(): Guided[] {
    const all: Guided[] = [
      { id: 'walk:strip', target: () => this.app.hud.objectiveTarget, text: i18n.t('ux3a.walk.strip') },
      { id: 'walk:build', target: () => navTab('build'), text: i18n.t('ux3a.walk.build') },
      { id: 'walk:people', target: () => navTab('people'), text: i18n.t('ux3a.walk.people') },
      { id: 'walk:research', target: () => navTab('research'), text: i18n.t('ux3a.walk.research') },
      { id: 'walk:surface', target: () => navTab('surface'), text: i18n.t('ux3a.walk.surface') },
      { id: 'walk:alerts', target: () => document.querySelector<HTMLElement>('.hx-alerts'), text: i18n.t('ux3a.walk.alerts') },
    ];
    return all.filter(w => !!w.target());
  }

  /** Settings > "Tutorial again": forget what this player was taught; a game still in its first steps gets the spotlights back, any other a short walk round the screen. */
  replay(): void {
    this.saveProfile({ done: false, skipped: false, seen: [] });
    this.answered.clear();
    this.handShown.clear();
    this.queue = [];
    this.spot?.hide();
    this.app.closeSheets();
    this.stage = ftueActive(this.ftueInput()) ? null : { kind: 'walk', i: 0 };
    this.app.toasts.show(`[[hand]] ${i18n.t('ux3a.replayed')}`, 'good');
  }
}

import { seasonAt, seasonsActive } from '../data/seasons';
import { resourceDef } from '../data/resources';
import type { GameState, ResourceType } from '../core/GameState';
import { haptic } from '../utils/haptics';
import { timeOfDay } from '../data/dayCycle';
import { isPowerPlant } from '../data/buildingDefs';
import { i18n } from '../i18n/I18nManager';
import { RESOURCE_ICONS, el, setRich } from './dom';
import { bedCap, bedsBuilt } from '../systems/BuildingSystem';
import { PopulationSystem } from '../systems/PopulationSystem';
import { ACTS, MAX_ACT, actOf, type ActDef } from '../data/acts';
import { crewCount, getDef } from '../data/buildingDefs';
import { subscribeA11y, getA11y, reducedMotion } from '../utils/a11y';
import { setHudInsets } from '../utils/hudInsets';
import { initViewportUi } from './viewportUi';
import { kResourceChip, kProgress, setProgress, kBadge, setBadge, kRow, kTooltip, bindPress } from './kit';
import { TIMER_ENDING_S } from './kit/tokens';
import { fmtDuration, fmtNum, plural } from './format';
import '../styles/hud.css';
import { CountUp } from './fx/countUp'; // [ux-redesign W4]

/** [Long game] Every resource the top bar can show; the Act decides which are in play (components, alloys... join from their Act on). */
const VISIBLE_RESOURCES: ResourceType[] = ['food', 'water', 'power', 'materials', 'medicine', 'knowledge', 'scrap', 'components', 'alloys', 'data', 'influence', 'seedCores'];

/**
 * [ux-redesign W2b] HUD diet: at most four resource tiles, on every screen. Early on the four basics; from Act III what holds progress
 * back (phoneSlots). A resource that runs short swaps itself in; the rest sit behind the labelled "N more" handle (a small list).
 */
const CORE_RESOURCES = new Set<ResourceType>(['food', 'water', 'power', 'materials']);
const MAX_TILES = 4;
/** Time to empty under which a tile shows a countdown (s), and under which it turns to danger. */
const COUNTDOWN_S = 300;
const DANGER_S = 180;
const LOW_PCT = 30;
const DANGER_PCT = 15;
const STEADY = 0.005;

export type NavKey = 'build' | 'surface' | 'research' | 'people';

/**
 * [ux-wp4] R3: the bunker is full because the Act holds the number of people (the rooms already give the beds), so the red door "!"
 * would be an alarm nobody can answer. Returns the next Act and how many places it opens, or null when more beds would help.
 */
export function actLock(state: GameState): { next: ActDef; more: number } | null {
  const lg = state.longGame;
  if (!lg || lg.meta.legacy || state.maxPopulation <= 0 || state.survivors.length < state.maxPopulation) return null;
  const act = actOf(state);
  if (act.id >= MAX_ACT || bedsBuilt(state) < bedCap(state)) return null;
  const next = ACTS[act.id];
  return next ? { next, more: Math.max(0, next.popCap - act.popCap) } : null;
}

/** [ux-wp4] B4/P14: idle adults and the free work places they could fill (a room behind a sealed door or still being built does not count). */
export function jobRoom(state: GameState): { idle: number; free: number } {
  let idle = 0;
  for (const s of state.survivors) if (!s.assignedBuildingId && !s.isOnMission && !s.child) idle++;
  let free = 0;
  if (idle > 0) {
    for (const b of state.buildings) {
      if (b.isConstructing && b.level <= 1) continue;
      const max = getDef(b.type)?.maxWorkers ?? 0;
      if (max > 0) free += Math.max(0, max - crewCount(state, b));
    }
  }
  return { idle, free };
}
/** [ux-redesign w3fix] Sets `hidden` only when it changes (writing the same value is still a DOM mutation). */
function setHidden(node: HTMLElement, on: boolean): void {
  if (node.hidden !== on) node.hidden = on;
}

/** [ux-redesign W3a] What the advisor strip says: one line, its reward or countdown, and its progress (null: no bar). */
export interface StripView {
  key: string;
  kind: 'crisis' | 'collect' | 'goal' | 'upgrade';
  icon: string;
  text: string;
  progress: [number, number] | null;
  reward: string;
  /** A countdown ("[[clock]] 2:10", icons allowed) when the line stands for a crisis. */
  urgent?: string;
  /** [phase1] The resource the line is about (a store crisis, the power shortage, a goal standing in for one). */
  resource?: string;
}

/** [ux-redesign W3a] One goal in the strip's unfolded list. */
export interface GoalView {
  icon: string;
  text: string;
  progress: [number, number];
  reward: string;
  onPress: () => void;
}

/** Buttons a "new system" card can make glow (see src/ui/controllers/systems.ts). */
export type SpotKey = NavKey | 'inbox' | 'season' | 'era';

export { timeOfDay };

interface ResourceEls {
  root: HTMLButtonElement;
  chip: HTMLElement;
  value: HTMLElement;
  trend: HTMLElement;
  rate: HTMLElement;
  bar: HTMLElement;
}

/** One line of the alerts list. `action` = something to do now (the badge turns red); otherwise news to read. */
interface Alert {
  key: string;
  icon: string;
  label: string;
  value?: string;
  count: number;
  action: boolean;
  open: () => void;
}

export class HUD {
  private container: HTMLDivElement;
  private resourceEls = new Map<ResourceType, ResourceEls>();
  onPopulation?: () => void;
  /** [ux-wp4] W2: the low-power banner and the morale chip open a short "why". */
  onPowerTap: (() => void) | null = null;
  onMoraleTap: (() => void) | null = null;
  /** [ux-redesign W2b] #23: the trade shop (falls back to the journal, whose Shop tab it is, until the app wires it). */
  onShop: (() => void) | null = null;
  /** [ux-wp4] B4: the People badge is recounted once a second, not every frame. */
  private jobsAt = 0;
  private jobsText = '';
  private powerBanner!: HTMLButtonElement;
  /** [phase1] The resource whose crisis the advisor strip shows now (null: none). */
  private stripRes: string | null = null;
  private placementBanner!: HTMLElement;
  private placementText!: HTMLElement;
  /** #44: the last text / class / style written to each node, so a frame writes only what changed. */
  private lastText = new WeakMap<HTMLElement, string>();
  private lastAttr = new WeakMap<HTMLElement, Map<string, string>>();
  private shown = new Map<ResourceType, number>();
  /** [ux-redesign W4] Big jumps count up over 300..1000 ms (and may wait for goods flying in); small ones roll as before. */
  readonly counts = new CountUp<ResourceType>();
  /** Which resources the current Act opens. */
  private actShow = new Map<ResourceType, boolean>();
  private topBar!: HTMLElement;
  private resRow!: HTMLElement;
  private moreBtn!: HTMLButtonElement;
  private moreText!: HTMLElement;
  private hiddenRes: ResourceType[] = [];
  private lastUpdate = performance.now();
  /** [plan4:AC-8] The resource buttons' spoken labels are refreshed at most 4 times a second (a screen reader must not be flooded). */
  private lastAria = 0;

  onNav: ((key: NavKey) => void) | null = null;
  onResourceTap: ((r: ResourceType) => void) | null = null;
  onMenu: (() => void) | null = null;
  private badges = new Map<NavKey, HTMLElement>();

  /** [plan4:AC-9] The plate of a resource that just ran short blinks twice (not under reduced motion: the toast carries the warning then). */
  alertResource(rt: ResourceType): void {
    const root = this.resourceEls.get(rt)?.root;
    if (!root || reducedMotion()) return;
    root.classList.remove('alert-pulse');
    void root.offsetWidth;
    root.classList.add('alert-pulse');
    window.setTimeout(() => root.classList.remove('alert-pulse'), 1200);
  }

  /** [plan4:AC-8] Marks the navigation button of the panel that is open (null: none). Cheap: touches the DOM only when it changes. */
  setNavCurrent(key: NavKey | 'menu' | null): void {
    if (this.navCurrent === key) return;
    this.navCurrent = key;
    for (const b of this.nav.querySelectorAll<HTMLElement>('.hx-tab')) {
      if (b.dataset.key === key) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }
  private navCurrent: NavKey | 'menu' | null = null;
  onPlacementCancel: (() => void) | null = null;

  constructor() {
    this.container = el('div');
    this.container.id = 'hud';
    document.body.appendChild(this.nightOverlay);
    document.body.appendChild(this.container);
    this.createTopBar();
    this.createBanners();
    this.createBottomNav();
    this.watchLayout();
    initViewportUi();
  }

  private resizeObs: ResizeObserver | null = null;
  private unsubA11y: (() => void) | null = null;
  /** [ux-redesign w2fix] The window resize listener and the pending frame of a measure, removed in destroy(). */
  private offResize: (() => void) | null = null;
  private measureRaf = 0;
  private nav!: HTMLElement;

  /**
   * [plan4:UX-5] Measures the real HUD bands (they change with the text size, the banners and the safe areas) and publishes them
   * (utils/hudInsets.ts: `window.__hudInsets`, --hud-top-h, --nav-h). From a text size of 1.25 the tiles drop their second line
   * into a 2x2 grid: that is a class on the bar, because a stylesheet cannot compare a custom property's number in a media query.
   */
  private watchLayout(): void {
    const sync = (): void => {
      this.topBar.classList.toggle('fs-big', getA11y().textScale >= 1.25);
    };
    sync();
    this.unsubA11y = subscribeA11y(sync);
    const measure = (): void => {
      this.measureRaf = 0;
      // [ux-redesign w2fix] The layout viewport (what position: fixed and 100% use), not innerHeight (which counts a pinch-zoomed view).
      const vh = document.documentElement.clientHeight || window.innerHeight;
      // The compact landscape layout (touch.css / hud.css) turns the status row and the nav into full-height side columns: they take
      // nothing from the top or bottom band then, so the heights are 0.
      const isColumn = (r: DOMRect): boolean => r.height > vh * 0.8;
      const topRect = this.topBar.getBoundingClientRect();
      let top = isColumn(topRect) ? 0 : topRect.bottom;
      for (const b of [this.powerBanner, this.incidentBanner, this.placementBanner]) {
        if (b.style.display !== 'none') top = Math.max(top, b.getBoundingClientRect().bottom);
      }
      const navRect = this.nav.getBoundingClientRect();
      const bottom = isColumn(navRect) ? 0 : vh - navRect.top;
      const objRect = this.objectiveEl.getBoundingClientRect();
      const objective = this.objectiveEl.style.display === 'none' ? 0 : Math.max(0, vh - bottom - objRect.top);
      setHudInsets({ top, bottom, objective });
      if (this.pop) this.placePop();
    };
    // [ux-redesign w2fix B4] Measured in the next frame, not inside the observer's callback: publishing the insets and placing the
    // list re-lays out the observed nodes, which made the browser report "ResizeObserver loop completed with undelivered notifications".
    const later = (): void => { if (!this.measureRaf) this.measureRaf = requestAnimationFrame(measure); };
    window.addEventListener('resize', later);
    this.offResize = () => window.removeEventListener('resize', later);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(later);
      for (const n of [this.topBar, this.nav, this.objectiveEl, this.powerBanner, this.incidentBanner, this.placementBanner]) this.resizeObs.observe(n);
    }
    measure();
  }

  // ───────────────────────────── top bar: resource tiles + one info row ─────────────────────────────

  private actBtn!: HTMLButtonElement;
  private actName!: HTMLElement;
  private actNum!: HTMLElement;
  private actPct!: HTMLElement;
  private actBar!: HTMLElement;
  private popBtn!: HTMLButtonElement;
  private popValue!: HTMLElement;
  private popCaption!: HTMLElement;
  private moraleBtn!: HTMLButtonElement;
  private moraleValue!: HTMLElement;
  private moraleIcon!: HTMLElement;
  private creditsBtn!: HTMLButtonElement;
  private creditsValue!: HTMLElement;
  private alertsBtn!: HTMLButtonElement;
  private alertsBadge!: HTMLElement;
  private clockValue!: HTMLElement;
  private clockIcon!: HTMLElement;
  private nightOverlay = el('div', 'night-overlay');

  private createTopBar(): void {
    // `.hud-top` stays for the safe-area and landscape-column rules in touch.css; everything inside is the W2b layout (styles/hud.css).
    const topBar = el('div', 'hud-top hx-top');
    const resourceRow = el('div', 'hx-res-row');
    for (const rt of VISIBLE_RESOURCES) {
      const root = el('button', 'hx-res');
      root.type = 'button';
      root.title = i18n.t(`resources.${rt}`);
      const chip = kResourceChip({ resource: rt, amount: 0 });
      chip.removeAttribute('role');
      chip.removeAttribute('aria-label');
      chip.setAttribute('aria-hidden', 'true');
      const value = chip.querySelector<HTMLElement>('.k-chip__amount')!;
      const rate = chip.querySelector<HTMLElement>('.k-chip__rate')!;
      rate.hidden = false;
      const trend = el('span', 'hx-trend');
      const line2 = el('span', 'hx-res__line2');
      // Danger also has a shape (the warning sign), never colour alone.
      line2.append(el('span', 'hx-warn', '[[warning]]'), trend, rate);
      const bar = kProgress(0, 100);
      bar.classList.add('hx-res__bar');
      bar.setAttribute('aria-hidden', 'true');
      chip.append(line2, bar);
      root.appendChild(chip);
      root.addEventListener('click', () => this.onResourceTap?.(rt));
      resourceRow.appendChild(root);
      this.resourceEls.set(rt, { root, chip, value, trend, rate, bar });
    }
    // "N more": hangs off the bottom edge of the bar (adds no row); opens the list of the Act's other stores.
    this.moreBtn = el('button', 'hx-more');
    this.moreBtn.type = 'button';
    this.moreText = el('span', 'hx-more__text');
    this.moreBtn.append(this.moreText);
    this.moreBtn.addEventListener('click', () => { haptic('tap'); this.togglePop('more'); });
    this.resRow = resourceRow;

    const info = el('div', 'hx-info');
    // The Act: its name, how far through it, as a labelled progress bar. Opens the Command panel.
    this.actBtn = el('button', 'hx-chip hx-act');
    this.actBtn.type = 'button';
    // [ux-redesign w2fix B1] Two short lines a phone can read: "Act III  38%" over the Act's own word ("Settle"); the progress is a
    // slim bar along the chip's bottom edge, so it no longer shares (and squeezes) the name's line.
    const actHead = el('span', 'hx-act__head');
    this.actNum = el('span', 'hx-act__num');
    this.actPct = el('span', 'hx-act__pct');
    actHead.append(this.actNum, this.actPct);
    this.actName = el('span', 'hx-act__name');
    this.actBar = kProgress(0, 100);
    this.actBar.classList.add('hx-act__bar');
    this.actBar.setAttribute('aria-hidden', 'true');
    this.actBtn.append(actHead, this.actName, this.actBar);
    this.actBtn.addEventListener('click', () => this.onEra?.());

    this.popBtn = el('button', 'hx-chip hx-stat hx-people');
    this.popBtn.type = 'button';
    this.popValue = el('span', 'hx-stat__value', '0/0');
    this.popCaption = el('span', 'hx-stat__caption', i18n.t('ux2b.survivors'));
    this.popBtn.append(el('span', 'hx-stat__icon', '[[people]]'), this.wrap(this.popValue, this.popCaption));
    this.popBtn.addEventListener('click', () => this.onPopulation?.());

    this.moraleBtn = el('button', 'hx-chip hx-stat hx-morale');
    this.moraleBtn.type = 'button';
    this.moraleValue = el('span', 'hx-stat__value', '50%');
    this.moraleIcon = el('span', 'hx-stat__icon', '[[neutral]]');
    this.moraleBtn.append(this.moraleIcon, this.wrap(this.moraleValue, el('span', 'hx-stat__caption', i18n.t('hud.morale'))));
    // Long press (or hover / keyboard focus): the biggest single cause. Bound before the click so the press that ends it is swallowed.
    kTooltip(this.moraleBtn, () => this.moraleTopCause());
    this.moraleBtn.addEventListener('click', () => this.onMoraleTap?.());

    // #23: the shop's own way in (wide screens; on a phone it is the last line of the alerts list).
    this.creditsBtn = el('button', 'hx-chip hx-stat hx-credits');
    this.creditsBtn.type = 'button';
    this.creditsValue = el('span', 'hx-stat__value', '0');
    this.creditsBtn.append(el('span', 'hx-stat__icon', RESOURCE_ICONS.credits ?? '[[credits]]'), this.wrap(this.creditsValue, el('span', 'hx-stat__caption', i18n.t('shop.tab'))));
    this.creditsBtn.addEventListener('click', () => this.openShop());

    const clock = el('div', 'hx-clock');
    this.clockValue = el('span', 'hx-stat__value', '06:00');
    this.clockValue.dir = 'ltr';
    this.clockIcon = el('span', 'hx-stat__icon', '[[sun]]');
    clock.append(this.clockIcon, this.clockValue);
    clock.setAttribute('aria-hidden', 'true');

    // One inbox for everything that waits: decisions, the supply crate, daily orders, the journal, the season, the shop.
    this.alertsBtn = el('button', 'hx-chip hx-alerts');
    this.alertsBtn.type = 'button';
    this.alertsBadge = kBadge(0);
    this.alertsBtn.append(el('span', 'hx-stat__icon', '[[bell]]'), el('span', 'hx-alerts__label', i18n.t('ux2b.alerts')), this.alertsBadge);
    this.alertsBtn.setAttribute('aria-haspopup', 'dialog');
    this.alertsBtn.setAttribute('aria-expanded', 'false');
    this.alertsBtn.addEventListener('click', () => { haptic('tap'); this.togglePop('alerts'); });

    info.append(this.actBtn, this.popBtn, this.moraleBtn, this.creditsBtn, clock, this.alertsBtn);
    topBar.append(resourceRow, info, this.moreBtn);
    this.topBar = topBar;
    this.container.appendChild(topBar);
    this.refreshAlerts();
  }

  private wrap(value: HTMLElement, caption: HTMLElement): HTMLElement {
    const box = el('span', 'hx-stat__text');
    box.append(value, caption);
    return box;
  }

  /** [Q7] Makes a HUD button glow for a few seconds, so the player sees where the new thing lives. */
  spotlight(key: SpotKey): void {
    const target = key === 'inbox' || key === 'season' ? this.alertsBtn : key === 'era' ? this.actBtn
      : this.nav.querySelector<HTMLElement>(`.hx-tab[data-key="${key}"]`);
    if (!target) return;
    target.classList.remove('spotlight');
    void target.offsetWidth;
    target.classList.add('spotlight');
    window.setTimeout(() => target.classList.remove('spotlight'), 9000);
  }

  // ───────────────────────────── alerts (the one notification lane) ─────────────────────────────

  onDaily: (() => void) | null = null;
  onSupply: (() => void) | null = null;
  onJournal: (() => void) | null = null;
  onInbox: (() => void) | null = null;
  onSeason: (() => void) | null = null;
  onEra: (() => void) | null = null;

  private daily = { visible: false, done: 0, n: 0, claimable: 0, title: '' };
  private supplyReady = false;
  private inbox = { visible: false, count: 0 };
  private journalUnread = 0;
  private season: { icon: string; label: string } | null = null;
  private credits = 0;
  private alertsSig = '';

  /** [plan4:GP-1] Daily orders: a line in the alerts list ("1/3"); `claimable` > 0 makes it an action. */
  setDaily(visible: boolean, done: number, n: number, claimable: number, title: string): void {
    this.daily = { visible, done, n, claimable, title };
    this.refreshAlerts();
  }

  setSupply(ready: boolean, _title: string): void {
    this.supplyReady = ready;
    this.refreshAlerts();
  }

  /** The decisions inbox: a line in the alerts list while it is in use; waiting cards make it an action. */
  setInbox(visible: boolean, count: number): void {
    this.inbox = { visible, count };
    this.refreshAlerts();
  }

  setJournalUnread(n: number): void {
    this.journalUnread = n;
    this.refreshAlerts();
  }

  private alerts(): Alert[] {
    const out: Alert[] = [];
    if (this.inbox.visible) out.push({ key: 'inbox', icon: 'inbox', label: i18n.t('ux2b.inbox'), value: this.inbox.count > 0 ? String(this.inbox.count) : '', count: this.inbox.count, action: this.inbox.count > 0, open: () => this.onInbox?.() });
    if (this.supplyReady) out.push({ key: 'supply', icon: 'gift', label: i18n.t('a11y.supply'), value: i18n.t('ux2b.supplyReady'), count: 1, action: true, open: () => this.onSupply?.() });
    if (this.daily.visible) out.push({ key: 'daily', icon: 'target', label: this.daily.title, value: `${this.daily.done}/${this.daily.n}`, count: this.daily.claimable, action: this.daily.claimable > 0, open: () => this.onDaily?.() });
    if (this.season) out.push({ key: 'season', icon: this.season.icon, label: this.season.label, count: 0, action: false, open: () => this.onSeason?.() });
    out.push({ key: 'journal', icon: 'journal', label: i18n.t('journal.title'), value: this.journalUnread > 0 ? i18n.t('ux2b.unread', { n: this.journalUnread }) : '', count: this.journalUnread, action: false, open: () => this.onJournal?.() });
    out.push({ key: 'shop', icon: 'credits', label: i18n.t('ux2b.shop'), value: fmtNum(this.credits), count: 0, action: false, open: () => this.openShop() });
    return out;
  }

  /** Recounts the badge (red only when something can be done now; grey for news; 99+). Called by the setters, not every frame. */
  private refreshAlerts(): void {
    const list = this.alerts();
    const acts = list.filter(a => a.action).reduce((s, a) => s + a.count, 0);
    const news = list.filter(a => !a.action).reduce((s, a) => s + a.count, 0);
    const n = acts > 0 ? acts : news;
    const sig = `${acts}|${news}|${list.map(a => `${a.key}:${a.value ?? ''}:${a.label}`).join(',')}`;
    if (sig === this.alertsSig) return;
    this.alertsSig = sig;
    setBadge(this.alertsBadge, n);
    this.alertsBadge.classList.toggle('is-news', acts === 0);
    this.alertsBtn.classList.toggle('has-action', acts > 0);
    const label = acts > 0 ? i18n.t('ux2b.alertsAct', { n: acts }) : news > 0 ? i18n.t('ux2b.alertsNews', { n: news }) : i18n.t('ux2b.alerts');
    this.alertsBtn.setAttribute('aria-label', label);
    this.alertsBtn.title = label;
    if (this.popKind === 'alerts') this.fillPop();
  }

  private openShop(): void {
    if (this.onShop) this.onShop();
    else this.onJournal?.();
  }

  // ───────────────────────────── the small list (alerts / more resources) ─────────────────────────────

  private pop: HTMLElement | null = null;
  private popKind: 'alerts' | 'more' | null = null;
  private popOff: (() => void) | null = null;

  private togglePop(kind: 'alerts' | 'more'): void {
    const same = this.popKind === kind;
    this.closePop();
    if (same) return;
    this.popKind = kind;
    const pop = el('div', 'hx-pop');
    pop.id = 'hud-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', kind === 'alerts' ? i18n.t('ux2b.alerts') : i18n.t('ux2b.moreTitle'));
    this.pop = pop;
    this.fillPop();
    document.body.appendChild(pop);
    this.placePop();
    const opener = kind === 'alerts' ? this.alertsBtn : this.moreBtn;
    opener.setAttribute('aria-expanded', 'true');
    pop.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (!pop.contains(t) && !opener.contains(t)) this.closePop();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { this.closePop(); opener.focus(); }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    this.popOff = () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      opener.setAttribute('aria-expanded', 'false');
    };
  }

  private closePop(): void {
    this.popOff?.();
    this.popOff = null;
    this.pop?.remove();
    this.pop = null;
    this.popKind = null;
  }

  private placePop(): void {
    if (!this.pop) return;
    const anchor = (this.popKind === 'alerts' ? this.alertsBtn : this.moreBtn).getBoundingClientRect();
    this.pop.style.top = `${Math.round(Math.max(this.topBar.getBoundingClientRect().bottom, anchor.bottom))}px`;
  }

  private fillPop(): void {
    const pop = this.pop;
    if (!pop) return;
    pop.replaceChildren();
    const go = (fn: () => void) => (): void => { this.closePop(); fn(); };
    if (this.popKind === 'alerts') {
      for (const a of this.alerts()) {
        const row = kRow({ icon: a.icon, label: a.label, value: a.value || undefined, onPress: go(a.open) });
        row.classList.add('hx-pop__row');
        if (a.action) {
          row.classList.add('is-action');
          row.appendChild(el('span', 'hx-pop__dot', '[[warning]]'));
        }
        pop.appendChild(row);
      }
    } else if (this.lastState) {
      for (const rt of this.hiddenRes) {
        const res = this.lastState.resources[rt];
        const net = res.productionRate - res.consumptionRate;
        const row = kRow({ label: i18n.t(`resources.${rt}`), value: `${fmtNum(res.amount)} · ${i18n.formatRate(net)}`, onPress: go(() => this.onResourceTap?.(rt)) });
        row.insertBefore(el('span', 'k-row__icon', RESOURCE_ICONS[rt] ?? ''), row.firstChild);
        row.classList.add('hx-pop__row');
        row.querySelector<HTMLElement>('.k-row__value')!.dir = 'ltr';
        pop.appendChild(row);
      }
    }
  }

  // ───────────────────────────── Act chip, clock, objective ─────────────────────────────

  /**
   * The Act and how far through it, as a labelled bar ("Act III 45%" over "Settle"); the era stays the bunker's look. Opens the
   * Command panel. `act` is the Act's numeral and percent; without it (legacy runs) the chip names the era only.
   * [ux-redesign w2fix] The numeral and the percent arrive as data (no "III·45%" string to parse) and sit in bidi isolates on screen.
   */
  setEra(key: string, name: string, act: { roman: string; pct: number } | null = null, title = name): void {
    const sig = `${key}|${name}|${act ? `${act.roman}|${act.pct}` : ''}|${title}`;
    if (this.actBtn.dataset.sig === sig) return;
    this.actBtn.dataset.sig = sig;
    this.actBtn.dataset.era = key;
    const pct = act ? act.pct : -1;
    if (act) {
      const roman = document.createElement('bdi');
      roman.className = 'hx-act__roman';
      roman.dir = 'ltr';
      roman.textContent = act.roman;
      this.actNum.replaceChildren(`${i18n.t('wp6.hud.actShort')} `, roman);
    } else {
      this.actNum.replaceChildren();
    }
    this.actNum.hidden = !act;
    this.setText(this.actName, name);
    this.setText(this.actPct, pct >= 0 ? `${pct}%` : '');
    this.actBar.hidden = pct < 0;
    if (pct >= 0) setProgress(this.actBar, pct, 100);
    this.actBtn.title = title;
    this.actBtn.setAttribute('aria-label', title);
  }

  private updateClock(state: GameState): void {
    const { hour, minute, night } = timeOfDay(state.stats.totalPlayTime);
    this.setText(this.clockValue, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    this.setText(this.clockIcon, night > 0.5 ? '[[moon]]' : '[[sun]]');
    this.setStyle(this.nightOverlay, 'opacity', night.toFixed(3));
  }

  /**
   * [ux-redesign W3a] The objective strip is the one "What now?" advisor: one line (icon, short verb text, reward or countdown, a progress
   * bar) that routes on tap, and a "goals" key that unfolds up to three active goals. What it says comes from `advisor`
   * (src/ui/onboarding/advisor.ts); without it the strip shows the objective the app passes, as before.
   */
  private objectiveEl!: HTMLElement;
  private objectiveMain!: HTMLButtonElement;
  private objectiveIcon!: HTMLElement;
  private objectiveText!: HTMLElement;
  private objectiveMeta!: HTMLElement;
  private objectiveBar!: HTMLElement;
  private objectiveMore!: HTMLButtonElement;
  private objectiveMoreN!: HTMLElement;
  private objectiveList: HTMLElement | null = null;
  private objectiveListAt = 0;
  private offListOutside: (() => void) | null = null;
  onObjectiveTap: (() => void) | null = null;
  /** [ux-redesign W3a] What the strip says now (null: the objective passed to setObjective). */
  advisor: (() => StripView | null) | null = null;
  /** [ux-redesign W3a] The goals the strip unfolds (up to three). Fewer than two: no "goals" key. */
  goals: (() => GoalView[]) | null = null;

  /** [ux-redesign W3a] The strip's tappable line (the spotlight and the idle hint point at it). */
  get objectiveTarget(): HTMLElement {
    return this.objectiveMain;
  }

  /**
   * Redraws the strip from `advisor` (about once a second). [w3fix] Every write is skipped when the value is already there: setting
   * `hidden` or a dataset value to what it already is still counts as a DOM mutation. Until the onboarding wires `advisor` (its first
   * tick, 250 ms in) the strip keeps its empty first look.
   */
  setObjective(): void {
    const v = this.advisor?.();
    if (!v) { this.stripRes = null; return; }
    // [phase1] One problem, one place: while the strip carries a store's crisis, its tile shows only its state colour (no countdown)
    // and the power banner stays down.
    this.stripRes = v.urgent && v.resource ? v.resource : null;
    const kind = v.urgent ? 'crisis' : v.kind;
    if (this.objectiveEl.dataset.kind !== kind) this.objectiveEl.dataset.kind = kind;
    this.setText(this.objectiveIcon, v.icon);
    this.setText(this.objectiveText, v.text);
    const [cur, target] = v.progress ?? [0, 0];
    const parts: string[] = [];
    if (v.urgent) parts.push(v.urgent);
    else if (target > 1) parts.push(`${fmtNum(Math.min(cur, target))}/${fmtNum(target)}`);
    if (v.reward) parts.push(`[[gift]] ${v.reward}`);
    this.setText(this.objectiveMeta, parts.join(' · '));
    setHidden(this.objectiveMeta, parts.length === 0);
    const showBar = !!v.progress && target > 0 && !v.urgent;
    setHidden(this.objectiveBar, !showBar);
    if (showBar && this.objectiveBar.dataset.sig !== `${cur}/${target}`) {
      this.objectiveBar.dataset.sig = `${cur}/${target}`;
      setProgress(this.objectiveBar, cur, target);
    }
    const label = `${v.text}${parts.length ? `. ${parts.join(', ').replace(/\[\[\w+\]\]\s?/g, '')}` : ''}`;
    if (this.objectiveMain.getAttribute('aria-label') !== label) this.objectiveMain.setAttribute('aria-label', label);
    // The goals key, and the open list kept current (about once a second: the goals read the whole Act).
    const now = performance.now();
    if (this.objectiveList) {
      if (now - this.objectiveListAt > 1000) this.fillGoals();
    } else if (now - this.objectiveListAt > 1000) {
      this.objectiveListAt = now;
      const n = this.goals?.().length ?? 0;
      setHidden(this.objectiveMore, n < 2);
      this.setText(this.objectiveMoreN, n >= 2 ? String(n) : '');
    }
  }

  private toggleGoals(): void {
    if (this.objectiveList) { this.closeGoals(); return; }
    const list = el('div', 'adv-list');
    list.id = 'adv-goals';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', i18n.t('ux3a.goals'));
    this.objectiveList = list;
    this.objectiveEl.appendChild(list);
    this.fillGoals();
    this.objectiveMore.setAttribute('aria-expanded', 'true');
    this.objectiveEl.classList.add('is-open');
    const outside = (e: PointerEvent): void => {
      if (e.target instanceof Node && this.objectiveEl.contains(e.target)) return;
      this.closeGoals();
    };
    document.addEventListener('pointerdown', outside, { capture: true });
    this.offListOutside = () => document.removeEventListener('pointerdown', outside, { capture: true });
  }

  /** [ux-redesign w3fix] A small floating list is open (the goals list, or the alerts / more-resources list): back closes it first. */
  get floatingOpen(): boolean {
    return !!this.objectiveList || !!this.pop;
  }

  /** [ux-redesign w3fix] Closes the goals list and the alerts / more list (back / Escape). True when something was open. */
  closeFloating(): boolean {
    const was = this.floatingOpen;
    const opener = this.objectiveList ? this.objectiveMore : this.popKind === 'alerts' ? this.alertsBtn : this.popKind === 'more' ? this.moreBtn : null;
    const box = this.objectiveList ?? this.pop;
    const focusInside = !!box && box.contains(document.activeElement);
    this.closeGoals();
    this.closePop();
    if (focusInside) opener?.focus({ preventScroll: true }); // the focus does not fall to the page when its list goes
    return was;
  }

  closeGoals(): void {
    if (!this.objectiveList) return; // [w3fix] nothing to close: no writes
    this.offListOutside?.();
    this.offListOutside = null;
    this.objectiveList?.remove();
    this.objectiveList = null;
    this.objectiveMore.setAttribute('aria-expanded', 'false');
    this.objectiveEl.classList.remove('is-open');
  }

  private fillGoals(): void {
    const list = this.objectiveList;
    if (!list) return;
    this.objectiveListAt = performance.now();
    const goals = this.goals?.() ?? [];
    const sig = goals.map(g => `${g.text}|${g.progress.join('/')}|${g.reward}`).join(';');
    if (list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    list.replaceChildren(el('div', 'adv-list__title', i18n.t('ux3a.goals')));
    for (const g of goals) {
      const row = el('button', 'adv-goal');
      row.type = 'button';
      row.setAttribute('role', 'listitem');
      const [cur, target] = g.progress;
      const meta = [target > 1 ? `${fmtNum(Math.min(cur, target))}/${fmtNum(target)}` : '', g.reward ? `[[gift]] ${g.reward}` : ''].filter(Boolean).join(' · ');
      const top = el('span', 'adv-goal__top');
      top.append(el('span', 'adv-goal__icon', g.icon), el('span', 'adv-goal__text', g.text));
      if (meta) {
        const m = el('span', 'adv-goal__meta', meta);
        m.dir = 'auto';
        top.appendChild(m);
      }
      row.append(top, kProgress(cur, Math.max(1, target), g.text));
      bindPress(row, () => { this.closeGoals(); g.onPress(); });
      list.appendChild(row);
    }
  }

  private createBanners(): void {
    // [ux-redesign W3a] The advisor strip: the line (one button, routes on release) and the "goals" key that unfolds the list above it.
    this.objectiveEl = el('div', 'objective adv');
    this.objectiveMain = el('button', 'adv-main');
    this.objectiveMain.type = 'button';
    this.objectiveIcon = el('span', 'objective-tag', '[[target]]');
    this.objectiveIcon.setAttribute('aria-hidden', 'true');
    this.objectiveText = el('span', 'objective-text');
    this.objectiveMeta = el('span', 'objective-meta');
    this.objectiveMeta.dir = 'auto';
    this.objectiveBar = kProgress(0, 1);
    this.objectiveBar.classList.add('adv-bar');
    this.objectiveBar.setAttribute('aria-hidden', 'true');
    const body = el('span', 'adv-body');
    const line = el('span', 'adv-line');
    line.append(this.objectiveText, this.objectiveMeta);
    body.append(line, this.objectiveBar);
    this.objectiveMain.append(this.objectiveIcon, body);
    bindPress(this.objectiveMain, () => { this.closeGoals(); this.onObjectiveTap?.(); }, { haptics: false });
    this.objectiveMore = el('button', 'adv-more');
    this.objectiveMore.type = 'button';
    this.objectiveMore.hidden = true;
    this.objectiveMore.setAttribute('aria-expanded', 'false');
    this.objectiveMore.setAttribute('aria-controls', 'adv-goals');
    this.objectiveMore.setAttribute('aria-label', i18n.t('ux3a.goalsMore'));
    this.objectiveMore.title = i18n.t('ux3a.goalsMore');
    this.objectiveMoreN = el('span', 'adv-more__n');
    this.objectiveMore.append(el('span', 'adv-more__icon', '[[flag]]'), this.objectiveMoreN);
    bindPress(this.objectiveMore, () => this.toggleGoals());
    this.objectiveEl.append(this.objectiveMain, this.objectiveMore);
    this.container.appendChild(this.objectiveEl);

    this.powerBanner = el('button', 'hud-banner power');
    this.powerBanner.style.display = 'none';
    this.powerBanner.addEventListener('click', () => this.onPowerTap?.()); // [ux-wp4] W2
    this.incidentBanner = el('button', 'hud-banner incident');
    this.incidentBanner.style.display = 'none';
    this.incidentBanner.addEventListener('click', () => this.onIncident?.());
    this.container.appendChild(this.incidentBanner);

    this.placementBanner = el('div', 'hud-banner placement');
    this.placementText = el('span');
    const cancel = el('button', 'btn btn-small btn-ghost', i18n.t('placement.cancel'));
    cancel.addEventListener('click', () => this.onPlacementCancel?.());
    this.placementBanner.append(this.placementText, cancel);
    this.placementBanner.style.display = 'none';

    this.container.append(this.powerBanner, this.placementBanner);
  }

  // ───────────────────────────── bottom nav (thumb zone) ─────────────────────────────

  private createBottomNav(): void {
    const nav = el('div', 'hud-bottom hx-nav');
    nav.id = 'hud-nav';
    this.nav = nav;
    // [plan4:AC-8] The console is a toolbar; the open panel's button says aria-current (setNavCurrent).
    nav.setAttribute('role', 'toolbar');
    nav.setAttribute('aria-label', i18n.t('a11y.nav'));
    const buttons: { key: NavKey | 'menu'; icon: string; label: string }[] = [
      { key: 'build', icon: '[[build]]', label: i18n.t('hud.build') },
      { key: 'people', icon: '[[people]]', label: i18n.t('hud.people') },
      { key: 'research', icon: '[[research]]', label: i18n.t('hud.research') },
      { key: 'surface', icon: '[[surface]]', label: i18n.t('hud.surface') },
      { key: 'menu', icon: '[[menu]]', label: i18n.t('menu.title') },
    ];
    for (const btn of buttons) {
      // #37: the keys fill the console edge to edge (no dead gaps); the visible plate is inset inside each key.
      const b = el('button', `hx-tab${btn.key === 'menu' ? ' hx-tab--menu' : ''}`);
      b.type = 'button';
      b.dataset.key = btn.key;
      const icon = el('span', 'hx-tab__icon', btn.icon);
      if (btn.key !== 'menu') {
        const badge = el('span', 'k-badge hx-tab__badge');
        badge.hidden = true;
        icon.appendChild(badge);
        this.badges.set(btn.key, badge);
        if (btn.key === 'people') this.peopleBadge = badge;
      }
      b.append(icon, el('span', 'hx-tab__label', btn.label));
      b.addEventListener('click', () => {
        haptic('select');
        if (btn.key === 'menu') this.onMenu?.(); else this.onNav?.(btn.key);
      });
      nav.appendChild(b);
    }
    // [plan4:UX-8] The console lives on <body>, not inside #hud: #hud is its own stacking context (z 10), under the sheets (z 20),
    // and the nav has to stay visible and tappable above an open sheet so a tab swaps the panel without closing it first.
    document.body.appendChild(nav);
  }

  private peopleBadge!: HTMLElement;
  private incidentBanner!: HTMLButtonElement;
  onIncident: (() => void) | null = null;

  /** Flashing alarm strip while a crisis burns somewhere in the bunker. */
  setIncident(text: string | null, kind = ''): void {
    this.incidentBanner.style.display = text ? '' : 'none';
    if (!text) return;
    this.incidentBanner.dataset.kind = kind;
    this.setText(this.incidentBanner, text);
  }

  /** Where a resource's tile is (fly-to-HUD); a resource without a tile flies to the "more" handle. */
  resourceRect(r: ResourceType): DOMRect | null {
    if (r === 'credits' && !this.resourceEls.has(r)) return this.creditsBtn.isConnected ? this.creditsBtn.getBoundingClientRect() : null; // [ux-redesign W4]
    const root = this.resourceEls.get(r)?.root;
    if (root && root.style.display !== 'none') return root.getBoundingClientRect();
    return this.moreBtn.style.display !== 'none' ? this.moreBtn.getBoundingClientRect() : null;
  }

  /** [ux-redesign W4] Goods are flying to this tile: its number waits `ms` for them before it counts up. */
  holdCount(r: ResourceType, ms: number): void {
    this.counts.hold(r, ms);
  }

  /** [ux-redesign W4] The first of the flying goods landed: the icon pulses (fx.css) and the number starts counting. */
  landResource(r: ResourceType): void {
    this.counts.release(r);
    this.pulseResource(r);
  }

  pulseResource(r: ResourceType): void {
    // [ux-redesign W4] The tile the goods flew to: the store's own, the credits chip, or the "more" handle of a store without a tile.
    const own = this.resourceEls.get(r)?.root;
    const root = own && own.style.display !== 'none' ? own : r === 'credits' ? this.creditsBtn : this.moreBtn.style.display !== 'none' ? this.moreBtn : null;
    if (!root) return;
    root.classList.remove('pulse');
    void root.offsetWidth;
    root.classList.add('pulse');
  }

  setBadge(key: NavKey, text: string | null): void {
    const badge = this.badges.get(key);
    if (!badge) return;
    setHidden(badge, !text); // [w3fix] no write when unchanged
    if (text) this.setText(badge, text);
  }

  showPlacement(name: string): void {
    this.placementText.textContent = i18n.t('placement.hint', { name });
    this.placementBanner.style.display = '';
  }

  hidePlacement(): void {
    this.placementBanner.style.display = 'none';
  }

  // ───────────────────────────── cached writes (#44) ─────────────────────────────

  private setText(node: HTMLElement, text: string): void {
    if (this.lastText.get(node) === text) return;
    this.lastText.set(node, text);
    setRich(node, text);
  }

  private cache(node: HTMLElement): Map<string, string> {
    let m = this.lastAttr.get(node);
    if (!m) { m = new Map(); this.lastAttr.set(node, m); }
    return m;
  }

  /** An attribute, a style property (`--x` or a property name) or a class set, written only when its value changes. */
  private setAttr(node: HTMLElement, name: string, value: string): void {
    const m = this.cache(node);
    if (m.get(`a:${name}`) === value) return;
    m.set(`a:${name}`, value);
    node.setAttribute(name, value);
  }

  private setStyle(node: HTMLElement, prop: string, value: string): void {
    const m = this.cache(node);
    if (m.get(`s:${prop}`) === value) return;
    m.set(`s:${prop}`, value);
    node.style.setProperty(prop, value);
  }

  private setState(node: HTMLElement, group: string, value: string): void {
    const m = this.cache(node);
    const prev = m.get(`c:${group}`);
    if (prev === value) return;
    m.set(`c:${group}`, value);
    if (prev) node.classList.remove(prev);
    if (value) node.classList.add(value);
  }

  // ───────────────────────────── the frame ─────────────────────────────

  private shownAct = -1;
  private lastState: GameState | null = null;
  private seasonSig = '';
  private lastSlots = '';
  private popSig = '';

  update(state: GameState): void {
    this.lastState = state;
    const act = state.longGame?.meta.act ?? 1;
    if (act !== this.shownAct) {
      this.shownAct = act;
      for (const rt of this.resourceEls.keys()) {
        const opens = resourceDef(rt)?.act ?? 0;
        // Tier-2 goods: the current Act's and the one before (older ones still show in costs and in the drawer).
        this.actShow.set(rt, opens === 0 || (act >= opens && opens >= act - 1));
      }
    }
    // [P2] The season (from the second Act): a line in the alerts list.
    const season = seasonsActive(state) ? seasonAt(state) : null;
    const sSig = season ? `${season.def.id}|${Math.ceil(season.left / 86400)}|${i18n.currentLocale}` : '';
    if (sSig !== this.seasonSig) {
      this.seasonSig = sSig;
      this.season = season ? { icon: season.def.icon, label: i18n.t('ux2b.season', { name: season.def.name[i18n.currentLocale], t: i18n.formatDuration(season.left) }) } : null;
      this.refreshAlerts();
    }
    const credits = Math.floor(state.resources.credits?.amount ?? 0);
    if (credits !== this.credits) {
      this.credits = credits;
      this.setText(this.creditsValue, fmtNum(credits));
      this.setAttr(this.creditsBtn, 'aria-label', i18n.t('ux2b.creditsLabel', { n: fmtNum(credits) }));
      this.refreshAlerts();
    }

    const nowMs = performance.now();
    const dtRoll = Math.min(0.1, (nowMs - this.lastUpdate) / 1000);
    this.lastUpdate = nowMs;
    // [ux-redesign final F8] The tiles' spoken labels (amount, rate, time left) follow the numbers every 5 s, or 4 times a second while the
    // focus is in the HUD (a screen reader is on it): they were rewritten 7 times a second while nobody listened.
    const focusIn = !!document.activeElement && this.container.contains(document.activeElement);
    const ariaDue = nowMs - this.lastAria >= (focusIn ? 250 : 5000);
    if (ariaDue) this.lastAria = nowMs;

    this.counts.instant = reducedMotion(); // [ux-redesign W4]
    const tiles = this.pickTiles(state, act);
    const tileSig = tiles.join(',');
    const hidden: ResourceType[] = [];
    for (const [rt, els] of this.resourceEls) {
      const res = state.resources[rt];
      const visible = tiles.includes(rt);
      if (!visible && this.actShow.get(rt)) hidden.push(rt);
      this.setStyle(els.root, 'display', visible ? '' : 'none');
      if (visible) this.setStyle(els.root, 'order', String(tiles.indexOf(rt)));
      // Counters roll toward their value instead of jumping; [ux-redesign W4] a jump of more than 5 % counts up (fx/countUp.ts).
      const prev = this.shown.get(rt) ?? res.amount;
      const next = this.counts.step(rt, prev, res.amount, nowMs, dtRoll);
      this.shown.set(rt, next);
      if (!visible) continue;
      this.updateTile(rt, els, next, ariaDue);
    }
    if (tileSig !== this.lastSlots) {
      this.lastSlots = tileSig;
      this.hiddenRes = hidden;
      this.setStyle(this.moreBtn, 'display', hidden.length ? '' : 'none');
      this.setText(this.moreText, i18n.t('ux2b.more', { n: hidden.length }));
      const label = plural('wp6.hud.more', hidden.length);
      this.setAttr(this.moreBtn, 'aria-label', label);
      this.moreBtn.title = label;
    }
    if (this.popKind === 'more' && ariaDue) {
      const sig = this.hiddenRes.map(r => `${fmtNum(state.resources[r].amount)}`).join(',');
      if (sig !== this.popSig) { this.popSig = sig; this.fillPop(); }
    }

    this.updatePeople(state, ariaDue);

    const ratio = state.powerRatio ?? 1;
    // No alarm before there is any power plant to blame: the dead bunker is simply dark.
    const hasPlant = state.buildings.some(b => isPowerPlant(b.type) && !(b.isConstructing && b.level === 1));
    if (ratio < 0.99 && hasPlant && this.stripRes !== 'power') {
      this.setText(this.powerBanner, `${i18n.t('hud.powerLow', { pct: Math.round(ratio * 100) })} [[question]]`);
      this.setStyle(this.powerBanner, 'display', '');
    } else {
      this.setStyle(this.powerBanner, 'display', 'none');
    }

    this.updateClock(state);

    // [ux-wp4] B4/P14: the red badge counts only the idle people there is a job for (min of idle and free places).
    if (nowMs - this.jobsAt > 1000) {
      this.jobsAt = nowMs;
      const { idle, free } = jobRoom(state);
      const n = Math.min(idle, free);
      const text = n > 0 ? String(n) : '';
      if (text !== this.jobsText) {
        this.jobsText = text;
        this.peopleBadge.hidden = n === 0;
        this.setText(this.peopleBadge, text);
        this.peopleBadge.title = n > 0 ? plural('wp4.badgeJobs', n) : '';
      }
    }
  }

  /**
   * One tile: icon, amount, trend arrow + rate. A full store says FULL (its rate means nothing then); a store that runs dry within
   * five minutes shows the countdown; under 15 % or 3 minutes it is in danger (dashed edge, warning sign, amber-to-red pulse).
   */
  private updateTile(rt: ResourceType, els: ResourceEls, shownAmount: number, ariaDue: boolean): void {
    const res = this.lastState!.resources[rt];
    const net = res.productionRate - res.consumptionRate;
    const hasCap = res.cap > 0 && isFinite(res.cap);
    const pct = hasCap ? Math.min(100, (res.amount / res.cap) * 100) : 0;
    const empty = res.amount <= 0 && res.consumptionRate > 0;
    const tte = net < -STEADY && res.amount > 0 ? res.amount / -net : Infinity;
    const full = hasCap && pct >= 99.5 && net > -STEADY;
    const draining = net < -STEADY;
    const danger = empty || tte < DANGER_S || (draining && hasCap && pct < DANGER_PCT);
    const low = !danger && (tte < COUNTDOWN_S || (draining && hasCap && pct < LOW_PCT));
    const timer = !empty && tte < COUNTDOWN_S;
    // [phase1] The strip already counts this one down: the tile keeps its colour (danger / low) but not a second clock.
    const countdown = timer && this.stripRes !== rt;

    this.setText(els.value, fmtNum(shownAmount));
    let line: string;
    let mode: string;
    if (full) { line = i18n.t('ux2b.full'); mode = 'is-full'; }
    else if (countdown) { line = `[[hourglass]] ${fmtDuration(tte)}`; mode = 'is-countdown'; }
    else { line = i18n.formatRate(net); mode = net > STEADY ? 'is-up' : draining ? 'is-down' : 'is-flat'; }
    this.setText(els.rate, line);
    this.setText(els.trend, full || countdown ? '' : net > STEADY ? '▲' : draining ? '▼' : '');
    this.setState(els.chip, 'mode', mode);
    this.setState(els.chip, 'state', danger ? 'is-danger' : low ? 'is-low' : 'is-normal');
    this.setState(els.root, 'empty', empty ? 'empty' : '');
    this.setState(els.chip, 'ending', countdown && tte <= TIMER_ENDING_S ? 'is-ending' : '');
    const barPct = Math.round(pct);
    if (this.cache(els.bar).get('pct') !== String(barPct)) {
      this.cache(els.bar).set('pct', String(barPct));
      setProgress(els.bar, barPct, 100);
    }
    if (ariaDue) {
      // "Food: 124 of 150, +0.4 per second" (the real value, not the rolling counter); then FULL or the time it runs out.
      const name = i18n.t(`resources.${rt}`);
      let label = i18n.t(hasCap ? 'a11y.resLabel' : 'a11y.resLabelNoCap', { name, amount: fmtNum(res.amount), cap: hasCap ? fmtNum(res.cap) : '', rate: i18n.formatRate(net) });
      if (full) label += `. ${i18n.t('ux2b.fullLabel')}`;
      else if (timer) label += `. ${i18n.t('ux2b.runsOut', { t: fmtDuration(tte) })}`;
      this.setAttr(els.root, 'aria-label', label);
    }
  }

  /**
   * At most four tiles. Acts I-II: the four basics. From Act III what holds progress back (phoneSlots). A resource that runs short
   * swaps itself in for the calmest tile.
   */
  private pickTiles(state: GameState, act: number): ResourceType[] {
    const slots = this.phoneSlots(state, act);
    const base = [...(slots ?? CORE_RESOURCES)].filter(r => this.actShow.get(r) !== false).slice(0, MAX_TILES);
    const urgent = (r: ResourceType): boolean => {
      const res = state.resources[r];
      const net = res.productionRate - res.consumptionRate;
      if (res.amount <= 0 && res.consumptionRate > 0) return true;
      if (net < -STEADY && res.amount / -net < COUNTDOWN_S) return true;
      return res.cap > 0 && isFinite(res.cap) && res.amount / res.cap < DANGER_PCT / 100 && net < -STEADY;
    };
    for (const r of VISIBLE_RESOURCES) {
      if (this.actShow.get(r) === false || base.includes(r) || !urgent(r)) continue;
      const calm = [...base].reverse().find(b => !urgent(b));
      if (!calm) break;
      base[base.indexOf(calm)] = r;
    }
    return base;
  }

  /**
   * [ux-wp4] M2: which resources the row shows (four places). Early on (Acts I-II) the four basics. From Act III the row shows what holds
   * progress back: the Act's currency (and the last Act's), then the basics that are not full (a full store says nothing), the emptiest first.
   */
  private phoneSlots(state: GameState, act: number): Set<ResourceType> | null {
    if (act < 3) return null;
    const fill = (r: ResourceType): number => {
      const res = state.resources[r];
      return res && res.cap > 0 && isFinite(res.cap) ? res.amount / res.cap : 0;
    };
    const currency = [...this.actShow.entries()].filter(([rt, s]) => s && (resourceDef(rt)?.act ?? 0) > 0).map(([rt]) => rt)
      .sort((a, b) => (resourceDef(b)?.act ?? 0) - (resourceDef(a)?.act ?? 0));
    const basics = [...CORE_RESOURCES].sort((a, b) => fill(a) - fill(b));
    const out = new Set<ResourceType>(currency.slice(0, 2));
    for (const r of basics) {
      if (out.size >= MAX_TILES) break;
      const res = state.resources[r];
      const draining = res.productionRate - res.consumptionRate < -STEADY;
      if (fill(r) < 0.9 || draining) out.add(r);
    }
    for (const r of basics) if (out.size < MAX_TILES) out.add(r);
    return out;
  }

  /** Population (with the door's state as a caption) and morale. */
  private updatePeople(state: GameState, ariaDue: boolean): void {
    const built = bedsBuilt(state);
    const capped = built > state.maxPopulation;
    this.setText(this.popValue, `${state.survivors.length}/${state.maxPopulation}`);
    const full = state.survivors.length >= state.maxPopulation && state.maxPopulation > 0;
    const lock = full ? actLock(state) : null;
    const left = Math.max(0, Math.ceil((state.nextArrivalAt ?? 0) - state.stats.totalPlayTime));
    // [ux-wp4] R3: the Act holds the number: a neutral lock that names the next Act. No free bed: a warning in words. Else: the next arrival.
    const caption = lock ? `[[lock]] ${i18n.t('ux2b.popLock')}`
      : full ? `[[warning]] ${i18n.t('ux2b.popFull')}`
        : i18n.t('ux2b.survivors'); // [ux-redesign w2fix #7] the next arrival's countdown is in the spoken label only (one number less)
    this.setText(this.popCaption, caption);
    this.setState(this.popBtn, 'door', lock ? 'is-lock' : full ? 'is-full' : capped ? 'is-capped' : '');
    if (ariaDue) {
      const popTitle = lock ? plural('wp4.actLock', lock.more, { act: lock.next.name[i18n.currentLocale] })
        : full ? `${i18n.t('wp6.hud.population', { n: state.survivors.length, max: state.maxPopulation })}. ${i18n.t('wp6.hud.arrivalFull')}`
          : capped ? i18n.t('building.bedsCapped', { built, cap: state.maxPopulation })
            : `${i18n.t('wp6.hud.population', { n: state.survivors.length, max: state.maxPopulation })}. ${i18n.t('wp6.hud.arrival', { t: i18n.formatDuration(left) })}`;
      this.setAttr(this.popBtn, 'aria-label', popTitle);
      this.setAttr(this.popBtn, 'title', popTitle);
    }
    const morale = state.survivors.length > 0
      ? Math.round(state.survivors.reduce((s, sv) => s + sv.happiness, 0) / state.survivors.length)
      : 50;
    this.setText(this.moraleValue, `${morale}%`);
    // [plan4:AC-7] The mood is a face as well as a colour: happy / neutral / sad.
    this.setText(this.moraleIcon, morale < 35 ? '[[sad]]' : morale > 70 ? '[[happy]]' : '[[neutral]]');
    this.setState(this.moraleBtn, 'mood', morale < 35 ? 'is-down' : morale > 70 ? 'is-up' : '');
    if (ariaDue) this.setAttr(this.moraleBtn, 'aria-label', `${i18n.t('wp6.hud.morale', { pct: morale })}`);
  }

  private moraleRules: PopulationSystem | null = null;

  /** The biggest single thing moving morale (the average over everyone of the same factors the "why" dialog lists). Read only. */
  private moraleTopCause(): string {
    const state = this.lastState;
    if (!state || state.survivors.length === 0) return i18n.t('wp4.moraleCalm');
    const ps = this.moraleRules ?? (this.moraleRules = new PopulationSystem());
    const sums = new Map<string, number>();
    for (const s of state.survivors) {
      for (const f of ps.getMoraleFactors(state, s)) if (f.key !== 'base') sums.set(f.key, (sums.get(f.key) ?? 0) + f.value);
    }
    let best: [string, number] | null = null;
    for (const [k, v] of sums) {
      const avg = v / state.survivors.length;
      if (Math.abs(avg) >= 0.5 && (!best || Math.abs(avg) > Math.abs(best[1]))) best = [k, avg];
    }
    if (!best) return i18n.t('wp4.moraleCalm');
    const v = Math.round(best[1]);
    return `${i18n.t('ux2b.moraleTop', { cause: i18n.t(`morale.${best[0]}`), v: `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}` })} ${i18n.t('ux2b.moraleMore')}`;
  }

  destroy(): void {
    this.closePop();
    this.closeGoals(); // [ux-redesign W3a]
    this.resizeObs?.disconnect();
    this.offResize?.();
    if (this.measureRaf) cancelAnimationFrame(this.measureRaf);
    this.unsubA11y?.();
    this.nav.remove();
    this.container.remove();
  }
}

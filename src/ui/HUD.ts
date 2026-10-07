import { seasonAt, seasonsActive } from '../data/seasons';
import { resourceDef } from '../data/resources';
import type { GameState, ResourceType } from '../core/GameState';
import { haptic } from '../utils/haptics';
import { timeOfDay } from '../data/dayCycle';
import { isPowerPlant } from '../data/buildingDefs';
import { i18n } from '../i18n/I18nManager';
import { RESOURCE_ICONS, el, setRich } from './dom';
import { bedsBuilt } from '../systems/BuildingSystem';
import { subscribeA11y, getA11y, reducedMotion } from '../utils/a11y';
import { setHudInsets } from '../utils/hudInsets';
import { initViewportUi } from './viewportUi';

/** [Long game] Components and alloys join the row from their Act on (the row then has four columns). */
const VISIBLE_RESOURCES: ResourceType[] = ['food', 'water', 'power', 'materials', 'medicine', 'knowledge', 'scrap', 'components', 'alloys', 'data', 'influence', 'seedCores'];

/**
 * Plan 2026-10 Q12 (HUD diet): on a phone the top bar shows only these four, in one row. Every other resource of the Act
 * joins the row only while it needs attention (empty, or low and draining); the "show all" pill under the row expands the
 * rest (remembered), and a tap on any resource still opens its drawer.
 */
const CORE_RESOURCES = new Set<ResourceType>(['food', 'water', 'power', 'materials']);
const MORE_KEY = 'lastbunker_hud_more';

export type NavKey = 'build' | 'surface' | 'research' | 'people';
/** Buttons a "new system" card can make glow (see src/ui/controllers/systems.ts). */
export type SpotKey = NavKey | 'inbox' | 'season' | 'era';

export { timeOfDay };

interface ResourceEls {
  root: HTMLElement;
  value: HTMLElement;
  rate: HTMLElement;
  fill: HTMLElement;
}

export class HUD {
  private container: HTMLDivElement;
  private resourceEls = new Map<ResourceType, ResourceEls>();
  private popValue!: HTMLElement;
  private arrivalValue!: HTMLElement;
  onPopulation?: () => void;
  private moraleValue!: HTMLElement;
  private moraleIcon!: HTMLElement;
  private powerBanner!: HTMLElement;
  private placementBanner!: HTMLElement;
  private placementText!: HTMLElement;
  private peopleBadge!: HTMLElement;
  private lastText = new WeakMap<HTMLElement, string>();
  private shown = new Map<ResourceType, number>();
  /** Plan 2026-10 Q12: which resources the current Act opens, the "show all" pill and its state. */
  private actShow = new Map<ResourceType, boolean>();
  private topBar!: HTMLElement;
  private moreBtn!: HTMLButtonElement;
  private expanded = false;
  private narrow = window.matchMedia('(max-width: 520px)');
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
    for (const b of this.nav.querySelectorAll<HTMLElement>('.nav-btn')) {
      const k = b.classList.contains('nav-menu') ? 'menu' : b.dataset.key;
      if (k === key) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
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
  private nav!: HTMLElement;

  /**
   * [plan4:UX-5] Measures the real HUD bands (they change with the text size, the banners and the safe areas) and publishes them
   * (utils/hudInsets.ts: `window.__hudInsets`, --hud-top-h, --nav-h). From a text size of 1.25 the resource row becomes 2x2: that is
   * a class on the bar, because a stylesheet cannot compare a custom property's number in a media query.
   */
  private watchLayout(): void {
    const sync = (): void => {
      this.topBar.classList.toggle('fs-big', getA11y().textScale >= 1.25);
    };
    sync();
    this.unsubA11y = subscribeA11y(sync);
    const measure = (): void => {
      const vh = window.innerHeight;
      // The compact landscape layout (touch.css) turns the status row and the nav into full-height side columns: they take
      // nothing from the top or bottom band then (the camera's side bands are a later concern), so the heights are 0.
      const isColumn = (r: DOMRect): boolean => r.height > vh * 0.8;
      const topRect = this.topBar.getBoundingClientRect();
      let top = isColumn(topRect) ? 0 : topRect.bottom;
      for (const b of [this.powerBanner, this.incidentBanner, this.placementBanner]) {
        if (b.style.display !== 'none') top = Math.max(top, b.getBoundingClientRect().bottom);
      }
      const navRect = this.nav.getBoundingClientRect();
      const bottom = isColumn(navRect) ? 0 : vh - navRect.top;
      const objRect = this.objectiveEl.getBoundingClientRect();
      // The strip sits just above the nav console (or at the bottom edge in landscape): what it adds is the gap from its top to the band.
      const objective = this.objectiveEl.style.display === 'none' ? 0 : Math.max(0, vh - bottom - objRect.top);
      setHudInsets({ top, bottom, objective });
    };
    if (typeof ResizeObserver === 'undefined') { measure(); return; }
    this.resizeObs = new ResizeObserver(measure);
    for (const n of [this.topBar, this.nav, this.objectiveEl, this.powerBanner, this.incidentBanner, this.placementBanner]) this.resizeObs.observe(n);
    window.addEventListener('resize', measure);
    measure();
  }

  private createTopBar(): void {
    const topBar = el('div', 'hud-top');
    const resourceRow = el('div', 'resource-row');

    for (const rt of VISIBLE_RESOURCES) {
      const root = el('button', 'resource-item');
      root.title = i18n.t(`resources.${rt}`);
      const value = el('span', 'resource-value', '0');
      const rate = el('span', 'resource-rate');
      rate.dir = 'ltr';
      const track = el('div', 'resource-fill-track');
      const fill = el('div', 'resource-fill-bar');
      track.appendChild(fill);
      root.append(el('span', 'resource-icon', RESOURCE_ICONS[rt] ?? ''), value, rate, track);
      root.addEventListener('click', () => this.onResourceTap?.(rt));
      resourceRow.appendChild(root);
      this.resourceEls.set(rt, { root, value, rate, fill });
    }
    topBar.appendChild(resourceRow);
    this.topBar = topBar;
    try {
      this.expanded = localStorage.getItem(MORE_KEY) === '1';
    } catch {
      this.expanded = false;
    }
    this.moreBtn = el('button', 'res-more');
    this.moreBtn.addEventListener('click', () => {
      this.expanded = !this.expanded;
      try {
        localStorage.setItem(MORE_KEY, this.expanded ? '1' : '0');
      } catch {
        // the choice just won't be remembered
      }
      haptic('tap');
      this.lastMore = '';
      if (this.lastState) this.update(this.lastState);
    });
    topBar.appendChild(this.moreBtn);

    const infoRow = el('div', 'info-row');
    const pop = el('div', 'info-item info-tap');
    this.popValue = el('span', 'info-value', '0/0');
    this.arrivalValue = el('span', 'info-arrival');
    this.arrivalValue.dir = 'ltr';
    pop.append(el('span', 'info-icon', '[[people]]'), el('span', 'info-label', i18n.t('hud.population')), this.popValue, this.arrivalValue);
    pop.addEventListener('click', () => this.onPopulation?.());

    const morale = el('div', 'info-item');
    this.moraleValue = el('span', 'info-value', '50%');
    this.moraleIcon = el('span', 'info-icon', '[[happy]]');
    morale.append(this.moraleIcon, el('span', 'info-label', i18n.t('hud.morale')), this.moraleValue);

    const journal = el('button', 'lang-btn journal-btn', '[[journal]]');
    journal.setAttribute('aria-label', i18n.t('journal.title'));
    this.journalBadge = el('span', 'nav-badge');
    this.journalBadge.style.display = 'none';
    journal.appendChild(this.journalBadge);
    journal.addEventListener('click', () => this.onJournal?.());
    this.eraChip = el('button', 'era-chip');
    this.eraChip.addEventListener('click', () => this.onEra?.());

    const clock = el('div', 'info-item info-clock');
    this.clockValue = el('span', 'info-value', '06:00');
    this.clockValue.dir = 'ltr';
    this.clockIcon = el('span', 'info-icon', '[[sun]]');
    clock.append(this.clockIcon, this.clockValue);
    // [P2] The season: its icon and the days left; a tap tells the forecast.
    this.seasonBtn = el('button', 'lang-btn season-btn', '[[clover]]');
    this.seasonBtn.style.display = 'none';
    this.seasonBtn.setAttribute('aria-label', i18n.t('season.title'));
    this.seasonBtn.addEventListener('click', () => this.onSeason?.());

    // The daily supply drop (NICE3): a crate button that only shows while today's crate is unopened.
    this.supplyBtn = el('button', 'lang-btn supply-btn', '[[gift]]');
    this.supplyBtn.style.display = 'none';
    this.supplyBtn.setAttribute('aria-label', i18n.t('a11y.supply'));
    this.supplyBtn.addEventListener('click', () => this.onSupply?.());

    // gfx-p0: the menu moved to the bottom nav (createBottomNav) so this row fits a 360 px phone.
    // [Long game] The Decision Inbox: shown from the second era on, with how many cards wait.
    this.inboxBtn = el('button', 'lang-btn inbox-btn', '[[inbox]]');
    this.inboxBtn.style.display = 'none';
    this.inboxBtn.setAttribute('aria-label', i18n.t('inbox.title'));
    this.inboxBadge = el('span', 'nav-badge');
    this.inboxBadge.style.display = 'none';
    this.inboxBtn.appendChild(this.inboxBadge);
    this.inboxBtn.addEventListener('click', () => this.onInbox?.());

    infoRow.append(this.eraChip, pop, morale, clock, this.seasonBtn, this.supplyBtn, this.inboxBtn, journal);
    topBar.appendChild(infoRow);
    this.container.appendChild(topBar);
  }

  /** [Q7] Makes a HUD button glow for a few seconds, so the player sees where the new thing lives. */
  spotlight(key: SpotKey): void {
    const target = key === 'inbox' ? this.inboxBtn : key === 'season' ? this.seasonBtn : key === 'era' ? this.eraChip
      : this.container.querySelector<HTMLElement>(`.nav-btn[data-key="${key}"]`);
    if (!target) return;
    target.classList.remove('spotlight');
    void target.offsetWidth;
    target.classList.add('spotlight');
    window.setTimeout(() => target.classList.remove('spotlight'), 9000);
  }

  private journalBadge!: HTMLElement;
  private supplyBtn!: HTMLButtonElement;
  onSupply: (() => void) | null = null;

  setSupply(ready: boolean, title: string): void {
    this.supplyBtn.style.display = ready ? '' : 'none';
    this.supplyBtn.title = title;
  }

  private eraChip!: HTMLButtonElement;
  onJournal: (() => void) | null = null;
  onInbox: (() => void) | null = null;
  onSeason: (() => void) | null = null;
  private seasonBtn!: HTMLButtonElement;
  private seasonSig = '';
  private inboxBtn!: HTMLButtonElement;
  private inboxBadge!: HTMLElement;

  /** The inbox button: hidden until the inbox is in use; the badge shows the waiting cards. */
  setInbox(visible: boolean, count: number): void {
    this.inboxBtn.style.display = visible ? '' : 'none';
    this.inboxBadge.style.display = count > 0 ? '' : 'none';
    this.setText(this.inboxBadge, String(count));
    this.inboxBtn.classList.toggle('has-cards', count > 0);
  }
  onEra: (() => void) | null = null;

  setJournalUnread(n: number): void {
    this.journalBadge.style.display = n > 0 ? '' : 'none';
    this.setText(this.journalBadge, String(n));
  }

  /**
   * The chip shows where the run stands. [Q2] In a long game that is the Act and how far through it (the tag stays on narrow
   * screens), the era's name is the quieter second half; the whole thing opens the Command panel.
   */
  setEra(key: string, name: string, actTag = '', title = name): void {
    const sig = `${key}|${name}|${actTag}|${title}`;
    if (this.eraChip.dataset.sig !== sig) {
      this.eraChip.dataset.sig = sig;
      setRich(this.eraChip, '[[flag]]');
      if (actTag) this.eraChip.appendChild(el('span', 'act-tag', actTag));
      this.eraChip.appendChild(el('span', 'era-name', name));
      this.eraChip.title = title;
      this.eraChip.setAttribute('aria-label', title);
    }
    this.eraChip.dataset.era = key;
  }

  private clockValue!: HTMLElement;
  private clockIcon!: HTMLElement;
  private nightOverlay = el('div', 'night-overlay');

  private updateClock(state: GameState): void {
    const { hour, minute, night } = timeOfDay(state.stats.totalPlayTime);
    this.setText(this.clockValue, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    this.setText(this.clockIcon, night > 0.5 ? '[[moon]]' : '[[sun]]');
    this.nightOverlay.style.opacity = night.toFixed(3);
  }

  private objectiveEl!: HTMLButtonElement;
  private objectiveText!: HTMLElement;
  private objectiveMeta!: HTMLElement;
  onObjectiveTap: (() => void) | null = null;

  setObjective(icon: string, text: string, progress: [number, number], reward: string): void {
    this.setText(this.objectiveText, `${icon} ${text}`);
    const [cur, target] = progress;
    this.setText(this.objectiveMeta, `${target > 1 ? `${cur}/${target}` : ''}${reward ? `${target > 1 ? ' · ' : ''}[[gift]] ${reward}` : ''}`);
    this.objectiveEl.style.setProperty('--obj-progress', `${Math.round((cur / Math.max(1, target)) * 100)}%`);
  }

  private createBanners(): void {
    this.objectiveEl = el('button', 'objective');
    this.objectiveText = el('span', 'objective-text');
    this.objectiveMeta = el('span', 'objective-meta');
    this.objectiveMeta.dir = 'auto';
    this.objectiveEl.append(el('span', 'objective-tag', '[[target]]'), this.objectiveText, this.objectiveMeta);
    this.objectiveEl.addEventListener('click', () => this.onObjectiveTap?.());
    this.container.appendChild(this.objectiveEl);

    this.powerBanner = el('div', 'hud-banner power');
    this.powerBanner.style.display = 'none';
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

  private createBottomNav(): void {
    const nav = el('div', 'hud-bottom');
    this.nav = nav;
    // [plan4:AC-8] The console is a toolbar; the open panel's button says aria-current (setNavCurrent).
    nav.setAttribute('role', 'toolbar');
    nav.setAttribute('aria-label', i18n.t('a11y.nav'));
    const buttons: { key: NavKey; icon: string }[] = [
      { key: 'build', icon: '[[build]]' },
      { key: 'people', icon: '[[people]]' },
      { key: 'research', icon: '[[research]]' },
      { key: 'surface', icon: '[[surface]]' },
    ];

    for (const btn of buttons) {
      const b = el('button', 'nav-btn');
      b.dataset.key = btn.key;
      const icon = el('span', 'nav-icon', btn.icon);
      const badge = el('span', 'nav-badge');
      badge.style.display = 'none';
      icon.appendChild(badge);
      this.badges.set(btn.key, badge);
      if (btn.key === 'people') this.peopleBadge = badge;
      b.append(icon, el('span', 'nav-label', i18n.t(`hud.${btn.key}`)));
      b.addEventListener('click', () => {
        haptic('select');
        this.onNav?.(btn.key);
      });
      nav.appendChild(b);
    }
    // A narrow bolt-on button at the end of the console opens the menu (settings, stats, rebirth).
    const menu = el('button', 'nav-btn nav-menu');
    menu.setAttribute('aria-label', i18n.t('menu.title'));
    menu.title = i18n.t('menu.title');
    menu.append(el('span', 'nav-icon', '[[menu]]'));
    menu.addEventListener('click', () => {
      haptic('select');
      this.onMenu?.();
    });
    nav.appendChild(menu);
    // [plan4:UX-8] The console lives on <body>, not inside #hud: #hud is its own stacking context (z 10), under the sheets (z 20),
    // and the nav has to stay visible and tappable above an open sheet so a tab swaps the panel without closing it first.
    document.body.appendChild(nav);
  }

  private incidentBanner!: HTMLButtonElement;
  onIncident: (() => void) | null = null;

  /** Flashing alarm strip while a crisis burns somewhere in the bunker. */
  setIncident(text: string | null, kind = ''): void {
    this.incidentBanner.style.display = text ? '' : 'none';
    if (!text) return;
    this.incidentBanner.dataset.kind = kind;
    this.setText(this.incidentBanner, text);
  }

  resourceRect(r: ResourceType): DOMRect | null {
    return this.resourceEls.get(r)?.root.getBoundingClientRect() ?? null;
  }

  pulseResource(r: ResourceType): void {
    const root = this.resourceEls.get(r)?.root;
    if (!root) return;
    root.classList.remove('pulse');
    void root.offsetWidth;
    root.classList.add('pulse');
  }

  setBadge(key: NavKey, text: string | null): void {
    const badge = this.badges.get(key);
    if (!badge) return;
    badge.style.display = text ? '' : 'none';
    if (text) this.setText(badge, text);
  }

  showPlacement(name: string): void {
    this.placementText.textContent = i18n.t('placement.hint', { name });
    this.placementBanner.style.display = '';
  }

  hidePlacement(): void {
    this.placementBanner.style.display = 'none';
  }

  private setText(node: HTMLElement, text: string): void {
    if (this.lastText.get(node) === text) return;
    this.lastText.set(node, text);
    setRich(node, text);
  }

  private shownAct = -1;
  private lastState: GameState | null = null;
  private lastMore = '';

  update(state: GameState): void {
    this.lastState = state;
    const act = state.longGame?.meta.act ?? 1;
    if (act !== this.shownAct) {
      this.shownAct = act;
      let tier2 = false;
      for (const [rt, els] of this.resourceEls) {
        const opens = resourceDef(rt)?.act ?? 0;
        // Tier-2 goods: the current Act's and the one before (older ones still show in costs and in the drawer).
        const show = opens === 0 || (act >= opens && opens >= act - 1);
        this.actShow.set(rt, show);
        if (opens > 0 && show) tier2 = true;
      }
      this.resourceEls.values().next().value?.root.parentElement?.classList.toggle('tier2', tier2);
    }
    // [P2] Season chip (from the second Act).
    const season = seasonsActive(state) ? seasonAt(state) : null;
    const sSig = season ? `${season.def.id}|${Math.ceil(season.left / 86400)}` : '';
    if (sSig !== this.seasonSig) {
      this.seasonSig = sSig;
      this.seasonBtn.style.display = season ? '' : 'none';
      if (season) {
        setRich(this.seasonBtn, `[[${season.def.icon}]]`);
        this.seasonBtn.title = `${season.def.name[i18n.currentLocale]} · ${i18n.formatDuration(season.left)}`;
      }
    }
    const nowMs = performance.now();
    const dtRoll = Math.min(0.1, (nowMs - this.lastUpdate) / 1000);
    this.lastUpdate = nowMs;
    const ariaDue = nowMs - this.lastAria >= 250;
    if (ariaDue) this.lastAria = nowMs;
    // Plan 2026-10 Q12: on a phone only the key four show, plus whatever needs attention; the pill expands the rest.
    const collapsible = this.narrow.matches;
    const compact = collapsible && !this.expanded;
    let hiddenCount = 0;
    for (const [rt, els] of this.resourceEls) {
      const res = state.resources[rt];
      // Counters roll toward their value instead of jumping.
      const prev = this.shown.get(rt) ?? res.amount;
      const diff = res.amount - prev;
      const next = Math.abs(diff) < 0.5 ? res.amount : prev + diff * Math.min(1, dtRoll * 9);
      this.shown.set(rt, next);
      this.setText(els.value, i18n.formatCompact(next));
      const net = res.productionRate - res.consumptionRate;
      this.setText(els.rate, i18n.formatRate(net));
      els.rate.className = `resource-rate ${net > 0.005 ? 'positive' : net < -0.005 ? 'negative' : ''}`;
      const pct = res.cap > 0 && isFinite(res.cap) ? Math.min(100, (res.amount / res.cap) * 100) : 0;
      els.fill.style.width = `${pct}%`;
      els.fill.className = `resource-fill-bar ${pct >= 99 ? 'full' : pct < 15 ? 'low' : ''}`;
      els.root.classList.toggle('empty', res.amount <= 0 && res.consumptionRate > 0);
      if (ariaDue) {
        // "Food: 124 of 150, +0.4 per second": the real value (not the rolling counter) and the net rate, in words.
        const hasCap = res.cap > 0 && isFinite(res.cap);
        const label = i18n.t(hasCap ? 'a11y.resLabel' : 'a11y.resLabelNoCap', { name: i18n.t(`resources.${rt}`), amount: i18n.formatCompact(res.amount), cap: hasCap ? i18n.formatCompact(res.cap) : '', rate: i18n.formatRate(net) });
        if (els.root.getAttribute('aria-label') !== label) els.root.setAttribute('aria-label', label);
      }
      const inAct = this.actShow.get(rt) !== false;
      const attention = (res.amount <= 0 && res.consumptionRate > 0) || (pct < 15 && net < -0.005 && res.cap > 0);
      const visible = inAct && (!compact || CORE_RESOURCES.has(rt) || attention);
      if (inAct && !visible) hiddenCount++;
      const want = visible ? '' : 'none';
      if (els.root.style.display !== want) els.root.style.display = want;
    }
    this.topBar.classList.toggle('res-collapsible', collapsible);
    const more = collapsible ? `${this.expanded ? 'less' : 'more'}|${hiddenCount}` : '';
    if (more !== this.lastMore) {
      this.lastMore = more;
      const total = [...this.actShow.entries()].filter(([rt, s]) => s && !CORE_RESOURCES.has(rt)).length;
      this.moreBtn.style.display = collapsible && total > 0 ? '' : 'none';
      this.moreBtn.textContent = this.expanded ? '▴' : `▾ ${total}`;
      this.moreBtn.setAttribute('aria-label', i18n.t(this.expanded ? 'hud.lessRes' : 'hud.moreRes'));
      this.moreBtn.title = i18n.t(this.expanded ? 'hud.lessRes' : 'hud.moreRes');
    }

    // A lock when the Act's limit holds back beds the rooms already give.
    const built = bedsBuilt(state);
    const capped = built > state.maxPopulation;
    this.setText(this.popValue, `${state.survivors.length}/${state.maxPopulation}${capped ? ' [[lock]]' : ''}`);
    this.popValue.parentElement!.title = capped ? i18n.t('building.bedsCapped', { built, cap: state.maxPopulation }) : '';
    // The door: a countdown to the next newcomer, or a warning that there are no free beds.
    const full = state.survivors.length >= state.maxPopulation && state.maxPopulation > 0;
    const left = Math.max(0, Math.ceil((state.nextArrivalAt ?? 0) - state.stats.totalPlayTime));
    const arrival = full ? '[[door]] !' : state.survivors.length > 0 && !state.activeEvent
      ? `[[door]] ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
    this.setText(this.arrivalValue, arrival);
    this.arrivalValue.classList.toggle('negative', full);
    const morale = state.survivors.length > 0
      ? Math.round(state.survivors.reduce((s, sv) => s + sv.happiness, 0) / state.survivors.length)
      : 50;
    this.setText(this.moraleValue, `${morale}%`);
    // [plan4:AC-7] The mood is a face as well as a colour: happy / neutral / sad.
    this.setText(this.moraleIcon, morale < 35 ? '[[sad]]' : morale > 70 ? '[[happy]]' : '[[neutral]]');
    this.moraleValue.className = `info-value ${morale < 35 ? 'negative' : morale > 70 ? 'positive' : ''}`;

    const ratio = state.powerRatio ?? 1;
    // No alarm before there is any power plant to blame: the dead bunker is simply dark.
    const hasPlant = state.buildings.some(b => isPowerPlant(b.type) && !(b.isConstructing && b.level === 1));
    if (ratio < 0.99 && hasPlant) {
      this.setText(this.powerBanner, i18n.t('hud.powerLow', { pct: Math.round(ratio * 100) }));
      this.powerBanner.style.display = '';
    } else {
      this.powerBanner.style.display = 'none';
    }

    this.updateClock(state);

    const idle = state.survivors.filter(s => !s.assignedBuildingId && !s.isOnMission).length;
    this.peopleBadge.style.display = idle > 0 ? '' : 'none';
    this.setText(this.peopleBadge, String(idle));
  }

  destroy(): void {
    this.resizeObs?.disconnect();
    this.unsubA11y?.();
    this.nav.remove();
    this.container.remove();
  }
}

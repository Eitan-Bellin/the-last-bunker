import type { BuildingInstance, GameState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { getDef, effectiveLevel, workforceMultiplier } from '../../data/buildingDefs';
import { childCapacityOf } from '../../data/roomEffects';
import { DISASTERS, INCIDENTS } from '../../data/incidents';
import { roomStatus } from '../../rendering/roomStatus';
import { hudTop } from '../../rendering/CameraController';
import { bunkerDefense } from '../../systems/EventSystem';
import { uiSound } from '../../audio/uiSound';
import { RESOURCE_ICONS, costRow, el, setRich } from '../dom';
import { fmtNum, plural } from '../format';
import { kButton, kProgress, setProgress } from '../kit';
import { BuildingPanel, type PanelHost } from './BuildingPanel';
import { Sheet } from './Sheet';
import '../../styles/room-screen.css';

/**
 * [clean:1] The room screen (store/playthrough/clean1/BRIEF.md; reference: tools/viewproto.html focus mode). A tap on a room opens it
 * instead of the old bottom sheet:
 *   - the top of the screen is the live room in the world: the camera frames it between the HUD's status row and the panel, and glides
 *     back to where it was on close (the people in the room keep moving);
 *   - the panel: the room's name, one status line, three facts (level, workers, what it makes or does), ONE main action chosen by the
 *     room's state (see mainAction), and everything else the old sheet had folded under "More" (BuildingPanel, hosted here unchanged);
 *   - a swipe across the picture, the two arrows or the arrow keys move to the room beside it on the same floor;
 *   - the close plate, Escape and the phone's back button (the app's backAction: it is a panel) close it.
 * Not a Sheet: it never counts as an interruption (it is only ever opened by the player), it closes any open sheet when it opens, and
 * any sheet that opens closes it. The tutorial spotlight sits above it (--z-tutorial).
 */

/** What the screen needs from the renderer (BunkerRenderer). */
export interface RoomScreenView {
  readonly camera: {
    readonly view: { x: number; y: number; z: number };
    frameRoom(r: Rect, topPx: number, bottomPx: number): void;
    releaseRoom(back: { x: number; y: number; z: number } | null): void;
  };
  roomRect(id: string): Rect | null;
  setSelected(id: string | null): void;
  /** [clean:1] Stairwells and vent stacks stand in front of the rooms: put away while one room is in focus. */
  setRoomFocus(on: boolean): void;
}
type Rect = { x: number; y: number; w: number; h: number };

/** The one main action of a room, by its state (first match wins). */
export type MainAction =
  | { kind: 'incident'; id: string }
  | { kind: 'disaster'; id: string }
  | { kind: 'repair' }
  | { kind: 'build'; rush: boolean }
  | { kind: 'fill'; n: number }
  | { kind: 'upgrade'; affordable: boolean }
  | { kind: 'none' };

/** Px of a horizontal swipe across the picture that moves to the next room (and how much more sideways than up/down it must be). */
const SWIPE_PX = 40;
const SWIPE_SLOPE = 1.3;
/** Px between the HUD's status row and the top of the framed room. */
const FRAME_GAP = 8;

export class RoomScreen implements PanelHost {
  readonly panel: BuildingPanel;
  /** The "More" fold the old room panel renders into. */
  readonly body: HTMLElement;
  readonly showsStatus = true;
  /** A crisis in a room handled by the danger dialog of that disaster (set by the app). */
  onDisaster: ((disasterId: string) => void) | null = null;

  private readonly engine: GameEngine;
  private readonly view: RoomScreenView;
  private readonly root: HTMLDivElement;
  private readonly win: HTMLDivElement;
  private readonly sheetEl: HTMLDivElement;
  private readonly nameEl: HTMLHeadingElement;
  private readonly dotEl: HTMLSpanElement;
  private readonly statusEl: HTMLSpanElement;
  private readonly facts: { value: HTMLElement; label: HTMLElement }[] = [];
  private readonly mainEl: HTMLDivElement;
  private readonly moreBtn: HTMLButtonElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private shown = false;
  private moreOpen = false;
  private roomId: string | null = null;
  private mainSig = '';
  private progress: HTMLElement | null = null;
  /** The camera before the screen opened (it glides back there on close). */
  private back: { x: number; y: number; z: number } | null = null;
  private opener: HTMLElement | null = null;
  /** Neighbours on the same floor, by world x: the room to the left and to the right of this one. */
  private left: string | null = null;
  private right: string | null = null;
  /** Escape: was a sheet or a dialog open when the key went down (then that one closes, not this screen)? */
  private escTaken = false;

  constructor(engine: GameEngine, view: RoomScreenView) {
    this.engine = engine;
    this.view = view;

    this.root = el('div', 'room-screen');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'false');
    this.root.hidden = true;

    // The window onto the world: transparent, it takes the swipes (the canvas behind does not get them while the screen is open).
    this.win = el('div', 'rs-window');
    this.win.title = i18n.t('cf1.swipe');
    const close = kButton({ variant: 'close', className: 'btn-ghost rs-close', icon: 'close', ariaLabel: i18n.t('journal.close'), onPress: () => this.close(), sound: 'click' });
    this.prevBtn = kButton({ variant: 'icon', className: 'btn-ghost rs-arrow rs-arrow--left', icon: 'arrowLeft', ariaLabel: '', onPress: () => this.go(this.left) });
    this.nextBtn = kButton({ variant: 'icon', className: 'btn-ghost rs-arrow rs-arrow--right', icon: 'arrowRight', ariaLabel: '', onPress: () => this.go(this.right) });
    this.win.append(close, this.prevBtn, this.nextBtn);
    this.bindSwipe(this.win);

    // The panel.
    this.sheetEl = el('div', 'rs-panel');
    const head = el('div', 'rs-head');
    this.nameEl = el('h2', 'rs-name');
    this.nameEl.id = 'rs-name';
    this.nameEl.tabIndex = -1;
    this.root.setAttribute('aria-labelledby', this.nameEl.id);
    const status = el('div', 'rs-status');
    this.dotEl = el('span', 'rs-dot');
    this.dotEl.setAttribute('aria-hidden', 'true');
    this.statusEl = el('span', 'rs-status-text');
    status.append(this.dotEl, this.statusEl);
    status.setAttribute('aria-live', 'polite');
    head.append(this.nameEl, status);

    const facts = el('div', 'rs-facts');
    for (let i = 0; i < 3; i++) {
      const f = el('div', 'rs-fact');
      const value = el('b', 'rs-fact-value');
      const label = el('span', 'rs-fact-label');
      f.append(value, label);
      facts.appendChild(f);
      this.facts.push({ value, label });
    }

    this.moreBtn = kButton({
      variant: 'tertiary', className: 'btn-ghost rs-more-toggle', label: i18n.t('cf1.more'), sound: 'click',
      onPress: () => this.setMore(!this.moreOpen),
    });
    this.moreBtn.setAttribute('aria-controls', 'rs-more');
    this.body = el('div', 'rs-more');
    this.body.id = 'rs-more';
    this.mainEl = el('div', 'rs-main');
    this.sheetEl.append(head, facts, this.moreBtn, this.body, this.mainEl);
    this.root.append(this.win, this.sheetEl);
    document.body.appendChild(this.root);
    this.setMore(false);

    this.panel = new BuildingPanel(engine, this);
    // One panel at a time: a sheet that opens (from the HUD, a toast, the Book) closes this screen.
    Sheet.onOpen = () => { if (this.shown) this.close(); };
    this.bindKeys();
    // A turned phone or a resized window: frame the room again for the new band.
    window.addEventListener('resize', () => { if (this.shown) requestAnimationFrame(() => this.frame()); });
  }

  get isOpen(): boolean {
    return this.shown;
  }

  /** PanelHost: BuildingPanel.show(id) opens the screen on that room, or moves it there. */
  open(buildingId: string): void {
    if (!this.shown) {
      this.back = this.view.camera.view;
      this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      Sheet.closeAll();
      this.shown = true;
      this.root.style.setProperty('--hud-top', `${Math.round(hudTop())}px`);
      this.root.hidden = false;
      this.setMore(false);
      void this.root.offsetWidth; // start the slide from below
      this.root.classList.add('is-open');
      document.body.classList.add('room-screen-on');
      uiSound('open', 0.7, 150);
      requestAnimationFrame(() => this.nameEl.focus({ preventScroll: true }));
    }
    if (this.roomId !== buildingId) this.sheetEl.scrollTop = 0;
    this.roomId = buildingId;
    this.mainSig = '';
    this.view.setSelected(buildingId);
    this.view.setRoomFocus(true); // [clean:1]
    this.neighbours(buildingId);
    // Frame once the panel has its place (its height is a share of the screen, so one frame is enough).
    requestAnimationFrame(() => this.frame());
  }

  /** PanelHost: closes the screen (the close plate, Escape, back, closeSheets, a sheet opening, the room gone). */
  close(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.remove('is-open');
    document.body.classList.remove('room-screen-on');
    this.root.hidden = true;
    this.view.camera.releaseRoom(this.back);
    this.view.setRoomFocus(false); // [clean:1]
    this.back = null;
    this.roomId = null;
    this.progress = null;
    this.panel.closed();
    const back = this.opener;
    this.opener = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  /** PanelHost: is the upgrade this room's main action (then the panel's own bar leaves its upgrade button out)? */
  showsUpgrade(state: GameState, b: BuildingInstance): boolean {
    return this.mainAction(state, b).kind === 'upgrade';
  }

  /** PanelHost: after every panel refresh, the screen's own part from the same state. */
  refreshed(state: GameState, b: BuildingInstance): void {
    if (!this.shown) return;
    const def = getDef(b.type);
    if (!def) return;
    const locale = i18n.currentLocale;
    setRich(this.nameEl, def.name[locale] ?? def.name.en);
    this.dotEl.dataset.status = roomStatus(state, b);
    // Plain text: a duration after a dash ("upgrading – 6 min") must not be read as a signed number (setRich isolates those).
    const line = this.statusLine(state, b);
    if (this.statusEl.textContent !== line) this.statusEl.textContent = line;
    const facts = this.factList(state, b);
    facts.forEach((f, i) => {
      setRich(this.facts[i].value, f.value);
      setRich(this.facts[i].label, f.label);
    });
    this.renderMain(state, b);
  }

  // ───────────────────────────── the main action ─────────────────────────────

  /**
   * The ONE main action, by the room's state (first match wins):
   *   1. a crisis in the room (or a blackout on its floor): fight it;  2. a disaster aimed at it: handle it (the disaster's dialog);
   *   3. shut down (a collapse or meltdown): repair now;  4. being built or upgraded: the progress, with Rush when charges are left;
   *   5. fewer workers than places and someone idle who can go there: fill the places (best fit);
   *   6. it can go up a level (not max, not held by the Act): upgrade, with its price (short of it, the tap says what is missing);
   *   7. otherwise none.
   */
  mainAction(state: GameState, b: BuildingInstance): MainAction {
    const inc = (state.incidents ?? []).find(i => i.buildingId === b.id)
      ?? (state.incidents ?? []).find(i => INCIDENTS[i.kind].wholeFloor && state.buildings.find(x => x.id === i.buildingId)?.position.floor === b.position.floor);
    if (inc) return { kind: 'incident', id: inc.id };
    const dz = (state.danger?.disasters ?? []).find(d => d.buildingId === b.id);
    if (dz) return { kind: 'disaster', id: dz.id };
    if (this.engine.maintenanceSystem.isDown(state, b)) return { kind: 'repair' };
    if (b.isConstructing) return { kind: 'build', rush: this.engine.rushSystem.count(state) > 0 };
    const def = getDef(b.type);
    if (def && def.maxWorkers > 0) {
      const adults = this.adults(state, b);
      const idle = state.survivors.filter(s => !s.assignedBuildingId && !s.isOnMission && !s.child).length;
      const n = Math.min(def.maxWorkers - adults, idle);
      if (n > 0 && this.engine.populationSystem.canAssign(state, b.id)) return { kind: 'fill', n };
    }
    if (this.engine.buildingSystem.upgradeBlock(b, state) === null) {
      return { kind: 'upgrade', affordable: this.engine.resourceSystem.canAfford(state, this.engine.buildingSystem.getUpgradeCost(b)) };
    }
    return { kind: 'none' };
  }

  private renderMain(state: GameState, b: BuildingInstance): void {
    const act = this.mainAction(state, b);
    const ms = this.engine.maintenanceSystem;
    const bs = this.engine.buildingSystem;
    const sig = [JSON.stringify(act), b.id, b.level,
      act.kind === 'repair' ? `${ms.canMaintain(state, b)}:${JSON.stringify(ms.cost(state, b))}` : '',
      act.kind === 'upgrade' ? JSON.stringify(bs.getUpgradeCost(b)) : '',
      act.kind === 'build' ? `${this.engine.rushSystem.count(state)}:${this.engine.rushSystem.canRushBuilding(state, b.id)}` : '',
    ].join('|');
    if (sig !== this.mainSig) {
      this.mainSig = sig;
      const was = this.mainEl.dataset.kind;
      this.buildMain(state, b, act);
      // The panel leaves its own upgrade button out exactly when it is the main action: redraw it when that changes.
      if ((was === 'upgrade') !== (act.kind === 'upgrade')) this.panel.invalidate();
    }
    if (this.progress && b.isConstructing) setProgress(this.progress, b.constructionProgress, b.constructionTotal);
  }

  private buildMain(state: GameState, b: BuildingInstance, act: MainAction): void {
    const locale = i18n.currentLocale;
    const redraw = () => this.panel.refresh(this.engine.stateManager.state);
    this.mainEl.dataset.kind = act.kind;
    this.progress = null;
    const parts: HTMLElement[] = [];
    switch (act.kind) {
      case 'incident': {
        const inc = (state.incidents ?? []).find(i => i.id === act.id);
        if (!inc) break;
        const def = INCIDENTS[inc.kind];
        parts.push(kButton({ variant: 'primary', className: 'btn-primary rs-main-btn', label: `[[${def.icon}]] ${def.fight[locale]}`, onPress: () => this.panel.onIncidentTap?.(inc.id) }));
        break;
      }
      case 'disaster': {
        const dz = (state.danger?.disasters ?? []).find(d => d.id === act.id);
        if (!dz) break;
        const def = DISASTERS[dz.kind];
        parts.push(kButton({ variant: 'primary', className: 'btn-primary rs-main-btn', label: `[[${def.icon}]] ${def.handleLabel[locale]}`, onPress: () => this.onDisaster?.(dz.id) }));
        break;
      }
      case 'repair': {
        const ms = this.engine.maintenanceSystem;
        parts.push(kButton({
          variant: 'primary', className: 'btn-primary rs-main-btn', icon: 'pick', label: i18n.t('p4r.wear.repairNow'),
          detail: costRow(state, ms.cost(state, b)),
          disabledReason: ms.canMaintain(state, b) ? null : '',
          onPress: () => { if (ms.maintain(b.id)) { uiSound('confirm'); this.engine.requestSave(); } redraw(); },
        }));
        break;
      }
      case 'build': {
        this.progress = kProgress(b.constructionProgress, b.constructionTotal, i18n.t(b.level > 1 ? 'building.upgrading' : 'building.constructing', { time: '' }));
        this.progress.classList.add('rs-progress');
        parts.push(this.progress);
        if (act.rush) {
          const rs = this.engine.rushSystem;
          parts.push(kButton({
            variant: 'primary', className: 'btn-primary rs-main-btn', icon: 'hourglass', label: i18n.t('rush.button', { n: rs.count(state) }),
            disabledReason: rs.canRushBuilding(state, b.id) ? null : '',
            onPress: () => { if (rs.rushBuilding(b.id)) { uiSound('confirm'); this.engine.requestSave(); } redraw(); },
          }));
        }
        break;
      }
      case 'fill':
        parts.push(kButton({
          variant: 'primary', className: 'btn-primary rs-main-btn', icon: 'worker', label: plural('cf1.main.fill', act.n),
          onPress: () => {
            uiSound(this.engine.populationSystem.assignIdleBestFit(this.engine.stateManager, b.id) ? 'assign' : 'error');
            this.engine.requestSave();
            redraw();
          },
        }));
        break;
      case 'upgrade': {
        // Short of the price the button stays tappable: the app's handler says what is missing and when it will be there (ui/missing.ts).
        const up = kButton({
          variant: 'primary', className: `btn-primary rs-main-btn${act.affordable ? '' : ' rs-short'}`, icon: 'up',
          label: i18n.t('building.upgradeTo', { n: b.level + 1 }), detail: costRow(state, this.engine.buildingSystem.getUpgradeCost(b)),
          onPress: () => this.panel.onUpgrade?.(b.id),
        });
        if (!act.affordable) up.setAttribute('aria-describedby', 'rs-more');
        parts.push(up);
        break;
      }
      case 'none':
        break;
    }
    this.mainEl.replaceChildren(...parts);
    this.mainEl.hidden = parts.length === 0;
  }

  // ───────────────────────────── status and facts ─────────────────────────────

  private adults(state: GameState, b: BuildingInstance): number {
    let n = 0;
    for (const id of b.assignedSurvivorIds) if (!state.survivors.find(s => s.id === id)?.child) n++;
    return n;
  }

  /** One line: what is going on in the room (the words behind the status dot). */
  private statusLine(state: GameState, b: BuildingInstance): string {
    const locale = i18n.currentLocale;
    if (this.engine.maintenanceSystem.isDown(state, b)) return i18n.t('cf1.status.down');
    const inc = (state.incidents ?? []).find(i => i.buildingId === b.id);
    if (inc) return i18n.t('cf1.status.crisis', { name: INCIDENTS[inc.kind].name[locale] });
    const dz = (state.danger?.disasters ?? []).find(d => d.buildingId === b.id);
    if (dz) return i18n.t('cf1.status.disaster', { name: DISASTERS[dz.kind].name[locale] });
    if (b.isConstructing) {
      return i18n.t(b.level > 1 ? 'building.upgrading' : 'building.constructing', { time: i18n.formatDuration(b.constructionTotal - b.constructionProgress) });
    }
    const max = getDef(b.type)?.maxWorkers ?? 0;
    if (max <= 0) return i18n.t('cf1.status.ok');
    const n = this.adults(state, b);
    if (n === 0) return i18n.t('cf1.status.idle');
    if (n < max) return i18n.t('cf1.status.short', { n, max });
    return i18n.t('cf1.status.ok');
  }

  /** The three facts: level, workers, and the room's main output (per hour) or effect, in plain words. */
  private factList(state: GameState, b: BuildingInstance): { value: string; label: string }[] {
    const def = getDef(b.type)!;
    const workers = def.maxWorkers > 0
      ? { value: `${this.adults(state, b)}/${def.maxWorkers}`, label: i18n.t('cf1.fact.workers') }
      : { value: '—', label: i18n.t('cf1.fact.noWorkers') };
    return [{ value: String(b.level), label: i18n.t('cf1.fact.level') }, workers, this.mainFact(state, b)];
  }

  private mainFact(state: GameState, b: BuildingInstance): { value: string; label: string } {
    const def = getDef(b.type)!;
    const level = Math.max(1, effectiveLevel(b));
    if (def.production) {
      const out = this.engine.resourceSystem.getBuildingOutput(state, b);
      const keys = Object.keys(def.production);
      const best = keys.reduce((a, r) => ((out[r as keyof typeof out] ?? 0) > (out[a as keyof typeof out] ?? 0) ? r : a), keys[0]);
      const perHour = Math.max(0, (out[best as keyof typeof out] ?? 0) * 3600);
      return { value: `+${fmtNum(perHour)}`, label: `${RESOURCE_ICONS[best] ?? ''} ${i18n.t('cf1.fact.perHour', { res: i18n.t(`resources.${best}`) })}` };
    }
    const fx = def.effects;
    if (fx?.maxPopulation) return { value: String(fx.maxPopulation.base + fx.maxPopulation.perLevel * (level - 1)), label: i18n.t('cf1.fact.beds') };
    if (fx?.childCapacity) {
      const kids = b.assignedSurvivorIds.filter(id => state.survivors.find(s => s.id === id)?.child).length;
      return { value: `${kids}/${childCapacityOf(b)}`, label: i18n.t('cf1.fact.kids') };
    }
    if (fx?.morale) return { value: `+${Math.round((fx.morale.base + fx.morale.perLevel * (level - 1)) * workforceMultiplier(state, b))}`, label: i18n.t('cf1.fact.morale') };
    if (fx?.defense) return { value: `+${Math.round((fx.defense.base + fx.defense.perLevel * (level - 1)) * workforceMultiplier(state, b))}`, label: `${i18n.t('cf1.fact.defense')} (${bunkerDefense(state)})` };
    if (fx?.storageCap) {
      const [r, v] = Object.entries(fx.storageCap)[0] ?? ['', 0];
      return { value: `+${fmtNum(v * level)}`, label: `${RESOURCE_ICONS[r] ?? ''} ${i18n.t('cf1.fact.storage')}` };
    }
    if (b.type === 'laboratory') return { value: `×${this.engine.researchSystem.speed(state).toFixed(2)}`, label: i18n.t('cf1.fact.research') };
    if (def.maxWorkers > 0) return { value: `${Math.round(workforceMultiplier(state, b) * 100)}%`, label: i18n.t('cf1.fact.efficiency') };
    return { value: '—', label: i18n.t('cf1.status.ok') };
  }

  // ───────────────────────────── neighbours, framing, input ─────────────────────────────

  /** The rooms beside this one on the same floor (world x order: the world is drawn the same way in Hebrew and English). */
  private neighbours(id: string): void {
    const state = this.engine.stateManager.state;
    const b = state.buildings.find(x => x.id === id);
    this.left = this.right = null;
    if (b) {
      const xOf = (r: BuildingInstance) => this.view.roomRect(r.id)?.x ?? r.position.x * 1000;
      const row = state.buildings.filter(r => r.position.floor === b.position.floor).sort((a, c) => xOf(a) - xOf(c));
      const i = row.findIndex(r => r.id === id);
      this.left = row[i - 1]?.id ?? null;
      this.right = row[i + 1]?.id ?? null;
    }
    // Reading direction: in Hebrew the next room is the one to the left.
    const rtl = document.documentElement.dir === 'rtl';
    this.prevBtn.setAttribute('aria-label', i18n.t(rtl ? 'cf1.next' : 'cf1.prev'));
    this.nextBtn.setAttribute('aria-label', i18n.t(rtl ? 'cf1.prev' : 'cf1.next'));
    this.prevBtn.hidden = !this.left;
    this.nextBtn.hidden = !this.right;
  }

  private go(id: string | null): void {
    if (!id || !this.shown) return;
    uiSound('click');
    this.panel.show(id); // through the panel: it resets its folds and re-renders, then calls open(id) here
  }

  private frame(): void {
    if (!this.shown || !this.roomId) return;
    const r = this.view.roomRect(this.roomId);
    if (!r) return;
    const top = hudTop() + FRAME_GAP;
    // Where the panel rests (its layout box: while it slides in, its transform would say "lower").
    const bottom = this.root.getBoundingClientRect().top + this.sheetEl.offsetTop - FRAME_GAP;
    this.view.camera.frameRoom(r, top, Math.max(top + 40, bottom));
  }

  private setMore(open: boolean): void {
    this.moreOpen = open;
    this.body.hidden = !open;
    this.root.classList.toggle('more-open', open);
    this.moreBtn.setAttribute('aria-expanded', String(open));
    const label = this.moreBtn.querySelector<HTMLElement>('.k-btn__label');
    if (label) setRich(label, `${open ? '▴' : '▾'} ${i18n.t(open ? 'cf1.less' : 'cf1.more')}`);
    if (open) requestAnimationFrame(() => this.moreBtn.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  /** A sideways swipe across the picture moves to the room beside: the finger drags the world, so a swipe to the left shows the room on the right. */
  private bindSwipe(target: HTMLElement): void {
    let id = -1, x0 = 0, y0 = 0;
    target.addEventListener('pointerdown', e => {
      if (e.target !== target) return; // the close plate and the arrows are buttons
      id = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_SLOPE) return;
      this.go(dx < 0 ? this.right : this.left);
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', () => { id = -1; });
  }

  /** Escape closes the screen (unless a sheet or a dialog over it takes the key); the arrow keys move to the next room. */
  private bindKeys(): void {
    window.addEventListener('keydown', () => {
      this.escTaken = Sheet.anyOpen || !!document.querySelector('.modal-overlay.open, .ob-spot.in');
    }, { capture: true });
    document.addEventListener('keydown', e => {
      if (!this.shown || e.defaultPrevented) return;
      const t = e.target as Element | null;
      if (t?.closest?.('input,textarea,select')) return;
      if (e.key === 'Escape' && !this.escTaken) { e.preventDefault(); this.close(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (this.escTaken) return;
        e.preventDefault();
        this.go(e.key === 'ArrowLeft' ? this.left : this.right);
      }
    });
  }
}

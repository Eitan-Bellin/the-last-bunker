import type { GameState, ResourceType } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import type { BuildingType } from '../../core/GameState';
import type { ObjectiveAction } from '../../systems/ObjectiveSystem';
import { i18n } from '../../i18n/I18nManager';
import { fmtCost, fmtDuration, plural } from '../format';
import { BRANCHES, REFINEMENTS, RESEARCH, type ResearchBranch, type ResearchDef } from '../../data/research';
import { BUILDABLE_TYPES, getDef } from '../../data/buildingDefs';
import { isBuildingUnlocked, refinementLevel } from '../../systems/ResearchSystem';
import { Sheet } from './Sheet';
import { RESOURCE_ICONS, bar, costRow, el, setBar, setRich } from '../dom';
import { flowArrow } from '../rtl';
import { describeMissing, missingList } from '../missing';
import { kButton, kRow, kTabs, kEmpty, setKButtonHighlighted } from '../kit';
import { uiSound } from '../../audio/uiSound';
import { genesisRequirements } from './MenuPanel';
import { showCrossroads } from './Crossroads'; // [phase4]
import '../../styles/research.css';
import '../../styles/screens-p2.css'; // [phase2]

/** [ux-redesign W2d] A node another panel asked to show (Surface: "Research Hazmat Suits"): consumed by the next show(). */
let pendingFocus: string | null = null;

/** Where a node sits in the list: on the main list, folded behind more research this Act, in a later Act, or done. */
type Place = 'now' | 'later' | 'act' | 'done';

export class ResearchPanel {
  private sheet = new Sheet('research-sheet', 'research');
  private engine: GameEngine;
  private branch: ResearchBranch = 'infrastructure';
  private signature = '';
  private activeBar: HTMLElement | null = null;
  private activeTime: HTMLElement | null = null;
  /** Folds the player opened (kept across redraws). */
  private openFolds = new Set<string>();
  private focusId: string | null = null;

  onOpenGenesis: (() => void) | null = null;
  /**
   * [ux-redesign W2d #13] Takes the player where a missing thing is made (e.g. `{ kind: 'build', type: 'laboratory' }`). Wired by the
   * app to `runAction`, like EraPanel.onGo. While unset, a blocked button still says why but does not route.
   */
  onGo: ((action: ObjectiveAction) => void) | null = null;

  /** [ux-redesign W2d #15] The next show() opens on this node's branch and points at it. */
  static focusNext(id: string): void {
    pendingFocus = id;
  }

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  show(): void {
    if (pendingFocus) {
      const def = RESEARCH.find(r => r.id === pendingFocus);
      if (def) { this.branch = def.branch; this.focusId = def.id; }
      pendingFocus = null;
    }
    this.signature = '';
    this.refresh(this.engine.stateManager.state);
    this.sheet.show();
    if (this.focusId) {
      const card = this.sheet.body.querySelector<HTMLElement>(`[data-research="${this.focusId}"]`);
      card?.scrollIntoView({ block: 'center' });
      const go = card?.querySelector<HTMLButtonElement>('.k-btn');
      if (go) setKButtonHighlighted(go, true);
      this.focusId = null;
    }
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  refresh(state: GameState): void {
    const rs = this.engine.researchSystem;
    const ids = [...RESEARCH.map(r => r.id), ...REFINEMENTS.map(r => r.id)];
    const sig = [
      this.branch, i18n.currentLocale, state.rush ?? 0, rs.activeId(state), rs.queue(state).join(','), JSON.stringify(state.refinements ?? {}),
      ids.map(id => `${id}:${rs.status(state, id)}:${rs.canStart(state, id)}`).join(','),
      state.buildings.filter(b => b.type === 'laboratory').length,
      // The blocked buttons name what is missing and how long it takes: redraw when that changes (about every 10 seconds at most).
      Math.floor(state.stats.totalPlayTime / 10),
      this.branch === 'genesis' ? this.engine.metaSystem.rebirthRequirements(state).map(r => r.current).join(',') : '',
    ].join('|');
    if (sig !== this.signature) {
      this.signature = sig;
      this.render(state);
    }
    const id = rs.activeId(state);
    if (id && this.activeBar && this.activeTime) {
      const node = state.research[id];
      setBar(this.activeBar, (node.progress / node.total) * 100);
      setRich(this.activeTime, `[[clock]] ${fmtDuration((node.total - node.progress) / rs.speed(state))}`);
    }
  }

  private redraw(): void {
    this.signature = '';
    this.refresh(this.engine.stateManager.state);
  }

  private start(id: string): void {
    if (this.engine.researchSystem.start(this.engine.stateManager, id)) {
      uiSound('confirm');
      this.engine.requestSave();
      this.redraw();
    }
  }

  private name(def: { name: Record<string, string> }): string {
    return def.name[i18n.currentLocale] ?? def.name.en;
  }

  private render(state: GameState): void {
    const rs = this.engine.researchSystem;
    this.sheet.setTitle(`[[research]] ${i18n.t('research.title')}`);
    const root = el('div', 'bp');
    // [phase2] Nothing begun and nothing can start yet (Act I): one line that says when research opens, no empty branch tabs.
    const notYet = this.notYet(state);
    if (notYet) {
      root.appendChild(notYet);
      this.activeBar = null;
      this.activeTime = null;
      this.sheet.body.replaceChildren(root);
      return;
    }

    const head = el('div', 'bp-card research-head');
    const activeId = rs.activeId(state);
    this.activeBar = null;
    this.activeTime = null;
    if (activeId) {
      const def = rs.defOf(state, activeId)!;
      const row = el('div', 'bp-row');
      row.append(el('span', 'research-active-name', `${def.icon} ${this.name(def)}`));
      this.activeTime = el('span', 'bp-hint');
      row.appendChild(this.activeTime);
      this.activeBar = bar(0, 'xp');
      head.append(row, this.activeBar);
      // Rush: spend a gift charge to skip 15 minutes of this research.
      head.appendChild(kButton({
        variant: 'secondary',
        className: 'btn-secondary btn-small',
        label: `[[hourglass]] ${i18n.t('rush.button', { n: this.engine.rushSystem.count(state) })}`,
        disabledReason: this.engine.rushSystem.canRushResearch(state) ? null : i18n.t('ux2d.rush.none'),
        onPress: () => {
          if (this.engine.rushSystem.rushResearch()) {
            uiSound('confirm');
            this.engine.requestSave();
            this.redraw();
          }
        },
      }));
      head.appendChild(this.renderQueue(state));
    } else {
      head.appendChild(el('div', 'bp-hint', i18n.t('research.idle')));
    }
    const hasLab = state.buildings.some(b => b.type === 'laboratory');
    if (hasLab) head.appendChild(el('div', 'bp-hint', i18n.t('research.speed', { x: rs.speed(state).toFixed(2) })));
    else if (this.onGo && isBuildingUnlocked(state, 'laboratory')) {
      // [ux-redesign W2d #13] "Build a Laboratory" is a way there, not only a sentence.
      head.appendChild(kButton({
        variant: 'tertiary',
        className: 'btn-ghost research-route',
        label: `[[intelligence]] ${i18n.t('research.needLab')} ${flowArrow()}`,
        onPress: () => this.onGo?.({ kind: 'build', type: 'laboratory' }),
      }));
    } else head.appendChild(el('div', 'bp-hint', `[[intelligence]] ${i18n.t('research.needLab')}`));
    root.appendChild(head);
    // [phase4] A doctrine is chosen on its Crossroads, not researched: a waiting one shows here, above the tree.
    for (const fork of rs.waitingForks(state)) root.appendChild(this.crossroadsCard(fork));

    // [ux-redesign W2d #14] Only branches with something to do now get a tab, so the row fits a phone; the row scrolls with a fade
    // at its end when it still does not. Genesis waits for the late game (ux-wp6), refinement until its first node can start.
    const places = this.places(state);
    const branches = BRANCHES.filter(b => {
      if (b.id === 'genesis') return this.showGenesis(state);
      if (b.id === 'refinement') return REFINEMENTS.some(r => rs.status(state, r.id) !== 'locked' || refinementLevel(state, r.id) > 0);
      return RESEARCH.some(r => r.branch === b.id && (places.get(r.id) === 'now' || places.get(r.id) === 'done'));
    });
    if (!branches.some(b => b.id === this.branch)) this.branch = branches[0]?.id ?? 'infrastructure';
    const list = el('div', 'research-list');
    list.id = 'research-list';
    const tabs = kTabs(
      branches.map(b => ({ id: b.id, label: `${b.icon} ${this.name(b)}` })),
      this.branch,
      (id) => { this.branch = id as ResearchBranch; uiSound('switch'); this.redraw(); },
      i18n.t('research.title'),
      list,
    );
    tabs.classList.add('research-tabs');
    const tabWrap = el('div', 'research-tabwrap');
    tabWrap.appendChild(tabs);
    root.appendChild(tabWrap);
    const syncFade = () => {
      const max = tabs.scrollWidth - tabs.clientWidth;
      const at = Math.abs(tabs.scrollLeft);
      tabWrap.classList.toggle('fade-end', max > 1 && at < max - 1);
      tabWrap.classList.toggle('fade-start', max > 1 && at > 1);
    };
    tabs.addEventListener('scroll', syncFade, { passive: true });
    requestAnimationFrame(() => {
      tabs.querySelector<HTMLElement>('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      syncFade();
    });

    if (this.branch === 'refinement') {
      list.appendChild(el('div', 'bp-hint', `[[up]] ${i18n.t('research.refineHint')}`));
      for (const ref of REFINEMENTS) {
        if (rs.status(state, ref.id) === 'locked' && refinementLevel(state, ref.id) === 0) continue;
        if (rs.surplusHidden(state, ref.id)) continue; // [phase1] a surplus resource needs no refinement
        list.appendChild(this.renderCard(state, rs.defOf(state, ref.id)!, refinementLevel(state, ref.id)));
      }
    } else {
      const inBranch = RESEARCH.filter(r => r.branch === this.branch).sort((a, b) => a.tier - b.tier);
      const of = (p: Place) => inBranch.filter(r => places.get(r.id) === p);
      const now = of('now');
      for (const def of now) list.appendChild(this.renderCard(state, def, null));
      if (now.length === 0) list.appendChild(kEmpty('check', i18n.t('ux2d.research.allDone')));
      const later = of('later');
      if (later.length) {
        list.appendChild(this.fold('later', `[[lock]] ${plural('ux2d.research.laterNow', later.length)}`, later.map(d => this.foldRow(state, d))));
      }
      // Next Act's nodes by name only (no Doctrine or Genesis talk before they open); the ones after that as a count.
      const act = state.longGame?.meta.act ?? 1;
      const byAct = new Map<number, ResearchDef[]>();
      for (const d of of('act')) {
        const n = d.act ?? act + 1;
        byAct.set(n, [...(byAct.get(n) ?? []), d]);
      }
      for (const [n, defs] of [...byAct].sort((a, b) => a[0] - b[0])) {
        list.appendChild(this.fold(`act${n}`, `[[lock]] ${i18n.t('ux2d.research.opensAct', { n, count: defs.length })}`, defs.map(d => this.foldRow(state, d))));
      }
      const hidden = inBranch.filter(r => !places.has(r.id) && !this.offTree(state, r)).length; // [phase4] auto and doctrine nodes are not "later"
      if (hidden > 0) list.appendChild(el('div', 'bp-hint research-later', `[[lock]] ${plural('wp6.research.later', hidden)}`));
      const done = of('done');
      if (done.length) {
        list.appendChild(this.fold('done', `[[check]] ${i18n.t('ux2d.research.done', { n: done.length })}`, done.map(d => kRow({ label: `${d.icon} ${this.name(d)}`, value: i18n.t('research.done') }))));
      }
    }
    root.appendChild(list);

    if (this.branch === 'genesis' && this.genesisNear(state)) {
      root.appendChild(genesisRequirements(state, this.engine.metaSystem));
      root.appendChild(kButton({ variant: 'secondary', label: `[[isotope7]] ${i18n.t('genesis.open')}`, onPress: () => this.onOpenGenesis?.() }));
    }
    this.sheet.body.replaceChildren(root);
  }

  /**
   * [phase2] The card for a bunker that cannot research yet: nothing done, running or queued (no refinement either) and no node that
   * can start now. It says what the first research waits for (the cheapest open node's missing price, and the room that makes it, as
   * a way there), or the Act research opens in. Null once anything can start or has been begun.
   */
  private notYet(state: GameState): HTMLElement | null {
    const rs = this.engine.researchSystem;
    const ids = [...RESEARCH.map(r => r.id), ...REFINEMENTS.map(r => r.id)];
    if (ids.some(id => { const st = rs.status(state, id); return st === 'done' || st === 'active' || st === 'queued' || rs.canStart(state, id); })) return null;
    if (REFINEMENTS.some(r => refinementLevel(state, r.id) > 0)) return null;
    const card = el('div', 'bp-card research-head p2s-research-wait');
    const open = RESEARCH.filter(r => rs.status(state, r.id) === 'available');
    const total = (d: ResearchDef) => Object.values(d.cost as Record<string, number>).reduce((s, v) => s + v, 0);
    const first = [...open].sort((a, b) => total(a) - total(b) || a.tier - b.tier)[0];
    if (!first) {
      const act = state.longGame?.meta.act ?? 1;
      const next = Math.min(...RESEARCH.map(r => r.act ?? 1).filter(n => n > act));
      card.appendChild(el('div', 'p2s-research-wait__line', `[[lock]] ${isFinite(next) ? i18n.t('p2s.research.opensAct', { n: next }) : i18n.t('p2s.research.later')}`));
      return card;
    }
    const cost = first.cost as Record<string, number>;
    const short = missingList(state, cost);
    const room = short.length ? this.producerFor(state, short[0].resource) : null;
    if (room) {
      const roomName = getDef(room)?.name[i18n.currentLocale] ?? room;
      const s0 = short[0];
      card.appendChild(el('div', 'p2s-research-wait__line', `[[lock]] ${i18n.t('p2s.research.needRoom', { n: fmtCost(s0.need), icon: RESOURCE_ICONS[s0.resource] ?? '', name: i18n.t(`resources.${s0.resource}`), room: roomName })}`));
      if (this.onGo) {
        card.appendChild(kButton({
          variant: 'secondary',
          className: 'btn-secondary research-route',
          label: `${i18n.t('p2s.research.build', { room: roomName })} ${flowArrow()}`,
          onPress: () => this.onGo?.({ kind: 'build', type: room }),
        }));
      }
    } else {
      card.appendChild(el('div', 'p2s-research-wait__line', `[[lock]] ${i18n.t('p2s.research.wait', { what: short.length ? describeMissing(state, cost) : i18n.t('p2s.research.soon') })}`));
    }
    return card;
  }

  /** A folded group: a summary line (48 px) that opens a short list of names. */
  private fold(key: string, summary: string, rows: HTMLElement[]): HTMLElement {
    const d = el('details', 'research-fold');
    d.open = this.openFolds.has(key);
    const s = el('summary', 'research-fold__summary', summary);
    d.append(s, ...rows);
    d.addEventListener('toggle', () => {
      if (d.open) this.openFolds.add(key);
      else this.openFolds.delete(key);
    });
    return d;
  }

  /** One folded node: its name and, briefly, what it waits for. */
  private foldRow(state: GameState, def: ResearchDef): HTMLElement {
    const rs = this.engine.researchSystem;
    const act = state.longGame?.meta.act ?? 1;
    let value = '';
    if ((def.act ?? 1) > act) value = i18n.t('research.actLock', { n: def.act ?? 0 });
    else {
      const missing = def.requires.filter(r => !state.research[r]?.completed);
      if (missing.length) value = i18n.t('research.requires', { list: missing.map(r => { const d = rs.defOf(state, r); return d ? this.name(d) : r; }).join(', ') });
    }
    return kRow({ label: `${def.icon} ${this.name(def)}`, value });
  }

  /**
   * [ux-redesign W2d #14] Where each node goes. On the main list: what can start now, what is running or queued, and the next step
   * (its prerequisites are done or on their way). Folded: nodes that need more research first ("later"), and the next Act's ("act").
   * Absent: two or more Acts ahead (ux-wp6, a count only). A second run sees everything that is open.
   */
  private places(state: GameState): Map<string, Place> {
    const rs = this.engine.researchSystem;
    const out = new Map<string, Place>();
    const hidden = this.hiddenNodes(state);
    const act = state.longGame?.meta.act ?? 1;
    const pending = new Set([rs.activeId(state), ...rs.queue(state)]);
    const ready = (id: string) => !!state.research[id]?.completed || pending.has(id);
    for (const r of RESEARCH) {
      if (hidden.has(r.id) || this.offTree(state, r)) continue; // [phase4]
      const st = rs.status(state, r.id);
      if (st === 'done') out.set(r.id, 'done');
      else if (st === 'active' || st === 'queued' || st === 'available') out.set(r.id, 'now');
      else if (state.longGame && (r.act ?? 1) > act) out.set(r.id, 'act');
      else if (rs.blockReason(state, r.id) === 'fork') out.set(r.id, 'now'); // a closed doctrine says so on its card
      // The next step: everything it needs is done, on its way, or can start now (its card says "Requires: ...").
      else out.set(r.id, r.requires.every(q => ready(q) || rs.status(state, q) === 'available') ? 'now' : 'later');
    }
    return out;
  }

  /**
   * [phase4] Nodes that are not part of the tree the player works through: filler that completes by itself (`auto`), and doctrines,
   * which are chosen on their Crossroads (a chosen one still shows as done; one an older save had running or queued shows as such).
   */
  private offTree(state: GameState, r: ResearchDef): boolean {
    if (r.auto) return true;
    if (!r.fork) return false;
    const st = this.engine.researchSystem.status(state, r.id);
    return st !== 'done' && st !== 'active' && st !== 'queued';
  }

  /** [phase4] "A crossroads is waiting: Power" and the way to it. */
  private crossroadsCard(fork: string): HTMLElement {
    const card = el('div', 'bp-card p4c-xr-card');
    card.append(
      el('div', 'bp-section-title', `[[flag]] ${i18n.t('p4c.xr.waiting', { fork: i18n.t(`p4c.fork.${fork}`) })}`),
      el('div', 'bp-hint', i18n.t('p4c.xr.waitingHint')),
      kButton({ variant: 'primary', label: `${i18n.t('p4c.xr.open')} ${flowArrow()}`, onPress: () => showCrossroads(this.engine, fork, () => this.redraw()) }),
    );
    return card;
  }

  /** [ux-wp6] A second run (or later): the whole tree was seen once, nothing is held back. */
  private veteran(state: GameState): boolean {
    return (state.prestige?.rebirthCount ?? 0) > 0 || (state.longGame?.meta.runIndex ?? 0) > 0;
  }

  /** [ux-wp6] The Genesis tab: from Act III (its first nodes open in Act IV), on a later run, or once any of its nodes was begun. */
  private showGenesis(state: GameState): boolean {
    const rs = this.engine.researchSystem;
    const act = state.longGame?.meta.act ?? 1;
    return this.veteran(state) || act >= 3 || RESEARCH.some(r => r.branch === 'genesis' && rs.status(state, r.id) !== 'available' && rs.status(state, r.id) !== 'locked');
  }

  /** [ux-wp6] The Genesis requirements and button: only once the last Acts are in sight (or on a later run). */
  private genesisNear(state: GameState): boolean {
    return this.veteran(state) || (state.longGame?.meta.act ?? 1) >= 6;
  }

  /**
   * [ux-wp6: clarity C3] Nodes held back for now: those that open two or more Acts ahead, and those that need one of them.
   * Done, running and queued nodes always show.
   */
  private hiddenNodes(state: GameState): Set<string> {
    const out = new Set<string>();
    if (this.veteran(state) || !state.longGame) return out;
    const rs = this.engine.researchSystem;
    const act = state.longGame.meta.act ?? 1;
    const byId = new Map(RESEARCH.map(r => [r.id, r]));
    const memo = new Map<string, boolean>();
    const far = (id: string, depth = 0): boolean => {
      const known = memo.get(id);
      if (known !== undefined) return known;
      const def = byId.get(id);
      if (!def || depth > 40) return false;
      const st = rs.status(state, id);
      const started = st === 'done' || st === 'active' || st === 'queued';
      const v = !started && ((def.act ?? 1) > act + 1 || def.requires.some(q => far(q, depth + 1)));
      memo.set(id, v);
      return v;
    };
    for (const r of RESEARCH) if (far(r.id)) out.add(r.id);
    return out;
  }

  /** The waiting line behind the active research, with a refund button per entry. */
  private renderQueue(state: GameState): HTMLElement {
    const rs = this.engine.researchSystem;
    const queue = rs.queue(state);
    const box = el('div', 'research-queue');
    box.appendChild(el('div', 'bp-hint', `[[clock]] ${i18n.t('research.queue', { n: queue.length, max: rs.queueSlots(state) })}`));
    queue.forEach((id, i) => {
      const def = rs.defOf(state, id);
      if (!def) return;
      const row = el('div', 'research-queue-row');
      row.append(
        el('span', 'research-queue-name', `${i + 1}. ${def.icon} ${this.name(def)}`),
        el('span', 'bp-hint', `[[clock]] ${i18n.formatDuration(rs.etaSeconds(state, id))}`),
      );
      const cancel = kButton({
        variant: 'close',
        icon: 'close',
        ariaLabel: i18n.t('research.cancelQueued'),
        onPress: () => {
          if (rs.cancelQueued(this.engine.stateManager, id)) {
            uiSound('switch');
            this.engine.requestSave();
            this.redraw();
          }
        },
      });
      cancel.title = i18n.t('research.cancelQueued');
      row.appendChild(cancel);
      box.appendChild(row);
    });
    if (queue.length < rs.queueSlots(state)) box.appendChild(el('div', 'bp-hint', i18n.t('research.queueHint')));
    return box;
  }

  /**
   * [ux-redesign W2d #13] Where a missing resource comes from: the first unlocked room type that makes it, when the bunker has none
   * yet (with one, the wait is the answer: "~4 min").
   */
  private producerFor(state: GameState, res: ResourceType): BuildingType | null {
    const makes = (t: BuildingType) => (getDef(t)?.production?.[res]?.base ?? 0) > 0;
    if (state.buildings.some(b => makes(b.type))) return null;
    return BUILDABLE_TYPES.find(t => makes(t) && isBuildingUnlocked(state, t)) ?? null;
  }

  /** The start button: starts, or says exactly what is missing and (when a room would make it) takes the player there. */
  private startButton(state: GameState, def: ResearchDef): HTMLElement {
    const rs = this.engine.researchSystem;
    const busy = !!rs.activeId(state);
    const full = busy && rs.queue(state).length >= rs.queueSlots(state);
    const label = busy ? i18n.t('research.addToQueue') : i18n.t('research.start');
    const variant = busy ? 'secondary' : 'primary';
    if (full) return kButton({ variant, label: i18n.t('research.queueFull'), disabledReason: i18n.t('ux2d.research.queueFullWhy'), onPress: () => {} });
    const cost = def.cost as Record<string, number>;
    const short = missingList(state, cost);
    if (short.length) {
      const first = short[0];
      const room = this.producerFor(state, first.resource);
      if (room) {
        const text = i18n.t('ux2d.research.needRoom', {
          n: fmtCost(first.need), icon: RESOURCE_ICONS[first.resource] ?? '', name: i18n.t(`resources.${first.resource}`),
          room: getDef(room)?.name[i18n.currentLocale] ?? room,
        });
        if (this.onGo) {
          return kButton({ variant: 'secondary', className: 'btn-secondary research-route', label: `${text} ${flowArrow()}`, onPress: () => this.onGo?.({ kind: 'build', type: room }) });
        }
        return kButton({ variant, label, disabledReason: text, detail: el('span', 'research-why', text), onPress: () => {} });
      }
      const why = describeMissing(state, cost);
      return kButton({ variant, label, disabledReason: why, detail: el('span', 'research-why', why), onPress: () => {} });
    }
    return kButton({ variant, label, disabledReason: rs.canStart(state, def.id) ? null : '', onPress: () => this.start(def.id) });
  }

  /** One node; `level` is set for repeatable refinements (levels already done). */
  private renderCard(state: GameState, def: ResearchDef, level: number | null): HTMLElement {
    const rs = this.engine.researchSystem;
    const status = rs.status(state, def.id);
    const card = el('div', `research-card ${status}`);
    card.dataset.research = def.id;
    const top = el('div', 'bp-row');
    top.append(
      el('span', 'research-name', `${def.icon} ${this.name(def)}`),
      el('span', 'tier-chip', level === null ? i18n.t('wp6.research.tier', { n: def.tier }) : i18n.t('research.level', { n: level })), // [ux-wp6] no Latin "T3" in Hebrew
    );
    card.append(top, el('div', 'build-item-desc', def.desc[i18n.currentLocale] ?? def.desc.en));
    // [P3] Doctrine forks and Eureka. Only nodes that are open reach a card, so the Doctrine line (which names Genesis) waits for them.
    if (def.fork) card.appendChild(el('div', 'bp-hint doctrine-tag', `[[flag]] ${i18n.t('research.doctrine')}`));
    if (def.eureka && status !== 'done') {
      const got = rs.eureka(state, def);
      card.appendChild(el('div', `bp-hint ${got ? 'eureka-on' : ''}`, `[[sparkle]] ${i18n.t(got ? 'research.eurekaOn' : `research.eureka.${def.eureka.kind}`, { n: def.eureka.n })}`));
    }

    if (status === 'done') {
      card.appendChild(el('div', 'research-done', `[[check]] ${i18n.t('research.done')}`));
    } else if (status === 'active') {
      card.appendChild(el('div', 'research-done active', `[[hourglass]] ${i18n.t('research.inProgress')}`));
    } else if (status === 'queued') {
      const pos = rs.queue(state).indexOf(def.id) + 1;
      card.appendChild(el('div', 'research-done active', `[[clock]] ${i18n.t('research.queued', { n: pos })}`));
    } else {
      const meta = el('div', 'bp-upgrade-info');
      meta.append(costRow(state, def.cost as Record<string, number>), el('span', 'bp-hint', `[[clock]] ${i18n.formatDuration(def.time / rs.speed(state))}`));
      card.appendChild(meta);
      const pending = new Set([rs.activeId(state), ...rs.queue(state)]);
      const missing = def.requires.filter(r => !state.research[r]?.completed && !pending.has(r));
      const block = rs.blockReason(state, def.id);
      if (block === 'act') {
        card.appendChild(el('div', 'bp-hint', `[[lock]] ${i18n.t('research.actLock', { n: def.act ?? 0 })}`));
      } else if (block === 'fork') {
        const other = rs.forkTaken(state, def.id);
        card.appendChild(el('div', 'bp-hint', `[[lock]] ${i18n.t('research.forkClosed', { name: other ? this.name(other) : '' })}`));
      } else if (missing.length > 0) {
        const names = missing.map(r => { const d = rs.defOf(state, r); return d ? this.name(d) : r; }).join(', ');
        card.appendChild(el('div', 'bp-hint', `[[lock]] ${i18n.t('research.requires', { list: names })}`));
      } else {
        card.appendChild(this.startButton(state, def));
      }
    }
    return card;
  }
}

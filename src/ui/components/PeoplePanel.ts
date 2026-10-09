import type { BuildingInstance, BuildingType, GameState, SurvivorState } from '../../core/GameState';
import { floorTag } from '../floorTag'; // plan4:ST-16
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { crewCount, getDef, traitBonus } from '../../data/buildingDefs';
import { childCapacityOf } from '../../data/roomEffects'; // [plan4:BL-4]
import { MORALE_KINDS, STAT_KEYS, xpForNextLevel } from '../../systems/PopulationSystem';
import { Sheet } from './Sheet';
import { genderOf, portraitFor, portraitUrl } from '../../data/portraits';
import { enhanceTabs } from '../a11yDom';
import { BUILDING_ICONS, STAT_ICONS, bar, button, el, localizedTrait, setBar, setRich } from '../dom';
import { uiSound } from '../../audio/uiSound';
import { MAX_RANK, SPECS, rankOf, rankProgress, trainingCost } from '../../data/mastery'; // [LateGame B3]
import { RESOURCE_ICONS } from '../dom';
import { flowArrow } from '../rtl'; // [plan4:UX-22]
import { jobRoom } from '../HUD'; // [ux-wp4] B4

interface Bars {
  health: HTMLElement;
  happiness: HTMLElement;
  xp: HTMLElement;
  /** [ux-wp4] M5: the rank bar moves with the person's mastery xp without a re-render. */
  rank: HTMLElement | null;
}

/** [ux-wp4] M5: compact rows or full cards, remembered on the device. */
const VIEW_KEY = 'lastbunker_people_view';
type PeopleView = 'rows' | 'cards';

/** [ux-wp4] B4: how well a survivor suits a room (its key stat, and a trait that fits the room counts as 20). */
function fitScore(s: SurvivorState, type: BuildingType): number {
  const stat = getDef(type)?.optimalStat;
  return (stat ? s.stats[stat] : 5) + traitBonus(s.traits, type) * 20;
}

/** [ux-wp4] B4: places a room still has for adults (a room being built for the first time takes nobody yet). */
function freePlaces(state: GameState, b: BuildingInstance): number {
  if (b.isConstructing && b.level <= 1) return 0;
  return Math.max(0, (getDef(b.type)?.maxWorkers ?? 0) - crewCount(state, b));
}

export class PeoplePanel {
  private sheet = new Sheet('people-sheet', 'people');
  private signature = '';
  private expandedId: string | null = null;
  private choosingFor: string | null = null;
  private bars = new Map<string, Bars>();
  /** [ux-wp4] M5: the level labels, updated in place (level-ups are frequent and must not rebuild the list). */
  private levels = new Map<string, { node: HTMLElement; level: number }>();
  private mode: 'list' | 'tree' = 'list';
  /** [ux-wp4] M5/D5: compact rows, filters and a search. */
  private view: PeopleView | null = null;
  private filter: 'all' | 'idle' = 'all';
  private roomFilter = '';
  private floorFilter = -1;
  private query = '';
  private tools = el('div', 'pp-tools');
  private search = document.createElement('input');
  private roomSel = document.createElement('select');
  private floorSel = document.createElement('select');
  private selSig = '';
  /** [ux-wp4] B4: what the last "Assign" tap did (shown once under the button). */
  private assignedNote = '';

  private engine: GameEngine;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.sheet.onClose = () => {
      this.expandedId = null;
      this.choosingFor = null;
      this.assignedNote = '';
    };
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === 'rows' || v === 'cards') this.view = v;
    } catch { /* the default applies */ }
    this.search.type = 'search';
    this.search.className = 'bm-search pp-search';
    this.search.autocomplete = 'off';
    this.search.enterKeyHint = 'search';
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.redraw();
    });
    this.roomSel.className = 'pp-select';
    this.roomSel.addEventListener('change', () => {
      this.roomFilter = this.roomSel.value;
      this.redraw();
    });
    this.floorSel.className = 'pp-select';
    this.floorSel.addEventListener('change', () => {
      this.floorFilter = Number(this.floorSel.value);
      this.redraw();
    });
  }

  private redraw(): void {
    this.signature = '';
    this.refresh(this.engine.stateManager.state);
  }

  show(focusId?: string): void {
    if (focusId) {
      this.expandedId = focusId;
      // A person asked for by name is shown whatever the filters said.
      this.filter = 'all';
      this.roomFilter = '';
      this.floorFilter = -1;
      this.query = '';
      this.search.value = '';
      this.mode = 'list';
    }
    this.signature = '';
    this.refresh(this.engine.stateManager.state);
    this.sheet.show();
    if (focusId) requestAnimationFrame(() => this.sheet.body.querySelector(`[data-sid="${focusId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  private currentView(state: GameState): PeopleView {
    return this.view ?? (state.survivors.length > 12 ? 'rows' : 'cards');
  }

  refresh(state: GameState): void {
    if (!this.sheet.isVisible && this.signature) return;
    const view = this.currentView(state);
    const listed = this.mode === 'list' && view === 'cards' ? this.filtered(state) : [];
    // [ux-wp4] M5: no mastery xp and no level in the signature (they change every few seconds for someone in a big bunker); both are
    // updated in place below. A rebuild happens when jobs, families, ranks or the filters change.
    const sig = [
      state.survivors.map(s => `${s.id}:${s.assignedBuildingId}:${s.partnerId ?? ''}:${s.child ? 1 : 0}:${rankOf(s)}:${s.spec ?? ''}:${s.isOnMission ? 1 : 0}`).join(','), this.mode,
      state.buildings.map(b => `${b.id}:${b.assignedSurvivorIds.length}:${b.isConstructing}`).join(','),
      this.expandedId, this.choosingFor, state.maxPopulation, view, this.filter, this.roomFilter, this.floorFilter, this.query, this.assignedNote,
      state.longGame?.meta.act ?? 1,
      this.expandedId ? JSON.stringify(this.engine.populationSystem.getMoraleFactors(state, state.survivors.find(s => s.id === this.expandedId) ?? state.survivors[0])) : '',
      // The training buttons of the cards on screen grey out and light up with what the bunker can pay.
      [...listed, ...state.survivors.filter(s => s.id === this.expandedId)].map(s => (this.engine.populationSystem.canTrain(state, this.engine.resourceSystem, s) ? 1 : 0)).join(''),
    ].join('|');
    if (sig !== this.signature) {
      this.signature = sig;
      this.render(state);
    }
    for (const s of state.survivors) {
      const b = this.bars.get(s.id);
      if (b) {
        setBar(b.health, s.health);
        setBar(b.happiness, s.happiness);
        setBar(b.xp, (s.xp / xpForNextLevel(s.level)) * 100);
        if (b.rank) {
          const [cur, span] = rankProgress(s);
          setBar(b.rank, rankOf(s) >= MAX_RANK ? 100 : (cur / span) * 100);
        }
      }
      const lv = this.levels.get(s.id);
      if (lv && lv.level !== s.level) {
        lv.level = s.level;
        setRich(lv.node, ` · ${i18n.t('people.level', { n: s.level })}`);
      }
    }
  }

  /** [ux-wp4] M5: the people the filters and the search let through, idle first, then workers, then children (as before). */
  private filtered(state: GameState): SurvivorState[] {
    const locale = i18n.currentLocale;
    const rank = (s: SurvivorState) => (s.child ? 2 : s.assignedBuildingId ? 1 : 0);
    const roomOf = (s: SurvivorState) => (s.assignedBuildingId ? state.buildings.find(b => b.id === s.assignedBuildingId) : undefined);
    return state.survivors.filter(s => {
      if (this.filter === 'idle' && (s.assignedBuildingId || s.child || s.isOnMission)) return false;
      if (this.roomFilter && roomOf(s)?.type !== this.roomFilter) return false;
      if (this.floorFilter >= 0 && roomOf(s)?.position.floor !== this.floorFilter) return false;
      if (this.query) {
        const job = roomOf(s);
        const hay = [this.engine.populationSystem.getLocalizedName(s, locale), s.name, job ? getDef(job.type)?.name[locale] ?? '' : '']
          .concat(s.traits.map(t => localizedTrait(t))).join(' ').toLowerCase();
        if (!hay.includes(this.query)) return false;
      }
      return true;
    }).sort((a, b) => rank(a) - rank(b));
  }

  private render(state: GameState): void {
    this.sheet.setTitle(`[[people]] ${i18n.t('people.title')} · ${state.survivors.length}/${state.maxPopulation}`);
    this.bars.clear();
    this.levels.clear();
    const tabs = el('div', 'tab-row');
    const families = this.engine.familySystem.families(state).length;
    for (const [key, label] of [['list', `[[people]] ${i18n.t('family.residents')}`], ['tree', `[[rings]] ${i18n.t('family.tree')}${families ? ` (${families})` : ''}`]] as const) {
      tabs.appendChild(button(label, `tab-btn ${this.mode === key ? 'active' : ''}`, () => {
        this.mode = key;
        this.refresh(this.engine.stateManager.state);
      }));
    }
    enhanceTabs(tabs, i18n.t('people.title'));
    if (this.mode === 'tree') {
      this.sheet.body.replaceChildren(tabs, this.renderTree(state));
      return;
    }
    const view = this.currentView(state);
    const head = this.renderJobsBar(state);
    this.renderTools(state, view);
    const list = el('div', `people-list${view === 'rows' ? ' rows' : ''}`);
    if (state.survivors.length === 0) list.appendChild(el('div', 'bp-hint center', i18n.t('people.empty')));
    const shown = this.filtered(state);
    if (state.survivors.length > 0 && shown.length === 0) list.appendChild(el('div', 'bp-hint center', i18n.t('wp4.noneMatch')));
    for (const s of shown) {
      if (view === 'rows' && this.expandedId !== s.id && this.choosingFor !== s.id) list.appendChild(this.renderRow(state, s));
      else list.appendChild(this.renderCard(state, s, view === 'rows'));
    }
    this.sheet.body.replaceChildren(tabs, head, this.tools, list);
  }

  /**
   * [ux-wp4] B4/P14: "Assign N idle" (fills free places, best fit first) when there is work for them; a grey line when there is none
   * (the badge in the nav is off then: it is a fact of the Act, not a task).
   */
  private renderJobsBar(state: GameState): HTMLElement {
    const box = el('div', 'pp-jobs');
    const { idle, free } = jobRoom(state);
    const n = Math.min(idle, free);
    if (n > 0) {
      box.appendChild(button(`[[worker]] ${i18n.t('wp4.assignIdle', { n })}`, 'btn-primary pp-assign', () => {
        const placed = this.assignIdle();
        uiSound(placed ? 'assign' : 'error');
        this.assignedNote = placed ? i18n.t('wp4.assignedN', { n: placed }) : i18n.t('wp4.assignedNone');
        this.engine.requestSave();
        this.redraw();
      }));
    } else if (idle > 0) {
      box.appendChild(el('div', 'pp-nojob', `[[worker]] ${i18n.t('wp4.noJobs', { n: idle })}`));
    }
    if (this.assignedNote) box.appendChild(el('div', 'bp-hint pp-note', `[[check]] ${this.assignedNote}`));
    return box;
  }

  /**
   * [ux-wp4] B4: puts every idle adult it can into a free place, best fit first: all (person, room) pairs are scored by the room's key stat
   * and a fitting trait, and taken from the best down while the person is still free and the room has room. Returns how many were placed.
   */
  assignIdle(): number {
    const sm = this.engine.stateManager;
    const ps = this.engine.populationSystem;
    const st = sm.state;
    const idle = st.survivors.filter(s => !s.assignedBuildingId && !s.isOnMission && !s.child);
    const left = new Map<string, number>();
    for (const b of st.buildings) {
      const n = freePlaces(st, b);
      if (n > 0 && ps.canAssign(st, b.id)) left.set(b.id, n);
    }
    const pairs: { s: string; b: string; score: number }[] = [];
    for (const s of idle) {
      for (const b of st.buildings) if (left.has(b.id)) pairs.push({ s: s.id, b: b.id, score: fitScore(s, b.type) });
    }
    pairs.sort((x, y) => y.score - x.score);
    const done = new Set<string>();
    let placed = 0;
    for (const p of pairs) {
      if (done.has(p.s) || (left.get(p.b) ?? 0) <= 0) continue;
      if (!ps.assignSurvivorToBuilding(sm, p.s, p.b)) { left.set(p.b, 0); continue; }
      done.add(p.s);
      left.set(p.b, (left.get(p.b) ?? 1) - 1);
      placed++;
    }
    return placed;
  }

  /** [ux-wp4] M5/D5: the search field, the idle filter, room and floor pickers, and the rows/cards switch. Built once, kept across renders. */
  private renderTools(state: GameState, view: PeopleView): void {
    const locale = i18n.currentLocale;
    this.search.placeholder = i18n.t('wp4.searchPeople');
    this.search.setAttribute('aria-label', i18n.t('wp4.searchPeople'));
    const idleN = state.survivors.filter(s => !s.assignedBuildingId && !s.child && !s.isOnMission).length;
    const chip = (on: boolean, label: string, onClick: () => void) => {
      const b = el('button', `bm-chip pp-chip${on ? ' active' : ''}`, label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => { uiSound('tab'); onClick(); });
      return b;
    };
    // The pickers list only what exists (room types with someone at work, floors with rooms); rebuilt only when that changes.
    const types = [...new Set(state.buildings.filter(b => (getDef(b.type)?.maxWorkers ?? 0) > 0 || childCapacityOf(b) > 0).map(b => b.type))];
    const floors = [...new Set(state.buildings.map(b => b.position.floor))].sort((a, b) => a - b);
    const sig = `${locale}|${types.join(',')}|${floors.join(',')}`;
    if (sig !== this.selSig) {
      this.selSig = sig;
      const opt = (v: string, label: string) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label;
        return o;
      };
      this.roomSel.replaceChildren(opt('', i18n.t('wp4.allRooms')), ...types.map(t => opt(t, getDef(t)?.name[locale] ?? t)));
      this.floorSel.replaceChildren(opt('-1', i18n.t('wp4.allFloors')), ...floors.map(f => opt(String(f), floorTag(f))));
      this.roomSel.setAttribute('aria-label', i18n.t('wp4.byRoom'));
      this.floorSel.setAttribute('aria-label', i18n.t('wp4.byFloor'));
    }
    if (!types.includes(this.roomFilter as BuildingType)) this.roomFilter = '';
    if (!floors.includes(this.floorFilter)) this.floorFilter = -1;
    this.roomSel.value = this.roomFilter;
    this.floorSel.value = String(this.floorFilter);
    const row1 = el('div', 'pp-row');
    row1.append(
      chip(this.filter === 'all', `${i18n.t('build.cat.all')} ${state.survivors.length}`, () => { this.filter = 'all'; this.redraw(); }),
      chip(this.filter === 'idle', `${i18n.t('wp4.idle')} ${idleN}`, () => { this.filter = 'idle'; this.redraw(); }),
      this.roomSel, this.floorSel,
    );
    const viewBtn = el('button', 'bm-toggle pp-view');
    viewBtn.type = 'button';
    viewBtn.append(el('span', '', view === 'rows' ? `[[menu]] ${i18n.t('wp4.viewCards')}` : `[[menu]] ${i18n.t('wp4.viewRows')}`));
    viewBtn.addEventListener('click', () => {
      this.view = view === 'rows' ? 'cards' : 'rows';
      try { localStorage.setItem(VIEW_KEY, this.view); } catch { /* not remembered */ }
      uiSound('switch');
      this.redraw();
    });
    const row2 = el('div', 'pp-row');
    row2.append(this.search, viewBtn);
    this.tools.replaceChildren(row1, row2);
  }

  /** [ux-wp4] M5: one compact line per person (face, name and level, job, best stat); a tap opens the full card in place. */
  private renderRow(state: GameState, s: SurvivorState): HTMLElement {
    const locale = i18n.currentLocale;
    const job = s.assignedBuildingId ? state.buildings.find(b => b.id === s.assignedBuildingId) : undefined;
    const row = el('button', `person-row${!s.assignedBuildingId && !s.child && !s.isOnMission ? ' idle' : ''}`);
    row.type = 'button';
    row.dataset.sid = s.id;
    const face = el('img', 'worker-face');
    face.src = portraitUrl(portraitFor(s));
    face.alt = '';
    face.loading = 'lazy';
    const name = el('span', 'pr-name', this.engine.populationSystem.getLocalizedName(s, locale));
    const lv = el('span', 'worker-level', ` · ${i18n.t('people.level', { n: s.level })}`);
    this.levels.set(s.id, { node: lv, level: s.level });
    name.appendChild(lv);
    const jobText = s.isOnMission ? `[[backpack]] ${i18n.t('wp4.onMission')}` : this.jobLabel(state, s);
    const best = STAT_KEYS.reduce((a, k) => (s.stats[k] > s.stats[a] ? k : a), STAT_KEYS[0]);
    const stat = el('span', 'pr-stat', `${STAT_ICONS[best]} ${s.stats[best]}`);
    stat.title = i18n.t(`stats.${best}`);
    const main = el('span', 'pr-main');
    main.append(name, el('span', `pr-job${job || s.child || s.isOnMission || s.assignedBuildingId ? '' : ' warn'}`, jobText));
    row.append(face, main, stat);
    row.setAttribute('aria-expanded', 'false');
    row.addEventListener('click', () => {
      uiSound('click');
      this.expandedId = s.id;
      this.refresh(this.engine.stateManager.state);
    });
    return row;
  }

  /** Family tree: founding couples at the top, each child under its parents, grandchildren under them. */
  private renderTree(state: GameState): HTMLElement {
    const fs = this.engine.familySystem;
    const fams = fs.families(state);
    const wrap = el('div', 'family-tree');
    if (fams.length === 0) {
      wrap.appendChild(el('div', 'bp-hint center', i18n.t('family.none')));
      return wrap;
    }
    const ids = new Set(state.survivors.map(s => s.id));
    const isRoot = (f: { parents: SurvivorState[] }) => f.parents.every(p => !(p.parentIds ?? []).some(id => ids.has(id)));
    const drawn = new Set<string>();
    const node = (s: SurvivorState): HTMLElement => {
      const n = el('div', `tree-node ${s.child ? 'child' : ''}`);
      const img = el('img', 'tree-face');
      img.src = portraitUrl(portraitFor(s));
      img.alt = '';
      n.append(img, el('div', 'tree-name', this.engine.populationSystem.getLocalizedName(s, i18n.currentLocale)));
      if (s.child) {
        const pct = Math.round(fs.growthOf(state, s) * 100);
        n.appendChild(el('div', 'tree-age', `[[baby]] ${pct}%`));
      }
      n.addEventListener('click', () => {
        this.mode = 'list';
        this.expandedId = s.id;
        this.show(s.id);
      });
      return n;
    };
    const family = (f: { parents: SurvivorState[]; children: SurvivorState[] }): HTMLElement => {
      f.parents.forEach(p => drawn.add(p.id));
      const box = el('div', 'tree-family');
      const couple = el('div', 'tree-couple');
      f.parents.forEach((p, i) => {
        if (i > 0) couple.appendChild(el('span', 'tree-heart', '[[heart]]'));
        couple.appendChild(node(p));
      });
      box.appendChild(couple);
      if (f.children.length) {
        const kids = el('div', 'tree-children');
        for (const c of f.children) {
          const own = fams.find(x => x !== f && x.parents.some(p => p.id === c.id));
          kids.appendChild(own && !drawn.has(c.id) ? family(own) : node(c));
        }
        box.appendChild(kids);
      }
      return box;
    };
    for (const f of fams.filter(isRoot)) wrap.appendChild(family(f));
    for (const f of fams) if (!f.parents.some(p => drawn.has(p.id))) wrap.appendChild(family(f));
    return wrap;
  }

  /** [ux-wp4] P8: the room types this person suits best among the rooms the bunker has (rooms with a free place first). */
  private fitFor(state: GameState, s: SurvivorState): string[] {
    const seen = new Map<BuildingType, { score: number; free: boolean }>();
    for (const b of state.buildings) {
      if ((getDef(b.type)?.maxWorkers ?? 0) === 0) continue;
      const free = freePlaces(state, b) > 0;
      const cur = seen.get(b.type);
      if (!cur) seen.set(b.type, { score: fitScore(s, b.type), free });
      else if (free) cur.free = true;
    }
    const locale = i18n.currentLocale;
    return [...seen.entries()].sort((a, b) => Number(b[1].free) - Number(a[1].free) || b[1].score - a[1].score)
      .slice(0, 2).map(([t]) => `${BUILDING_ICONS[t] ?? ''} ${getDef(t)?.name[locale] ?? t}`);
  }

  private renderCard(state: GameState, s: SurvivorState, collapsible = false): HTMLElement {
    const locale = i18n.currentLocale;
    const card = el('div', `person-card ${s.assignedBuildingId ? '' : 'idle'}${collapsible ? ' open' : ''}`);
    card.dataset.sid = s.id;

    const head = el('div', 'person-head');
    const portrait = el('img', 'person-portrait');
    portrait.src = portraitUrl(portraitFor(s));
    portrait.alt = '';
    portrait.loading = 'lazy';
    head.appendChild(portrait);
    const name = el('div', 'person-name', this.engine.populationSystem.getLocalizedName(s, locale));
    const lv = el('span', 'worker-level', ` · ${i18n.t('people.level', { n: s.level })}`);
    this.levels.set(s.id, { node: lv, level: s.level });
    name.appendChild(lv);
    head.appendChild(name);
    const partner = s.partnerId ? state.survivors.find(p => p.id === s.partnerId) : undefined;
    if (partner) head.appendChild(el('span', 'family-chip', `[[heart]] ${this.engine.populationSystem.getLocalizedName(partner, locale)}`));
    if (s.child) head.appendChild(el('span', 'family-chip child', `[[baby]] ${i18n.t('family.child', { n: Math.round(this.engine.familySystem.growthOf(state, s) * 100), g: genderOf(s) })}`));
    const traits = el('div', 'trait-list');
    for (const t of s.traits) {
      const chip = el('span', 'trait-chip', localizedTrait(t, genderOf(s)));
      const desc = `traitDesc.${t}`;
      if (i18n.has(desc)) chip.title = i18n.t(desc, { g: genderOf(s) });
      traits.appendChild(chip);
    }
    head.appendChild(traits);
    if (collapsible) {
      // [ux-wp4] M5: an open card in the rows view folds back to its row.
      const fold = button('▴', 'btn-small btn-ghost pp-fold', () => {
        if (this.expandedId === s.id) this.expandedId = null;
        if (this.choosingFor === s.id) this.choosingFor = null;
        this.refresh(this.engine.stateManager.state);
      });
      fold.setAttribute('aria-label', i18n.t('wp4.fold'));
      head.appendChild(fold);
    }
    card.appendChild(head);

    const statsRow = el('div', 'stat-row');
    const job = s.assignedBuildingId ? state.buildings.find(b => b.id === s.assignedBuildingId) : undefined;
    const jobStat = job ? getDef(job.type)?.optimalStat : undefined;
    for (const k of STAT_KEYS) {
      // [ux-wp4] P8: each of the five numbers says what it is (a short word under the icon; the full name on hover and for a screen reader).
      const chip = el('span', `stat-chip ${k === jobStat ? 'active' : ''} ${s.stats[k] >= 8 ? 'high' : ''}`, `${STAT_ICONS[k]} ${s.stats[k]}`);
      chip.appendChild(el('span', 'stat-name', i18n.t(`wp4.stat.${k}`)));
      chip.title = i18n.t(`stats.${k}`);
      chip.setAttribute('aria-label', `${i18n.t(`stats.${k}`)} ${s.stats[k]}`);
      statsRow.appendChild(chip);
    }
    card.appendChild(statsRow);

    const bars: Bars = {
      health: bar(s.health, 'health'),
      happiness: bar(s.happiness, 'happiness'),
      xp: bar((s.xp / xpForNextLevel(s.level)) * 100, 'xp'),
      rank: null,
    };
    this.bars.set(s.id, bars);
    const barGrid = el('div', 'bar-grid');
    barGrid.append(
      el('span', 'bar-label', `[[heart]] ${i18n.t('people.health')}`), bars.health,
      el('span', 'bar-label', `[[happy]] ${i18n.t('people.happiness')}`), bars.happiness,
      el('span', 'bar-label', `[[star]] ${i18n.t('people.xp')}`), bars.xp,
    );
    card.appendChild(barGrid);

    // [LateGame B3] Mastery: rank 1-5 (+5% room output per rank), paid quick training, the rank-5 specialization.
    if (!s.child) {
      const rank = rankOf(s);
      const [cur, span] = rankProgress(s);
      const spec = SPECS.find(x => x.id === s.spec);
      const mastery = el('div', 'bar-grid');
      bars.rank = bar(rank >= MAX_RANK ? 100 : (cur / span) * 100, 'xp');
      mastery.append(
        el('span', 'bar-label', `[[medal]] ${i18n.t('mastery.rank', { n: rank })}${spec ? ` · ${spec.name[locale]}` : ''}`),
        bars.rank,
      );
      card.appendChild(mastery);
      const row = el('div', 'person-actions');
      if (rank < MAX_RANK) {
        const cost = trainingCost(s, state.longGame?.meta.act ?? 1);
        const label = Object.entries(cost).map(([r, v]) => `${RESOURCE_ICONS[r] ?? r}${v}`).join(' ');
        row.appendChild(button(`[[books]] ${i18n.t('mastery.train')} ${label}`, 'btn-small', () => {
          if (this.engine.populationSystem.train(this.engine.stateManager, this.engine.resourceSystem, s.id)) {
            uiSound('click');
            this.engine.requestSave();
            this.signature = '';
            this.refresh(this.engine.stateManager.state);
          }
        }, !this.engine.populationSystem.canTrain(state, this.engine.resourceSystem, s)));
      } else if (!s.spec) {
        for (const sp of SPECS) {
          const b2 = button(`${sp.icon} ${sp.name[locale]}`, 'btn-small', () => {
            this.engine.populationSystem.chooseSpec(this.engine.stateManager, s.id, sp.id);
            this.engine.requestSave();
            this.signature = '';
            this.refresh(this.engine.stateManager.state);
          });
          b2.title = sp.desc[locale];
          row.appendChild(b2);
        }
      }
      if (row.childNodes.length) card.appendChild(row);
    }

    const jobRow = el('div', 'person-job');
    const ruin = !job && s.assignedBuildingId ? state.ruins.find(r => r.id === s.assignedBuildingId) : undefined;
    // [plan4:BL-4] A child in a nursery or school shows its room; otherwise "too young", as before.
    jobRow.appendChild(el('span', job || ruin || s.child || s.assignedBuildingId?.startsWith('p_') ? '' : 'warn', this.jobLabel(state, s)));
    const actions = el('div', 'person-actions');
    actions.appendChild(button('?', 'btn-small btn-ghost', () => {
      this.expandedId = this.expandedId === s.id ? null : s.id;
      this.refresh(this.engine.stateManager.state);
    }));
    if (!s.child || state.buildings.some(b => !b.isConstructing && childCapacityOf(b) > 0)) { // [plan4:BL-4] children can be placed once a room takes them
      actions.appendChild(button(i18n.t('people.assign'), 'btn-small', () => {
        this.choosingFor = this.choosingFor === s.id ? null : s.id;
        this.refresh(this.engine.stateManager.state);
      }));
    }
    jobRow.appendChild(actions);
    card.appendChild(jobRow);
    // [ux-wp4] P8: "good fit for", next to Assign.
    if (!s.child) {
      const fit = this.fitFor(state, s);
      if (fit.length) card.appendChild(el('div', 'bp-hint pp-fit', `[[star]] ${i18n.t('wp4.fitFor', { list: fit.join(', ') })}`));
    }

    if (this.expandedId === s.id) card.appendChild(this.renderMorale(state, s));
    if (this.choosingFor === s.id) card.appendChild(this.renderJobChooser(state, s));
    return card;
  }

  /** What a person does, in one line (a room, a ruin, the dig crew, a project, nothing; a child too young for work). */
  private jobLabel(state: GameState, s: SurvivorState): string {
    const locale = i18n.currentLocale;
    const job = s.assignedBuildingId ? state.buildings.find(b => b.id === s.assignedBuildingId) : undefined;
    if (s.child && !job) return `[[baby]] ${i18n.t('family.tooYoung', { g: genderOf(s) })}`;
    if (job) return `${BUILDING_ICONS[job.type] ?? ''} ${getDef(job.type)?.name[locale] ?? ''}`;
    const ruin = s.assignedBuildingId ? state.ruins.find(r => r.id === s.assignedBuildingId) : undefined;
    if (ruin) return `[[pick]] ${i18n.t('ruin.duty', { n: ruin.floor + 1 })}`;
    if (s.assignedBuildingId === 'p_dig' || s.assignedBuildingId === 'p_dig2') return this.digDuty(state, s.assignedBuildingId === 'p_dig2' ? 1 : 0); // [Long game] [plan4:ST-3] two crews
    if (s.assignedBuildingId?.startsWith('p_')) return `[[build]] ${i18n.t('proj.duty')}`; // [LateGame B1]
    return `[[warning]] ${i18n.t('people.noJob')}`;
  }

  /** [plan4:ST-3] The job line of a dig crew member: a floor dig or a wing, in slot 0 or 1. */
  private digDuty(state: GameState, slot: number): string {
    const d = slot === 0 ? state.longGame?.dig : state.longGame?.dig2;
    const n = (d?.floor ?? 0) + 1;
    return `[[pick]] ${i18n.t(d?.kind === 'wing' ? 'wing.duty' : 'dig.duty', { n })}`;
  }

  private renderMorale(state: GameState, s: SurvivorState): HTMLElement {
    const box = el('div', 'morale-box');
    box.appendChild(el('div', 'bp-section-title', i18n.t('people.moraleWhy')));
    const factors = this.engine.populationSystem.getMoraleFactors(state, s);
    for (const f of factors) {
      const row = el('div', 'bp-row');
      row.append(
        el('span', '', i18n.t(`morale.${f.key}`, { g: genderOf(s) })),
        // [ux-wp4] I1: a real minus sign, which the signed-number isolate keeps in front of the number in Hebrew.
        el('span', `bp-value ${f.value >= 0 ? 'positive' : 'negative'}`, f.key === 'base' ? String(f.value) : `${f.value > 0 ? '+' : f.value < 0 ? '−' : ''}${Math.abs(f.value)}`),
      );
      box.appendChild(row);
    }
    const target = Math.round(this.engine.populationSystem.getTargetHappiness(state, s));
    const total = el('div', 'bp-row total');
    total.append(el('span', '', flowArrow()), el('span', 'bp-value', `${target}%`)); // [plan4:UX-22]
    box.appendChild(total);
    box.appendChild(this.renderMoraleSources(state));
    return box;
  }

  /** [plan4:BL-3] "Morale sources": what each channel gives (against its ceiling) and which rooms feed it. Empty when no room gives morale. */
  private renderMoraleSources(state: GameState): HTMLElement {
    const box = el('div', 'morale-sources');
    const m = this.engine.populationSystem.getMoraleSources(state);
    if (m.sources.length === 0) return box;
    const locale = i18n.currentLocale;
    box.appendChild(el('div', 'bp-section-title', i18n.t('morale.sources')));
    for (const kind of MORALE_KINDS) {
      const ch = m.channels[kind];
      const rows = m.sources.filter(x => x.kind === kind);
      if (rows.length === 0) continue;
      const head = el('div', 'bp-row');
      head.append(el('span', '', i18n.t(`morale.channel.${kind}`)), el('span', 'bp-value', `${Math.round(ch.value)}/${ch.cap}`));
      box.appendChild(head);
      for (const r of rows) {
        const name = getDef(r.type)?.name[locale] ?? r.type;
        const row = el('div', 'bp-row');
        row.append(el('span', 'bp-hint', `${BUILDING_ICONS[r.type] ?? ''} ${i18n.t('morale.sourceRow', { name, n: r.count })}`), el('span', 'bp-value positive', `+${r.value.toFixed(1)}`));
        box.appendChild(row);
      }
    }
    return box;
  }

  private renderJobChooser(state: GameState, s: SurvivorState): HTMLElement {
    const locale = i18n.currentLocale;
    const box = el('div', 'job-chooser');
    box.appendChild(el('div', 'bp-section-title', i18n.t('people.chooseJob', { name: this.engine.populationSystem.getLocalizedName(s, locale) })));

    const assign = (buildingId: string | null) => {
      uiSound(buildingId ? 'assign' : 'unassign');
      this.engine.populationSystem.assignSurvivorToBuilding(this.engine.stateManager, s.id, buildingId);
      this.engine.requestSave();
      this.choosingFor = null;
      this.refresh(this.engine.stateManager.state);
    };

    // [ux-wp4] B4: the room they are in first, then rooms with a free place (best fit first), full rooms last.
    const rows: { b: BuildingInstance; full: boolean; score: number; label: string }[] = [];
    for (const b of state.buildings) {
      const def = getDef(b.type);
      if (!def || (def.maxWorkers === 0 && !s.child)) continue;
      // [plan4:BL-4] Children pick rooms with childCapacity (a separate count); adults count only adults.
      if (s.child ? childCapacityOf(b) <= 0 || b.isConstructing : false) continue;
      const kids = b.assignedSurvivorIds.length - crewCount(state, b);
      const used = s.child ? kids : crewCount(state, b);
      const cap = s.child ? childCapacityOf(b, state) : def.maxWorkers; // plan4:BL-1 counts the school-by-nursery bonus
      const full = used >= cap && !b.assignedSurvivorIds.includes(s.id);
      const statVal = def.optimalStat ? `${STAT_ICONS[def.optimalStat]} ${s.stats[def.optimalStat]}` : '';
      const star = traitBonus(s.traits, b.type) > 0 ? ' [[star]]' : '';
      const label = `${floorTag(b.position.floor)} · ${BUILDING_ICONS[b.type] ?? ''} ${def.name[locale] ?? def.name.en} (${used}/${cap}) ${statVal}${star}`;
      rows.push({ b, full, score: fitScore(s, b.type), label });
    }
    const cur = (r: { b: BuildingInstance }) => (r.b.id === s.assignedBuildingId ? 1 : 0);
    rows.sort((a, c) => cur(c) - cur(a) || Number(a.full) - Number(c.full) || c.score - a.score);
    for (const r of rows) {
      const btn = button(r.full ? `${r.label} · ${i18n.t('people.full')}` : r.label, `btn-job ${r.b.id === s.assignedBuildingId ? 'current' : ''}`, () => assign(r.b.id), r.full);
      box.appendChild(btn);
    }
    if (s.assignedBuildingId) box.appendChild(button(i18n.t('people.noJob'), 'btn-job btn-ghost', () => assign(null)));
    return box;
  }
}

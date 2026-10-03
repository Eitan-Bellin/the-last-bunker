import type { GameState, SurvivorState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { getDef, traitBonus } from '../../data/buildingDefs';
import { STAT_KEYS, xpForNextLevel } from '../../systems/PopulationSystem';
import { Sheet } from './Sheet';
import { portraitFor, portraitUrl } from '../../data/portraits';
import { BUILDING_ICONS, STAT_ICONS, bar, button, el, localizedTrait, setBar } from '../dom';
import { uiSound } from '../../audio/uiSound';
import { MAX_RANK, SPECS, rankOf, rankProgress, trainingCost } from '../../data/mastery'; // [LateGame B3]
import { RESOURCE_ICONS } from '../dom';

interface Bars {
  health: HTMLElement;
  happiness: HTMLElement;
  xp: HTMLElement;
}

export class PeoplePanel {
  private sheet = new Sheet('people-sheet');
  private signature = '';
  private expandedId: string | null = null;
  private choosingFor: string | null = null;
  private bars = new Map<string, Bars>();
  private mode: 'list' | 'tree' = 'list';

  private engine: GameEngine;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.sheet.onClose = () => {
      this.expandedId = null;
      this.choosingFor = null;
    };
  }

  show(focusId?: string): void {
    if (focusId) this.expandedId = focusId;
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

  refresh(state: GameState): void {
    if (!this.sheet.isVisible && this.signature) return;
    const sig = [
      state.survivors.map(s => `${s.id}:${s.assignedBuildingId}:${s.level}:${s.partnerId ?? ''}:${s.child ? 1 : 0}:${rankOf(s)}:${s.spec ?? ''}:${Math.floor((s.mxp ?? 0) / 900)}`).join(','), this.mode,
      state.buildings.map(b => `${b.id}:${b.assignedSurvivorIds.length}:${b.isConstructing}`).join(','),
      this.expandedId, this.choosingFor, state.maxPopulation,
      this.expandedId ? JSON.stringify(this.engine.populationSystem.getMoraleFactors(state, state.survivors.find(s => s.id === this.expandedId) ?? state.survivors[0])) : '',
    ].join('|');
    if (sig !== this.signature) {
      this.signature = sig;
      this.render(state);
    }
    for (const s of state.survivors) {
      const b = this.bars.get(s.id);
      if (!b) continue;
      setBar(b.health, s.health);
      setBar(b.happiness, s.happiness);
      setBar(b.xp, (s.xp / xpForNextLevel(s.level)) * 100);
    }
  }

  private render(state: GameState): void {
    this.sheet.setTitle(`[[people]] ${i18n.t('people.title')} · ${state.survivors.length}/${state.maxPopulation}`);
    this.bars.clear();
    const tabs = el('div', 'tab-row');
    const families = this.engine.familySystem.families(state).length;
    for (const [key, label] of [['list', `[[people]] ${i18n.t('family.residents')}`], ['tree', `[[rings]] ${i18n.t('family.tree')}${families ? ` (${families})` : ''}`]] as const) {
      tabs.appendChild(button(label, `tab-btn ${this.mode === key ? 'active' : ''}`, () => {
        this.mode = key;
        this.refresh(this.engine.stateManager.state);
      }));
    }
    if (this.mode === 'tree') {
      this.sheet.body.replaceChildren(tabs, this.renderTree(state));
      return;
    }
    const list = el('div', 'people-list');
    if (state.survivors.length === 0) list.appendChild(el('div', 'bp-hint center', i18n.t('people.empty')));

    const rank = (s: SurvivorState) => (s.child ? 2 : s.assignedBuildingId ? 1 : 0);
    const sorted = [...state.survivors].sort((a, b) => rank(a) - rank(b));
    for (const s of sorted) list.appendChild(this.renderCard(state, s));
    this.sheet.body.replaceChildren(tabs, list);
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

  private renderCard(state: GameState, s: SurvivorState): HTMLElement {
    const locale = i18n.currentLocale;
    const card = el('div', `person-card ${s.assignedBuildingId ? '' : 'idle'}`);
    card.dataset.sid = s.id;

    const head = el('div', 'person-head');
    const portrait = el('img', 'person-portrait');
    portrait.src = portraitUrl(portraitFor(s));
    portrait.alt = '';
    portrait.loading = 'lazy';
    head.appendChild(portrait);
    const name = el('div', 'person-name', this.engine.populationSystem.getLocalizedName(s, locale));
    name.appendChild(el('span', 'worker-level', ` · ${i18n.t('people.level', { n: s.level })}`));
    head.appendChild(name);
    const partner = s.partnerId ? state.survivors.find(p => p.id === s.partnerId) : undefined;
    if (partner) head.appendChild(el('span', 'family-chip', `[[heart]] ${this.engine.populationSystem.getLocalizedName(partner, locale)}`));
    if (s.child) head.appendChild(el('span', 'family-chip child', `[[baby]] ${i18n.t('family.child', { n: Math.round(this.engine.familySystem.growthOf(state, s) * 100) })}`));
    const traits = el('div', 'trait-list');
    for (const t of s.traits) {
      const chip = el('span', 'trait-chip', localizedTrait(t));
      const desc = `traitDesc.${t}`;
      if (i18n.has(desc)) chip.title = i18n.t(desc);
      traits.appendChild(chip);
    }
    head.appendChild(traits);
    card.appendChild(head);

    const statsRow = el('div', 'stat-row');
    const job = s.assignedBuildingId ? state.buildings.find(b => b.id === s.assignedBuildingId) : undefined;
    const jobStat = job ? getDef(job.type)?.optimalStat : undefined;
    for (const k of STAT_KEYS) {
      const chip = el('span', `stat-chip ${k === jobStat ? 'active' : ''} ${s.stats[k] >= 8 ? 'high' : ''}`, `${STAT_ICONS[k]} ${s.stats[k]}`);
      chip.title = i18n.t(`stats.${k}`);
      statsRow.appendChild(chip);
    }
    card.appendChild(statsRow);

    const bars: Bars = {
      health: bar(s.health, 'health'),
      happiness: bar(s.happiness, 'happiness'),
      xp: bar((s.xp / xpForNextLevel(s.level)) * 100, 'xp'),
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
      mastery.append(
        el('span', 'bar-label', `[[medal]] ${i18n.t('mastery.rank', { n: rank })}${spec ? ` · ${spec.name[locale]}` : ''}`),
        bar(rank >= MAX_RANK ? 100 : (cur / span) * 100, 'xp'),
      );
      card.appendChild(mastery);
      const row = el('div', 'person-actions');
      if (rank < MAX_RANK) {
        const cost = trainingCost(s);
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
    const jobName = job ? `${BUILDING_ICONS[job.type] ?? ''} ${getDef(job.type)?.name[locale] ?? ''}`
      : ruin ? `[[pick]] ${i18n.t('ruin.duty', { n: ruin.floor + 1 })}`
        : s.assignedBuildingId?.startsWith('p_') ? `[[build]] ${i18n.t('proj.duty')}` // [LateGame B1]
        : `[[warning]] ${i18n.t('people.noJob')}`;
    jobRow.appendChild(el('span', job || ruin || s.child || s.assignedBuildingId?.startsWith('p_') ? '' : 'warn', s.child ? `[[baby]] ${i18n.t('family.tooYoung')}` : jobName));
    const actions = el('div', 'person-actions');
    actions.appendChild(button('?', 'btn-small btn-ghost', () => {
      this.expandedId = this.expandedId === s.id ? null : s.id;
      this.refresh(this.engine.stateManager.state);
    }));
    if (!s.child) {
      actions.appendChild(button(i18n.t('people.assign'), 'btn-small', () => {
        this.choosingFor = this.choosingFor === s.id ? null : s.id;
        this.refresh(this.engine.stateManager.state);
      }));
    }
    jobRow.appendChild(actions);
    card.appendChild(jobRow);

    if (this.expandedId === s.id) card.appendChild(this.renderMorale(state, s));
    if (this.choosingFor === s.id) card.appendChild(this.renderJobChooser(state, s));
    return card;
  }

  private renderMorale(state: GameState, s: SurvivorState): HTMLElement {
    const box = el('div', 'morale-box');
    box.appendChild(el('div', 'bp-section-title', i18n.t('people.moraleWhy')));
    const factors = this.engine.populationSystem.getMoraleFactors(state, s);
    for (const f of factors) {
      const row = el('div', 'bp-row');
      row.append(
        el('span', '', i18n.t(`morale.${f.key}`)),
        el('span', `bp-value ${f.value >= 0 ? 'positive' : 'negative'}`, f.key === 'base' ? String(f.value) : `${f.value > 0 ? '+' : ''}${f.value}`),
      );
      box.appendChild(row);
    }
    const target = Math.round(this.engine.populationSystem.getTargetHappiness(state, s));
    const total = el('div', 'bp-row total');
    total.append(el('span', '', '→'), el('span', 'bp-value', `${target}%`));
    box.appendChild(total);
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

    for (const b of state.buildings) {
      const def = getDef(b.type);
      if (!def || def.maxWorkers === 0) continue;
      const full = b.assignedSurvivorIds.length >= def.maxWorkers && !b.assignedSurvivorIds.includes(s.id);
      const statVal = def.optimalStat ? `${STAT_ICONS[def.optimalStat]} ${s.stats[def.optimalStat]}` : '';
      const star = traitBonus(s.traits, b.type) > 0 ? ' [[star]]' : '';
      const label = `B${b.position.floor + 1} · ${BUILDING_ICONS[b.type] ?? ''} ${def.name[locale] ?? def.name.en} (${b.assignedSurvivorIds.length}/${def.maxWorkers}) ${statVal}${star}`;
      const btn = button(full ? `${label} · ${i18n.t('people.full')}` : label, `btn-job ${b.id === s.assignedBuildingId ? 'current' : ''}`, () => assign(b.id), full);
      box.appendChild(btn);
    }
    if (s.assignedBuildingId) box.appendChild(button(i18n.t('people.noJob'), 'btn-job btn-ghost', () => assign(null)));
    return box;
  }
}

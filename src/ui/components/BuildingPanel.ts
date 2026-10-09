import type { BuildingInstance, GameState, ResourceType, SurvivorState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { getDef, effectiveLevel, workforceMultiplier, traitBonus, compoundNeighbors, synergyOf, isDistrict, shapeFactor, type BuildingDef } from '../../data/buildingDefs';
import { roomEffect, childCapacityOf } from '../../data/roomEffects'; // [plan4:BL-15..32]
import { Sheet } from './Sheet';
import { genderOf, portraitFor, portraitUrl } from '../../data/portraits';
import { bunkerDefense } from '../../systems/EventSystem';
import { BUILDING_ICONS, RESOURCE_ICONS, STAT_ICONS, bar, bidiNumbers, button, costRow, el, rateText, setBar, setRich } from '../dom';
import { flowArrow } from '../rtl'; // [ux-wp4] B3 "Next" points along the reading direction
import { INCIDENTS, quickFixCost } from '../../data/incidents';
import { boostReserve, chainInputs, inputFed, inputRate } from '../../data/chains';
import { roomPowerDraw } from '../../systems/ResourceSystem';
import { bedsBuilt } from '../../systems/BuildingSystem';
import { MORALE_CAPS } from '../../systems/PopulationSystem'; // [plan4:BL-39]
import { allowedFloors } from '../../data/zones';
import { RETOOL_SECONDS, specOf, specsFor } from '../../data/specializations';
import type { Incident } from '../../core/GameState';
import { uiSound } from '../../audio/uiSound';
import { maintenanceCard } from './MaintenanceCard'; // [Danger C3]
import { relocateBlock } from '../../systems/relocate'; // [plan4:ST-19]
import { infraCard, infraSignature } from './InfraCard'; // plan4:ST-14

export class BuildingPanel {
  private sheet = new Sheet('building-sheet', 'building');
  private buildingId: string | null = null;
  private pickerOpen = false;
  /** NICE2: the demolish button was pressed once and waits for a confirmation. */
  private demolishOpen = false;
  private signature = '';

  private statusText: HTMLElement | null = null;
  private statusBar: HTMLElement | null = null;
  private outputValues = new Map<string, HTMLElement>();
  private efficiencyEl: HTMLElement | null = null;

  onUpgrade: ((buildingId: string) => void) | null = null;
  /** [ux-wp4] B3: opens another room's panel in place (the "Next" button of the upgrade bar). */
  onOpenRoom: ((buildingId: string) => void) | null = null;
  /** [ux-wp4] B3: rooms already visited with "Next" since the sheet opened, so the button walks the list instead of bouncing between two. */
  private visited = new Set<string>();
  onMove: ((buildingId: string) => void) | null = null; // [plan4:ST-19] "Move": starts the relocate flow (WorldController.beginRelocate)
  onClose: (() => void) | null = null;
  onIncidentTap: ((incidentId: string) => void) | null = null;
  onQuickFix: ((incidentId: string) => void) | null = null;
  onSpecialize: ((buildingId: string, specId: string) => void) | null = null;
  /** [Long game] Change a specialized room's role. */
  onRetool: ((buildingId: string, specId: string) => void) | null = null;
  private incidentBar: HTMLElement | null = null;
  private incidentSev: HTMLElement | null = null;

  private engine: GameEngine;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.sheet.onClose = () => {
      this.buildingId = null;
      this.pickerOpen = false;
      this.visited.clear();
      this.onClose?.();
    };
  }

  show(buildingId: string): void {
    this.buildingId = buildingId;
    this.pickerOpen = false;
    this.demolishOpen = false;
    this.signature = '';
    this.refresh(this.engine.stateManager.state);
    this.sheet.show();
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  refresh(state: GameState): void {
    if (!this.buildingId) return;
    const b = state.buildings.find(x => x.id === this.buildingId);
    if (!b) {
      this.hide();
      return;
    }

    const upgradeAffordable = this.engine.resourceSystem.canAfford(state, this.engine.buildingSystem.getUpgradeCost(b));
    this.nextId = this.nextUpgrade(state, b.id);
    const sig = [
      this.nextId ?? '',
      b.level, b.isConstructing, state.rush ?? 0, b.assignedSurvivorIds.join(','), this.pickerOpen, upgradeAffordable,
      state.survivors.map(s => `${s.id}:${s.assignedBuildingId}:${s.level}`).join(','),
      state.powerRatio < 0.99,
      infraSignature(state, b), // plan4:ST-14
      this.incidentFor(state, b)?.id ?? '', b.specialization ?? '', Math.floor((b.wear ?? 0) / 5), this.engine.maintenanceSystem.canMaintain(state, b), // [Danger C3]

      chainInputs(b).map(i => inputFed(state, i)).join(','),
      this.engine.buildingSystem.canSpecialize(state, b.id),
      state.longGame?.meta.act ?? 0, Math.ceil(Math.max(0, (b.retoolUntil ?? 0) - (state.longGame?.meta.worldT ?? 0)) / 60), // [Long game]
      this.engine.resourceSystem.canAfford(state, this.engine.buildingSystem.specCost()),
      this.demolishOpen, this.engine.buildingSystem.demolishBlock(state, b.id), state.maxPopulation,
      Object.values(state.resources).map(r => Math.floor(r.cap)).join(','), state.buildings.length, state.currentFloors,
    ].join('|');

    if (sig !== this.signature) {
      this.signature = sig;
      this.render(state, b, upgradeAffordable);
    }
    this.updateDynamic(state, b);
  }

  private render(state: GameState, b: BuildingInstance, upgradeAffordable: boolean): void {
    const def = getDef(b.type)!;
    const locale = i18n.currentLocale;
    this.sheet.setTitle(`${BUILDING_ICONS[b.type] ?? ''} ${def.name[locale] ?? def.name.en} · ${i18n.t('building.level', { n: b.level })}`);
    this.outputValues.clear();

    const root = el('div', 'bp');

    const status = el('div', 'bp-status');
    this.statusText = el('div', 'bp-status-text');
    this.statusBar = bar(0, 'accent');
    status.append(this.statusText, this.statusBar);
    // Rush: spend a gift charge to skip 15 minutes of this build or upgrade.
    if (b.isConstructing) {
      status.appendChild(button(`[[hourglass]] ${i18n.t('rush.button', { n: this.engine.rushSystem.count(state) })}`, 'btn-secondary btn-small', () => {
        if (this.engine.rushSystem.rushBuilding(b.id)) {
          uiSound('confirm');
          this.engine.requestSave();
        }
      }, !this.engine.rushSystem.canRushBuilding(state, b.id)));
    }
    status.style.display = b.isConstructing ? '' : 'none';
    // [ux-wp4] B3: the upgrade and "Next" sit in a bar pinned to the top of the sheet: upgrading several rooms is one tap each.
    root.appendChild(this.renderUpgradeBar(state, b, upgradeAffordable));
    root.appendChild(status);

    if (this.pickerOpen) {
      root.appendChild(this.renderPicker(state, b));
      this.sheet.body.replaceChildren(root);
      return;
    }

    const incident = this.incidentFor(state, b);
    this.incidentBar = null;
    if (incident) root.appendChild(this.renderIncident(state, incident));
    const spec = specOf(b);
    if (spec) {
      const card = el('div', 'bp-card spec-card chosen');
      card.append(el('div', 'spec-name', `[[${spec.icon}]] ${spec.name[locale]}`), el('div', 'spec-desc', spec.desc[locale]));
      root.appendChild(card);
    }

    const stats = el('div', 'bp-card');
    if (def.production) {
      for (const r of Object.keys(def.production)) {
        const row = el('div', 'bp-row');
        row.appendChild(el('span', '', `${RESOURCE_ICONS[r] ?? ''} ${i18n.t(`resources.${r}`)}`));
        const val = el('span', 'bp-value positive');
        this.outputValues.set(r, val);
        row.appendChild(val);
        stats.appendChild(row);
      }
    }
    if (def.maxWorkers > 0) {
      const row = el('div', 'bp-row');
      row.appendChild(el('span', '', i18n.t('building.efficiency')));
      this.efficiencyEl = el('span', 'bp-value');
      row.appendChild(this.efficiencyEl);
      stats.appendChild(row);
    } else {
      this.efficiencyEl = null;
    }
    const level = Math.max(1, effectiveLevel(b));
    if (def.effects?.maxPopulation) {
      const p = def.effects.maxPopulation;
      stats.appendChild(this.row(`[[quarters]] ${i18n.t('building.capacity')}`, String(p.base + p.perLevel * (level - 1))));
      // The Act's limit can leave beds unused: say so here, where the player upgrades for more.
      const built = bedsBuilt(state);
      if (built > state.maxPopulation) {
        stats.appendChild(el('div', 'bp-note warning', i18n.t('building.bedsCapped', { built, cap: state.maxPopulation })));
      }
    }
    if (def.effects?.morale) {
      const m = def.effects.morale;
      stats.appendChild(this.row(`[[happy]] ${i18n.t('building.morale')}`, `+${Math.round((m.base + m.perLevel * (level - 1)) * workforceMultiplier(state, b))}`));
      // [plan4:BL-39] Which of the three morale channels it feeds (each has its own ceiling).
      if (def.effects.moraleKind && def.effects.moraleKind !== 'base') {
        const cap = MORALE_CAPS[def.effects.moraleKind];
        stats.appendChild(this.row(`[[happy]] ${i18n.t('building.moraleChannel')}`, `${i18n.t(`morale.channel.${def.effects.moraleKind}`)} · max ${cap}`));
      }
    }
    if (def.effects?.storageCap) {
      const caps = Object.entries(def.effects.storageCap).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''}+${v * level}`).join('  ');
      stats.appendChild(this.row(`[[storage]] ${i18n.t('building.storage')}`, caps));
    }
    const compound = compoundNeighbors(state, b);
    if (compound > 0) stats.appendChild(this.row(`[[compound]] ${i18n.t('building.compound')}`, `+${compound * 10}%`));
    // [plan4:BL-39] Neighbour pairs (doc 2.5): who stands next door and what the pair gives.
    for (const link of synergyOf(state, b).links) {
      const nd = getDef(link.with);
      stats.appendChild(this.row(`[[compound]] ${i18n.t('building.synergyRow', { name: nd?.name[locale] ?? nd?.name.en ?? link.with })}`, `+${Math.round(link.value * 100)}% ${i18n.t(`synergy.effect.${link.effect}`)}`));
    }
    if (def.effects?.defense) {
      const d = def.effects.defense;
      stats.appendChild(this.row(`[[endurance]] ${i18n.t('building.defense')}`, `+${Math.round((d.base + d.perLevel * (level - 1)) * workforceMultiplier(state, b))} · ${i18n.t('building.totalDefense', { n: bunkerDefense(state) })}`));
    }
    for (const r of this.wave2Rows(state, b, def)) stats.appendChild(r); // [plan4:BL-15..32]
    if (b.type === 'radioTower') stats.appendChild(el('div', 'bp-hint', `[[radioTower]] ${i18n.t('building.radio')}`));
    if (b.type === 'trainingRoom') stats.appendChild(el('div', 'bp-hint', `[[trainingRoom]] ${i18n.t('building.training')}`));
    if (b.type === 'laboratory') {
      stats.appendChild(this.row(`[[research]] ${i18n.t('building.labSpeed')}`, `×${this.engine.researchSystem.speed(state).toFixed(2)}`));
    }
    if (def.powerConsumption > 0) {
      // S3: the draw grows with the room's level.
      const draw = roomPowerDraw(def.powerConsumption, level);
      stats.appendChild(this.row(`[[power]] ${i18n.t('build.powerUse')}`, `−${Number.isInteger(draw) ? draw : draw.toFixed(1)}`));
    }
    if (def.production && !def.production.power && state.powerRatio < 0.99) {
      stats.appendChild(el('div', 'bp-warning', `[[warning]] ${i18n.t('building.powerLow')}`));
    }
    for (const input of chainInputs(b)) {
      const fed = inputFed(state, input);
      // M1: fuel below the reserve is being saved for digs and research, not missing.
      const saving = input.boost && !fed && (state.resources[input.resource]?.amount ?? 0) > 0.5;
      const status = input.boost
        ? (fed ? i18n.t('chain.boosted') : saving ? i18n.t('chain.reserve', { n: Math.round(boostReserve(state, input)) }) : i18n.t('chain.noBoost'))
        : fed ? i18n.t('chain.fed') : i18n.t('chain.starved');
      const r = el('div', `bp-row chain-row ${fed ? 'ok' : input.boost ? '' : 'bad'}`);
      r.append(
        el('span', '', `[[recycle]] ${i18n.t(input.boost ? 'chain.fuel' : 'chain.input')} ${RESOURCE_ICONS[input.resource] ?? ''}`),
        el('span', 'bp-value', `−${inputRate(input, b).toFixed(2)} · ${status}`),
      );
      stats.appendChild(r);
    }
    // S2: B1 is full of homes: say where more beds come from.
    if (b.type === 'quarters' && bedsBuilt(state) <= state.maxPopulation && !allowedFloors('quarters', state.currentFloors).some(f => this.engine.buildingSystem.findFreeSpot('quarters', f, state))) {
      stats.appendChild(el('div', 'bp-hint', `[[pick]] ${i18n.t('building.digForHomes')}`));
    }
    root.appendChild(stats);

    if (def.maxWorkers > 0) root.appendChild(this.renderWorkers(state, b));

    // [Danger C3] wear and the Maintain button
    const maint = maintenanceCard(this.engine, state, b, () => this.refresh(this.engine.stateManager.state));
    if (maint) root.appendChild(maint);
    const infra = infraCard(this.engine, state, b, () => this.refresh(this.engine.stateManager.state)); // plan4:ST-14/15 doors, stairwell, vent stack
    if (infra) root.appendChild(infra);
    root.appendChild(this.renderUpgrade(state, b, upgradeAffordable));
    if (this.engine.buildingSystem.canSpecialize(state, b.id)) root.appendChild(this.renderSpecs(state, b));
    else if (b.specialization && specsFor(b.type, state).length > 1) root.appendChild(this.renderRetool(state, b)); // [Long game]
    root.appendChild(this.renderDemolish(state, b));
    this.sheet.body.replaceChildren(root);
  }

  /** The crisis in this room (or the blackout on its floor). */
  private incidentFor(state: GameState, b: BuildingInstance): Incident | undefined {
    return (state.incidents ?? []).find(i => i.buildingId === b.id)
      ?? (state.incidents ?? []).find(i => INCIDENTS[i.kind].wholeFloor
        && state.buildings.find(x => x.id === i.buildingId)?.position.floor === b.position.floor);
  }

  private renderIncident(state: GameState, inc: Incident): HTMLElement {
    const def = INCIDENTS[inc.kind];
    const locale = i18n.currentLocale;
    const card = el('div', `bp-card incident-card incident-${inc.kind}`);
    card.appendChild(el('div', 'incident-title', `[[${def.icon}]] ${def.name[locale]}`));
    card.appendChild(el('div', 'incident-desc', def.desc[locale]));
    const crew = this.engine.incidentSystem.crewFor(state, inc).length;
    card.appendChild(el('div', 'bp-hint', `[[worker]] ${i18n.t('incident.crew', { n: crew })} · ${STAT_ICONS[def.stat]} ${i18n.t(`stats.${def.stat}`)}`));
    this.incidentBar = bar(inc.progress * 100, 'good');
    this.incidentSev = bar(inc.severity * 100, 'danger');
    const bars = el('div', 'incident-bars');
    bars.append(el('span', 'bp-hint', i18n.t('incident.progress')), this.incidentBar, el('span', 'bp-hint', i18n.t('incident.severity')), this.incidentSev);
    card.appendChild(bars);
    const actions = el('div', 'incident-actions');
    actions.appendChild(button(`[[hand]] ${def.fight[locale]}`, 'btn-primary btn-fight', () => this.onIncidentTap?.(inc.id)));
    const fix = button(`[[${def.icon}]] ${def.fixLabel[locale]}`, 'btn-secondary', () => this.onQuickFix?.(inc.id),
      !this.engine.incidentSystem.canQuickFix(inc.id));
    const wrap = el('div', 'incident-fix');
    wrap.append(fix, costRow(state, quickFixCost(state, inc.kind))); // [offline/events agent] era-scaled quick-fix price (S7)
    actions.appendChild(wrap);
    card.appendChild(actions);
    return card;
  }

  private renderSpecs(state: GameState, b: BuildingInstance): HTMLElement {
    const locale = i18n.currentLocale;
    const card = el('div', 'bp-card');
    card.appendChild(el('div', 'bp-section-title', `[[crown]] ${i18n.t('spec.title')}`));
    card.appendChild(el('div', 'bp-hint', i18n.t('spec.hint')));
    const cost = this.engine.buildingSystem.specCost();
    const affordable = this.engine.resourceSystem.canAfford(state, cost);
    const grid = el('div', 'spec-grid');
    for (const spec of specsFor(b.type, state)) {
      const opt = el('div', 'spec-card');
      opt.append(el('div', 'spec-name', `[[${spec.icon}]] ${spec.name[locale]}`), el('div', 'spec-desc', spec.desc[locale]));
      opt.appendChild(button(i18n.t('spec.choose'), 'btn-primary btn-small', () => this.onSpecialize?.(b.id, spec.id), !affordable));
      grid.appendChild(opt);
    }
    card.append(grid, costRow(state, cost));
    return card;
  }

  /** [Long game] A specialized room can be refitted to another role: double the price, and it stands still meanwhile. */
  private renderRetool(state: GameState, b: BuildingInstance): HTMLElement {
    const locale = i18n.currentLocale;
    const bs = this.engine.buildingSystem;
    const card = el('div', 'bp-card');
    const now = state.longGame?.meta.worldT ?? 0;
    const left = (b.retoolUntil ?? 0) - now;
    card.appendChild(el('div', 'bp-section-title', `[[crown]] ${specOf(b)?.name[locale] ?? ''}`));
    if (left > 0) {
      card.appendChild(el('div', 'bp-hint', `[[settings]] ${i18n.t('spec.retooling', { t: i18n.formatDuration(left) })}`));
      return card;
    }
    card.appendChild(el('div', 'bp-hint', i18n.t('spec.retoolBody', { t: i18n.formatDuration(RETOOL_SECONDS) })));
    const cost = bs.retoolCost();
    const affordable = this.engine.resourceSystem.canAfford(state, cost);
    const grid = el('div', 'spec-grid');
    for (const spec of specsFor(b.type, state)) {
      if (spec.id === b.specialization) continue;
      const opt = el('div', 'spec-card');
      opt.append(el('div', 'spec-name', `[[${spec.icon}]] ${spec.name[locale]}`), el('div', 'spec-desc', spec.desc[locale]));
      opt.appendChild(button(i18n.t('spec.retool'), 'btn-secondary btn-small', () => this.onRetool?.(b.id, spec.id), !affordable || b.isConstructing));
      grid.appendChild(opt);
    }
    card.append(grid, costRow(state, cost));
    return card;
  }

  /**
   * [plan4:BL-15..32] The effect rows of the wave 2 rooms (children, quarantine, warning, trips, hygiene, mourning, weather), one per effect the room has.
   * Values are the room's own at its level; the bunker-wide totals are capped where the systems apply them.
   */
  private wave2Rows(state: GameState, b: BuildingInstance, def: BuildingDef): HTMLDivElement[] {
    const fx = def.effects;
    const out: HTMLDivElement[] = [];
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    if (fx?.childCapacity) {
      const kids = b.assignedSurvivorIds.filter(id => state.survivors.find(s => s.id === id)?.child).length;
      out.push(this.row(`[[baby]] ${i18n.t('building.childPlaces')}`, `${kids}/${childCapacityOf(b)}`));
    }
    if (fx?.childGrowth) out.push(this.row(`[[baby]] ${i18n.t('building.childGrowth')}`, `×${roomEffect(b, 'childGrowth').toFixed(2)}`));
    if (fx?.graduateStat) out.push(this.row(`[[cap]] ${i18n.t('building.graduate')}`, `+${fx.graduateStat}`));
    if (fx?.quarantine) out.push(this.row(`[[medbay]] ${i18n.t('building.quarantine')}`, String(Math.floor(roomEffect(b, 'quarantine')))));
    if (fx?.earlyWarning) out.push(this.row(`[[signal]] ${i18n.t('building.earlyWarning')}`, `+${Math.round(roomEffect(b, 'earlyWarning'))}s`));
    if (fx?.expeditionTeams) {
      const level = effectiveLevel(b);
      out.push(this.row(`[[backpack]] ${i18n.t('building.expeditionTeams')}`, `+${fx.expeditionTeams.filter(at => level >= at).length}`));
    }
    if (fx?.cargo) out.push(this.row(`[[cart]] ${i18n.t('building.cargo')}`, `+${pct(roomEffect(b, 'cargo'))}`));
    if (fx?.returnSafety) out.push(this.row(`[[backpack]] ${i18n.t('building.returnSafety')}`, `−${pct(roomEffect(b, 'returnSafety'))}`));
    if (fx?.hygiene) out.push(this.row(`[[bandage]] ${i18n.t('building.hygiene')}`, `−${pct(roomEffect(b, 'hygiene'))}`));
    if (fx?.mourning) out.push(this.row(`[[heart]] ${i18n.t('building.mourning')}`, `−${pct(roomEffect(b, 'mourning'))}`));
    if (def.shape) out.push(this.row(`[[${def.shape === 'wind' ? 'wave' : 'sun'}]] ${i18n.t(`building.weather.${def.shape}`)}`, `×${shapeFactor(def, state.stats.totalPlayTime).toFixed(2)}`));
    return out;
  }

  private row(label: string, value: string): HTMLDivElement {
    const r = el('div', 'bp-row');
    r.append(el('span', '', label), el('span', 'bp-value', value));
    return r;
  }

  private renderWorkers(state: GameState, b: BuildingInstance): HTMLElement {
    const def = getDef(b.type)!;
    const card = el('div', 'bp-card');
    const header = el('div', 'bp-section-title');
    setRich(header, `[[worker]] ${i18n.t('building.workers')} (${b.assignedSurvivorIds.length}/${def.maxWorkers})`);
    if (def.optimalStat) {
      header.appendChild(el('span', 'bp-hint', ` · ${i18n.t('building.bestStat')}: ${STAT_ICONS[def.optimalStat]} ${i18n.t(`stats.${def.optimalStat}`)}`));
    }
    card.appendChild(header);

    for (const id of b.assignedSurvivorIds) {
      const s = state.survivors.find(x => x.id === id);
      if (!s) continue;
      const row = el('div', 'worker-row');
      row.appendChild(this.face(s));
      const name = el('div', 'worker-name', this.engine.populationSystem.getLocalizedName(s, i18n.currentLocale));
      name.appendChild(el('span', 'worker-level', ` · ${i18n.t('people.level', { n: s.level })}`));
      row.appendChild(name);
      if (def.optimalStat) row.appendChild(el('span', 'worker-stat', `${STAT_ICONS[def.optimalStat]} ${s.stats[def.optimalStat]}`));
      if (traitBonus(s.traits, b.type) > 0) row.appendChild(el('span', 'worker-trait', '[[star]]'));
      row.appendChild(button(i18n.t('building.unassign'), 'btn-small btn-ghost', () => {
        uiSound('unassign');
        this.engine.populationSystem.assignSurvivorToBuilding(this.engine.stateManager, s.id, null);
        this.engine.requestSave();
        this.refresh(this.engine.stateManager.state);
      }));
      card.appendChild(row);
    }

    for (let i = b.assignedSurvivorIds.length; i < def.maxWorkers; i++) {
      card.appendChild(button(i18n.t('building.addWorker'), 'btn-slot', () => {
        this.pickerOpen = true;
        this.refresh(this.engine.stateManager.state);
      }));
    }
    return card;
  }

  private renderPicker(state: GameState, b: BuildingInstance): HTMLElement {
    const def = getDef(b.type)!;
    const stat = def.optimalStat;
    const card = el('div', 'bp-card');
    card.appendChild(el('div', 'bp-section-title', i18n.t('building.pickWorker')));

    const candidates = state.survivors
      .filter(s => !s.isOnMission && !s.child && s.assignedBuildingId !== b.id)
      .sort((a, c) => {
        const score = (s: typeof a) => (stat ? s.stats[stat] : 0) + traitBonus(s.traits, b.type) * 20 - (s.assignedBuildingId ? 0.5 : 0);
        return score(c) - score(a);
      });

    if (candidates.length === 0) card.appendChild(el('div', 'bp-hint', i18n.t('people.empty')));

    const locale = i18n.currentLocale;
    // [ux-wp4] B4: free hands first (no one else's room empties), then people from other rooms under their own heading.
    const idle = candidates.filter(s => !s.assignedBuildingId);
    const busy = candidates.filter(s => s.assignedBuildingId);
    const heads = new Map<string, string>();
    if (idle.length) heads.set(idle[0].id, i18n.t('wp4.freeHands', { n: idle.length }));
    if (busy.length) heads.set(busy[0].id, i18n.t('wp4.fromRooms'));
    for (const s of [...idle, ...busy]) {
      const head = heads.get(s.id);
      if (head) card.appendChild(el('div', 'bp-hint bp-pick-head', head));
      const row = el('button', 'worker-row worker-pick');
      row.appendChild(this.face(s));
      const name = el('div', 'worker-name', this.engine.populationSystem.getLocalizedName(s, locale));
      const job = s.assignedBuildingId ? state.buildings.find(x => x.id === s.assignedBuildingId) : undefined;
      const jobName = job ? getDef(job.type)?.name[locale] ?? '' : '';
      name.appendChild(el('span', 'worker-level', ` · ${job ? i18n.t('building.worksAt', { name: jobName, g: genderOf(s) }) : i18n.t('building.idle')}`));
      row.appendChild(name);
      if (stat) row.appendChild(el('span', 'worker-stat', `${STAT_ICONS[stat]} ${s.stats[stat]}`));
      if (traitBonus(s.traits, b.type) > 0) row.appendChild(el('span', 'worker-trait', '[[star]]'));
      row.addEventListener('click', () => {
        uiSound('assign');
        this.engine.populationSystem.assignSurvivorToBuilding(this.engine.stateManager, s.id, b.id);
        this.engine.requestSave();
        this.pickerOpen = false;
        this.refresh(this.engine.stateManager.state);
      });
      card.appendChild(row);
    }

    card.appendChild(button(i18n.t('placement.cancel'), 'btn-ghost', () => {
      this.pickerOpen = false;
      this.refresh(this.engine.stateManager.state);
    }));
    return card;
  }

  private renderUpgrade(state: GameState, b: BuildingInstance, affordable: boolean): HTMLElement {
    const def = getDef(b.type)!;
    const card = el('div', 'bp-card bp-upgrade');
    if (b.level >= def.maxLevel) {
      card.appendChild(el('div', 'bp-hint center', `[[star]] ${i18n.t('building.maxLevel')}`));
      return card;
    }
    // [Long game] The Act holds the level: say so instead of a grey button.
    if (this.engine.buildingSystem.upgradeBlock(b, state) === 'act') {
      card.appendChild(el('div', 'bp-hint center', `[[lock]] ${i18n.t('building.actCap', { level: b.level + 1 })}`));
      return card;
    }
    const cost = this.engine.buildingSystem.getUpgradeCost(b);
    const time = this.engine.buildingSystem.getUpgradeTime(b);
    const info = el('div', 'bp-upgrade-info');
    info.appendChild(costRow(state, cost, true)); // [ux-wp4] P17: short prices with the resource's name
    info.appendChild(el('span', 'bp-hint', `[[clock]] ${i18n.formatDuration(time)}`));
    card.appendChild(info);
    // The price is more than storage can even hold: point at the Storage Room instead of a silent grey button.
    const over = Object.entries(cost).find(([r, v]) => v > (state.resources[r as ResourceType]?.cap ?? Infinity));
    if (over) {
      const cap = Math.floor(state.resources[over[0] as ResourceType].cap);
      card.appendChild(el('div', 'bp-hint negative-text', `[[storage]] ${i18n.t('building.needStorage', { cap, cost: over[1] })}`));
    }
    // [ux-wp4] B3: the button itself is in the bar at the top (renderUpgradeBar); this card keeps the full price, the time and the notes.
    void affordable;
    return card;
  }

  private nextId: string | null = null;

  /**
   * [ux-wp4] B3: the next room worth upgrading after this one: rooms that can go up now (the Act allows it, not busy), the affordable ones
   * first, then the highest level, then the cheapest (the order of the guide's "take me there"); rooms already visited with Next come last.
   */
  private nextUpgrade(state: GameState, currentId: string): string | null {
    const bs = this.engine.buildingSystem;
    const rs = this.engine.resourceSystem;
    const rows = state.buildings.filter(x => x.id !== currentId && !x.isConstructing && bs.canUpgrade(x, state)).map(x => {
      const cost = bs.getUpgradeCost(x);
      return { id: x.id, level: x.level, ok: rs.canAfford(state, cost), total: Object.values(cost).reduce((a, v) => a + v, 0), seen: this.visited.has(x.id) };
    });
    rows.sort((a, c) => Number(a.seen) - Number(c.seen) || Number(c.ok) - Number(a.ok) || c.level - a.level || a.total - c.total || (a.id < c.id ? -1 : 1));
    return rows[0]?.id ?? null;
  }

  /** [ux-wp4] B3: the sticky bar: [Upgrade to N · price] [Next ▸]. */
  private renderUpgradeBar(state: GameState, b: BuildingInstance, affordable: boolean): HTMLElement {
    const bar = el('div', 'bp-upbar');
    const bs = this.engine.buildingSystem;
    const block = bs.upgradeBlock(b, state);
    if (block === null) {
      // Short of the price the button stays tappable: the app's handler then says what is missing and when it will be there (ui/missing.ts).
      const up = button(`[[up]] ${i18n.t('building.upgradeTo', { n: b.level + 1 })}`, `btn-primary bp-upbtn${affordable ? '' : ' unaffordable'}`, () => this.onUpgrade?.(b.id));
      if (!affordable) up.setAttribute('aria-disabled', 'true');
      up.appendChild(costRow(state, bs.getUpgradeCost(b)));
      bar.appendChild(up);
    } else {
      const note = block === 'max' ? `[[star]] ${i18n.t('building.maxLevel')}` : block === 'act' ? `[[lock]] ${i18n.t('building.actCap', { level: b.level + 1 })}`
        : `[[build]] ${i18n.t('wp4.busy')}`;
      bar.appendChild(el('div', 'bp-upnote', note));
    }
    const next = this.nextId;
    const go = button(`${i18n.t('wp4.next')} ${flowArrow()}`, 'btn-secondary bp-next', () => {
      if (!next || !this.buildingId) return;
      this.visited.add(this.buildingId);
      uiSound('click');
      this.onOpenRoom?.(next);
    }, !next);
    go.title = next ? i18n.t('wp4.nextHint') : i18n.t('wp4.nextNone');
    go.setAttribute('aria-label', go.title);
    bar.appendChild(go);
    return bar;
  }

  /** NICE2: tear a room down for half its build price (two taps: the button, then the confirmation). */
  private renderDemolish(state: GameState, b: BuildingInstance): HTMLElement {
    const bs = this.engine.buildingSystem;
    const card = el('div', 'bp-card bp-demolish');
    const block = bs.demolishBlock(state, b.id);
    // [plan4:ST-19] Move the room (10% of its price, 30 s of downtime); greyed out with the reason when it can't move now.
    if (this.onMove && !isDistrict(b.type)) card.appendChild(button(`[[walker]] ${i18n.t('relocate.button')}`, 'btn-secondary btn-small', () => this.onMove?.(b.id), relocateBlock(state, b) !== null));
    if (block === 'busy') return card;
    if (block) {
      card.appendChild(el('div', 'bp-hint', `[[lock]] ${i18n.t(block === 'incident' ? 'build.demolishIncident' : 'build.demolishBeds')}`));
      return card;
    }
    if (!this.demolishOpen) {
      card.appendChild(button(`[[trash]] ${i18n.t('build.demolish')}`, 'btn-ghost btn-small', () => {
        uiSound('click');
        this.demolishOpen = true;
        this.refresh(this.engine.stateManager.state);
      }));
      return card;
    }
    const refund = bs.demolishRefund(state, b.id);
    card.appendChild(el('div', 'bp-warning', `[[warning]] ${i18n.t('build.demolishConfirm')}`));
    if (Object.keys(refund).length) card.appendChild(costRow(state, refund));
    const actions = el('div', 'incident-actions');
    actions.appendChild(button(`[[trash]] ${i18n.t('build.demolishYes')}`, 'btn-primary', () => {
      const sm = this.engine.stateManager;
      const gain = bs.demolishRefund(sm.state, b.id);
      if (!bs.demolish(sm, b.id)) return;
      this.engine.resourceSystem.gain(sm, gain);
      this.engine.requestSave();
      uiSound('debris');
      this.hide();
    }));
    actions.appendChild(button(i18n.t('placement.cancel'), 'btn-secondary', () => {
      this.demolishOpen = false;
      this.refresh(this.engine.stateManager.state);
    }));
    card.appendChild(actions);
    return card;
  }

  private face(s: SurvivorState): HTMLImageElement {
    const img = el('img', 'worker-face');
    img.src = portraitUrl(portraitFor(s));
    img.alt = '';
    return img;
  }

  private updateDynamic(state: GameState, b: BuildingInstance): void {
    if (b.isConstructing && this.statusText) {
      const remaining = b.constructionTotal - b.constructionProgress;
      const key = b.level > 1 ? 'building.upgrading' : 'building.constructing';
      setRich(this.statusText, `[[build]] ${i18n.t(key, { time: i18n.formatDuration(remaining) })}`);
      setBar(this.statusBar, (b.constructionProgress / b.constructionTotal) * 100);
    }

    const output = this.engine.resourceSystem.getBuildingOutput(state, b);
    for (const [r, elv] of this.outputValues) {
      const v = output[r as ResourceType] ?? 0;
      elv.textContent = bidiNumbers(rateText(v)); // plan4:BL-25 a trickle (blueprints) shows per hour; [ux-wp4] I1 the sign stays in front in Hebrew
    }
    if (this.efficiencyEl) {
      this.efficiencyEl.textContent = `${Math.round(workforceMultiplier(state, b) * 100)}%`;
    }
    const inc = this.incidentFor(state, b);
    if (inc && this.incidentBar) {
      setBar(this.incidentBar, inc.progress * 100);
      setBar(this.incidentSev, inc.severity * 100);
    }
  }
}

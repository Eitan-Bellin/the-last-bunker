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
import { boostReserve, chainInputs, inputFed, inputRate, surplusShare } from '../../data/chains';
import { roomPowerDraw } from '../../systems/ResourceSystem';
import { bedsBuilt } from '../../systems/BuildingSystem';
import { MORALE_CAPS, shownLevel } from '../../systems/PopulationSystem'; // [plan4:BL-39] [phase4] shownLevel
import { allowedFloors } from '../../data/zones';
import { RETOOL_SECONDS, specOf, TYPE_ROLE_ACT, TYPE_ROLE_COOLDOWN, actRoleFor, getSpec, roleRoomCount, typeRoleCooldown, typeRoleOf, typeRolesFor } from '../../data/specializations'; // [phase4] type roles
import { specLevel } from '../../data/buildingDefs';
import type { Incident } from '../../core/GameState';
import { uiSound } from '../../audio/uiSound';
import { maintenanceCard } from './MaintenanceCard'; // [Danger C3]
import { relocateBlock } from '../../systems/relocate'; // [plan4:ST-19]
import { infraCard, infraSignature } from './InfraCard'; // plan4:ST-14
import { kButton } from '../kit'; // [ux2e]
import { plural } from '../format'; // [phase4]
import { masteryMultiplier } from '../../data/mastery';

/** [ux2e #45] How many number rows the stats card shows before "More numbers" (with the upgrade price and time: about 7 in view). */
const PRIMARY_ROWS = 3;

export class BuildingPanel {
  private sheet = new Sheet('building-sheet', 'building');
  private buildingId: string | null = null;
  private pickerOpen = false;
  /** NICE2: the demolish button was pressed once and waits for a confirmation. */
  private demolishOpen = false;
  /** [ux2e #28] The "…" menu (Demolish lives there) is open. */
  private moreOpen = false;
  /** [ux2e #45] The "why this efficiency" breakdown and the folded number rows are open. */
  private effOpen = false;
  private detailsOpen = false;
  private signature = '';
  /** [phase4] The "change the role of every room of this type" list is open. */
  private roleOpen = false;

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
    this.moreOpen = false;
    this.effOpen = false;
    this.roleOpen = false; // [phase4]
    this.signature = '';
    this.refresh(this.engine.stateManager.state);
    this.sheet.show();
    // [ux-redesign w2fix] Like a ruin's sheet: the world controller frames the room in the strip of world left above the sheet.
    window.dispatchEvent(new CustomEvent('lb:sheet-target', { detail: { buildingId } }));
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
      this.engine.resourceSystem.canAfford(state, this.engine.buildingSystem.retoolCost()), typeRoleOf(state, b.type) ?? '', // [phase4]
      Math.ceil(typeRoleCooldown(state, b.type) / 60), this.roleOpen,
      this.demolishOpen, this.engine.buildingSystem.demolishBlock(state, b.id), state.maxPopulation,
      this.moreOpen, this.effOpen, this.detailsOpen, relocateBlock(state, b) ?? '', // [ux2e]
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

    // [ux2e #45] At most PRIMARY_ROWS numbers in view (output and efficiency first); the rest fold under "More numbers". Notes stay visible.
    const stats = el('div', 'bp-card');
    const nums: HTMLElement[] = [];
    const notes: HTMLElement[] = [];
    if (def.production) {
      for (const r of Object.keys(def.production)) {
        const row = el('div', 'bp-row');
        row.appendChild(el('span', '', `${RESOURCE_ICONS[r] ?? ''} ${i18n.t(`resources.${r}`)}`));
        const val = el('span', 'bp-value positive');
        this.outputValues.set(r, val);
        row.appendChild(val);
        nums.push(row);
      }
    }
    if (def.maxWorkers > 0) {
      nums.push(this.renderEfficiency(state, b));
    } else {
      this.efficiencyEl = null;
    }
    const level = Math.max(1, effectiveLevel(b));
    if (def.effects?.maxPopulation) {
      const p = def.effects.maxPopulation;
      nums.push(this.row(`[[quarters]] ${i18n.t('building.capacity')}`, String(p.base + p.perLevel * (level - 1))));
      // The Act's limit can leave beds unused: say so here, where the player upgrades for more.
      const built = bedsBuilt(state);
      if (built > state.maxPopulation) {
        notes.push(el('div', 'bp-note warning', i18n.t('building.bedsCapped', { built, cap: state.maxPopulation })));
      }
    }
    if (def.effects?.morale) {
      const m = def.effects.morale;
      nums.push(this.row(`[[happy]] ${i18n.t('building.morale')}`, `+${Math.round((m.base + m.perLevel * (level - 1)) * workforceMultiplier(state, b))}`));
      // [plan4:BL-39] Which of the three morale channels it feeds (each has its own ceiling).
      if (def.effects.moraleKind && def.effects.moraleKind !== 'base') {
        const cap = MORALE_CAPS[def.effects.moraleKind];
        nums.push(this.row(`[[happy]] ${i18n.t('building.moraleChannel')}`, `${i18n.t(`morale.channel.${def.effects.moraleKind}`)} · max ${cap}`));
      }
    }
    if (def.effects?.storageCap) {
      const caps = Object.entries(def.effects.storageCap).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''}+${v * level}`).join('  ');
      nums.push(this.row(`[[storage]] ${i18n.t('building.storage')}`, caps));
    }
    const compound = compoundNeighbors(state, b);
    if (compound > 0) nums.push(this.row(`[[compound]] ${i18n.t('building.compound')}`, `+${compound * 10}%`));
    // [plan4:BL-39] Neighbour pairs (doc 2.5): who stands next door and what the pair gives.
    for (const link of synergyOf(state, b).links) {
      const nd = getDef(link.with);
      nums.push(this.row(`[[compound]] ${i18n.t('building.synergyRow', { name: nd?.name[locale] ?? nd?.name.en ?? link.with })}`, `+${Math.round(link.value * 100)}% ${i18n.t(`synergy.effect.${link.effect}`)}`));
    }
    if (def.effects?.defense) {
      const d = def.effects.defense;
      nums.push(this.row(`[[endurance]] ${i18n.t('building.defense')}`, `+${Math.round((d.base + d.perLevel * (level - 1)) * workforceMultiplier(state, b))} · ${i18n.t('building.totalDefense', { n: bunkerDefense(state) })}`));
    }
    for (const r of this.wave2Rows(state, b, def)) nums.push(r); // [plan4:BL-15..32]
    if (b.type === 'radioTower') notes.push(el('div', 'bp-hint', `[[radioTower]] ${i18n.t('building.radio')}`));
    if (b.type === 'trainingRoom') notes.push(el('div', 'bp-hint', `[[trainingRoom]] ${i18n.t('building.training')}`));
    if (b.type === 'laboratory') {
      nums.push(this.row(`[[research]] ${i18n.t('building.labSpeed')}`, `×${this.engine.researchSystem.speed(state).toFixed(2)}`));
    }
    if (def.powerConsumption > 0) {
      // S3: the draw grows with the room's level.
      const draw = roomPowerDraw(def.powerConsumption, level);
      nums.push(this.row(`[[power]] ${i18n.t('build.powerUse')}`, `−${Number.isInteger(draw) ? draw : draw.toFixed(1)}`));
    }
    if (def.production && !def.production.power && state.powerRatio < 0.99) {
      notes.push(el('div', 'bp-warning', `[[warning]] ${i18n.t('building.powerLow')}`));
    }
    for (const input of chainInputs(b, state)) { // [phase3] inputs of a later Act are not listed yet
      const fed = inputFed(state, input);
      // M1: fuel below the reserve is being saved for digs and research, not missing.
      const saving = input.boost && !fed && (state.resources[input.resource]?.amount ?? 0) > 0.5;
      const status = input.boost
        ? (fed ? i18n.t('chain.boosted') : saving ? i18n.t('chain.reserve', { n: Math.round(boostReserve(state, input)) }) : i18n.t('chain.noBoost'))
        : fed ? i18n.t('chain.fed') : i18n.t('chain.starved');
      const r = el('div', `bp-row chain-row ${fed ? 'ok' : input.boost ? '' : 'bad'}`);
      r.append(
        el('span', '', `[[recycle]] ${i18n.t(input.boost ? 'chain.fuel' : 'chain.input')} ${RESOURCE_ICONS[input.resource] ?? ''}`),
        // [phase3] A surplus draw takes only what would spill: show the share it really gets.
        el('span', 'bp-value', `−${(inputRate(input, b) * (input.surplus ? surplusShare(state, input.resource) : 1)).toFixed(2)} · ${status}`),
      );
      nums.push(r);
    }
    // S2: B1 is full of homes: say where more beds come from.
    if (b.type === 'quarters' && bedsBuilt(state) <= state.maxPopulation && !allowedFloors('quarters', state.currentFloors).some(f => this.engine.buildingSystem.findFreeSpot('quarters', f, state))) {
      notes.push(el('div', 'bp-hint', `[[pick]] ${i18n.t('building.digForHomes')}`));
    }
    stats.append(...nums.slice(0, PRIMARY_ROWS));
    if (nums.length > PRIMARY_ROWS) {
      const more = nums.slice(PRIMARY_ROWS);
      const box = el('div', 'ux2e-more');
      box.hidden = !this.detailsOpen;
      box.append(...more);
      const toggle = kButton({
        variant: 'tertiary', className: 'btn-ghost ux2e-more-btn',
        label: `${this.detailsOpen ? '▴' : '▾'} ${i18n.t(this.detailsOpen ? 'ux2e.room.lessNumbers' : 'ux2e.room.moreNumbers', { n: more.length })}`,
        onPress: () => { this.detailsOpen = !this.detailsOpen; this.signature = ''; this.refresh(this.engine.stateManager.state); },
      });
      toggle.setAttribute('aria-expanded', String(this.detailsOpen));
      stats.append(toggle, box);
    }
    stats.append(...notes);
    root.appendChild(stats);

    if (def.maxWorkers > 0) root.appendChild(this.renderWorkers(state, b));

    // [Danger C3] wear and the Maintain button
    const maint = maintenanceCard(this.engine, state, b, () => this.refresh(this.engine.stateManager.state));
    if (maint) root.appendChild(maint);
    const infra = infraCard(this.engine, state, b, () => this.refresh(this.engine.stateManager.state)); // plan4:ST-14/15 doors, stairwell, vent stack
    if (infra) root.appendChild(infra);
    root.appendChild(this.renderUpgrade(state, b, upgradeAffordable));
    const roles = this.renderRoles(state, b); // [phase4] one role per room type, plus this room's Act role
    if (roles) root.appendChild(roles);
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

  /**
   * [phase4] (C2) The room's role card. A role is chosen once for the whole room type (from Act III; every room of the type at its role
   * level takes it, and changing it is free but holds for TYPE_ROLE_COOLDOWN). The one per-room choice left is the type's Act role: this
   * room makes the Act's currency instead of part of its own output. Null when the room has nothing to choose or show.
   */
  private renderRoles(state: GameState, b: BuildingInstance): HTMLElement | null {
    const locale = i18n.currentLocale;
    const bs = this.engine.buildingSystem;
    const def = getDef(b.type)!;
    const level = specLevel(def);
    const typeRole = getSpec(typeRoleOf(state, b.type));
    const plain = typeRolesFor(b.type, state);
    const actRole = actRoleFor(b.type, state);
    const typeOpen = (state.longGame?.meta.act ?? 99) >= TYPE_ROLE_ACT && plain.length > 0;
    if (!typeRole && !typeOpen && !(actRole && b.level >= level)) return null;
    const roomName = def.name[locale] ?? def.name.en;
    const card = el('div', 'bp-card');
    card.appendChild(el('div', 'bp-section-title', `[[crown]] ${i18n.t('p4r.role.title', { room: roomName })}`));
    const left = (b.retoolUntil ?? 0) - (state.longGame?.meta.worldT ?? 0);
    if (left > 0) card.appendChild(el('div', 'bp-hint', `[[settings]] ${i18n.t('spec.retooling', { t: i18n.formatDuration(left) })}`));
    const option = (spec: { icon: string; name: Record<'he' | 'en', string>; desc: Record<'he' | 'en', string> }, action?: HTMLElement) => {
      const opt = el('div', 'spec-card');
      opt.append(el('div', 'spec-name', `[[${spec.icon}]] ${spec.name[locale]}`), el('div', 'spec-desc', spec.desc[locale]));
      if (action) opt.appendChild(action);
      return opt;
    };

    // The type's role: one choice for every room of the type.
    if (typeRole) {
      if (b.specialization !== typeRole.id) card.appendChild(option(typeRole)); // the room's own specialty is the card at the top
      card.appendChild(el('div', 'bp-hint', plural('p4r.role.applies', roleRoomCount(state, b.type, level), { level })));
      const others = plain.filter(s => s.id !== typeRole.id);
      const cd = typeRoleCooldown(state, b.type);
      if (others.length > 0 && cd > 0) {
        card.appendChild(el('div', 'bp-hint', `[[clock]] ${i18n.t('p4r.role.cooldown', { t: i18n.formatDuration(cd) })}`));
      } else if (others.length > 0 && !this.roleOpen) {
        card.appendChild(button(i18n.t('p4r.role.change'), 'btn-ghost btn-small', () => { this.roleOpen = true; this.refresh(this.engine.stateManager.state); }));
      } else if (others.length > 0) {
        card.appendChild(el('div', 'bp-hint', i18n.t('p4r.role.switchBody', { t: i18n.formatDuration(TYPE_ROLE_COOLDOWN) })));
        const grid = el('div', 'spec-grid');
        for (const spec of others) {
          grid.appendChild(option(spec, button(i18n.t('p4r.role.switchAll'), 'btn-secondary btn-small', () => {
            if (bs.changeTypeRole(this.engine.stateManager, b.type, spec.id)) {
              uiSound('click');
              this.engine.requestSave();
            }
            this.roleOpen = false;
            this.refresh(this.engine.stateManager.state);
          })));
        }
        card.appendChild(grid);
      }
    } else if (typeOpen && b.level >= level && !b.specialization) {
      const cost = bs.specCost();
      const affordable = this.engine.resourceSystem.canAfford(state, cost);
      card.appendChild(el('div', 'bp-hint', i18n.t('p4r.role.pickHint', { room: roomName, level, n: roleRoomCount(state, b.type, level) })));
      const grid = el('div', 'spec-grid');
      for (const spec of plain) grid.appendChild(option(spec, button(i18n.t('p4r.role.chooseAll'), 'btn-primary btn-small', () => this.onSpecialize?.(b.id, spec.id), !affordable)));
      card.append(grid, costRow(state, cost));
    } else if (typeOpen && b.level < level) {
      card.appendChild(el('div', 'bp-hint', i18n.t('p4r.role.atLevel', { level })));
    }

    // This room's Act role (a maker of the Act's currency).
    if (actRole && b.level >= level) {
      const here = b.specialization === actRole.id;
      const refit = !!b.specialization;
      const cost = refit ? bs.retoolCost() : bs.specCost();
      const affordable = this.engine.resourceSystem.canAfford(state, cost);
      let action: HTMLElement | undefined;
      if (here && typeRole) {
        action = button(i18n.t('p4r.role.backTo', { role: typeRole.name[locale] }), 'btn-secondary btn-small', () => this.onRetool?.(b.id, typeRole.id), !affordable || left > 0);
      } else if (!here) {
        action = button(i18n.t('p4r.role.actMake'), 'btn-primary btn-small', () => (refit ? this.onRetool : this.onSpecialize)?.(b.id, actRole.id), !affordable || left > 0);
      }
      card.appendChild(el('div', 'bp-section-title', i18n.t(here ? 'p4r.role.actHere' : 'p4r.role.actTitle')));
      if (!here) card.appendChild(option(actRole, action));
      else if (action) card.appendChild(action);
      if (action) {
        if (refit) card.appendChild(el('div', 'bp-hint', i18n.t('p4r.role.actRefit', { t: i18n.formatDuration(RETOOL_SECONDS) })));
        card.appendChild(costRow(state, cost));
      }
    }
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

  /**
   * [ux2e #45] The efficiency row is a button: a tap shows where the number comes from (crew, skill match, neighbours) and the power
   * supply that scales the output on top of it. Read-only: the parts are the same terms workforceMultiplier multiplies.
   */
  private renderEfficiency(state: GameState, b: BuildingInstance): HTMLElement {
    const def = getDef(b.type)!;
    const wrap = el('div', 'ux2e-eff');
    const row = el('button', 'bp-row ux2e-eff-row');
    row.type = 'button';
    row.setAttribute('aria-expanded', String(this.effOpen));
    this.efficiencyEl = el('span', 'bp-value');
    row.append(el('span', '', `[[chart]] ${i18n.t('building.efficiency')} ${this.effOpen ? '▴' : '▾'}`), this.efficiencyEl);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      uiSound('click');
      this.effOpen = !this.effOpen;
      this.refresh(this.engine.stateManager.state);
    });
    wrap.appendChild(row);
    if (!this.effOpen) return wrap;

    const box = el('div', 'ux2e-why');
    const workers = b.assignedSurvivorIds.map(id => state.survivors.find(s => s.id === id)).filter((s): s is SurvivorState => !!s && !s.isOnMission && !s.child);
    const baseEff = def.baseEfficiency ?? 0.2;
    const staffing = baseEff + (1 - baseEff) * Math.min(1, workers.length / Math.max(1, def.maxWorkers));
    const compound = compoundNeighbors(state, b);
    const total = workforceMultiplier(state, b);
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const why = (label: string, value: string, bad = false) => {
      const r = el('div', `bp-row${bad ? ' ux2e-why-bad' : ''}`);
      r.append(el('span', '', label), el('span', 'bp-value', value));
      box.appendChild(r);
    };
    why(`[[worker]] ${i18n.t('ux2e.room.why.crew', { n: workers.length, max: def.maxWorkers })}`, `×${pct(staffing)}`, workers.length < def.maxWorkers);
    if (workers.length > 0) {
      // Skill, traits and mastery together: what is left of the total once crew and neighbours are taken out.
      const skill = total / Math.max(0.0001, staffing * (1 + 0.1 * compound));
      const stat = def.optimalStat;
      const avg = stat ? workers.reduce((a, w) => a + w.stats[stat], 0) / workers.length : 0;
      const label = stat
        ? i18n.t('ux2e.room.why.skill', { stat: `${STAT_ICONS[stat]} ${i18n.t(`stats.${stat}`)}`, avg: avg.toFixed(1) })
        : i18n.t('ux2e.room.why.skillAny');
      why(`[[star]] ${label}`, `×${pct(skill)}`, skill < 1);
      if (masteryMultiplier(workers) > 1) box.appendChild(el('div', 'bp-hint', i18n.t('ux2e.room.why.mastery')));
    }
    if (compound > 0) why(`[[compound]] ${i18n.t('building.compound')}`, `+${compound * 10}%`);
    if (def.production && !def.production.power) {
      why(`[[power]] ${i18n.t('ux2e.room.why.power')}`, pct(Math.min(1, state.powerRatio ?? 1)), (state.powerRatio ?? 1) < 0.99);
    }
    box.appendChild(el('div', 'bp-hint', i18n.t('ux2e.room.why.hint')));
    wrap.appendChild(box);
    return wrap;
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
      name.appendChild(el('span', 'worker-level', ` · ${i18n.t('people.level', { n: shownLevel(s) }) /* [phase4] */}`));
      row.appendChild(name);
      if (def.optimalStat) row.appendChild(el('span', 'worker-stat', `${STAT_ICONS[def.optimalStat]} ${s.stats[def.optimalStat]}`));
      if (traitBonus(s.traits, b.type) > 0) row.appendChild(el('span', 'worker-trait', '[[star]]'));
      // [ux2e #28] A 48 px Remove (it was a 34 px ghost button).
      row.appendChild(kButton({
        variant: 'secondary', className: 'btn-secondary ux2e-48', label: i18n.t('building.unassign'), sound: 'unassign',
        ariaLabel: `${i18n.t('building.unassign')} ${this.engine.populationSystem.getLocalizedName(s, i18n.currentLocale)}`,
        onPress: () => {
          this.engine.populationSystem.assignSurvivorToBuilding(this.engine.stateManager, s.id, null);
          this.engine.requestSave();
          this.refresh(this.engine.stateManager.state);
        },
      }));
      card.appendChild(row);
    }

    // [phase4] (C5) Best fit is the default: one tap fills the open places with the idle people who suit the room best;
    // picking by hand stays one tap further (the manual override). The slot buttons used to be the only way in.
    const open = def.maxWorkers - b.assignedSurvivorIds.length;
    if (open > 0) {
      const idle = state.survivors.filter(s => !s.assignedBuildingId && !s.isOnMission && !s.child).length;
      const fill = Math.min(open, idle);
      if (fill > 0 && this.engine.populationSystem.canAssign(state, b.id)) {
        card.appendChild(kButton({
          variant: 'primary', className: 'btn-primary ux2e-48', icon: 'worker', label: plural('p4r.staff.fill', fill),
          onPress: () => {
            uiSound(this.engine.populationSystem.assignIdleBestFit(this.engine.stateManager, b.id) ? 'assign' : 'error');
            this.engine.requestSave();
            this.refresh(this.engine.stateManager.state);
          },
        }));
      }
      card.appendChild(button(i18n.t(fill > 0 ? 'p4r.staff.byHand' : 'building.addWorker'), 'btn-slot', () => {
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
    // [ux2e #45] The price is on the Upgrade button at the top: this card keeps only the time (and the storage note).
    const info = el('div', 'bp-upgrade-info');
    info.appendChild(el('span', 'bp-hint', `[[clock]] ${i18n.t('ux2e.room.upgradeTime', { t: i18n.formatDuration(time) })}`));
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

  /**
   * [ux2e #28] Room actions: Move (48 px) and a "…" menu that holds Demolish, away from Move. Demolish asks first, saying what it
   * costs (the crew goes idle, half the price back, no undo); Cancel is the big button there, Demolish the quiet one.
   * NICE2: tearing down still refunds half the build price (unchanged).
   */
  private renderDemolish(state: GameState, b: BuildingInstance): HTMLElement {
    const bs = this.engine.buildingSystem;
    const card = el('div', 'bp-card bp-demolish ux2e-actions');
    const block = bs.demolishBlock(state, b.id);
    const redraw = () => this.refresh(this.engine.stateManager.state);

    if (this.demolishOpen && !block) {
      const def = getDef(b.type)!;
      const name = def.name[i18n.currentLocale] ?? def.name.en;
      const crew = b.assignedSurvivorIds.length;
      card.classList.add('ux2e-confirm');
      card.setAttribute('role', 'group');
      card.appendChild(el('div', 'bp-section-title', `[[warning]] ${i18n.t('ux2e.room.demolishTitle', { name })}`));
      const list = el('ul', 'ux2e-conseq');
      if (crew > 0) list.appendChild(el('li', '', i18n.t('ux2e.room.demolishCrew', { n: crew })));
      const back = el('li', '', i18n.t('ux2e.room.demolishRefund'));
      const refund = bs.demolishRefund(state, b.id);
      if (Object.keys(refund).length) back.appendChild(costRow(state, refund, true));
      list.append(back, el('li', '', i18n.t('ux2e.room.demolishUndo')));
      card.appendChild(list);
      const actions = el('div', 'ux2e-confirm-actions');
      actions.append(
        kButton({
          variant: 'primary', className: 'btn-primary ux2e-48', label: i18n.t('placement.cancel'), sound: 'click',
          onPress: () => { this.demolishOpen = false; this.moreOpen = false; redraw(); },
        }),
        kButton({
          variant: 'tertiary', className: 'btn-ghost ux2e-48 ux2e-danger', icon: 'trash', label: i18n.t('build.demolishYes'),
          onPress: () => {
            const sm = this.engine.stateManager;
            const gain = bs.demolishRefund(sm.state, b.id);
            if (!bs.demolish(sm, b.id)) return;
            this.engine.resourceSystem.gain(sm, gain);
            this.engine.requestSave();
            uiSound('debris');
            this.hide();
          },
        }),
      );
      card.appendChild(actions);
      return card;
    }

    const row = el('div', 'ux2e-action-row');
    // [plan4:ST-19] Move the room (10% of its price, 30 s of downtime); pressing it while it can't move says why.
    if (this.onMove && !isDistrict(b.type)) {
      const why = relocateBlock(state, b);
      row.appendChild(kButton({
        variant: 'secondary', className: 'btn-secondary ux2e-48 ux2e-grow', icon: 'walker', label: i18n.t('relocate.button'),
        disabledReason: why ? i18n.t(`relocate.blocked.${why}`) : null,
        onPress: () => this.onMove?.(b.id),
      }));
    }
    if (block !== 'busy') {
      const more = kButton({
        variant: 'icon', className: 'btn-secondary ux2e-48 ux2e-more-menu', label: '…', ariaLabel: i18n.t('ux2e.room.moreActions'),
        onPress: () => { this.moreOpen = !this.moreOpen; redraw(); },
      });
      more.setAttribute('aria-expanded', String(this.moreOpen));
      more.setAttribute('aria-haspopup', 'menu');
      row.appendChild(more);
    }
    if (row.childElementCount) card.appendChild(row);
    if (!this.moreOpen || block === 'busy') return card;

    const menu = el('div', 'ux2e-menu');
    menu.setAttribute('role', 'menu');
    const item = kButton({
      variant: 'tertiary', className: 'btn-ghost ux2e-48 ux2e-danger ux2e-menu-item', icon: 'trash', label: i18n.t('build.demolish'),
      disabledReason: block ? i18n.t(block === 'incident' ? 'build.demolishIncident' : 'build.demolishBeds') : null,
      onPress: () => { this.demolishOpen = true; redraw(); },
    });
    item.setAttribute('role', 'menuitem');
    menu.appendChild(item);
    if (block) menu.appendChild(el('div', 'bp-hint', `[[lock]] ${i18n.t(block === 'incident' ? 'build.demolishIncident' : 'build.demolishBeds')}`));
    card.appendChild(menu);
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

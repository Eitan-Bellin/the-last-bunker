import type { GameState, ResourceType, Ruin } from '../../core/GameState';
import { floorTag, floorTagIso } from '../floorTag'; // plan4:ST-16
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { plural } from '../format';
import { getDef, isPowerPlant } from '../../data/buildingDefs';
import { roomPowerDraw } from '../../systems/ResourceSystem'; // [ux-wp4] P4
import { MAX_RUIN_WORKERS, RUIN_KINDS } from '../../data/ruins';
import { Sheet } from './Sheet';
import { BUILDING_ICONS, RESOURCE_ICONS, STAT_ICONS, bar, el, setBar, setRich } from '../dom';
import { kButton } from '../kit';
import { costChips, missingText } from './BuildMenu'; // [ux-redesign w2c]

/**
 * Bottom sheet for a ruined area: what it is, what clearing costs and yields, and who is working on it.
 * [ux-redesign w2c] #16 the Cost card says the restored room's power use against the bunker's spare power (red when it would go negative);
 * #17 showing it fires `lb:sheet-target` so the world controller frames the ruin above the sheet; buttons are kit buttons, the price chips say
 * what is short.
 */
export class RuinPanel {
  private sheet = new Sheet('building-sheet');
  private ruinId: string | null = null;
  private signature = '';
  private statusText: HTMLElement | null = null;
  private statusBar: HTMLElement | null = null;
  private engine: GameEngine;

  onStart: ((ruinId: string) => void) | null = null;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.sheet.onClose = () => {
      this.ruinId = null;
    };
  }

  show(ruinId: string): void {
    this.ruinId = ruinId;
    this.signature = '';
    this.refresh(this.engine.stateManager.state);
    this.sheet.show();
    window.dispatchEvent(new CustomEvent('lb:sheet-target', { detail: { ruinId } }));
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  get currentId(): string | null {
    return this.ruinId;
  }

  refresh(state: GameState): void {
    if (!this.ruinId) return;
    const r = state.ruins.find(x => x.id === this.ruinId);
    if (!r) {
      this.hide();
      return;
    }
    const rs = this.engine.restorationSystem;
    const sig = [
      r.started, rs.blockReason(state, r), rs.canStart(state, r), i18n.currentLocale, this.powerUse(state, r)?.join(':') ?? '',
      missingText(state, rs.cost(r) as Record<string, number>),
      state.survivors.map(s => `${s.id}:${s.assignedBuildingId}:${s.isOnMission}`).join(','),
    ].join('|');
    if (sig !== this.signature) {
      this.signature = sig;
      this.render(state, r);
    }
    if (this.statusText && r.started) {
      const left = rs.secondsLeft(state, r);
      setRich(this.statusText, isFinite(left)
        ? `[[pick]] ${i18n.t('ruin.working', { time: i18n.formatDuration(left) })}`
        : `[[warning]] ${i18n.t('ruin.noCrew')}`);
      setBar(this.statusBar, (r.progress / r.total) * 100);
    }
  }

  private title(r: Ruin): string {
    const locale = i18n.currentLocale;
    if (r.restoresTo) {
      const def = getDef(r.restoresTo);
      return `${BUILDING_ICONS[r.restoresTo] ?? ''} ${i18n.t('ruin.wreckOf', { name: def?.name[locale] ?? def?.name.en ?? '' })}`;
    }
    const icon = r.kind === 'flooded' ? '[[wave]]' : r.kind === 'collapsed' ? '[[warning]]' : '[[broom]]';
    return `${icon} ${RUIN_KINDS[r.kind].name[locale]}`;
  }

  private render(state: GameState, r: Ruin): void {
    const locale = i18n.currentLocale;
    const rs = this.engine.restorationSystem;
    const kind = RUIN_KINDS[r.kind];
    this.sheet.setTitle(`${this.title(r)} · ${floorTagIso(r.floor)}`);
    const root = el('div', 'bp');

    const desc = el('div', 'bp-card ruin-desc');
    desc.appendChild(el('p', 'ruin-text', kind.desc[locale]));
    if (r.restoresTo) {
      const def = getDef(r.restoresTo);
      desc.appendChild(el('p', 'bp-hint', `[[up]] ${i18n.t('ruin.restoresInto', { name: def?.name[locale] ?? '' })}`));
    }
    if (r.lore && !state.lore.includes(r.lore)) desc.appendChild(el('p', 'bp-hint lore-hint', `[[note]] ${i18n.t('ruin.somethingHidden')}`));
    root.appendChild(desc);

    const finds = el('div', 'bp-card');
    finds.appendChild(el('div', 'bp-section-title', i18n.t('ruin.finds')));
    const chips = el('div', 'cost-row');
    for (const res of Object.keys(kind.loot) as ResourceType[]) chips.appendChild(el('span', 'cost-chip affordable', `${RESOURCE_ICONS[res] ?? ''} ${i18n.t(`resources.${res}`)}`));
    finds.appendChild(chips);
    root.appendChild(finds);

    const block = rs.blockReason(state, r);
    if (block === 'needsPump') {
      root.appendChild(el('div', 'bp-warning', `[[lock]] ${i18n.t('ruin.needsPump')}`));
    }

    if (r.started) {
      const status = el('div', 'bp-status');
      this.statusText = el('div', 'bp-status-text');
      this.statusBar = bar((r.progress / r.total) * 100, 'accent');
      status.append(this.statusText, this.statusBar);
      root.appendChild(status);
      root.appendChild(this.renderCrew(state, r));
    } else {
      this.statusText = null;
      this.statusBar = null;
      const card = el('div', 'bp-card');
      card.appendChild(el('div', 'bp-section-title', i18n.t('ruin.cost')));
      const cost = rs.cost(r) as Record<string, number>;
      if (Object.keys(cost).length) card.appendChild(costChips(state, cost));
      else card.appendChild(el('div', 'bp-hint', i18n.t('ruin.free')));
      // [w2c #16] (was [ux-wp4] P4) What the restored room will draw against the spare power: red, with a warning, when it would go negative.
      const use = this.powerUse(state, r);
      if (use) {
        const [draw, spare] = use;
        const short = spare - draw < 0;
        const sign = (v: number) => `${v < 0 ? '\u2212' : '+'}${Math.abs(v)}`; // el() isolates signed numbers (dom.ts setRich), so "+4.6" keeps its order in Hebrew
        const line = el('div', `bp-hint ux2c-power${short ? ' is-short' : ''}`, `${short ? '[[warning]]' : '[[power]]'} ${i18n.t('ux2c.ruin.power', { draw, spare: sign(spare) })}`);
        card.appendChild(line);
        if (short) card.appendChild(el('div', 'bp-hint ux2c-power is-short', i18n.t('ux2c.ruin.powerShort')));
      }
      const idle = rs.pickIdle(state, MAX_RUIN_WORKERS).length;
      const est = r.total / Math.max(1, idle);
      card.appendChild(el('div', 'bp-hint', `[[clock]] ${i18n.t('ruin.estimate', { time: i18n.formatDuration(est) })} · [[worker]] ${plural('ruin.crewSize', MAX_RUIN_WORKERS)}`));
      if (idle === 0) card.appendChild(el('div', 'bp-hint negative-text', `[[warning]] ${i18n.t('ruin.noIdle')}`));
      root.appendChild(card);
      // The one main action; disabled with the reason (the pump, or what the price lacks).
      const why = rs.canStart(state, r) ? null : block === 'needsPump' ? i18n.t('ruin.needsPump') : missingText(state, cost) || '';
      root.appendChild(kButton({
        variant: 'primary',
        className: 'btn-primary btn-wide',
        icon: r.kind === 'wreck' ? 'workshop' : 'broom',
        label: i18n.t(r.kind === 'wreck' ? 'ruin.startRestore' : 'ruin.startClear'),
        disabledReason: why,
        onPress: () => this.onStart?.(r.id),
      }));
    }
    this.sheet.body.replaceChildren(root);
  }

  /**
   * [w2c #16] [draw, spare]: the power the room this ruin turns into will draw (at the level it comes back at) and the bunker's spare power now
   * (production minus demand, tenths; negative in a shortage). null when it makes power itself or draws none.
   */
  private powerUse(state: GameState, r: Ruin): [number, number] | null {
    if (!r.restoresTo || isPowerPlant(r.restoresTo)) return null;
    const def = getDef(r.restoresTo);
    const draw = def ? roomPowerDraw(def.powerConsumption, r.restoresLevel ?? 1) : 0;
    if (draw <= 0) return null;
    const p = state.resources.power;
    const spare = Math.round(((p?.productionRate ?? 0) - (p?.consumptionRate ?? 0)) * 10) / 10;
    return [Math.round(draw * 10) / 10, spare];
  }

  private renderCrew(state: GameState, r: Ruin): HTMLElement {
    const rs = this.engine.restorationSystem;
    const locale = i18n.currentLocale;
    const card = el('div', 'bp-card');
    const crew = rs.workers(state, r.id);
    card.appendChild(el('div', 'bp-section-title', `[[worker]] ${i18n.t('ruin.crew')} (${crew.length}/${MAX_RUIN_WORKERS})`));
    for (const s of crew) {
      const row = el('div', 'worker-row');
      row.appendChild(el('span', 'worker-name', this.engine.populationSystem.getLocalizedName(s, locale)));
      row.appendChild(el('span', 'worker-stat', `${STAT_ICONS.strength} ${s.stats.strength}`));
      row.appendChild(kButton({
        variant: 'tertiary',
        className: 'btn-small btn-ghost',
        label: i18n.t('building.unassign'),
        onPress: () => {
          rs.unassign(s.id);
          this.engine.requestSave();
          this.refresh(this.engine.stateManager.state);
        },
      }));
      card.appendChild(row);
    }
    if (crew.length < MAX_RUIN_WORKERS) {
      const candidates = state.survivors
        .filter(s => !s.isOnMission && s.assignedBuildingId !== r.id && s.health > 20)
        .sort((a, b) => Number(!!a.assignedBuildingId) - Number(!!b.assignedBuildingId) || b.stats.strength - a.stats.strength)
        .slice(0, 6);
      for (const s of candidates) {
        const job = s.assignedBuildingId ? state.buildings.find(b => b.id === s.assignedBuildingId) : undefined;
        const label = `${this.engine.populationSystem.getLocalizedName(s, locale)} · ${STAT_ICONS.strength} ${s.stats.strength}${job ? ` · ${BUILDING_ICONS[job.type] ?? ''}` : ''}`;
        card.appendChild(kButton({
          variant: 'secondary',
          className: 'btn-job',
          icon: 'plus',
          label,
          onPress: () => {
            rs.assign(r.id, s.id);
            this.engine.requestSave();
            this.refresh(this.engine.stateManager.state);
          },
        }));
      }
    }
    return card;
  }
}

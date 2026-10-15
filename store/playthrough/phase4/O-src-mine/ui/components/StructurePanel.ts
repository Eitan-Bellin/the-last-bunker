import type { BuildingInstance, GameState } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { crewCount, getDef, effectiveLevel, workforceMultiplier } from '../../data/buildingDefs';
import { INCIDENTS } from '../../data/incidents';
import { Sheet } from './Sheet';
import { RESOURCE_ICONS, button, el } from '../dom';
import { uiSound } from '../../audio/uiSound';

/**
 * [plan4:AC-11] "Bunker structure": the bunker as a list instead of a picture, for screen-reader users and anyone who prefers text.
 * Floors, then the rooms on them: name, level, state (fine / fault / being built), workers and what the room produces, with a button that
 * opens the room's own panel. Opened from the Accessibility tab or the L key.
 * [ux-wp4] M5: also from the menu ("Rooms"), with filters: rooms that can be upgraded now, rooms with a free work place, rooms in trouble.
 */
export class StructurePanel {
  private sheet = new Sheet('structure-sheet');
  private signature = '';
  /** Opens a room's panel (the app also moves the camera there). */
  onOpenRoom: ((buildingId: string) => void) | null = null;
  private state: () => GameState;
  /** [ux-wp4] M5: set by the app (the Act's level ceiling and the price rules live in BuildingSystem). */
  canUpgrade: ((b: BuildingInstance) => boolean) | null = null;
  private filter: 'all' | 'upgrade' | 'free' | 'fault' = 'all';

  constructor(state: () => GameState) {
    this.state = state;
    this.sheet.onClose = () => { this.signature = ''; };
  }

  show(): void {
    this.signature = '';
    this.refresh(this.state());
    this.sheet.show();
  }

  hide(): void {
    this.sheet.hide();
  }

  toggle(): void {
    if (this.sheet.isVisible) this.hide(); else this.show();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  /** Re-draws only when something it shows changed (the list can be a hundred rooms long). */
  refresh(state: GameState): void {
    const sig = [
      this.filter, this.filter === 'upgrade' ? state.buildings.map(b => (this.canUpgrade?.(b) ? 1 : 0)).join('') : '',
      i18n.currentLocale, state.currentFloors, state.survivors.length, state.maxPopulation,
      state.buildings.map(b => `${b.id}.${b.level}.${b.isConstructing ? Math.floor((b.constructionProgress / Math.max(1, b.constructionTotal)) * 20) : 'x'}.${b.assignedSurvivorIds.length}`).join(','),
      (state.incidents ?? []).map(i => `${i.id}.${Math.floor(i.severity * 4)}`).join(','),
    ].join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    this.render(state);
  }

  private render(state: GameState): void {
    const locale = i18n.currentLocale;
    this.sheet.setTitle(`[[build]] ${i18n.t('structure.title')}`);
    const root = el('div', 'bp');
    const incidents = state.incidents ?? [];
    root.appendChild(el('p', 'bp-hint', i18n.t('structure.summary', {
      people: state.survivors.length, max: state.maxPopulation, rooms: state.buildings.length, events: incidents.length,
    })));
    // [ux-wp4] M5: filter chips; with a filter on, floors without a match are left out.
    const keepBy = (id: 'all' | 'upgrade' | 'free' | 'fault', b: BuildingInstance): boolean => {
      if (id === 'upgrade') return !b.isConstructing && !!this.canUpgrade?.(b);
      if (id === 'free') return !(b.isConstructing && b.level <= 1) && crewCount(state, b) < (getDef(b.type)?.maxWorkers ?? 0);
      if (id === 'fault') return incidents.some(i => i.buildingId === b.id);
      return true;
    };
    const keep = (b: BuildingInstance): boolean => keepBy(this.filter, b);
    const chips = el('div', 'bm-chips struct-chips');
    const opts: [typeof this.filter, string][] = [['all', i18n.t('build.cat.all')], ['upgrade', `[[up]] ${i18n.t('wp4.fUpgrade')}`], ['free', `[[worker]] ${i18n.t('wp4.fFree')}`], ['fault', `[[warning]] ${i18n.t('wp4.fFault')}`]];
    for (const [id, label] of opts) {
      if (id === 'upgrade' && !this.canUpgrade) continue;
      const n = id === 'all' ? state.buildings.length : state.buildings.filter(b => keepBy(id, b)).length;
      const c = el('button', `bm-chip${this.filter === id ? ' active' : ''}`);
      c.type = 'button';
      c.setAttribute('aria-pressed', String(this.filter === id));
      c.append(el('span', 'bm-chip-label', label), el('span', 'bm-chip-n', String(n)));
      c.addEventListener('click', () => { uiSound('tab'); this.filter = id; this.signature = ''; this.refresh(this.state()); });
      chips.appendChild(c);
    }
    root.appendChild(chips);
    for (let f = 0; f < state.currentFloors; f++) {
      const rooms = state.buildings.filter(b => b.position.floor === f && keep(b)).sort((a, b) => a.position.x - b.position.x);
      if (!rooms.length && this.filter !== 'all') continue;
      const floor = el('section', 'struct-floor');
      const h = el('h3', '', i18n.t('structure.floor', { n: f + 1 }));
      floor.appendChild(h);
      if (!rooms.length) floor.appendChild(el('div', 'struct-empty', i18n.t('structure.empty')));
      for (const b of rooms) floor.appendChild(this.room(state, b, locale));
      root.appendChild(floor);
    }
    this.sheet.body.replaceChildren(root);
  }

  private room(state: GameState, b: BuildingInstance, locale: 'he' | 'en'): HTMLElement {
    const def = getDef(b.type);
    const incident = (state.incidents ?? []).find(i => i.buildingId === b.id);
    const kind = b.isConstructing ? 'building' : incident ? 'fault' : 'ok';
    const row = el('div', `struct-room ${kind}`);
    const name = def?.name[locale] ?? b.type;
    row.appendChild(el('strong', '', name));
    row.appendChild(button(i18n.t('structure.open'), 'btn-small', () => { uiSound('click'); this.onOpenRoom?.(b.id); }));
    // State: a word and an icon, never colour alone.
    const stateText = b.isConstructing
      ? `[[build]] ${i18n.t('structure.building', { pct: Math.round((b.constructionProgress / Math.max(1, b.constructionTotal)) * 100) })}`
      : incident ? `[[warning]] ${i18n.t('structure.fault', { name: INCIDENTS[incident.kind]?.name[locale] ?? incident.kind })}` : `[[check]] ${i18n.t('structure.ok')}`;
    const parts = [stateText, i18n.t('structure.level', { n: Math.max(1, b.level) })];
    if (def && def.maxWorkers > 0) parts.push(i18n.t('structure.workers', { n: b.assignedSurvivorIds.length, max: def.maxWorkers }));
    if (def?.production && !b.isConstructing) {
      const level = Math.max(1, effectiveLevel(b));
      const mult = workforceMultiplier(state, b);
      const out = Object.entries(def.production)
        .map(([r, p]) => `${RESOURCE_ICONS[r] ?? ''} ${i18n.t(`resources.${r}`)} ${i18n.formatRate((p.base + p.perLevel * (level - 1)) * mult)}`);
      parts.push(i18n.t('structure.production', { list: out.join(', ') }));
    }
    row.appendChild(el('div', 'struct-meta', parts.join(' · ')));
    return row;
  }
}

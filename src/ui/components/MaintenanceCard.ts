import type { BuildingInstance, GameState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { bar, button, costRow, el } from '../dom';
import { WEAR_FROM_LEVEL, wearOf } from '../../systems/MaintenanceSystem';

/**
 * [Danger C3] The "Maintenance" card of the building panel: how worn the room is and a button that resets it.
 * Null for rooms below level 3 (they don't wear) and for rooms still under construction.
 */
export function maintenanceCard(engine: GameEngine, state: GameState, b: BuildingInstance, onDone: () => void): HTMLElement | null {
  const ms = engine.maintenanceSystem;
  if (b.isConstructing || (b.level < WEAR_FROM_LEVEL && !ms.isDown(state, b))) return null;
  const wear = Math.round(wearOf(b));
  const card = el('div', 'bp-card');
  const row = el('div', 'bp-row');
  row.append(el('span', '', `[[pick]] ${i18n.t('maintenance.title')}`), el('span', `bp-value ${wear >= 50 ? 'negative' : ''}`, `${i18n.t('maintenance.wear')} ${wear}%`));
  card.append(row, bar(wear, wear >= 50 ? 'danger' : 'accent'));
  card.appendChild(el('div', 'bp-hint', i18n.t(b.type === 'reactor' ? 'maintenance.hintHot' : b.type === 'geothermal' ? 'maintenance.hintSteam' : 'maintenance.hint') /* plan4:BL-24 */));
  if (ms.needsIt(b)) {
    const cost = ms.cost(state, b);
    card.appendChild(costRow(state, cost));
    card.appendChild(button(`[[pick]] ${i18n.t('maintenance.do')}`, 'btn-secondary', () => {
      if (ms.maintain(b.id)) onDone();
    }, !ms.canMaintain(state, b)));
  }
  return card;
}

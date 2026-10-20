import type { BuildingInstance, GameState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { bar, button, costRow, el } from '../dom';
import { CREW_RESERVE, CREW_SERVICE_AT, WEAR_FROM_LEVEL, wearOf } from '../../systems/MaintenanceSystem';

/**
 * [Danger C3] The "Maintenance" card of the building panel: how worn the room is.
 * [phase4] (C5) A passive stat: the crew services the room by itself at CREW_SERVICE_AT% while materials last above the reserve, so there is
 * no "Maintain" button any more. The only button left is "repair now" for a room a disaster shut down (pay instead of waiting it out).
 * Null for rooms below level 3 (they don't wear) and for rooms still under construction.
 */
export function maintenanceCard(engine: GameEngine, state: GameState, b: BuildingInstance, onDone: () => void): HTMLElement | null {
  const ms = engine.maintenanceSystem;
  const down = ms.isDown(state, b);
  if (b.isConstructing || (b.level < WEAR_FROM_LEVEL && !down)) return null;
  const wear = Math.round(wearOf(b));
  const card = el('div', 'bp-card');
  const row = el('div', 'bp-row');
  row.append(el('span', '', `[[pick]] ${i18n.t('maintenance.title')}`), el('span', `bp-value ${wear >= 50 ? 'negative' : ''}`, `${i18n.t('maintenance.wear')} ${wear}%`));
  card.append(row, bar(wear, wear >= 50 ? 'danger' : 'accent'));
  card.appendChild(el('div', 'bp-hint', i18n.t(b.type === 'reactor' ? 'maintenance.hintHot' : b.type === 'geothermal' ? 'maintenance.hintSteam' : 'maintenance.hint') /* plan4:BL-24 */));
  // [phase4] What the crew does about it, in this bunker's numbers: at which wear, and whether the materials reserve lets them.
  const mats = state.resources.materials;
  const price = ms.cost(state, b).materials ?? 0;
  const short = !!mats && mats.amount - price < CREW_RESERVE * mats.cap;
  card.appendChild(el('div', `bp-hint${short && wear >= CREW_SERVICE_AT ? ' negative-text' : ''}`,
    i18n.t(short ? 'p4r.wear.short' : 'p4r.wear.crew', { at: CREW_SERVICE_AT, n: price, reserve: Math.round(CREW_RESERVE * 100) })));
  if (down) {
    const cost = ms.cost(state, b);
    card.appendChild(costRow(state, cost));
    card.appendChild(button(`[[pick]] ${i18n.t('p4r.wear.repairNow')}`, 'btn-secondary', () => {
      if (ms.maintain(b.id)) onDone();
    }, !ms.canMaintain(state, b)));
  }
  return card;
}

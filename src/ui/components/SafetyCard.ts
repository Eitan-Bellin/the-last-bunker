import type { GameState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { button, el } from '../dom';
import { shutDoorCount } from '../../systems/doors';
import { closeEmergencyDoors, doorsOperable, emergencyDoorTargets, fireCodeFloors, openAllDoors } from '../../systems/InfraSystem';

/**
 * [plan4:ST-14/ST-15] The "Safety" card of the Command panel: floors that break the fire code (B9 and deeper with no emergency stairwell
 * within one floor), how many doors stand shut with a button to open them all, and, while a fire, an epidemic or a raid is on, a one-tap
 * "shut the doors around the trouble". The card is empty (and hidden) when there is nothing to say. The panel refreshes four times a
 * second, so the DOM is rebuilt only when what it shows changes.
 */
export function fillSafetyCard(box: HTMLElement | null, engine: GameEngine, state: GameState): void {
  if (!box) return;
  const floors = fireCodeFloors(state);
  const shut = shutDoorCount(state);
  const targets = emergencyDoorTargets(state).length;
  const operable = doorsOperable(state);
  const sig = `${floors.join(',')}|${shut}|${targets}|${operable}|${i18n.currentLocale}`;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  if (floors.length === 0 && shut === 0 && targets === 0) {
    box.replaceChildren();
    return;
  }
  const card = el('div', 'bp-card');
  card.appendChild(el('div', 'bp-section-title', `[[warning]] ${i18n.t('safety.title')}`));
  for (const f of floors.slice(0, 3)) card.appendChild(el('div', 'bp-row bad', `[[fire]] ${i18n.t('safety.fireCode', { f: f + 1 })}`)); // displayed floor = index + 1 (B9 = index 8)
  if (floors.length > 3) card.appendChild(el('div', 'bp-hint', i18n.t('safety.fireCodeMore', { n: floors.length - 3 })));
  if (floors.length > 0) card.appendChild(el('div', 'bp-hint', i18n.t('safety.fireCodeHint')));
  const sm = engine.stateManager;
  if (targets > 0) {
    card.appendChild(button(`[[door]] ${i18n.t('safety.closeAll')}`, 'btn-primary', () => { closeEmergencyDoors(sm); engine.requestSave(); }, !operable));
  }
  if (shut > 0) {
    card.appendChild(el('div', 'bp-row', `[[door]] ${i18n.t('safety.shut', { n: shut })}`));
    card.appendChild(button(i18n.t('safety.openAll'), 'btn-secondary', () => { openAllDoors(sm); engine.requestSave(); }, !operable));
  }
  box.replaceChildren(card);
}

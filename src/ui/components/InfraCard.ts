import type { BuildingInstance, GameState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { button, costRow, el } from '../dom';
import { roomSlots } from '../../data/buildingDefs';
import { getDoor, infraAt, infraOfKind, isSealedOff, type DoorState } from '../../systems/doors';
import {
  DOOR_DRAIN, DOOR_MAX_LEVEL, VENT_MAX_STACKS, buildColumn, buildDoor, columnBlock, columnCost, doorBlock, doorCost, doorLevel, doorUpgradeBlock,
  doorUpgradeCost, doorsOperable, infraUnlocked, roomEdgeBoundaries, setDoorState, stairwellNear, upgradeDoor, type InfraBlock,
} from '../../systems/InfraSystem';
import { fireCodeMult, ventilationRelief } from '../../data/roomEffects';

/**
 * [plan4:ST-14/ST-15] The "Doors and exits" card of the room panel: the bulkhead doors on the room's two edges (build, open, shut, seal,
 * strengthen), and this floor's emergency stairwell and vent stacks. Null for rooms that cannot have doors (the shaft, caverns, rooms
 * still being built) and while none of the three is researched and no door stands by the room.
 * All feedback is in the card itself (a disabled button with the reason under it), so it needs no toast.
 */

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** What the card shows, as a short string: the panel re-renders when it changes. */
export function infraSignature(state: GameState, b: BuildingInstance): string {
  const edges = roomEdgeBoundaries(b).map(x => `${x}=${getDoor(state, b.position.floor, x) ?? '-'}${doorLevel(state, b.position.floor, x)}`).join(',');
  // Only whether each price is affordable (not the amounts) so the panel is not rebuilt every few seconds.
  const can = (cost: Record<string, number>) => Object.entries(cost).every(([r, v]) => (state.resources[r as keyof GameState['resources']]?.amount ?? 0) >= v);
  return [
    edges, infraUnlocked(state, 'bulkhead'), infraUnlocked(state, 'stairwell'), infraUnlocked(state, 'ventStack'),
    infraAt(state, 'stairwell', b.position.floor).length, infraOfKind(state, 'ventStack').length, doorsOperable(state),
    can(doorCost()), can(doorUpgradeCost(1)), can(doorUpgradeCost(2)), can(columnCost(state, 'stairwell')), can(columnCost(state, 'ventStack')),
    stairwellNear(state, b.position.floor, 1), fireCodeMult(state, b.position.floor),
  ].join('|');
}

export function infraCard(engine: GameEngine, state: GameState, b: BuildingInstance, onChange: () => void): HTMLElement | null {
  const type = b.type as string;
  if (b.isConstructing || type === 'elevator' || type === 'cave' || type === 'lake' || type === 'metro') return null;
  const floor = b.position.floor;
  const edges = roomEdgeBoundaries(b);
  const canDoors = infraUnlocked(state, 'bulkhead');
  const canStairs = infraUnlocked(state, 'stairwell');
  const canVents = infraUnlocked(state, 'ventStack');
  const hasDoor = edges.some(x => getDoor(state, floor, x) !== undefined);
  if (!canDoors && !canStairs && !canVents && !hasDoor) return null;

  const sm = engine.stateManager;
  const rs = engine.resourceSystem;
  const card = el('div', 'bp-card');
  card.appendChild(el('div', 'bp-section-title', `[[door]] ${i18n.t('infra.card.title')}`));
  const reason = (r: InfraBlock) => el('div', 'bp-hint', i18n.t(`infra.block.${r}`));
  const done = () => { engine.requestSave(); onChange(); };
  const w = roomSlots(b.type);
  const towardShaft = b.position.x >= 0 ? b.position.x : b.position.x + w;

  // Doors: the edge toward the shaft first, then the far one.
  for (const x of [...edges].sort((p, q) => Number(q === towardShaft) - Number(p === towardShaft))) {
    const door = getDoor(state, floor, x);
    const row = el('div', 'bp-row');
    const label = i18n.t(x === towardShaft ? 'infra.door.toward' : 'infra.door.far');
    if (door === undefined) {
      if (!canDoors) continue;
      row.append(el('span', '', `[[door]] ${label}`));
      card.appendChild(row);
      const block = doorBlock(state, floor, x);
      if (block) { if (block !== 'empty') card.appendChild(reason(block)); continue; }
      card.appendChild(costRow(state, doorCost()));
      card.appendChild(button(`[[build]] ${i18n.t('infra.door.build')}`, 'btn-secondary', () => {
        if (!buildDoor(sm, rs, floor, x)) done();
      }, !rs.canAfford(state, doorCost())));
      continue;
    }
    const lvl = doorLevel(state, floor, x);
    row.append(el('span', '', `[[door]] ${label}`), el('span', `bp-value ${door === 'open' ? '' : 'negative'}`, `${i18n.t(`infra.door.state.${door}`)} · ${i18n.t('infra.door.level', { n: lvl })}`));
    card.appendChild(row);
    const btns = el('div', 'bp-row');
    btns.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    for (const s of ['open', 'closed', 'sealed'] as DoorState[]) {
      btns.appendChild(button(i18n.t(`infra.door.btn.${s}`), door === s ? 'btn-primary' : 'btn-secondary', () => {
        if (!setDoorState(sm, floor, x, s)) done();
      }, door === s || !doorsOperable(state)));
    }
    card.appendChild(btns);
    if (!doorUpgradeBlock(state, floor, x) && lvl < DOOR_MAX_LEVEL) {
      card.appendChild(costRow(state, doorUpgradeCost(lvl)));
      card.appendChild(button(`[[up]] ${i18n.t('infra.door.upgrade')}`, 'btn-secondary', () => {
        if (!upgradeDoor(sm, rs, floor, x)) done();
      }, !rs.canAfford(state, doorUpgradeCost(lvl))));
    }
  }
  if (!doorsOperable(state) && hasDoor) card.appendChild(el('div', 'bp-note warning', i18n.t('infra.door.blackout')));
  if (isSealedOff(state, floor, b.position.x, w)) card.appendChild(el('div', 'bp-note warning', i18n.t('infra.door.sealedOff')));
  if (canDoors || hasDoor) card.appendChild(el('div', 'bp-hint', i18n.t('infra.door.hint', { n: fmt(DOOR_DRAIN) })));

  // The emergency stairwell of this floor.
  if (canStairs || infraAt(state, 'stairwell', floor).length) {
    const near = stairwellNear(state, floor, 1);
    card.appendChild(el('div', `bp-row ${near ? '' : 'bad'}`, `[[up]] ${i18n.t(near ? 'infra.stair.have' : 'infra.stair.none')}`));
    if (canStairs) {
      const block = columnBlock(state, 'stairwell', floor, 1);
      card.appendChild(costRow(state, columnCost(state, 'stairwell', 1)));
      card.appendChild(button(`[[build]] ${i18n.t('infra.stair.build')}`, 'btn-secondary', () => {
        if (!buildColumn(sm, rs, 'stairwell', floor, 1)) done();
      }, !!block || !rs.canAfford(state, columnCost(state, 'stairwell', 1))));
      if (block) card.appendChild(reason(block));
    }
  }

  // Vent stacks (bunker-wide: each eases the crowding, wherever it stands).
  if (canVents || infraOfKind(state, 'ventStack').length) {
    const n = infraOfKind(state, 'ventStack').length;
    card.appendChild(el('div', 'bp-row', `[[wave]] ${i18n.t('infra.vent.have', { n, max: VENT_MAX_STACKS, relief: Math.min(6, ventilationRelief(state)) })}`));
    if (canVents && n < VENT_MAX_STACKS) {
      const block = columnBlock(state, 'ventStack', floor, 1);
      card.appendChild(costRow(state, columnCost(state, 'ventStack', 1)));
      card.appendChild(button(`[[build]] ${i18n.t('infra.vent.build')}`, 'btn-secondary', () => {
        if (!buildColumn(sm, rs, 'ventStack', floor, 1)) done();
      }, !!block || !rs.canAfford(state, columnCost(state, 'ventStack', 1))));
      if (block) card.appendChild(reason(block));
    }
  }
  return card;
}

import { haptic } from '../../utils/haptics';
import { statusTint } from '../../utils/a11y';
import { HUD } from '../../ui/HUD';
import { i18n } from '../../i18n/I18nManager';
import { getDef } from '../../data/buildingDefs';
import { allowedFloors } from '../../data/zones';
import { BUILDING_ICONS, RESOURCE_ICONS, el } from '../../ui/dom';
import type { BuildingType, Position, ResourceType } from '../../core/GameState';
import { roomFloors } from '../../data/buildingDefs';
import type { IconName } from '../../ui/icons';
import type { GameApp } from '../../app';

/** A bubble is worth two minutes of the room's output (NICE1), so a tap still matters after the first hour. */
const BUBBLE_SECONDS = 120;
/** Now and then a bubble holds a surprise instead: salvage or a bit of know-how (share of that store's cap). */
const BUBBLE_SURPRISE_CHANCE = 0.15;
const BUBBLE_SURPRISE_SHARE = 0.04;
export const PRODUCTION_POPUP_MS = 4000;
const MAX_PRODUCTION_POPUPS = 8;
const RESOURCE_COLORS: Partial<Record<ResourceType, number>> = {
  food: 0x7dff6a, water: 0x6ab8ff, power: 0xffdd44, materials: 0xff9a5a, medicine: 0xff7a9a, knowledge: 0xb48cff,
};

/** Placing rooms, tapping bubbles, dragging people, and production popups in the bunker view. */
export class WorldController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  highlightPlacement(type: BuildingType): void {
    this.app.renderer.setPlacementHighlight(pos => this.app.engine.buildingSystem.canPlaceBuilding(type, pos, this.app.state), roomFloors(type));
  }

  startPlacement(type: BuildingType): void {
    const state = this.app.state;
    const floors = allowedFloors(type, state.currentFloors);
    const target = floors.find(f => this.app.engine.buildingSystem.findFreeSpot(type, f, state)) ?? floors[0];
    this.app.renderer.focusFloor(target);
    this.app.placementMode = type;
    document.body.classList.add('placement-mode');
    const name = getDef(type)?.name[i18n.currentLocale] ?? type;
    this.app.hud.showPlacement(name);
    this.highlightPlacement(type);
  }

  cancelPlacement(): void {
    if (!this.app.placementMode) return;
    this.app.placementMode = null;
    document.body.classList.remove('placement-mode');
    this.app.hud.hidePlacement();
    this.app.renderer.setPlacementHighlight(null);
  }

  rejectAt(pos: Position): void {
    const c = this.app.renderer.slotCenter(pos);
    this.app.popups.spawn(c.x, c.y, '[[close]]', statusTint('bad'));
    haptic('error'); // [plan4:UX-2] every invalid placement is rejected through here
  }

  tryPlaceBuilding(type: BuildingType, pos: Position): boolean {
    const state = this.app.state;
    if (!this.app.engine.buildingSystem.canPlaceBuilding(type, pos, state)) return false;
    const cost = this.app.engine.buildingSystem.getBuildCost(type, state);
    if (!this.app.engine.resourceSystem.spend(this.app.engine.stateManager, cost)) {
      this.app.toasts.show(i18n.t('toast.notEnough'), 'bad');
      return false;
    }
    this.app.engine.buildingSystem.placeBuilding(type, pos, this.app.engine.stateManager);
    this.app.engine.requestSave();
    haptic('success');
    return true;
  }

  /** Working rooms now and then offer a bonus to tap: about half a minute of their output. */
  spawnBubbles(): void {
    if (document.hidden || this.app.introPlaying) return;
    const state = this.app.state;
    for (const b of state.buildings) {
      if (this.app.renderer.hasBubble(b.id) || b.assignedSurvivorIds.length === 0 || Math.random() > 0.28) continue;
      const out = this.app.engine.resourceSystem.getBuildingOutput(state, b);
      const entry = (Object.entries(out) as [ResourceType, number][]).find(([, v]) => v > 0);
      if (!entry) continue;
      this.app.renderer.showBubble(b.id, entry[0] as IconName);
    }
  }

  collectBubble(buildingId: string): void {
    const state = this.app.state;
    const b = state.buildings.find(x => x.id === buildingId);
    const pos = this.app.renderer.popBubble(buildingId);
    if (!b || !pos) return;
    const out = this.app.engine.resourceSystem.getBuildingOutput(state, b);
    const entry = (Object.entries(out) as [ResourceType, number][]).find(([, v]) => v > 0);
    if (!entry) return;
    const [made, rate] = entry;
    let r: ResourceType = made;
    let amount = Math.max(1, Math.round(rate * BUBBLE_SECONDS));
    if (Math.random() < BUBBLE_SURPRISE_CHANCE) {
      r = Math.random() < 0.5 ? 'scrap' : 'knowledge';
      amount = Math.max(3, Math.round(state.resources[r].cap * BUBBLE_SURPRISE_SHARE));
    }
    this.app.engine.resourceSystem.gain(this.app.engine.stateManager, { [r]: amount });
    this.app.audio.play(r === 'water' ? 'drip' : r === 'materials' || r === 'scrap' ? 'coin' : 'collect');
    if (r === 'water') this.app.audio.play('collect', { volume: 0.6 });
    haptic('tap');
    this.flyToHud(r, pos.x, pos.y, `+${amount}`);
    this.app.engine.notifyInteraction();
  }

  /** A collected resource icon arcs up into its HUD counter, which then pulses. */
  flyToHud(r: ResourceType, x: number, y: number, label: string): void {
    const target = this.app.hud.resourceRect(r);
    const fly = el('div', 'fly-icon', `${RESOURCE_ICONS[r] ?? ''} ${label}`);
    fly.style.left = `${x}px`;
    fly.style.top = `${y}px`;
    document.body.appendChild(fly);
    requestAnimationFrame(() => {
      fly.classList.add('go');
      if (target) {
        fly.style.left = `${target.left + target.width / 2}px`;
        fly.style.top = `${target.top + target.height / 2}px`;
      }
    });
    setTimeout(() => {
      fly.remove();
      this.app.hud.pulseResource(r);
    }, 650);
  }

  /** Dropping a carried survivor on a room puts them to work there. */
  dropSurvivor(survivorId: string, targetId: string | null): void {
    const state = this.app.state;
    const s = state.survivors.find(x => x.id === survivorId);
    if (!s || !targetId || targetId === s.assignedBuildingId) return;
    const ps = this.app.engine.populationSystem;
    const name = this.app.localName(s.name);
    if (targetId.startsWith('r_')) {
      const ruin = state.ruins.find(r => r.id === targetId);
      if (!ruin) return;
      if (!ruin.started) {
        this.app.openRuin(targetId);
        return;
      }
      if (!this.app.engine.restorationSystem.assign(targetId, survivorId)) {
        this.app.audio.play('error');
        this.app.toasts.show(`[[warning]] ${i18n.t('people.full')}`, 'bad');
        return;
      }
      this.app.toasts.show(`[[pick]] ${i18n.t('drag.toRuin', { name, ...this.app.gOf(s) })}`, 'good');
    } else {
      const b = state.buildings.find(x => x.id === targetId);
      if (!b) return;
      const def = getDef(b.type);
      if (!def || def.maxWorkers === 0) {
        this.app.audio.play('error');
        this.app.toasts.show(`[[warning]] ${i18n.t('drag.noJobs')}`, 'bad');
        return;
      }
      if (!ps.assignSurvivorToBuilding(this.app.engine.stateManager, survivorId, targetId)) {
        this.app.audio.play('error');
        this.app.toasts.show(`[[warning]] ${i18n.t('drag.full', { room: def.name[i18n.currentLocale] ?? def.name.en })}`, 'bad');
        return;
      }
      this.app.toasts.show(`${BUILDING_ICONS[b.type] ?? ''} ${i18n.t('drag.assigned', { name, room: def.name[i18n.currentLocale] ?? def.name.en, ...this.app.gOf(s) })}`, 'good');
    }
    this.app.audio.play('assign');
    haptic('impact');
    this.app.engine.requestSave();
  }

  spawnProductionPopups(): void {
    if (document.hidden) return;
    const state = this.app.state;
    let shown = 0;
    for (const b of state.buildings) {
      if (shown >= MAX_PRODUCTION_POPUPS) break;
      const out = this.app.engine.resourceSystem.getBuildingOutput(state, b);
      const entry = (Object.entries(out) as [ResourceType, number][]).find(([r, v]) => v > 0 && r !== 'power');
      if (!entry) continue;
      const [r, rate] = entry;
      const amount = rate * (PRODUCTION_POPUP_MS / 1000);
      const c = this.app.renderer.roomCenter(b);
      const delay = Math.random() * 1500;
      setTimeout(() => this.app.popups.spawn(c.x, c.y + 10, `+${amount >= 10 ? Math.round(amount) : amount.toFixed(1)} ${RESOURCE_ICONS[r] ?? ''}`, RESOURCE_COLORS[r]), delay);
      shown++;
    }
  }
}

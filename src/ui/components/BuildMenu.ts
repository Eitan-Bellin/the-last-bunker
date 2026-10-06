import type { BuildingType, GameState } from '../../core/GameState';
import type { ResourceSystem } from '../../systems/ResourceSystem';
import type { BuildingSystem } from '../../systems/BuildingSystem';
import { i18n } from '../../i18n/I18nManager';
import { BUILDABLE_TYPES, getDef } from '../../data/buildingDefs';
import { allowedFloors, zoneForFloor } from '../../data/zones';
import { isBuildingUnlocked, unlockingResearch } from '../../systems/ResearchSystem';
import { Sheet } from './Sheet';
import { ArtLibrary } from '../../art/ArtLibrary';
import { buildingArtKey } from '../../art/registry';
import { BUILDING_ICONS, costRow, el } from '../dom';

export class BuildMenu {
  private sheet = new Sheet('build-sheet', 'build');
  private signature = '';

  onSelectBuilding: ((type: BuildingType) => void) | null = null;

  private resources: ResourceSystem;
  private buildings: BuildingSystem;

  constructor(resources: ResourceSystem, buildings: BuildingSystem) {
    this.resources = resources;
    this.buildings = buildings;
  }

  show(state: GameState): void {
    this.sheet.setTitle(`[[build]] ${i18n.t('build.title')}`);
    this.signature = '';
    this.refresh(state);
    this.sheet.show();
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  refresh(state: GameState): void {
    const entries = BUILDABLE_TYPES.map(type => {
      const cost = this.buildings.getBuildCost(type, state);
      const unlocked = isBuildingUnlocked(state, type);
      return { type, cost, unlocked, affordable: unlocked && this.resources.canAfford(state, cost) };
    });
    const sig = entries.map(e => `${e.type}:${e.unlocked}:${e.affordable}:${JSON.stringify(e.cost)}`).join('|') + i18n.currentLocale;
    if (sig === this.signature) return;
    this.signature = sig;

    const locale = i18n.currentLocale;
    const list = el('div', 'build-list');
    for (const { type, cost, affordable, unlocked } of entries) {
      const def = getDef(type);
      if (!def) continue;

      const item = el('div', `build-item ${affordable ? '' : 'disabled'} ${unlocked ? '' : 'locked'}`);
      // The room's own painting is its card art; the icon badge sits on top.
      const icon = el('div', 'build-icon build-thumb');
      const art = buildingArtKey(type, 0);
      if (art) icon.style.backgroundImage = `url(${ArtLibrary.url(art)})`;
      else icon.style.background = def.color;
      icon.appendChild(el('span', 'build-badge', BUILDING_ICONS[type] ?? ''));

      const info = el('div', 'build-info');
      info.appendChild(el('div', 'build-item-name', def.name[locale] ?? def.name.en));
      info.appendChild(el('div', 'build-item-desc', def.description[locale] ?? def.description.en));

      const meta = el('div', 'build-meta');
      const floors = allowedFloors(type);
      if (floors.length === 1) {
        const zone = zoneForFloor(floors[0]);
        meta.appendChild(el('span', 'zone-chip', `${zone.icon} B${zone.floor + 1} ${zone.name[locale] ?? zone.name.en}`));
      }
      meta.appendChild(el('span', '', `[[clock]] ${i18n.formatDuration(def.constructionTime)}`));
      if (def.powerConsumption > 0) meta.appendChild(el('span', '', `[[power]] −${def.powerConsumption}`));
      if (def.maxWorkers > 0) meta.appendChild(el('span', '', `[[worker]] ${def.maxWorkers}`));
      info.appendChild(meta);
      if (unlocked) {
        info.appendChild(costRow(state, cost));
      } else {
        const req = unlockingResearch(type);
        info.appendChild(el('div', 'bp-hint', `[[lock]] ${i18n.t('build.needsResearch', { name: req?.name[locale] ?? '' })}`));
      }

      item.append(icon, info);
      item.addEventListener('click', () => {
        if (!unlocked || !this.resources.canAfford(state, cost)) return;
        this.hide();
        this.onSelectBuilding?.(type);
      });
      list.appendChild(item);
    }
    this.sheet.body.replaceChildren(list);
  }
}

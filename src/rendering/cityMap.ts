import { Container, Graphics, Text } from 'pixi.js';
import type { BuildingType, GameState } from '../core/GameState';
import { isDistrict, isHall, roomSlots } from '../data/buildingDefs';
import { zoneForFloor } from '../data/zones';
import { BASE_EAST, BUILDING_W, ROOMS_X, SHAFT_W, SLAB, SLOT_W, TOPSOIL, buildingH, buildingX, extentsFor, floorTop, galleryCount, galleryTop, GALLERY_H, slotX } from './layout';
import { hashString } from './draw';

export interface CityMap {
  container: Container;
  animate: (state: GameState, t: number, night: number) => void;
}

const CATEGORY: Partial<Record<BuildingType, number>> = {
  farm: 0x7dff6a, hydroponics: 0x7dff6a,
  waterPump: 0x4ab8ff, waterPurifier: 0x4ab8ff,
  generator: 0xffd84a, reactor: 0xffd84a, reactorHall: 0xfff07a,
  quarters: 0xffb070, canteen: 0xffb070, medbay: 0xff8aa0, atrium: 0xc8ff8a,
  laboratory: 0x9a8cff, radioTower: 0x9a8cff,
  armory: 0xff6a5a, trainingRoom: 0xff6a5a,
  workshop: 0xffa040, storage: 0xc8b08a,
  cave: 0x6affd0, lake: 0x6ad8ff, metro: 0xffc060,
  // [plan4:BL-9..14,19,33]
  batteryBank: 0xffd84a, commons: 0xffb070, library: 0x9a8cff, recycler: 0xffa040,
  condenser: 0x4ab8ff, mushroomFarm: 0x7dff6a, gatePost: 0xff6a5a, barracks: 0xff6a5a,
  // [plan4:BL-15..32]
  quarantineWard: 0xff6a8a, solarArray: 0xffd84a, windTurbine: 0x9ad8e8, watchtower: 0xff6a5a, garage: 0xffc060, decon: 0x6affd0,
  aquaculture: 0x6ad8ff, market: 0xffc060, nursery: 0xffb0d0, school: 0x9a8cff, bathhouse: 0x6ad8ff, memorialHall: 0xffb070,
  // [plan4:BL-24,25,34..38]
  geothermal: 0xff7a3a, oldVault: 0xc8c070, componentsPlant: 0xffa040, alloyFoundry: 0xff6a2a, dataCenter: 0x5ab8ff, forum: 0xffc860, seedLab: 0x7affb0,
};

/**
 * Far zoom level (Sprint 7): the bunker seen as a living city map at night. Every room is a lit window
 * in its trade's colour, residents are moving sparks, crises flash red, and each level is labelled.
 */
export function buildCityMap(state: GameState, floors: number, locale: string): CityMap {
  const container = new Container();
  container.eventMode = 'none';
  container.alpha = 0;
  const exts = extentsFor(state, floors); // [plan4:ST-4] a wing is a lit rectangle on the map
  const maxW = exts.reduce((m, x) => Math.max(m, x.w), 0), maxE = exts.reduce((m, x) => Math.max(m, x.e), BASE_EAST);
  const left = maxW > 0 ? Math.min(-28, slotX(-maxW) - 28) : -28;
  const right = Math.max(BUILDING_W, slotX(maxE), ...state.buildings.map(b => buildingX(b) + roomSlots(b.type) * SLOT_W)) + 24;
  const top = TOPSOIL - SLAB - 8;
  const bottom = floorTop(floors) + 6;

  const base = new Graphics();
  base.rect(left, top, right - left, bottom - top).fill({ color: 0x040712, alpha: 0.86 });
  // Blueprint grid.
  for (let x = left; x < right; x += 23) base.rect(x, top, 1, bottom - top).fill({ color: 0x3a8aff, alpha: 0.06 });
  for (let f = 0; f <= floors; f++) {
    const y = f < floors ? floorTop(f) - SLAB / 2 : floorTop(f) - SLAB / 2;
    base.rect(left, y, right - left, 1.5).fill({ color: 0x5ab8ff, alpha: 0.35 });
  }
  for (let f = 0; f < floors; f++) {
    const x = exts[f];
    if (x.w === 0 && x.e <= BASE_EAST) continue;
    // The dug reach of a wide floor: a pale band the length of the floor, brighter beyond the classic twelve slots.
    base.rect(slotX(-x.w), floorTop(f) + 4, (x.w + x.e) * SLOT_W, 100 - 8).fill({ color: 0x5ab8ff, alpha: 0.1 });
  }
  // [plan4:ST-1] Service galleries: an orange line each, so the far view reads the rhythm of the floors.
  for (let g = 0; g < galleryCount(floors); g++) base.rect(left, galleryTop(g) + GALLERY_H / 2 - 1.5, right - left, 3).fill({ color: 0xff9a3a, alpha: 0.5 });
  // The shaft as a column of light.
  base.rect(SHAFT_W / 2 - 3, top, 6, bottom - top).fill({ color: 0xffd47a, alpha: 0.18 });
  container.addChild(base);

  const windows = new Graphics();
  windows.blendMode = 'add';
  container.addChild(windows);

  for (let f = 0; f < floors; f++) {
    const zone = zoneForFloor(f);
    const label = new Text({
      text: `B${f + 1} · ${zone.name[locale] ?? zone.name.en}`,
      style: { fontFamily: 'Rubik, sans-serif', fontSize: 22, fontWeight: '700', fill: 0xbfe6ff },
      resolution: 2,
    });
    label.anchor.set(0, 0.5);
    const ly = floorTop(f) - SLAB / 2;
    const pill = new Graphics();
    pill.roundRect(ROOMS_X - 4, ly - 15, label.width + 16, 30, 6).fill({ color: 0x06101e, alpha: 0.92 }).stroke({ color: 0x5ab8ff, width: 1.5, alpha: 0.7 });
    label.position.set(ROOMS_X + 4, ly);
    container.addChild(pill, label);
  }

  return {
    container,
    animate: (s, t, night) => {
      const g = windows;
      g.clear();
      const glow = 0.55 + 0.35 * night;
      for (const b of s.buildings) {
        const x = buildingX(b), y = floorTop(b.position.floor);
        const w = roomSlots(b.type) * SLOT_W;
        const h = buildingH(b.type);
        if (b.isConstructing && b.level === 1) {
          for (let dx = 0; dx < w; dx += 10) g.rect(x + dx, y + 4, 6, 2).fill({ color: 0xffb547, alpha: 0.7 });
          continue;
        }
        const color = CATEGORY[b.type] ?? 0xffe2b0;
        const seed = hashString(b.id) % 100;
        const flick = 0.85 + 0.15 * Math.sin(t * (1.3 + (seed % 7) * 0.2) + seed);
        const crisis = s.incidents?.some(i => i.buildingId === b.id);
        const c = crisis ? (Math.sin(t * 8) > 0 ? 0xff3a2a : 0x6a0a04) : color;
        const pad = isDistrict(b.type) ? 8 : 4;
        g.roundRect(x + pad, y + 8, w - pad * 2, h - 14, isDistrict(b.type) ? 18 : 3).fill({ color: c, alpha: 0.22 * glow * flick });
        g.roundRect(x + pad, y + 8, w - pad * 2, h - 14, isDistrict(b.type) ? 18 : 3).stroke({ color: c, alpha: 0.75 * glow, width: 2 });
        if (isHall(b.type)) g.rect(x + w / 2 - 1, y + 10, 2, h - 18).fill({ color: c, alpha: 0.4 * glow });
      }
      // Residents as sparks drifting through their rooms.
      for (const sv of s.survivors) {
        if (sv.isOnMission) continue;
        const b = s.buildings.find(x => x.id === sv.assignedBuildingId)
          ?? s.buildings.find(x => x.type === 'quarters');
        if (!b) continue;
        const seed = hashString(sv.id);
        const x0 = buildingX(b) + 10, w = roomSlots(b.type) * SLOT_W - 20;
        const k = 0.5 + 0.5 * Math.sin(t * (0.3 + (seed % 5) * 0.08) + seed);
        const px = x0 + w * k;
        const py = floorTop(b.position.floor) + buildingH(b.type) - 14;
        g.circle(px, py, sv.child ? 3.6 : 5).fill({ color: 0xffffff, alpha: 0.95 });
        g.circle(px, py, 13).fill({ color: CATEGORY[b.type] ?? 0xffe2b0, alpha: 0.3 });
      }
    },
  };
}

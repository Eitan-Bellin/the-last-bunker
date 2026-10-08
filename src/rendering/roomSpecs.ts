/**
 * [plan4:BL-6/BL-7] Appearance of the composed rooms: the specs of wave 1 (roomSpecsA.ts, the 8 rooms of BL-9..14, 19, 33) and wave 2
 * (roomSpecsB.ts, BL-15..18, 20..23, 26, 30..32), plus what their people do (ROOM_ACTIVITY) and wear (JOB_OUTFIT).
 *
 * [plan4:BL-7 wave 3] also the five Act rooms and the two new districts (roomSpecsC.ts, roomSpecsD.ts).
 * Everything is keyed by building type NAME. The wave 2 types are added to `BuildingType` by Rooms-Data; until they exist a spec is simply
 * never asked for (the registry only looks a spec up for a type that is being drawn), and the two tables below are spread into the
 * people.ts tables as plain string-keyed records (a key that is not a building type yet is harmless there).
 * Signage is pictograms only: rooms are mirrored for every second neighbour and the game is bilingual.
 */
import { registerRoomSpecs } from './roomComposer';
import { SPECS_A } from './roomSpecsA';
import { SPECS_B } from './roomSpecsB';
import { SPECS_C } from './roomSpecsC'; // [plan4:BL-7] wave 3: the five Act rooms
import { SPECS_D } from './roomSpecsD'; // [plan4:BL-7] wave 3: the two new districts

registerRoomSpecs({ ...SPECS_A, ...SPECS_B, ...SPECS_C, ...SPECS_D });

/** The clip each room's workers play (names of the `Activity` union in people.ts); rooms with no crew have none. */
export const LOOK_ACTIVITY: Record<string, string> = {
  // wave 1 keeps its entries in people.ts (BL-9..14, 19, 33); wave 2:
  quarantineWard: 'tend', garage: 'wrench', decon: 'idle', aquaculture: 'water', market: 'carry',
  nursery: 'tend', school: 'inspect', bathhouse: 'idle', memorialHall: 'idle', watchtower: 'idle',
  // wave 3 (doc 02 section 4.3: geothermal tend, vault search = the existing 'inspect' clip); existing clips only
  componentsPlant: 'wrench', alloyFoundry: 'hammer', dataCenter: 'type', forum: 'idle', seedLab: 'tend', geothermal: 'tend', oldVault: 'inspect',
};

/** Room soundscape of the wave 2 rooms (keys of `AmbienceKey`, audio/ambience.ts), from doc 02 section 4.3; spread into AMBIENCE_FOR. */
export const LOOK_AMBIENCE: Record<string, string> = {
  quarantineWard: 'medical', solarArray: 'air', windTurbine: 'air', watchtower: 'air', garage: 'workshop', decon: 'water',
  aquaculture: 'water', market: 'kitchen', nursery: 'base', school: 'base', bathhouse: 'water', memorialHall: 'air',
  // wave 3: a plant hums like a workshop, the foundry roars like a machine hall, the vent is the reactor's low rumble (doc 02 section 4.3)
  componentsPlant: 'workshop', alloyFoundry: 'machine', dataCenter: 'electronics', forum: 'base', seedLab: 'air', geothermal: 'reactor', oldVault: 'air',
};

export interface LookOutfit {
  top: number;
  bottom: number;
  hat: 'straw' | 'hard' | 'chef' | 'cap' | 'helmet' | 'headset' | 'hazmat' | null;
  tool: 'can' | 'hammer' | 'wrench' | 'spoon' | 'clipboard' | 'box' | 'pick' | 'dumbbell' | null;
  coat?: number;
  apron?: number;
  goggles?: boolean;
}

/** Work clothes of the wave 2 rooms (dusty, muted, like the rest: saturation is for alerts). Solar and wind have no crew. */
export const LOOK_OUTFIT: Record<string, LookOutfit> = {
  quarantineWard: { top: 0x6a9e9a, bottom: 0x5a8a86, hat: 'hazmat', tool: 'clipboard', coat: 0xe8e6de, goggles: true },
  garage: { top: 0x7a6a4a, bottom: 0x3a3328, hat: 'hard', tool: 'wrench', apron: 0x4a3a2a, goggles: true },
  decon: { top: 0xb8a64e, bottom: 0xa08e44, hat: 'hazmat', tool: null, goggles: true },
  aquaculture: { top: 0x3a5a6a, bottom: 0x2e3a4e, hat: 'cap', tool: 'can' },
  market: { top: 0x9a8450, bottom: 0x3a3a42, hat: 'cap', tool: 'box', apron: 0x8a6a4a },
  nursery: { top: 0xa08a7a, bottom: 0x4a4a52, hat: null, tool: null, apron: 0xcfc8b6 },
  school: { top: 0x6c5c74, bottom: 0x2e3a4e, hat: null, tool: 'clipboard' },
  bathhouse: { top: 0x8a9a9a, bottom: 0x4a5a62, hat: null, tool: null, apron: 0xd8d4c8 },
  memorialHall: { top: 0x4a4a52, bottom: 0x2a2a2a, hat: null, tool: null },
  watchtower: { top: 0x5a5a3a, bottom: 0x3a3a2a, hat: 'helmet', tool: null },
  // wave 3
  componentsPlant: { top: 0x6a7480, bottom: 0x3a3328, hat: 'hard', tool: 'wrench', apron: 0x4a4a3a, goggles: true },
  alloyFoundry: { top: 0x8a5a3a, bottom: 0x3a3328, hat: 'helmet', tool: 'hammer', apron: 0x4a3a2a, goggles: true },
  dataCenter: { top: 0x4a6a8a, bottom: 0x2e3a4e, hat: 'headset', tool: 'clipboard' },
  forum: { top: 0x9a8450, bottom: 0x3a3a42, hat: null, tool: null },
  seedLab: { top: 0x5a7a5a, bottom: 0x2e3a4e, hat: null, tool: 'clipboard', coat: 0xe4e2da, goggles: true },
  geothermal: { top: 0x9a6a46, bottom: 0x6a4a30, hat: 'hard', tool: 'wrench', goggles: true },
  oldVault: { top: 0x6c5c74, bottom: 0x2e3a4e, hat: 'cap', tool: 'clipboard' },
};

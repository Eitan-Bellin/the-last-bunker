/**
 * [plan4:BL-6/BL-7] Appearance of the composed rooms: the specs of wave 1 (roomSpecsA.ts, the 8 rooms of BL-9..14, 19, 33) and wave 2
 * (roomSpecsB.ts, BL-15..18, 20..23, 26, 30..32), plus what their people do (ROOM_ACTIVITY) and wear (JOB_OUTFIT).
 *
 * Everything is keyed by building type NAME. The wave 2 types are added to `BuildingType` by Rooms-Data; until they exist a spec is simply
 * never asked for (the registry only looks a spec up for a type that is being drawn), and the two tables below are spread into the
 * people.ts tables as plain string-keyed records (a key that is not a building type yet is harmless there).
 * Signage is pictograms only: rooms are mirrored for every second neighbour and the game is bilingual.
 */
import { registerRoomSpecs } from './roomComposer';
import { SPECS_A } from './roomSpecsA';
import { SPECS_B } from './roomSpecsB';

registerRoomSpecs({ ...SPECS_A, ...SPECS_B });

/** The clip each room's workers play (names of the `Activity` union in people.ts); rooms with no crew have none. */
export const LOOK_ACTIVITY: Record<string, string> = {
  // wave 1 keeps its entries in people.ts (BL-9..14, 19, 33); wave 2:
  quarantineWard: 'tend', garage: 'wrench', decon: 'idle', aquaculture: 'water', market: 'carry',
  nursery: 'tend', school: 'inspect', bathhouse: 'idle', memorialHall: 'idle', watchtower: 'idle',
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
};

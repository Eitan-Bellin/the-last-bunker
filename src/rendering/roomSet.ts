/**
 * Plan 2026-10 M1 (Room Set Data): what each painting offers people. Placed by eye on the paintings (see tools/roomset.html,
 * which draws every entry over its painting for review), in fractions of the painting's width (x) and height (y), so one
 * entry serves every room size and mirrors with the room.
 *
 *  - `beds`   mattress surfaces to lie on: `y` is the mattress top, `head` the side the pillow is on (-1 left, 1 right);
 *  - `seats`  places to sit: `y` is the seat surface (stool, bench, bunk edge), `face` the way they look (1 = right),
 *             `kind` what they do there ('sit' resting and talking, 'eat' at the table);
 *  - `front`  polygons of the painting that stand in FRONT of people (a footboard, a table edge): the painting is drawn
 *             again over the people inside them, so legs go behind furniture (M2).
 *
 * Only paintings listed here give people anything to use; every other room keeps its work spots (workSpots.ts).
 */
import { composedKey } from '../art/registry'; // [plan4:BL-6]
import { composedMeta, composedTypes } from './roomComposer'; // [plan4:BL-6]

export interface BedDef { x: number; y: number; head: -1 | 1 }
export interface SeatDef { x: number; y: number; face: 1 | -1; kind: 'sit' | 'eat' }
export interface RoomSetDef {
  beds?: readonly BedDef[];
  seats?: readonly SeatDef[];
  front?: readonly (readonly (readonly [number, number])[])[];
}

// Quarters: two bunk beds (tiers 0 and 1) or four sleeping pods (tier 2), a rug in front. Two more sleepers fit on the rug.
const QUARTERS_OLD: RoomSetDef = {
  beds: [
    { x: 0.21, y: 0.665, head: -1 }, { x: 0.21, y: 0.4, head: -1 }, { x: 0.77, y: 0.67, head: -1 }, { x: 0.77, y: 0.41, head: -1 },
    { x: 0.34, y: 0.925, head: -1 }, { x: 0.66, y: 0.94, head: 1 },
  ],
  seats: [{ x: 0.33, y: 0.665, face: 1, kind: 'sit' }, { x: 0.74, y: 0.67, face: -1, kind: 'sit' }],
};

export const ROOM_SET: Record<string, RoomSetDef> = {
  'rooms/quarters-0': QUARTERS_OLD,
  'rooms/quarters-1': { ...QUARTERS_OLD, beds: [
    { x: 0.21, y: 0.665, head: -1 }, { x: 0.21, y: 0.385, head: -1 }, { x: 0.77, y: 0.665, head: -1 }, { x: 0.77, y: 0.385, head: -1 },
    { x: 0.34, y: 0.93, head: -1 }, { x: 0.66, y: 0.945, head: 1 },
  ] },
  'rooms/quarters-2': {
    beds: [
      { x: 0.245, y: 0.69, head: -1 }, { x: 0.245, y: 0.455, head: -1 }, { x: 0.755, y: 0.69, head: -1 }, { x: 0.755, y: 0.455, head: -1 },
      { x: 0.36, y: 0.93, head: -1 }, { x: 0.64, y: 0.945, head: 1 },
    ],
    seats: [{ x: 0.34, y: 0.69, face: 1, kind: 'sit' }, { x: 0.7, y: 0.69, face: -1, kind: 'sit' }],
  },
  // Canteen: a table with a stool or bench on each side (the top tier has a counter instead: nobody sits).
  'rooms/canteen-0': { seats: [{ x: 0.33, y: 0.755, face: 1, kind: 'eat' }, { x: 0.83, y: 0.755, face: -1, kind: 'eat' }] },
  'rooms/canteen-1': { seats: [{ x: 0.17, y: 0.745, face: 1, kind: 'eat' }, { x: 0.9, y: 0.745, face: -1, kind: 'eat' }] },
};

// ---- [plan4:BL-6] composed rooms: beds, seats and work spots come from the room's own spec (dry pass), under the same keys as paintings ----

/** Work spots of the composed rooms in workSpots.ts' own format (`[x, face, activity?, depth?]`); spread into its ROOMS table. */
export const COMPOSED_SPOTS: Record<string, { spots: readonly (readonly [number, 1 | -1, string?, number?])[] }> = {};

for (const type of composedTypes()) {
  for (const tier of [0, 1, 2] as const) {
    const key = `rooms/${type}-${tier}`;
    const ck = composedKey(key);
    if (!ck || ck.painted) continue; // a painted room has its own hand-placed data
    const m = composedMeta(type, tier, ck.slots);
    if (!m) continue;
    if (m.beds.length || m.seats.length) ROOM_SET[key] = { beds: m.beds, seats: m.seats };
    if (m.spots.length) COMPOSED_SPOTS[key] = { spots: m.spots };
  }
}

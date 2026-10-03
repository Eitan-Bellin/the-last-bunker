import type { BuildingType, ResourceType, Ruin, RuinKind } from '../core/GameState';
import { roomSlots } from './buildingDefs';

export interface RuinKindDef {
  name: Record<string, string>;
  desc: Record<string, string>;
  /** Seconds of work for one average worker, per slot. */
  workPerSlot: number;
  cost: Partial<Record<ResourceType, number>>;
  loot: Partial<Record<ResourceType, [number, number]>>;
}

// S8: collapsed and flooded areas are real work (x2), so the Remnant lasts minutes; wrecked rooms stay quick wins.
export const RUIN_KINDS: Record<RuinKind, RuinKindDef> = {
  collapsed: {
    name: { he: 'תקרה שקרסה', en: 'Collapsed ceiling' },
    desc: { he: 'גוש בטון וברזל סוגר את החלל. צריך לפנות את ההריסות ולחזק את התקרה.', en: 'A mass of concrete and steel blocks the space. The rubble must be cleared and the ceiling shored up.' },
    workPerSlot: 28, cost: { materials: 10 }, loot: { materials: [15, 30], scrap: [6, 14] },
  },
  debris: {
    name: { he: 'חדר נטוש', en: 'Abandoned room' },
    desc: { he: 'רהיטים הפוכים, ארגזים ואבק של שנים. אולי משהו שימושי מחכה מתחת.', en: 'Overturned furniture, crates and years of dust. Something useful may be waiting underneath.' },
    workPerSlot: 9, cost: {}, loot: { materials: [8, 18], scrap: [4, 10], food: [0, 12] },
  },
  flooded: {
    name: { he: 'אזור מוצף', en: 'Flooded area' },
    desc: { he: 'מים עומדים ושחורים עד הברכיים. צריך משאבת מים פעילה כדי לנקז את האזור.', en: 'Black standing water, knee deep. A working water pump is needed to drain the area.' },
    workPerSlot: 32, cost: { materials: 15 }, loot: { scrap: [10, 20], materials: [10, 20], medicine: [0, 4] },
  },
  wreck: {
    name: { he: 'חדר הרוס', en: 'Wrecked room' },
    desc: { he: 'החדר עוד שם, מתחת לחלודה. אפשר לשקם אותו בזול יותר מלבנות חדש.', en: 'The room is still there, under the rust. It can be restored for less than building a new one.' },
    workPerSlot: 11, cost: { materials: 15, scrap: 5 }, loot: { scrap: [2, 6] },
  },
};

interface RuinSeed {
  floor: number;
  x: number;
  w: number;
  kind: RuinKind;
  restoresTo?: BuildingType;
  flooded?: boolean;
  lore?: string;
}

/** The bunker as the newcomers find it: one dry room on B1, everything else to win back. */
const START_LAYOUT: RuinSeed[] = [
  { floor: 0, x: 3, w: 3, kind: 'collapsed', lore: 'welcome' },
  { floor: 0, x: 6, w: 2, kind: 'wreck', restoresTo: 'canteen', lore: 'photo41' },
  { floor: 0, x: 8, w: 2, kind: 'debris', lore: 'drawing' },
  { floor: 0, x: 10, w: 2, kind: 'wreck', restoresTo: 'medbay', lore: 'medicine' },
  { floor: 1, x: 0, w: 2, kind: 'wreck', restoresTo: 'waterPump' },
  { floor: 1, x: 2, w: 3, kind: 'wreck', restoresTo: 'farm', lore: 'seeds' },
  { floor: 1, x: 5, w: 3, kind: 'debris', lore: 'rations' },
  { floor: 1, x: 8, w: 2, kind: 'collapsed', lore: 'day1' },
  { floor: 1, x: 10, w: 2, kind: 'debris' },
  { floor: 2, x: 0, w: 2, kind: 'wreck', restoresTo: 'generator', lore: 'generatorTape' },
  { floor: 2, x: 2, w: 3, kind: 'flooded', flooded: true, lore: 'flood' },
  { floor: 2, x: 5, w: 2, kind: 'wreck', restoresTo: 'workshop', flooded: true, lore: 'workshopNotes' },
  { floor: 2, x: 7, w: 3, kind: 'flooded', flooded: true, lore: 'signal' },
  { floor: 2, x: 10, w: 2, kind: 'flooded', flooded: true, lore: 'vote' },
];

/** Flooded areas in a fresh bunker (the Remnant's goal asks for one of them to be drained). */
export const START_FLOODED = START_LAYOUT.filter(r => r.flooded).length;

/** Lore found deeper down when new levels are dug. */
export const DIG_LORE: Record<number, string> = { 3: 'sickness', 4: 'reactorPlans', 5: 'lastTape' };

export function seedRuins(): Ruin[] {
  return START_LAYOUT.map((r, i) => {
    const def = RUIN_KINDS[r.kind];
    const w = r.restoresTo ? roomSlots(r.restoresTo) : r.w;
    return {
      id: `r_${i + 1}`,
      floor: r.floor,
      x: r.x,
      w,
      kind: r.kind,
      restoresTo: r.restoresTo ?? null,
      flooded: !!r.flooded,
      progress: 0,
      total: Math.round(def.workPerSlot * w * (r.flooded ? 1.3 : 1)),
      started: false,
      lore: r.lore ?? null,
    };
  });
}

export function ruinCost(r: Ruin): Partial<Record<ResourceType, number>> {
  const base = RUIN_KINDS[r.kind].cost;
  const out: Partial<Record<ResourceType, number>> = {};
  for (const [k, v] of Object.entries(base)) out[k as ResourceType] = Math.round((v ?? 0) * (r.w / 2));
  if (r.flooded && r.kind === 'wreck') out.materials = (out.materials ?? 0) + 10;
  return out;
}

export const MAX_RUIN_WORKERS = 2;

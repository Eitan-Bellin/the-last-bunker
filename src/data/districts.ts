import type { BuildingType, GameState, ResourceType } from '../core/GameState';
import type { IconName } from '../ui/icons';

/**
 * Districts (Sprint 7): natural spaces found by digging sideways out of the bunker's east wall.
 * Each is a wide painted cavern that works like a big room with its own trade.
 *
 * [plan4:ST-8] Data-driven: the sign, the choice card (ui/controllers/dig.ts) and the sim bot all read `availableDistricts`.
 * To add a district kind (BL-24 geothermal, BL-25 oldVault) it is enough to: add an entry to DISTRICTS (floor = the level index it opens on,
 * `needsFlag` / `minAct` for its gate, no `after` so it is offered next to the others), add its definition to data/buildings.json, add the type to
 * `BuildingType` (core/GameState.ts), to `DISTRICT_KINDS` (data/buildingDefs.ts) and its painting key to `DISTRICT_KEYS` (art/registry.ts).
 * `tools/sim/lint.ts` fails if any of these lists disagree.
 */
export type DistrictKind = 'cave' | 'lake' | 'metro' | 'geothermal' | 'oldVault'; // [plan4:BL-24,25] the two Act districts

export interface DistrictDef {
  kind: DistrictKind;
  icon: IconName;
  /** The level index (0 = B1) it opens on; also the lowest one where the tunnel can reach it. One district per floor. */
  floor: number;
  /** The tunnel is only offered once this district is dug (the first three keep their old order; the new kinds leave it out). */
  after?: DistrictKind;
  /** Story flag that must be set. */
  needsFlag?: string;
  /** Lowest Act (longGame.meta.act). */
  minAct?: number;
  /** [plan4:BL-24,25] Research node that must be finished (the node that also carries the room's `unlock`). */
  needsResearch?: string;
  cost: Partial<Record<ResourceType, number>>;
  name: Record<'he' | 'en', string>;
  find: Record<'he' | 'en', string>;
}

export const DISTRICTS: DistrictDef[] = [
  {
    kind: 'cave', icon: 'sparkle', floor: 1,
    cost: { materials: 300, scrap: 60 },
    name: { he: 'מערת הגבישים', en: 'Crystal Cave' },
    find: {
      he: 'המכושים פרצו לחלל עצום. גבישים ירוקים זוהרים בקירות, ומים מטפטפים מהתקרה. מקום מושלם לכרייה, ולמחקר.',
      en: 'The picks broke into a vast hollow. Green crystals glow in the walls and water drips from the ceiling. Perfect for mining, and for study.',
    },
  },
  {
    kind: 'lake', icon: 'wave', floor: 2, after: 'cave',
    cost: { materials: 500, scrap: 100 },
    name: { he: 'האגם התת־קרקעי', en: 'Underground Lake' },
    find: {
      he: 'מאחורי הסלע: אגם שקט ושחור, ועליו סירה ישנה קשורה למזח. המים נקיים. יש בהם דגים עיוורים.',
      en: 'Behind the rock: a still black lake with an old boat tied to a jetty. The water is clean. There are blind fish in it.',
    },
  },
  {
    kind: 'metro', icon: 'district', floor: 3, after: 'lake',
    cost: { materials: 800, scrap: 160, blueprints: 1 },
    name: { he: 'תחנת המטרו הנטושה', en: 'Abandoned Metro Station' },
    find: {
      he: 'רציף שלם, קרון שירד מהפסים ושלטים חלודים. המנהרות ממשיכות לכל העיר. המשלחות יגיעו מהר יותר.',
      en: 'A whole platform, a derailed car and rusty signs. The tunnels run under the entire city. Expeditions will travel faster.',
    },
  },
  // [plan4:BL-24,25] The two Act districts: no `after`, so they are offered beside the classic ones once their research is done and their Act has come.
  // Floors (levels, 0 = B1): the vault opens on B6 (index 5), the vent on B7 (index 6); 02-new-buildings.md asks for "floor >= 5 / >= 6".
  {
    kind: 'geothermal', icon: 'fire', floor: 6, minAct: 4, needsResearch: 'geothermalVents',
    cost: { materials: 900, scrap: 180, blueprints: 1 },
    name: { he: 'מערת קיטור', en: 'Geothermal Vent' },
    find: {
      he: 'הסלע חם מתחת לידיים. סדקים אדומים בקיר, וקיטור שנפלט בשריקה. כאן אפשר לקבל חשמל בלי דלק, אם נזהרים.',
      en: 'The rock is hot under the hands. Red cracks in the wall and steam hissing out. Here there is power without fuel, if we are careful.',
    },
  },
  {
    kind: 'oldVault', icon: 'vault', floor: 5, minAct: 5, needsResearch: 'vaultSurvey',
    cost: { materials: 1000, scrap: 200 },
    name: { he: 'כספת טרום־מלחמה', en: 'Pre-War Vault' },
    find: {
      he: 'דלת פלדה עצומה, עבה כמו קיר, ומאחוריה מגירות ארוכות. כולן מלאות תוכניות ישנות. מישהו שמר כאן את מה שהעולם הישן ידע.',
      en: 'A huge steel door, as thick as a wall, and long drawers behind it. All of them full of old plans. Someone kept here what the old world knew.',
    },
  },
];

export const DISTRICT_TYPES: BuildingType[] = DISTRICTS.map(d => d.kind);

export function districtDef(kind: string): DistrictDef | undefined {
  return DISTRICTS.find(d => d.kind === kind);
}

/**
 * [plan4:ST-8] Every district the player can tunnel to right now: not dug yet, its level exists, its predecessor is dug, its gate is open
 * and no other district already sits on its floor (one eastern district per floor). With the three classic kinds this is a list of one,
 * in the old fixed order.
 */
export function availableDistricts(state: GameState): DistrictDef[] {
  if (!state.storyFlags.includes('districts:unlocked')) return [];
  const act = state.longGame?.meta.act ?? 1;
  return DISTRICTS.filter(d =>
    !state.buildings.some(b => b.type === d.kind)
    && d.floor < state.currentFloors
    && (!d.after || state.buildings.some(b => b.type === d.after))
    && (!d.needsFlag || state.storyFlags.includes(d.needsFlag))
    && (d.minAct === undefined || act >= d.minAct)
    && (!d.needsResearch || !!state.research?.[d.needsResearch]?.completed) // plan4:BL-24,25
    && !state.buildings.some(b => b.position.floor === d.floor && DISTRICT_TYPES.includes(b.type)));
}

/** The first district on offer, if any (kept for callers that do not offer a choice: the bot, the single sign). */
export function nextDistrict(state: GameState): DistrictDef | undefined {
  return availableDistricts(state)[0];
}

/** Expeditions travel through the metro tunnels. */
export function metroSpeedup(state: GameState): number {
  return state.buildings.some(b => b.type === 'metro' && !b.isConstructing) ? 0.75 : 1;
}

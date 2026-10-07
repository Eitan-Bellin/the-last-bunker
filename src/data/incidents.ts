import type { BuildingInstance, BuildingType, DisasterKind, GameState, IncidentKind, ResourceType, SurvivorStats } from '../core/GameState';
import type { IconName } from '../ui/icons';
import { BUILDING_DEFS, effectiveLevel, isPowerPlant } from './buildingDefs';

/** In-room crises (Sprint 6). Each kind has the rooms it strikes, the skill that fights it and what it costs while it burns. */
export interface IncidentDef {
  kind: IncidentKind;
  icon: IconName;
  color: number;
  stat: keyof SurvivorStats;
  rooms: Partial<Record<BuildingType, number>>;
  /** Spend this to end it at once. */
  quickFix: Partial<Record<ResourceType, number>>;
  /** Resource loss per second at full severity. */
  drain?: Partial<Record<ResourceType, number>>;
  /** Health loss per second at full severity for everyone in the room. */
  harm?: number;
  /** Shuts down every room on the floor, not just its own. */
  wholeFloor?: boolean;
  /** Only rooms on the top floor (raiders come in from above). */
  topFloor?: boolean;
  name: Record<'he' | 'en', string>;
  desc: Record<'he' | 'en', string>;
  fight: Record<'he' | 'en', string>;
  fixLabel: Record<'he' | 'en', string>;
}

/** [plan4:BL-8] Blackout weights: the old table for the three plants, 2 for any later fuel plant; weather-fed plants (shape) never short out. */
function blackoutRooms(): Partial<Record<BuildingType, number>> {
  const known: Partial<Record<BuildingType, number>> = { generator: 3, reactor: 2, reactorHall: 2 };
  const out: Partial<Record<BuildingType, number>> = {};
  for (const type of Object.keys(BUILDING_DEFS) as BuildingType[]) {
    if (!isPowerPlant(type) || BUILDING_DEFS[type].shape) continue;
    out[type] = known[type] ?? 2;
  }
  return out;
}

export const INCIDENTS: Record<IncidentKind, IncidentDef> = {
  fire: {
    kind: 'fire', icon: 'fire', color: 0xff7a2a, stat: 'endurance',
    rooms: { generator: 3, reactor: 2, reactorHall: 2, workshop: 2, canteen: 2, laboratory: 1.5, armory: 1, storage: 1, metro: 0.5,
      batteryBank: 2.5, recycler: 1.5, commons: 0.5, library: 1, condenser: 0.5,
      garage: 1 }, // [plan4:BL-9..13,20] batteries burn, the recycler runs hot, the motor pool is full of fuel and oil
    quickFix: { water: 25 }, harm: 0.35,
    name: { he: 'שריפה', en: 'Fire' },
    desc: { he: 'להבות אוכלות את החדר. היא תתפשט לחדר הסמוך אם לא תכבו אותה.', en: 'Flames are eating the room. It will spread next door if nobody puts it out.' },
    fight: { he: 'כבו!', en: 'Douse!' },
    fixLabel: { he: 'מטף מים', en: 'Water hose' },
  },
  flood: {
    kind: 'flood', icon: 'wave', color: 0x4aa8ff, stat: 'strength',
    rooms: { waterPump: 3, waterPurifier: 2, hydroponics: 2, farm: 1.5, medbay: 1, quarters: 1, lake: 1, atrium: 0.5,
      condenser: 1.5, mushroomFarm: 1, aquaculture: 2, bathhouse: 1.5, decon: 1 }, // [plan4:BL-13,14,21,22,31] wet rooms
    quickFix: { materials: 20 }, drain: { water: 0.6, materials: 0.15 },
    name: { he: 'הצפה', en: 'Flood' },
    desc: { he: 'צינור התפוצץ והמים עולים. כל רגע הולכים לאיבוד מים.', en: 'A main burst and the water is rising. Every second wastes water.' },
    fight: { he: 'שאבו!', en: 'Bail!' },
    fixLabel: { he: 'אטם וצנרת', en: 'Patch & pipe' },
  },
  blackout: {
    kind: 'blackout', icon: 'plug', color: 0x9fb8ff, stat: 'intelligence', wholeFloor: true,
    rooms: blackoutRooms(), // [plan4:BL-8] every fuel power plant (generator 3, reactor 2, hall 2); solar and wind have no switchboard
    quickFix: { materials: 15, knowledge: 10 },
    name: { he: 'הפסקת חשמל', en: 'Blackout' },
    desc: { he: 'קצר בלוח החשמל. כל הקומה בחושך ולא עובדת.', en: 'The switchboard shorted. The whole floor is dark and idle.' },
    fight: { he: 'תקנו!', en: 'Rewire!' },
    fixLabel: { he: 'נתיכים חדשים', en: 'New fuses' },
  },
  roaches: {
    kind: 'roaches', icon: 'bug', color: 0xb08a4a, stat: 'agility',
    rooms: { farm: 3, hydroponics: 2, canteen: 2, storage: 2, quarters: 1, cave: 1, atrium: 1,
      mushroomFarm: 3, library: 0.5, market: 1, nursery: 0.5 }, // [plan4:BL-14,11,23,26] the damp farm breeds them, the books and the stalls feed them
    quickFix: { medicine: 4 }, drain: { food: 0.5 },
    name: { he: 'מכת ג׳וקים', en: 'Roach Swarm' },
    desc: { he: 'ג׳וקים מוטנטיים פשטו על המזון. הם אוכלים מהר.', en: 'Mutant roaches swarmed the food. They eat fast.' },
    fight: { he: 'רמסו!', en: 'Stomp!' },
    fixLabel: { he: 'רעל', en: 'Poison' },
  },
  breach: {
    kind: 'breach', icon: 'skull', color: 0xff3a3a, stat: 'strength', topFloor: true,
    rooms: { storage: 3, workshop: 2, armory: 2, canteen: 1, quarters: 1, farm: 1, generator: 1, waterPump: 1,
      garage: 1, market: 1 }, // [plan4:BL-20,23] the doors and the goods draw raiders (breaches only hit floor 0)
    quickFix: { scrap: 25 }, drain: { materials: 0.6, scrap: 0.3 }, harm: 0.3,
    name: { he: 'פריצת שודדים', en: 'Raider Breach' },
    desc: { he: 'שודדים חדרו דרך פיר האוורור ובוזזים את החדר.', en: 'Raiders got in through a vent shaft and are looting the room.' },
    fight: { he: 'הדפו!', en: 'Repel!' },
    fixLabel: { he: 'שוחד בגרוטאות', en: 'Bribe with scrap' },
  },
};

/**
 * [plan4:BL-19] A working gate post makes the door harder to get through: the weight of a raider breach is halved
 * (it does not stack, a second post only adds defense).
 */
export function breachGuardMult(state: GameState): number {
  for (const b of state.buildings) {
    if (b.type === 'gatePost' && effectiveLevel(b) > 0 && !incidentBlocks(state, b)) return 0.5;
  }
  return 1;
}

export const INCIDENT_KINDS = Object.keys(INCIDENTS) as IncidentKind[];

/** Buying a crisis away costs more in a bigger bunker: the base price ×(1 + era) (S7). */
export function quickFixCost(state: GameState, kind: IncidentKind): Record<string, number> {
  const mult = 1 + Math.max(0, state.era ?? 0);
  const out: Record<string, number> = {};
  for (const [r, v] of Object.entries(INCIDENTS[kind].quickFix)) out[r] = Math.round((v ?? 0) * mult);
  return out;
}

/** [Danger C2] Disasters: a countdown, a "handle it" action with a price and a crew, and a real price if ignored. */
export interface DisasterDef {
  kind: DisasterKind;
  icon: IconName;
  color: number;
  /** Seconds (play time) between the warning and the strike. */
  countdown: number;
  /** Adults who must be free to handle it. */
  crew: number;
  name: Record<'he' | 'en', string>;
  desc: Record<'he' | 'en', string>;
  handleLabel: Record<'he' | 'en', string>;
  /** What happened when nobody handled it. */
  struck: Record<'he' | 'en', string>;
  /** What happened when the crew handled it. */
  saved: Record<'he' | 'en', string>;
}

export const DISASTERS: Record<DisasterKind, DisasterDef> = {
  collapse: {
    kind: 'collapse', icon: 'pick', color: 0xc8a070, countdown: 600, crew: 2,
    name: { he: 'סכנת קריסה', en: 'Cave-in Risk' },
    desc: { he: 'הקירות בקומה העמוקה נסדקים והאבק יורד מהתקרה. צריך חומרים ויד עובדת כדי לחזק את החדר.', en: 'The walls on the deep level are cracking and dust falls from the ceiling. It takes materials and a crew to shore the room up.' },
    handleLabel: { he: 'חזקו את החדר', en: 'Shore it up' },
    struck: { he: 'התקרה קרסה והחדר נהרס. צריך לשקם אותו, ומי שהיה בפנים נפצע.', en: 'The ceiling came down and the room is wrecked. It has to be restored, and those inside were hurt.' },
    saved: { he: 'הצוות חיזק את החדר בזמן. הוא יחזיק.', en: 'The crew shored the room up in time. It will hold.' },
  },
  deepFlood: {
    kind: 'deepFlood', icon: 'wave', color: 0x4aa8ff, countdown: 900, crew: 2,
    name: { he: 'הצפה תת־קרקעית', en: 'Underground Flood' },
    desc: { he: 'מי תהום חודרים ליד המשאבות. צריך לשאוב ולאטום לפני שהמים יגיעו לחדרים.', en: 'Groundwater is seeping in by the pumps. Pump it out and seal the wall before it reaches the rooms.' },
    handleLabel: { he: 'שאבו ואטמו', en: 'Pump and seal' },
    struck: { he: 'המים פרצו פנימה: מלאי אבד ובחדר יש הצפה.', en: 'The water broke through: stock was lost and the room is flooded.' },
    saved: { he: 'השאיבה הצליחה והקיר אטום.', en: 'The pumping worked and the wall is sealed.' },
  },
  epidemic: {
    kind: 'epidemic', icon: 'medicine', color: 0x7ddb6a, countdown: 3600, crew: 2,
    name: { he: 'מגפה', en: 'Epidemic' },
    desc: { he: 'חום ושיעול עוברים בין החדרים הצפופים. הסגר במרפאה ותרופות יעצרו אותה.', en: 'Fever and coughing are moving through the crowded rooms. Quarantine in the medbay and medicine will stop it.' },
    handleLabel: { he: 'הסגר ותרופות', en: 'Quarantine and medicine' },
    struck: { he: 'המגפה פרצה: חלק מהדיירים חולים, ובלי תרופות יש מקרי מוות.', en: 'The epidemic broke out: part of the residents are sick, and without medicine people die.' },
    saved: { he: 'ההסגר עצר את המגפה בזמן.', en: 'The quarantine stopped the epidemic in time.' },
  },
  meltdown: {
    kind: 'meltdown', icon: 'rad', color: 0xff4a2a, countdown: 1200, crew: 2,
    name: { he: 'התכת כור', en: 'Reactor Meltdown' },
    desc: { he: 'הכור מתחמם בלי תחזוקה. צוות מומחה וגרוטאות יכולים לקרר אותו לפני שיהיה מאוחר.', en: 'The reactor is overheating from lack of maintenance. A skilled crew and scrap can cool it before it is too late.' },
    handleLabel: { he: 'קררו את הכור', en: 'Cool the reactor' },
    struck: { he: 'הכור הותך ונסגר ליום. עובדים נפגעו מקרינה.', en: 'The reactor melted down and is shut for a day. Workers were hurt by radiation.' },
    saved: { he: 'הכור קורר והסכנה חלפה.', en: 'The reactor was cooled and the danger passed.' },
  },
};

export const DISASTER_KINDS = Object.keys(DISASTERS) as DisasterKind[];

/** What it costs to handle a disaster; grows with the era like a quick fix (and the epidemic with the crowd). */
export function disasterCost(state: GameState, kind: DisasterKind): Record<string, number> {
  const mult = 1 + Math.max(0, state.era ?? 0);
  switch (kind) {
    case 'collapse': return { materials: 40 * mult };
    case 'deepFlood': return { materials: 30 * mult };
    case 'epidemic': {
      const cap = state.resources.medicine?.cap ?? 30;
      return { medicine: Math.max(5, Math.min(Math.round(cap * 0.6), Math.ceil(state.survivors.length * 0.4))) };
    }
    case 'meltdown': return { scrap: 40 * mult, knowledge: 20 * mult };
  }
}

/** Whether a room is stopped by an incident in it, a blackout on its floor or a meltdown shutdown. */
export function incidentBlocks(state: GameState, b: BuildingInstance): boolean {
  // [Danger] a reactor shut down by a meltdown stays off until its time is up.
  const off = state.danger?.disabled?.[b.id];
  if (off && off > Date.now()) return true;
  const list = state.incidents;
  if (!list || list.length === 0) return false;
  for (const inc of list) {
    if (inc.buildingId === b.id) return true;
    if (INCIDENTS[inc.kind].wholeFloor) {
      const src = state.buildings.find(x => x.id === inc.buildingId);
      if (src && src.position.floor === b.position.floor) return true;
    }
  }
  return false;
}

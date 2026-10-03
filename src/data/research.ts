import type { BuildingType, ResourceType } from '../core/GameState';

export type ResearchBranch = 'infrastructure' | 'survival' | 'exploration' | 'society' | 'defense' | 'genesis' | 'refinement';

export type ResearchEffect =
  | { type: 'unlock'; building: BuildingType }
  | { type: 'resourceMult'; resource: ResourceType; value: number }
  | { type: 'buildingMult'; building: BuildingType; value: number }
  | { type: 'cap'; resource: ResourceType; value: number }
  | { type: 'morale'; value: number }
  | { type: 'feature'; feature: string };

export interface ResearchDef {
  id: string;
  branch: ResearchBranch;
  tier: number;
  icon: string;
  name: Record<string, string>;
  desc: Record<string, string>;
  cost: Partial<Record<ResourceType, number>>;
  time: number;
  requires: string[];
  effects: ResearchEffect[];
}

export const BRANCHES: { id: ResearchBranch; icon: string; name: Record<string, string> }[] = [
  { id: 'infrastructure', icon: '[[power]]', name: { he: 'תשתיות', en: 'Infrastructure' } },
  { id: 'survival', icon: '[[farm]]', name: { he: 'הישרדות', en: 'Survival' } },
  { id: 'exploration', icon: '[[map]]', name: { he: 'חקירה', en: 'Exploration' } },
  { id: 'society', icon: '[[charisma]]', name: { he: 'קהילה', en: 'Society' } },
  { id: 'defense', icon: '[[endurance]]', name: { he: 'הגנה', en: 'Defense' } },
  { id: 'genesis', icon: '[[isotope7]]', name: { he: 'פרויקט בראשית', en: 'Project Genesis' } },
  { id: 'refinement', icon: '[[up]]', name: { he: 'שכלול', en: 'Refinement' } },
];

/**
 * The fixed tree. Late tiers are deliberately slow (tier 3 ×2, tier 4 ×4, tier 5 ×8 of the old times),
 * so Genesis lands after days, not hours, and a queued node is worth leaving overnight.
 */
export const RESEARCH: ResearchDef[] = [
  // Infrastructure
  {
    id: 'insulatedWiring', branch: 'infrastructure', tier: 1, icon: '[[plug]]',
    name: { he: 'חיווט מבודד', en: 'Insulated Wiring' },
    desc: { he: '+15% ייצור חשמל', en: '+15% power output' },
    cost: { knowledge: 10 }, time: 60, requires: [],
    effects: [{ type: 'resourceMult', resource: 'power', value: 0.15 }],
  },
  {
    id: 'batteryBanks', branch: 'infrastructure', tier: 2, icon: '[[battery]]',
    name: { he: 'מצברים', en: 'Battery Banks' },
    desc: { he: '+100 קיבולת חשמל', en: '+100 power storage' },
    cost: { knowledge: 25, materials: 40 }, time: 120, requires: ['insulatedWiring'],
    effects: [{ type: 'cap', resource: 'power', value: 100 }],
  },
  {
    id: 'automation', branch: 'infrastructure', tier: 2, icon: '[[settings]]',
    name: { he: 'אוטומציה', en: 'Automation' },
    desc: { he: '+30% תפוקת סדנה', en: '+30% workshop output' },
    cost: { knowledge: 30, scrap: 10 }, time: 180, requires: ['insulatedWiring'],
    effects: [{ type: 'buildingMult', building: 'workshop', value: 0.3 }],
  },
  {
    id: 'advancedEngineering', branch: 'infrastructure', tier: 3, icon: '[[workshop]]',
    name: { he: 'הנדסה מתקדמת', en: 'Advanced Engineering' },
    desc: { he: '+20% חומרים, +200 קיבולת חומרים', en: '+20% materials, +200 materials storage' },
    cost: { knowledge: 70, scrap: 30 }, time: 840, requires: ['automation', 'batteryBanks'],
    effects: [{ type: 'resourceMult', resource: 'materials', value: 0.2 }, { type: 'cap', resource: 'materials', value: 200 }],
  },
  {
    id: 'reactorTheory', branch: 'infrastructure', tier: 4, icon: '[[reactor]]',
    name: { he: 'תורת הכור', en: 'Reactor Theory' },
    desc: { he: 'פותח: כור גרעיני', en: 'Unlocks: Reactor' },
    cost: { knowledge: 150, scrap: 60 }, time: 3600, requires: ['advancedEngineering'],
    effects: [{ type: 'unlock', building: 'reactor' }],
  },
  {
    id: 'fusionHall', branch: 'infrastructure', tier: 5, icon: '[[rad]]',
    name: { he: 'היתוך בקנה מידה', en: 'Fusion at Scale' },
    desc: { he: 'פותח: אולם הכור (בניין דו־קומתי)', en: 'Unlocks: Reactor Hall (two-storey)' },
    cost: { knowledge: 320, scrap: 140, blueprints: 1 }, time: 12000, requires: ['reactorTheory'],
    effects: [{ type: 'unlock', building: 'reactorHall' }],
  },

  // Survival
  {
    id: 'nutrition', branch: 'survival', tier: 1, icon: '[[wheat]]',
    name: { he: 'תזונה', en: 'Nutrition' },
    desc: { he: '+20% ייצור אוכל', en: '+20% food output' },
    cost: { knowledge: 10 }, time: 60, requires: [],
    effects: [{ type: 'resourceMult', resource: 'food', value: 0.2 }],
  },
  {
    id: 'waterFiltration', branch: 'survival', tier: 2, icon: '[[waterPurifier]]',
    name: { he: 'סינון מים', en: 'Water Filtration' },
    desc: { he: 'פותח: מטהר מים', en: 'Unlocks: Water Purifier' },
    cost: { knowledge: 30, materials: 30 }, time: 180, requires: ['nutrition'],
    effects: [{ type: 'unlock', building: 'waterPurifier' }],
  },
  {
    id: 'hydroponicsResearch', branch: 'survival', tier: 2, icon: '[[hydroponics]]',
    name: { he: 'הידרופוניקה', en: 'Hydroponics' },
    desc: { he: 'פותח: חוות הידרופוניקה', en: 'Unlocks: Hydroponics' },
    cost: { knowledge: 35, scrap: 10 }, time: 240, requires: ['nutrition'],
    effects: [{ type: 'unlock', building: 'hydroponics' }],
  },
  {
    id: 'firstAid', branch: 'survival', tier: 2, icon: '[[bandage]]',
    name: { he: 'עזרה ראשונה', en: 'First Aid' },
    desc: { he: '+40% תרופות', en: '+40% medicine' },
    cost: { knowledge: 25 }, time: 150, requires: ['nutrition'],
    effects: [{ type: 'resourceMult', resource: 'medicine', value: 0.4 }],
  },
  {
    id: 'preservation', branch: 'survival', tier: 3, icon: '[[food]]',
    name: { he: 'שימור מזון', en: 'Food Preservation' },
    desc: { he: '+150 קיבולת אוכל ומים', en: '+150 food & water storage' },
    cost: { knowledge: 60, materials: 60 }, time: 720, requires: ['hydroponicsResearch', 'waterFiltration'],
    effects: [{ type: 'cap', resource: 'food', value: 150 }, { type: 'cap', resource: 'water', value: 150 }],
  },

  // Exploration
  {
    id: 'hazmatSuits', branch: 'exploration', tier: 1, icon: '[[gasmask]]',
    name: { he: 'חליפות מגן', en: 'Hazmat Suits' },
    desc: { he: 'פותח: משלחות אל פני השטח', en: 'Unlocks: surface expeditions' },
    cost: { knowledge: 15, materials: 20 }, time: 90, requires: [],
    effects: [{ type: 'feature', feature: 'surface' }],
  },
  {
    id: 'radioBasics', branch: 'exploration', tier: 2, icon: '[[radioTower]]',
    name: { he: 'רדיו בסיסי', en: 'Radio Basics' },
    desc: { he: 'פותח: מגדל רדיו – מושך ניצולים', en: 'Unlocks: Radio Tower – attracts survivors' },
    cost: { knowledge: 30, scrap: 10 }, time: 180, requires: ['hazmatSuits'],
    effects: [{ type: 'unlock', building: 'radioTower' }],
  },
  {
    id: 'geigerCounters', branch: 'exploration', tier: 2, icon: '[[isotope7]]',
    name: { he: 'מוני גייגר', en: 'Geiger Counters' },
    desc: { he: 'משלחות בטוחות יותר (-30% פציעות)', en: 'Safer expeditions (-30% injuries)' },
    cost: { knowledge: 35, scrap: 15 }, time: 240, requires: ['hazmatSuits'],
    effects: [{ type: 'feature', feature: 'geiger' }],
  },
  {
    id: 'scavengingTactics', branch: 'exploration', tier: 3, icon: '[[backpack]]',
    name: { he: 'טקטיקות ליקוט', en: 'Scavenging Tactics' },
    desc: { he: '+40% שלל ממשלחות', en: '+40% expedition loot' },
    cost: { knowledge: 60, scrap: 25 }, time: 840, requires: ['geigerCounters'],
    effects: [{ type: 'feature', feature: 'lootBonus' }],
  },
  {
    id: 'vehicles', branch: 'exploration', tier: 4, icon: '[[car]]',
    name: { he: 'רכבי שטח', en: 'Vehicles' },
    desc: { he: 'משלחות מהירות פי 2', en: 'Expeditions twice as fast' },
    cost: { knowledge: 120, scrap: 60, materials: 100 }, time: 3600, requires: ['scavengingTactics'],
    effects: [{ type: 'feature', feature: 'vehicles' }],
  },

  // Society
  {
    id: 'communityMeals', branch: 'society', tier: 1, icon: '[[canteen]]',
    name: { he: 'ארוחות משותפות', en: 'Community Meals' },
    desc: { he: '+50% בונוס חדר אוכל', en: '+50% canteen bonus' },
    cost: { knowledge: 15 }, time: 90, requires: [],
    effects: [{ type: 'buildingMult', building: 'canteen', value: 0.5 }],
  },
  {
    id: 'trainingProgram', branch: 'society', tier: 2, icon: '[[trainingRoom]]',
    name: { he: 'תוכנית אימונים', en: 'Training Program' },
    desc: { he: 'פותח: חדר כושר – ניסיון פי 3', en: 'Unlocks: Training Room – triple XP' },
    cost: { knowledge: 35, materials: 40 }, time: 240, requires: ['communityMeals'],
    effects: [{ type: 'unlock', building: 'trainingRoom' }],
  },
  {
    id: 'leadership', branch: 'society', tier: 2, icon: '[[medal]]',
    name: { he: 'מנהיגות', en: 'Leadership' },
    desc: { he: '+8 מורל לכולם', en: '+8 morale for everyone' },
    cost: { knowledge: 40 }, time: 300, requires: ['communityMeals'],
    effects: [{ type: 'morale', value: 8 }],
  },
  {
    id: 'education', branch: 'society', tier: 3, icon: '[[cap]]',
    name: { he: 'חינוך', en: 'Education' },
    desc: { he: '+30% ידע', en: '+30% knowledge' },
    cost: { knowledge: 80 }, time: 960, requires: ['leadership'],
    effects: [{ type: 'resourceMult', resource: 'knowledge', value: 0.3 }, { type: 'cap', resource: 'knowledge', value: 200 }],
  },
  {
    id: 'atriumDesign', branch: 'society', tier: 4, icon: '[[clover]]',
    name: { he: 'גנים תת־קרקעיים', en: 'Underground Gardens' },
    desc: { he: 'פותח: האטריום (בניין דו־קומתי)', en: 'Unlocks: the Atrium (two-storey)' },
    cost: { knowledge: 160, materials: 200 }, time: 3600, requires: ['education'],
    effects: [{ type: 'unlock', building: 'atrium' }],
  },

  // Defense
  {
    id: 'armoryResearch', branch: 'defense', tier: 1, icon: '[[armory]]',
    name: { he: 'נשקייה', en: 'Armory' },
    desc: { he: 'פותח: נשקייה – הגנה מפני שודדים', en: 'Unlocks: Armory – defense against raiders' },
    cost: { knowledge: 20, scrap: 10 }, time: 150, requires: [],
    effects: [{ type: 'unlock', building: 'armory' }],
  },
  {
    id: 'fortifiedDoor', branch: 'defense', tier: 2, icon: '[[door]]',
    name: { he: 'דלת מבוצרת', en: 'Fortified Door' },
    desc: { he: '+15 הגנה', en: '+15 defense' },
    cost: { knowledge: 40, materials: 80 }, time: 300, requires: ['armoryResearch'],
    effects: [{ type: 'feature', feature: 'fortifiedDoor' }],
  },

  // Project Genesis
  {
    id: 'temporalTheory', branch: 'genesis', tier: 5, icon: '[[hourglass]]',
    name: { he: 'תורת הזמן', en: 'Temporal Theory' },
    desc: { he: 'פותח את פרויקט בראשית – אתחול עם ידע מהעתיד', en: 'Unlocks Project Genesis – restart with knowledge from the future' },
    cost: { knowledge: 400, scrap: 150, blueprints: 2 }, time: 14400, requires: ['reactorTheory', 'education'],
    effects: [{ type: 'feature', feature: 'genesis' }],
  },
];

/**
 * Repeatable "Refinement" nodes: an endless knowledge sink once the fixed tree is done.
 * Each level adds +5% to one resource; cost grows ×1.6 and time ×1.35 per level, so storage caps
 * (and the Storage Memory prestige upgrade) decide how far a run can push them.
 */
export interface RefinementDef {
  id: string;
  resource: ResourceType;
  icon: string;
  requires: string[];
}

export const REFINEMENT_STEP = 0.05;
const REFINE_COST_GROWTH = 1.6;
const REFINE_TIME_GROWTH = 1.35;
const REFINE_BASE_COST = { knowledge: 40, materials: 60 };
const REFINE_BASE_TIME = 600;

export const REFINEMENTS: RefinementDef[] = [
  { id: 'refine_food', resource: 'food', icon: '[[food]]', requires: ['nutrition'] },
  { id: 'refine_water', resource: 'water', icon: '[[water]]', requires: ['waterFiltration'] },
  { id: 'refine_power', resource: 'power', icon: '[[power]]', requires: ['batteryBanks'] },
  { id: 'refine_materials', resource: 'materials', icon: '[[materials]]', requires: ['advancedEngineering'] },
  { id: 'refine_medicine', resource: 'medicine', icon: '[[medicine]]', requires: ['firstAid'] },
  { id: 'refine_knowledge', resource: 'knowledge', icon: '[[knowledge]]', requires: ['education'] },
];

const RESOURCE_NAMES: Partial<Record<ResourceType, Record<string, string>>> = {
  food: { he: 'אוכל', en: 'food' },
  water: { he: 'מים', en: 'water' },
  power: { he: 'חשמל', en: 'power' },
  materials: { he: 'חומרים', en: 'materials' },
  medicine: { he: 'תרופות', en: 'medicine' },
  knowledge: { he: 'ידע', en: 'knowledge' },
};

export function getRefinement(id: string): RefinementDef | undefined {
  return REFINEMENTS.find(r => r.id === id);
}

/** The research node for the next level of a refinement (level = levels already done). */
export function refinementResearch(def: RefinementDef, level: number): ResearchDef {
  const res = RESOURCE_NAMES[def.resource] ?? { he: def.resource, en: def.resource };
  const scale = Math.pow(REFINE_COST_GROWTH, level);
  return {
    id: def.id, branch: 'refinement', tier: level + 1, icon: def.icon,
    name: { he: `שכלול: ${res.he}`, en: `Refinement: ${res.en}` },
    desc: { he: `+5% ${res.he} לכל רמה (כרגע +${level * 5}%)`, en: `+5% ${res.en} per level (now +${level * 5}%)` },
    cost: { knowledge: Math.round(REFINE_BASE_COST.knowledge * scale), materials: Math.round(REFINE_BASE_COST.materials * scale) },
    time: Math.round(REFINE_BASE_TIME * Math.pow(REFINE_TIME_GROWTH, level)),
    requires: def.requires,
    effects: [{ type: 'resourceMult', resource: def.resource, value: REFINEMENT_STEP }],
  };
}

/** Fixed nodes by id; refinements resolve to their first level (names and icons for toasts). */
export function getResearch(id: string): ResearchDef | undefined {
  const ref = getRefinement(id);
  return RESEARCH.find(r => r.id === id) ?? (ref ? refinementResearch(ref, 0) : undefined);
}

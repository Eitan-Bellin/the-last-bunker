import type { BuildingInstance, BuildingType, GameState, ResourceType } from '../core/GameState';
import type { IconName } from '../ui/icons';
import type { ChainInput } from './chains';

/**
 * Room specialization (Sprint 6): a room at its top level can be fitted out for one of two roles.
 * The choice is permanent for that room and changes how it pulls its weight.
 */
export interface SpecDef {
  id: string;
  type: BuildingType;
  icon: IconName;
  name: Record<'he' | 'en', string>;
  desc: Record<'he' | 'en', string>;
  /** Multiplies everything the room produces. */
  outputMult?: number;
  /** Extra output per second regardless of the room's main product. */
  extra?: Partial<Record<ResourceType, number>>;
  /** Added storage. */
  caps?: Partial<Record<ResourceType, number>>;
  morale?: number;
  defense?: number;
  population?: number;
  /** Chance multiplier for in-room incidents. */
  risk?: number;
  /** Training speed, healing speed, recruit pull or expedition bonuses. */
  xpMult?: number;
  healMult?: number;
  recruitMult?: number;
  expeditionLoot?: number;
  expeditionChance?: number;
  childGrowth?: number;
  /** [plan4:BL-4] A school role: the stat points a graduate gets (replaces the school's own 1). */
  graduateStat?: number;
  /** [Long game] First Act in which this role can be chosen. */
  act?: number;
  /** [Long game] What the role consumes for its `extra` (a starved input slows the whole room, as in chains.ts). */
  inputs?: ChainInput[];
  /** [Long game] `extra` grows with the room's level (given here for a level-5 room). */
  levelScaled?: boolean;
}

/** [Long game] Changing a room's role: this many times the specialization price, and the room stands still for a while. */
export const RETOOL_PRICE_MULT = 2;
export const RETOOL_SECONDS = 1800;

export const SPEC_COST: Partial<Record<ResourceType, number>> = { materials: 160, knowledge: 60 };

export const SPECIALIZATIONS: SpecDef[] = [
  {
    id: 'bunkbeds', type: 'quarters', icon: 'quarters', population: 3,
    name: { he: 'דרגשים צפופים', en: 'Bunk Stacks' }, desc: { he: '+3 מקומות לינה', en: '+3 beds' },
  },
  {
    id: 'familySuites', type: 'quarters', icon: 'baby', morale: 8, childGrowth: 2,
    name: { he: 'סוויטות משפחה', en: 'Family Suites' }, desc: { he: '+8 מורל · ילדים גדלים פי 2 מהר', en: '+8 morale · children grow twice as fast' },
  },
  {
    id: 'orchard', type: 'farm', icon: 'clover', outputMult: 1.4,
    name: { he: 'פרדס תת־קרקעי', en: 'Underground Orchard' }, desc: { he: '+40% אוכל', en: '+40% food' },
  },
  {
    id: 'seedBank', type: 'farm', icon: 'wheat', caps: { food: 150 }, morale: 4,
    name: { he: 'בנק זרעים', en: 'Seed Bank' }, desc: { he: '+150 קיבולת אוכל · +4 מורל', en: '+150 food storage · +4 morale' },
  },
  {
    id: 'deepBore', type: 'waterPump', icon: 'water', outputMult: 1.4,
    name: { he: 'קידוח עמוק', en: 'Deep Bore' }, desc: { he: '+40% מים', en: '+40% water' },
  },
  {
    id: 'cistern', type: 'waterPump', icon: 'wave', caps: { water: 200 }, risk: 0.5,
    name: { he: 'בור מים', en: 'Cistern' }, desc: { he: '+200 קיבולת מים · פחות הצפות', en: '+200 water storage · fewer floods' },
  },
  {
    id: 'overclock', type: 'generator', icon: 'power', outputMult: 1.6, risk: 2,
    name: { he: 'האצת יתר', en: 'Overclocked' }, desc: { he: '+60% חשמל · סכנת שריפה כפולה', en: '+60% power · double fire risk' },
  },
  {
    // [Long game] Tier 2: alloys, the currency of Act IV. The furnace burns most of the generator's own power.
    id: 'arcFurnace', type: 'generator', icon: 'fire', act: 4, outputMult: 0.4, levelScaled: true, risk: 1.5,
    extra: { alloys: 0.012 },
    inputs: [{ resource: 'materials', base: 0.4, perLevel: 0.4 }, { resource: 'scrap', base: 0.04, perLevel: 0.3 }],
    name: { he: 'כבשן קשת', en: 'Arc Furnace' },
    desc: { he: 'מתיך חומרים וגרוטאות לסגסוגות · 40% מהחשמל', en: 'Smelts materials and scrap into alloys · 40% of the power' },
  },
  {
    id: 'efficient', type: 'generator', icon: 'battery', outputMult: 1.25, risk: 0.3, caps: { power: 50 },
    name: { he: 'יעילות', en: 'Efficient' }, desc: { he: '+25% חשמל · +50 אחסון · כמעט בלי תקלות', en: '+25% power · +50 storage · rarely fails' },
  },
  {
    id: 'foundry', type: 'workshop', icon: 'materials', outputMult: 1.4,
    name: { he: 'יציקה', en: 'Foundry' }, desc: { he: '+40% חומרים', en: '+40% materials' },
  },
  {
    // [Long game] Tier 2: components, the currency of Act III. The line eats scrap and leaves less raw materials.
    id: 'assemblyLine', type: 'workshop', icon: 'settings', act: 3, outputMult: 0.6, levelScaled: true,
    extra: { components: 0.03 },
    inputs: [{ resource: 'scrap', base: 0.05, perLevel: 0.3 }],
    name: { he: 'פס הרכבה', en: 'Assembly Line' },
    desc: { he: 'מייצר רכיבים מגרוטאות · 60% מהחומרים', en: 'Makes components from scrap · 60% of the materials' },
  },
  {
    // [P5] Data: the archive of the new world, mined from the lab's knowledge.
    id: 'dataVault', type: 'laboratory', icon: 'knowledge', act: 5, outputMult: 0.5, levelScaled: true,
    extra: { data: 0.006 },
    inputs: [{ resource: 'knowledge', base: 0.3, perLevel: 0.3 }],
    name: { he: 'כספת נתונים', en: 'Data Vault' },
    desc: { he: 'הופך ידע לנתונים · 50% מהידע', en: 'Turns knowledge into data · 50% of the knowledge' },
  },
  {
    // [P5] Influence: where the bunker meets its neighbours and decides together.
    id: 'councilHall', type: 'canteen', icon: 'chat', act: 6, levelScaled: true,
    extra: { influence: 0.004 },
    inputs: [{ resource: 'food', base: 0.3, perLevel: 0.3 }],
    name: { he: 'אולם המועצה', en: 'Council Hall' },
    desc: { he: 'מייצר השפעה מארוחות משותפות עם השכנים', en: 'Makes influence from shared meals with the neighbours' },
  },
  {
    // [P5] Seed cores: the matter of the next world, forged from the bunker's best goods.
    id: 'seedForge', type: 'reactor', icon: 'isotope7', act: 7, outputMult: 0.5, levelScaled: true, risk: 1.5,
    extra: { seedCores: 0.0025 },
    inputs: [{ resource: 'alloys', base: 0.006, perLevel: 0.2 }, { resource: 'data', base: 0.004, perLevel: 0.2 }],
    name: { he: 'כור זרעים', en: 'Seed Forge' },
    desc: { he: 'מתיך סגסוגות ונתונים לליבות זרע · 50% מהחשמל', en: 'Fuses alloys and data into seed cores · 50% of the power' },
  },
  {
    id: 'salvageYard', type: 'workshop', icon: 'recycle', extra: { scrap: 0.15 },
    name: { he: 'מגרש פירוק', en: 'Salvage Yard' }, desc: { he: '+0.15 גרוטאות לשנייה', en: '+0.15 scrap per second' },
  },
  {
    id: 'surgery', type: 'medbay', icon: 'bandage', healMult: 2,
    name: { he: 'חדר ניתוח', en: 'Surgery' }, desc: { he: 'ריפוי מהיר פי 2', en: 'Heals twice as fast' },
  },
  {
    id: 'pharmacy', type: 'medbay', icon: 'medicine', outputMult: 1.5,
    name: { he: 'בית מרקחת', en: 'Pharmacy' }, desc: { he: '+50% תרופות', en: '+50% medicine' },
  },
  {
    id: 'messHall', type: 'canteen', icon: 'happy', morale: 10,
    name: { he: 'חדר אוכל גדול', en: 'Mess Hall' }, desc: { he: '+10 מורל', en: '+10 morale' },
  },
  {
    id: 'kitchen', type: 'canteen', icon: 'food', extra: { food: 0.35 },
    name: { he: 'מטבח שימור', en: 'Preserving Kitchen' }, desc: { he: '+0.35 אוכל לשנייה משאריות', en: '+0.35 food per second from leftovers' },
  },
  {
    id: 'archive', type: 'laboratory', icon: 'books', caps: { knowledge: 300 }, extra: { knowledge: 0.05 },
    name: { he: 'ארכיון', en: 'Archive' }, desc: { he: '+300 קיבולת ידע · +0.05 ידע', en: '+300 knowledge storage · +0.05 knowledge' },
  },
  {
    id: 'reactorLab', type: 'laboratory', icon: 'rad', outputMult: 1.5, risk: 1.5,
    name: { he: 'מעבדה חמה', en: 'Hot Lab' }, desc: { he: '+50% ידע · יותר תקלות', en: '+50% knowledge · more accidents' },
  },
  {
    id: 'beacon', type: 'radioTower', icon: 'signal', recruitMult: 2,
    name: { he: 'משואה', en: 'Beacon' }, desc: { he: 'פי 2 נודדים מגיעים', en: 'Twice as many wanderers' },
  },
  {
    id: 'listeningPost', type: 'radioTower', icon: 'dish', extra: { knowledge: 0.1 }, expeditionChance: 0.1,
    name: { he: 'עמדת האזנה', en: 'Listening Post' }, desc: { he: '+0.1 ידע · +10% הצלחת משלחות', en: '+0.1 knowledge · +10% expedition success' },
  },
  {
    id: 'distillery', type: 'waterPurifier', icon: 'water', outputMult: 1.4,
    name: { he: 'מזקקה', en: 'Distillery' }, desc: { he: '+40% מים', en: '+40% water' },
  },
  {
    id: 'filtration', type: 'waterPurifier', icon: 'medicine', extra: { medicine: 0.03 },
    name: { he: 'סינון רפואי', en: 'Medical Filtration' }, desc: { he: '+0.03 תרופות לשנייה', en: '+0.03 medicine per second' },
  },
  {
    id: 'gym', type: 'trainingRoom', icon: 'strength', xpMult: 1.6,
    name: { he: 'חדר כושר', en: 'Gym' }, desc: { he: 'אימון מהיר ב־60%', en: 'Training 60% faster' },
  },
  {
    id: 'dojo', type: 'trainingRoom', icon: 'agility', defense: 15,
    name: { he: 'דוג׳ו', en: 'Dojo' }, desc: { he: '+15 הגנה', en: '+15 defense' },
  },
  {
    id: 'fortress', type: 'armory', icon: 'medal', defense: 30,
    name: { he: 'מבצר', en: 'Fortress' }, desc: { he: '+30 הגנה', en: '+30 defense' },
  },
  {
    id: 'quartermaster', type: 'armory', icon: 'backpack', extra: { scrap: 0.1 }, expeditionLoot: 0.15,
    name: { he: 'אפסנאות', en: 'Quartermaster' }, desc: { he: '+0.1 גרוטאות · +15% שלל משלחות', en: '+0.1 scrap · +15% expedition loot' },
  },
  {
    id: 'breeder', type: 'reactor', icon: 'isotope7', outputMult: 1.5, risk: 1.8,
    name: { he: 'כור מגדל', en: 'Breeder Core' }, desc: { he: '+50% חשמל · סיכון גבוה', en: '+50% power · high risk' },
  },
  {
    id: 'shielded', type: 'reactor', icon: 'lock', risk: 0.2, morale: 5,
    name: { he: 'כור ממוגן', en: 'Shielded Core' }, desc: { he: 'כמעט בלי תקלות · +5 מורל', en: 'Almost never fails · +5 morale' },
  },
  {
    id: 'aeroponics', type: 'hydroponics', icon: 'clover', outputMult: 1.4,
    name: { he: 'אירופוניקה', en: 'Aeroponics' }, desc: { he: '+40% אוכל', en: '+40% food' },
  },
  {
    id: 'herbGarden', type: 'hydroponics', icon: 'medicine', extra: { medicine: 0.04 },
    name: { he: 'גן צמחי מרפא', en: 'Herb Garden' }, desc: { he: '+0.04 תרופות לשנייה', en: '+0.04 medicine per second' },
  },
  {
    id: 'vault', type: 'storage', icon: 'vault', caps: { materials: 300, scrap: 200, knowledge: 150 },
    name: { he: 'כספת', en: 'Vault' }, desc: { he: '+300 חומרים · +200 גרוטאות · +150 ידע', en: '+300 materials · +200 scrap · +150 knowledge' },
  },
  {
    id: 'coldStore', type: 'storage', icon: 'water', caps: { food: 300, water: 300, medicine: 30 },
    name: { he: 'חדר קירור', en: 'Cold Store' }, desc: { he: '+300 אוכל ומים · +30 תרופות', en: '+300 food & water · +30 medicine' },
  },
];

const BY_ID = new Map(SPECIALIZATIONS.map(s => [s.id, s]));

export function specsFor(type: BuildingType, state?: GameState): SpecDef[] {
  const act = state?.longGame?.meta.act ?? 99;
  return SPECIALIZATIONS.filter(s => s.type === type && (!state || (s.act ?? 0) <= act));
}

export function specOf(b: BuildingInstance): SpecDef | undefined {
  return b.specialization ? BY_ID.get(b.specialization) : undefined;
}

/** Sum of a numeric spec field over every finished, specialized room. */
export function specTotal(state: GameState, field: 'morale' | 'defense' | 'population' | 'expeditionLoot' | 'expeditionChance'): number {
  let n = 0;
  for (const b of state.buildings) {
    if (b.isConstructing) continue;
    n += specOf(b)?.[field] ?? 0;
  }
  return n;
}

/** Strongest multiplier of a kind among specialized rooms (1 when none). */
export function specMax(state: GameState, field: 'healMult' | 'recruitMult' | 'childGrowth' | 'xpMult', type?: BuildingType): number {
  let m = 1;
  for (const b of state.buildings) {
    if (b.isConstructing || (type && b.type !== type)) continue;
    const v = specOf(b)?.[field];
    if (v && v > m) m = v;
  }
  return m;
}

import type { GameState, ResourceType } from '../core/GameState';

/**
 * [LateGame B2] Trade with the settlements the story has made friends with.
 * A caravan (two people, 1-3 hours) carries a load of surplus to a partner and brings back what the partner has.
 * Every deal raises the relation (level 0-5): +10% on the rate per level and one special deal per level.
 * The road is not safe: an ambush loses the cargo (and sometimes someone gets hurt).
 */
export type PartnerId = 'terminus' | 'clan' | 'noa';

export interface SpecialDeal {
  cost: Partial<Record<ResourceType, number>>;
  gain: Partial<Record<ResourceType, number>>;
}

export interface PartnerDef {
  id: PartnerId;
  icon: string;
  name: Record<'he' | 'en', string>;
  desc: Record<'he' | 'en', string>;
  /** Story flags that open the road (any one of them). */
  flags: string[];
  /** What the partner takes, in the order the cargo is loaded. */
  accepts: ResourceType[];
  /** How the value coming back is split between goods (shares add up to 1). */
  goods: Partial<Record<ResourceType, number>>;
  /** Trip length in seconds before speed-ups. */
  seconds: number;
  /** Chance that a caravan brings home a skilled newcomer (grows with the cargo size). */
  recruit?: number;
  /** One special deal for each relation level 1-5. */
  specials: SpecialDeal[];
}

/** What one unit of each resource is worth when trading. */
export const TRADE_VALUE: Partial<Record<ResourceType, number>> = {
  food: 1, water: 1, materials: 3, knowledge: 6, medicine: 20, scrap: 6, blueprints: 1000,
};

export const CARGO_TIERS = [
  { id: 's', value: 600 },
  { id: 'm', value: 2000 },
  { id: 'l', value: 6000 },
] as const;
export type CargoTier = typeof CARGO_TIERS[number]['id'];

export const CARAVAN_CREW = 2;
/** Deals needed for relation levels 1..5. */
export const RELATION_STEPS = [1, 3, 6, 10, 15];
export const MAX_RELATION = 5;

export const PARTNERS: PartnerDef[] = [
  {
    id: 'terminus', icon: '[[radioTower]]',
    name: { he: 'טרמינוס', en: 'Terminus' },
    desc: { he: 'העיר של עזרא. ידע ושרטוטים תמורת אוכל וחומרים.', en: 'Ezra\'s city. Knowledge and blueprints for food and materials.' },
    flags: ['terminus:ally', 'terminus:merged', 'terminus:saved'],
    accepts: ['food', 'water', 'materials'],
    goods: { knowledge: 0.8, blueprints: 0.2 },
    seconds: 7200,
    specials: [
      { cost: { materials: 400 }, gain: { knowledge: 200 } },
      { cost: { food: 800, water: 800 }, gain: { blueprints: 1 } },
      { cost: { materials: 1200 }, gain: { knowledge: 800, blueprints: 1 } },
      { cost: { scrap: 150 }, gain: { blueprints: 2 } },
      { cost: { knowledge: 2000 }, gain: { blueprints: 3, isotope7: 3 } },
    ],
  },
  {
    id: 'clan', icon: '[[armory]]',
    name: { he: 'שבט החלודה', en: 'Rust Clan' },
    desc: { he: 'השבט של גדעון. גרוטאות וחומרים תמורת אוכל ומים.', en: 'Gideon\'s clan. Scrap and materials for food and water.' },
    flags: ['gideon:paid', 'gideon:joined', 'clan:peace', 'clan:united', 'clan:tribute', 'clan:wardens'],
    accepts: ['food', 'water', 'medicine'],
    goods: { scrap: 0.7, materials: 0.3 },
    seconds: 3600,
    specials: [
      { cost: { food: 500 }, gain: { scrap: 150 } },
      { cost: { food: 800 }, gain: { materials: 600 } },
      { cost: { medicine: 60 }, gain: { scrap: 400 } },
      { cost: { food: 1500, water: 800 }, gain: { scrap: 800, materials: 800 } },
      { cost: { materials: 2000 }, gain: { isotope7: 3, scrap: 600 } },
    ],
  },
  {
    id: 'noa', icon: '[[medicine]]',
    name: { he: 'אנשי נועה', en: 'Noa\'s People' },
    desc: { he: 'מעבדת בראשית. תרופות, ולפעמים אדם מיומן שמצטרף.', en: 'The Genesis lab. Medicine, and sometimes a skilled person who joins.' },
    flags: ['genesis:known'],
    accepts: ['materials', 'scrap', 'knowledge'],
    goods: { medicine: 1 },
    seconds: 10800,
    recruit: 0.25,
    specials: [
      { cost: { materials: 300 }, gain: { medicine: 60 } },
      { cost: { food: 800 }, gain: { medicine: 120 } },
      { cost: { knowledge: 300 }, gain: { medicine: 200, blueprints: 1 } },
      { cost: { food: 1500, water: 1000 }, gain: { medicine: 300 } },
      { cost: { knowledge: 1000 }, gain: { isotope7: 3, blueprints: 2 } },
    ],
  },
];

export function getPartner(id: string | null | undefined): PartnerDef | undefined {
  return PARTNERS.find(p => p.id === id);
}

export function partnerOpen(state: GameState, p: PartnerDef): boolean {
  return p.flags.some(f => state.storyFlags.includes(f));
}

export function openPartners(state: GameState): PartnerDef[] {
  return PARTNERS.filter(p => partnerOpen(state, p));
}

export function dealsWith(state: GameState, id: string): number {
  return state.lateGame?.trade?.deals?.[id] ?? 0;
}

/** Relation level 0-5 from the number of deals made. */
export function relationLevel(state: GameState, id: string): number {
  const n = dealsWith(state, id);
  return RELATION_STEPS.filter(t => n >= t).length;
}

/** Deals still needed for the next level, or null at the top. */
export function dealsToNext(state: GameState, id: string): number | null {
  const lvl = relationLevel(state, id);
  return lvl >= MAX_RELATION ? null : RELATION_STEPS[lvl] - dealsWith(state, id);
}

/** Value coming back per value sent: better with every relation level. */
export function tradeRate(level: number): number {
  return 1 * (1 + 0.1 * level);
}

/** Chance of an ambush on the road: 10% early, up to 25% as the world gets more dangerous. */
export function ambushChance(state: GameState, id: string): number {
  const era = state.era ?? 0;
  const base = 0.1 + 0.05 * Math.max(0, Math.min(2, era - 1));
  return base + (relationLevel(state, id) < 2 ? 0.05 : 0);
}

export function specialKey(id: string, n: number): string {
  return `${id}:${n}`;
}

export function cargoValue(cargo: Partial<Record<ResourceType, number>>): number {
  let v = 0;
  for (const [r, n] of Object.entries(cargo) as [ResourceType, number][]) v += n * (TRADE_VALUE[r] ?? 0);
  return v;
}

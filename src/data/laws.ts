import type { GameState, ResourceType } from '../core/GameState';

/**
 * [Long game P3/R2] Laws (long-game plan, pillar C): standing rules with a clear price. The Acts open a few slots
 * (one in Act III, two in Act V, three in Act VI); passing a law costs knowledge, repealing it is free.
 */
export interface LawDef {
  id: string;
  icon: string;
  name: Record<'he' | 'en', string>;
  desc: Record<'he' | 'en', string>;
  /** Morale for everyone. */
  morale?: number;
  /** Output of every room (1.1 = +10%). */
  output?: number;
  /** Output of one resource. */
  outputOf?: Partial<Record<ResourceType, number>>;
  /** Food and water people use. */
  appetite?: number;
  /** Gap between newcomers (smaller = more people). */
  arrivals?: number;
  /** Added to the threat meter's target. */
  threat?: number;
  /** Walls and guards. */
  defense?: number;
}

export const LAWS: LawDef[] = [
  {
    id: 'rationing', icon: '[[food]]', appetite: 0.8, morale: -6,
    name: { he: 'קיצוב', en: 'Rationing' },
    desc: { he: 'אוכל ומים −20% לאדם · מורל −6', en: 'Food and water −20% per person · morale −6' },
  },
  {
    id: 'doubleShifts', icon: '[[clock]]', output: 1.12, morale: -8,
    name: { he: 'משמרות כפולות', en: 'Double Shifts' },
    desc: { he: 'כל החדרים +12% · מורל −8', en: 'Every room +12% · morale −8' },
  },
  {
    id: 'openDoors', icon: '[[door]]', arrivals: 0.7, threat: 10,
    name: { he: 'דלתות פתוחות', en: 'Open Doors' },
    desc: { he: 'ניצולים מגיעים מהר יותר ב־30% · האיום +10', en: 'Newcomers 30% faster · threat +10' },
  },
  {
    id: 'martialLaw', icon: '[[armory]]', defense: 1.25, morale: -10,
    name: { he: 'משטר צבאי', en: 'Martial Law' },
    desc: { he: 'חומות ושומרים +25% · מורל −10', en: 'Walls and guards +25% · morale −10' },
  },
  {
    id: 'freeSchools', icon: '[[books]]', outputOf: { knowledge: 1.2, materials: 0.9 },
    name: { he: 'בתי ספר חינם', en: 'Free Schools' },
    desc: { he: 'ידע +20% · חומרים −10%', en: 'Knowledge +20% · materials −10%' },
  },
  {
    id: 'dayOfRest', icon: '[[happy]]', morale: 10, output: 0.92,
    name: { he: 'יום מנוחה', en: 'Day of Rest' },
    desc: { he: 'מורל +10 · כל החדרים −8%', en: 'Morale +10 · every room −8%' },
  },
];

/** Law slots by Act (index = Act). */
const SLOTS = [0, 0, 0, 1, 1, 2, 3, 3];

export function lawSlots(state: GameState): number {
  return SLOTS[Math.min(SLOTS.length - 1, state.longGame?.meta.act ?? 0)];
}

export function activeLaws(state: GameState): LawDef[] {
  const ids = state.longGame?.policy.laws ?? [];
  return LAWS.filter(l => ids.includes(l.id));
}

export function lawCost(state: GameState): Record<string, number> {
  return { knowledge: 800 * Math.max(1, state.longGame?.meta.act ?? 1) };
}

const product = (xs: (number | undefined)[]) => xs.reduce<number>((p, x) => p * (x ?? 1), 1);
const sum = (xs: (number | undefined)[]) => xs.reduce<number>((p, x) => p + (x ?? 0), 0);

export const lawMorale = (s: GameState) => sum(activeLaws(s).map(l => l.morale));
export const lawOutput = (s: GameState, r: ResourceType) => product(activeLaws(s).map(l => (l.output ?? 1) * (l.outputOf?.[r] ?? 1)));
export const lawAppetite = (s: GameState) => product(activeLaws(s).map(l => l.appetite));
export const lawArrivals = (s: GameState) => product(activeLaws(s).map(l => l.arrivals));
export const lawThreat = (s: GameState) => sum(activeLaws(s).map(l => l.threat));
export const lawDefense = (s: GameState) => product(activeLaws(s).map(l => l.defense));

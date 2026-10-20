import type { GameState } from '../core/GameState';

/**
 * [P5] Mutators (long-game plan, pillar E): after the first Genesis, a new run may take on hardships for more Legacy.
 * Chosen when the run starts, kept for the whole run.
 * [phase5] Hardships with bite (strategy-systems C10, "mutators are free legacy"): each one takes away a crutch the last run leaned on,
 * in return for its Legacy share. Where each one is enforced:
 *  - cutOff: the old homes send nothing (scenarios.homeTribute).
 *  - noForeman: the Foreman takes no orders (MetaSystem switches the orders off; ForemanSystem.available should also read it, see wiring).
 *  - exposed: a lost raid loses an outpost for good (MetaSystem, on 'raid:resolved').
 *  - scarcity: storage −25% (ResourceSystem.computeCaps).
 *  - restless: threat +20 (ThreatSystem).
 * Harsh Winters and Lean Years were passive ±% nobody played around: they are no longer offered, but a run that already has them keeps
 * their effect and their Legacy (RETIRED_MUTATORS).
 */
export interface MutatorDef {
  id: string;
  icon: string;
  name: Record<'he' | 'en', string>;
  desc: Record<'he' | 'en', string>;
  /** Extra Legacy share. */
  legacy: number;
}

export const MUTATORS: MutatorDef[] = [
  {
    id: 'cutOff', icon: '[[signal]]', legacy: 0.15,
    name: { he: 'מנותקים', en: 'Cut Off' },
    desc: { he: 'הבונקרים הקודמים לא שולחים כלום. כל מה שיש, תרוויחו לבד', en: 'Your old bunkers send nothing. Everything you have, you earn here' },
  },
  {
    id: 'noForeman', icon: '[[hand]]', legacy: 0.2,
    name: { he: 'בלי מנהל עבודה', en: 'No Foreman' },
    desc: { he: 'מנהל העבודה לא מקבל פקודות קבע: תיקונים, איוש ומשלוחים לפרויקט רק ביד', en: 'The Foreman takes no standing orders: repairs, staffing and project deliveries are all by hand' },
  },
  {
    id: 'exposed', icon: '[[flag]]', legacy: 0.15,
    name: { he: 'מאחזים חשופים', en: 'Exposed Outposts' },
    desc: { he: 'פשיטה שהפסדתם בה לוקחת מאחז אחד לתמיד (לא רק פוגעת בו)', en: 'A raid you lose takes one outpost for good (not only damages it)' },
  },
  {
    id: 'scarcity', icon: '[[storage]]', legacy: 0.2,
    name: { he: 'מחסור', en: 'Scarcity' },
    desc: { he: 'כל המחסנים קטנים ב־25%: חפירות ופרויקטים דורשים מחסן גדול יותר מוקדם יותר', en: 'All storage 25% smaller: digs and projects need a bigger store sooner' },
  },
  {
    id: 'restless', icon: '[[skull]]', legacy: 0.15,
    name: { he: 'עולם חסר מנוחה', en: 'Restless World' },
    desc: { he: 'האיום מבחוץ +20: יותר פשיטות, וגדולות יותר', en: 'Threat from outside +20: more raids, and bigger ones' },
  },
];

/** [phase5] No longer offered for a new run; a run that already has one keeps its effect and its Legacy. */
export const RETIRED_MUTATORS: MutatorDef[] = [
  {
    id: 'harshWinters', icon: '[[snow]]', legacy: 0.15,
    name: { he: 'חורפים קשים', en: 'Harsh Winters' },
    desc: { he: 'עונשי החורף כפולים', en: 'Winter\'s penalties are doubled' },
  },
  {
    id: 'leanYears', icon: '[[wheat]]', legacy: 0.15,
    name: { he: 'שנים רזות', en: 'Lean Years' },
    desc: { he: 'אוכל −15% כל הזמן', en: 'Food −15% all the time' },
  },
];

export function hasMutator(state: GameState, id: string): boolean {
  return state.longGame?.meta.mutators.includes(id) ?? false;
}

export function mutatorLegacy(state: GameState): number {
  return [...MUTATORS, ...RETIRED_MUTATORS].filter(m => hasMutator(state, m.id)).reduce((s, m) => s + m.legacy, 0);
}

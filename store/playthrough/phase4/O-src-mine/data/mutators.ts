import type { GameState } from '../core/GameState';

/**
 * [P5] Mutators (long-game plan, pillar E): after the first Genesis, a new run may take on hardships for more Legacy.
 * Chosen when the run starts, kept for the whole run.
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
    id: 'harshWinters', icon: '[[snow]]', legacy: 0.15,
    name: { he: 'חורפים קשים', en: 'Harsh Winters' },
    desc: { he: 'עונשי החורף כפולים', en: 'Winter\'s penalties are doubled' },
  },
  {
    id: 'scarcity', icon: '[[storage]]', legacy: 0.2,
    name: { he: 'מחסור', en: 'Scarcity' },
    desc: { he: 'כל המחסנים קטנים ב־25%', en: 'All storage 25% smaller' },
  },
  {
    id: 'restless', icon: '[[skull]]', legacy: 0.15,
    name: { he: 'עולם חסר מנוחה', en: 'Restless World' },
    desc: { he: 'האיום מבחוץ +20', en: 'Threat from outside +20' },
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
  return MUTATORS.filter(m => hasMutator(state, m.id)).reduce((s, m) => s + m.legacy, 0);
}

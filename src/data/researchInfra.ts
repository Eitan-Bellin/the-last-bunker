import type { ResearchDef } from './research';
import type { BuildingType } from '../core/GameState';

/**
 * [plan4:BL-27/28/29] The research that opens the bulkhead door, the emergency stairwell and the vent stack. Like the rooms they are
 * defined in buildings.json and unlocked by exactly one node (isBuildingUnlocked), but they live in state.layout, not state.buildings.
 * Prices and times are the plan's (02-new-buildings.md section 2.1). Kept in a file of its own so the other research files stay free of edits.
 */
const infra = (k: string) => k as BuildingType;

export const INFRA_RESEARCH: ResearchDef[] = [
  {
    id: 'bulkheads', branch: 'defense', tier: 2, icon: '[[door]]', act: 2,
    name: { he: 'דלתות מחיצה', en: 'Bulkheads' },
    desc: { he: 'פותח: דלת מחיצה – עוצרת אש, מגפה ופורצים', en: 'Unlocks: Bulkhead Door – holds back fire, sickness and raiders' },
    cost: { knowledge: 35, materials: 60 }, time: 240, requires: ['fortifiedDoor'],
    effects: [{ type: 'unlock', building: infra('bulkhead') }],
  },
  {
    id: 'emergencyExits', branch: 'survival', tier: 2, icon: '[[up]]', act: 2,
    name: { he: 'יציאות חירום', en: 'Emergency Exits' },
    desc: { he: 'פותח: חדר מדרגות חירום – פינוי מהיר באש ובקריסה', en: 'Unlocks: Emergency Stairwell – a quick way out of a fire or a collapse' },
    cost: { knowledge: 40, materials: 70 }, time: 300, requires: ['firstAid'],
    effects: [{ type: 'unlock', building: infra('stairwell') }],
  },
  {
    id: 'ventilation', branch: 'infrastructure', tier: 3, icon: '[[wave]]', act: 3,
    name: { he: 'אוורור', en: 'Ventilation' },
    desc: { he: 'פותח: פיר אוורור – פחות צפיפות ופחות מגפות', en: 'Unlocks: Vent Stack – less crowding and fewer epidemics' },
    cost: { knowledge: 80, scrap: 20 }, time: 600, requires: ['waterFiltration'],
    effects: [{ type: 'unlock', building: infra('ventStack') }],
  },
];

import type { ResearchDef } from './research';

/**
 * [plan4:BL-9..14,19,33] The unlocking research of the new rooms: exactly one node per room type (isBuildingUnlocked only reads the
 * first `unlock` node of a type). Prices and times are the redesign plan's starting values (02-new-buildings.md, section 2.1); they are
 * small on purpose: a room is a choice of what to build next, not a research milestone. The Act is the first one in which it can be
 * researched. Kept in a block of its own so the other research files stay free of room-by-room edits.
 */
export const ROOM_RESEARCH: ResearchDef[] = [
  {
    id: 'energyStorage', branch: 'infrastructure', tier: 2, icon: '[[batteryBank]]', act: 2,
    name: { he: 'אגירת אנרגיה', en: 'Energy Storage' },
    desc: { he: 'פותח: מצבר ענק – עוד חשמל לשעות החושך', en: 'Unlocks: Battery Bank – more power for the dark hours' },
    cost: { knowledge: 50, materials: 60 }, time: 360, requires: ['batteryBanks'],
    effects: [{ type: 'unlock', building: 'batteryBank' }],
  },
  {
    id: 'communityHall', branch: 'society', tier: 2, icon: '[[commons]]', act: 2,
    name: { he: 'אולם קהילה', en: 'Community Hall' },
    desc: { he: 'פותח: אולם מועדון – מורל מנוחה וחברה', en: 'Unlocks: Commons – comfort and company for morale' },
    cost: { knowledge: 25, materials: 30 }, time: 180, requires: ['communityMeals'],
    effects: [{ type: 'unlock', building: 'commons' }],
  },
  {
    id: 'libraryScience', branch: 'society', tier: 3, icon: '[[library]]', act: 2,
    name: { he: 'ספריית הבונקר', en: 'Bunker Library' },
    desc: { he: 'פותח: ספרייה – ידע, אחסון ידע ותרבות', en: 'Unlocks: Library – knowledge, knowledge storage and culture' },
    cost: { knowledge: 70, materials: 80 }, time: 600, requires: ['education'],
    effects: [{ type: 'unlock', building: 'library' }],
  },
  {
    id: 'recyclingTech', branch: 'infrastructure', tier: 3, icon: '[[recycler]]', act: 3,
    name: { he: 'טכנולוגיית מחזור', en: 'Recycling Tech' },
    desc: { he: 'פותח: מרכז מחזור – גרוטאות מחומרים', en: 'Unlocks: Recycler – scrap from materials' },
    cost: { knowledge: 90, materials: 120 }, time: 900, requires: ['advancedEngineering'],
    effects: [{ type: 'unlock', building: 'recycler' }],
  },
  {
    id: 'atmosphericWater', branch: 'survival', tier: 2, icon: '[[condenser]]', act: 2,
    name: { he: 'מים מהאוויר', en: 'Atmospheric Water' },
    desc: { he: 'פותח: מעבה אדים – מים בלי עובדים', en: 'Unlocks: Air Condenser – water without a crew' },
    cost: { knowledge: 45, scrap: 15 }, time: 300, requires: ['waterFiltration'],
    effects: [{ type: 'unlock', building: 'condenser' }],
  },
  {
    id: 'mycology', branch: 'survival', tier: 2, icon: '[[mushroomFarm]]', act: 2, eureka: { kind: 'floors', n: 4 },
    name: { he: 'מיקולוגיה', en: 'Mycology' },
    desc: { he: 'פותח: חוות פטריות – אוכל בקומות העמוקות', en: 'Unlocks: Mushroom Farm – food on the deep levels' },
    cost: { knowledge: 40, scrap: 10 }, time: 240, requires: ['waterFiltration'],
    effects: [{ type: 'unlock', building: 'mushroomFarm' }],
  },
  {
    id: 'perimeter', branch: 'defense', tier: 2, icon: '[[gatePost]]', act: 2,
    name: { he: 'הגנת היקף', en: 'Perimeter Defense' },
    desc: { he: 'פותח: עמדת שער – הגנה ופחות פריצות', en: 'Unlocks: Gate Post – defense and fewer breaches' },
    cost: { knowledge: 50, materials: 80 }, time: 360, requires: ['armoryResearch'],
    effects: [{ type: 'unlock', building: 'gatePost' }],
  },
  {
    // The plan calls this node `militia`; that id is taken by the society doctrine, so the garrison has its own.
    id: 'garrison', branch: 'defense', tier: 3, icon: '[[barracks]]', act: 3,
    name: { he: 'חיל המשמר', en: 'Garrison' },
    desc: { he: 'פותח: מגורי שומרים – מיטות והגנה', en: 'Unlocks: Barracks – beds and defense' },
    cost: { knowledge: 80, scrap: 40 }, time: 600, requires: ['armoryResearch'],
    effects: [{ type: 'unlock', building: 'barracks' }],
  },
];

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
  // ---- [plan4:BL-15..32] wave 2 (the memorial hall has no node: it opens with the story flag `memorial:first`) ----
  {
    id: 'epidemiology', branch: 'survival', tier: 3, icon: '[[quarantineWard]]', act: 3,
    name: { he: 'אפידמיולוגיה', en: 'Epidemiology' },
    desc: { he: 'פותח: מחלקת בידוד – חולים מחלימים מהר ולא מדביקים', en: 'Unlocks: Quarantine Ward – the sick recover faster and do not spread it' },
    cost: { knowledge: 100, materials: 100 }, time: 900, requires: ['firstAid'],
    effects: [{ type: 'unlock', building: 'quarantineWard' }],
  },
  {
    id: 'photovoltaics', branch: 'infrastructure', tier: 2, icon: '[[solarArray]]', act: 2,
    name: { he: 'תאים פוטו־וולטאיים', en: 'Photovoltaics' },
    desc: { he: 'פותח: שדה פאנלים על הגג – חשמל חינם ביום', en: 'Unlocks: Solar Array on the roof – free power by day' },
    cost: { knowledge: 60, scrap: 20 }, time: 600, requires: ['batteryBanks'],
    effects: [{ type: 'unlock', building: 'solarArray' }],
  },
  {
    id: 'windPower', branch: 'infrastructure', tier: 3, icon: '[[windTurbine]]', act: 3,
    name: { he: 'כוח רוח', en: 'Wind Power' },
    desc: { he: 'פותח: טורבינת רוח – חשמל כשהרוח נושבת', en: 'Unlocks: Wind Turbine – power when the wind blows' },
    cost: { knowledge: 80, scrap: 40 }, time: 600, requires: ['photovoltaics'],
    effects: [{ type: 'unlock', building: 'windTurbine' }],
  },
  {
    id: 'observation', branch: 'defense', tier: 2, icon: '[[watchtower]]', act: 2,
    name: { he: 'תצפית', en: 'Observation' },
    desc: { he: 'פותח: מגדל תצפית – התראה מוקדמת על פשיטות', en: 'Unlocks: Watchtower – an early warning of raids' },
    cost: { knowledge: 40, scrap: 15 }, time: 240, requires: ['armoryResearch'],
    effects: [{ type: 'unlock', building: 'watchtower' }],
  },
  {
    // The plan calls this node `vehicles`; that id is the existing expedition-speed node, so the motor pool has its own.
    id: 'motorPool', branch: 'exploration', tier: 3, icon: '[[garage]]', act: 3,
    name: { he: 'מוסך שיירות', en: 'Motor Pool' },
    desc: { he: 'פותח: מוסך שיירות – עוד צוותי משלחת ושיירות עמוסות יותר', en: 'Unlocks: Motor Pool – more expedition teams and fuller caravans' },
    cost: { knowledge: 110, scrap: 60 }, time: 1200, requires: ['scavengingTactics'],
    effects: [{ type: 'unlock', building: 'garage' }],
  },
  {
    id: 'decontamination', branch: 'survival', tier: 3, icon: '[[decon]]', act: 3,
    name: { he: 'טיהור', en: 'Decontamination' },
    desc: { he: 'פותח: תא טיהור – פחות פצועים וחולים בחזרה ממשלחות', en: 'Unlocks: Decon Chamber – fewer injured or sick on the way home' },
    cost: { knowledge: 90, materials: 100 }, time: 900, requires: ['hazmatSuits'],
    effects: [{ type: 'unlock', building: 'decon' }],
  },
  {
    id: 'aquaculture', branch: 'survival', tier: 3, icon: '[[aquaculture]]', act: 3,
    name: { he: 'גידול דגים', en: 'Aquaculture' },
    desc: { he: 'פותח: בריכות דגים – אוכל ליד האגם', en: 'Unlocks: Fish Ponds – food beside the lake' },
    cost: { knowledge: 90, scrap: 30 }, time: 900, requires: ['waterFiltration'],
    effects: [{ type: 'unlock', building: 'aquaculture' }],
  },
  {
    id: 'marketplace', branch: 'society', tier: 3, icon: '[[market]]', act: 3,
    name: { he: 'שוק', en: 'Marketplace' },
    desc: { he: 'פותח: שוק – שיירות עמוסות והצעות החלפה', en: 'Unlocks: Market – fuller caravans and swap offers' },
    cost: { knowledge: 100, materials: 140 }, time: 900, requires: ['radioBasics'],
    effects: [{ type: 'unlock', building: 'market' }],
  },
  {
    id: 'childcare', branch: 'society', tier: 2, icon: '[[nursery]]', act: 2,
    name: { he: 'טיפול בילדים', en: 'Childcare' },
    desc: { he: 'פותח: גן ילדים – ילדים גדלים בבטחה ומהר יותר', en: 'Unlocks: Nursery – children grow up safe and faster' },
    cost: { knowledge: 30, materials: 50 }, time: 240, requires: ['communityMeals'],
    effects: [{ type: 'unlock', building: 'nursery' }],
  },
  {
    // The plan calls this node `education`; that id is the existing society node, so the school has its own.
    id: 'schooling', branch: 'society', tier: 3, icon: '[[school]]', act: 3,
    name: { he: 'בית ספר', en: 'Schooling' },
    desc: { he: 'פותח: בית ספר – ילדים לומדים ויוצאים חזקים יותר', en: 'Unlocks: School – children learn and grow up stronger' },
    cost: { knowledge: 120, materials: 150 }, time: 1200, requires: ['childcare', 'education'],
    effects: [{ type: 'unlock', building: 'school' }],
  },
  {
    id: 'sanitation', branch: 'survival', tier: 2, icon: '[[bathhouse]]', act: 2,
    name: { he: 'תברואה', en: 'Sanitation' },
    desc: { he: 'פותח: מקלחות וכביסה – מורל ופחות מגפות', en: 'Unlocks: Bathhouse – morale and fewer epidemics' },
    cost: { knowledge: 35, materials: 40 }, time: 240, requires: ['waterFiltration'],
    effects: [{ type: 'unlock', building: 'bathhouse' }],
  },
];

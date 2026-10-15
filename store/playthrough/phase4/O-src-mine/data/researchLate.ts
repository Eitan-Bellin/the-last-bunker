import type { ResearchDef } from './research';

/**
 * [Balance plan P2-1 / P2-8] The late research: a doctrine fork for each of Acts IV-VII (industry, the surface, the regime, what crosses
 * into the next world) and a handful of nodes per Act, so the lab has work (and the run has choices) until the end. Before this the tree
 * ended around day 17 and no fork was left after day 9. Times follow the long-game tiers: T6 16 h, T7 38 h, T8 77 h of lab time at base speed.
 * The Act's own currency (alloys, data, influence, seed cores) is part of every price, so research competes with the Act's other needs.
 */
const T6 = 57_600;
const T7 = 136_800;
const T8 = 277_200;

export const LATE_RESEARCH: ResearchDef[] = [
  // ---- Act IV: Industry doctrine ----
  {
    id: 'foundryDoctrine', branch: 'infrastructure', tier: 6, icon: '[[alloys]]', act: 4, fork: 'industry', eureka: { kind: 'specialized', n: 8 },
    name: { he: 'דוקטרינה: היציקה', en: 'Doctrine: The Foundry' },
    desc: { he: 'סגסוגות +30% · רכיבים +30%', en: 'Alloys +30% · components +30%' },
    cost: { knowledge: 6000, alloys: 200, components: 300 }, time: T6, requires: ['assemblyTheory'],
    effects: [{ type: 'resourceMult', resource: 'alloys', value: 0.3 }, { type: 'resourceMult', resource: 'components', value: 0.3 }],
  },
  {
    id: 'deepMining', branch: 'infrastructure', tier: 6, icon: '[[pick]]', act: 4, fork: 'industry', eureka: { kind: 'floors', n: 12 },
    name: { he: 'דוקטרינה: כרייה עמוקה', en: 'Doctrine: Deep Mining' },
    desc: { he: 'חומרים +30% · חפירת קומות מהירה ב־20%', en: 'Materials +30% · digging floors 20% faster' },
    cost: { knowledge: 6000, alloys: 150, scrap: 800 }, time: T6, requires: ['assemblyTheory'],
    effects: [{ type: 'resourceMult', resource: 'materials', value: 0.3 }, { type: 'feature', feature: 'deepMining' }],
  },
  {
    id: 'precisionCraft', branch: 'infrastructure', tier: 6, icon: '[[research]]', act: 4, fork: 'industry', eureka: { kind: 'pop', n: 70 },
    name: { he: 'דוקטרינה: מלאכת מחשבת', en: 'Doctrine: Precision Craft' },
    desc: { he: 'ידע +25% · מעבדות +30%', en: 'Knowledge +25% · laboratories +30%' },
    cost: { knowledge: 6500, alloys: 150, components: 250 }, time: T6, requires: ['assemblyTheory'],
    effects: [{ type: 'resourceMult', resource: 'knowledge', value: 0.25 }, { type: 'buildingMult', building: 'laboratory', value: 0.3 }],
  },
  // ---- Act IV nodes ----
  {
    id: 'quarryEngines', branch: 'infrastructure', tier: 6, icon: '[[materials]]', act: 4,
    name: { he: 'מנועי מחצבה', en: 'Quarry Engines' },
    desc: { he: 'חומרים +20%', en: 'Materials +20%' },
    cost: { knowledge: 5500, alloys: 120 }, time: T6, requires: ['gridAutomation'],
    effects: [{ type: 'resourceMult', resource: 'materials', value: 0.2 }],
  },
  {
    id: 'closedLoopWater', branch: 'survival', tier: 6, icon: '[[water]]', act: 4,
    name: { he: 'מחזור מים סגור', en: 'Closed-Loop Water' },
    desc: { he: 'מים +25% · +1,500 קיבולת מים', en: 'Water +25% · +1,500 water storage' },
    cost: { knowledge: 5200, alloys: 100 }, time: T6, requires: ['coldChain'],
    effects: [{ type: 'resourceMult', resource: 'water', value: 0.25 }, { type: 'cap', resource: 'water', value: 1500 }],
  },
  {
    id: 'fieldMedicine', branch: 'survival', tier: 6, icon: '[[medbay]]', act: 4,
    name: { he: 'רפואת שדה', en: 'Field Medicine' },
    desc: { he: 'תרופות +30%', en: 'Medicine +30%' },
    cost: { knowledge: 5500, alloys: 120, components: 200 }, time: T6, requires: ['medicalCenter'],
    effects: [{ type: 'resourceMult', resource: 'medicine', value: 0.3 }],
  },
  {
    id: 'surveyDrones', branch: 'exploration', tier: 6, icon: '[[dish]]', act: 4, eureka: { kind: 'explored', n: 200 },
    name: { he: 'רחפני סקר', en: 'Survey Drones' },
    desc: { he: 'משלחות מהירות ב־20%', en: 'Expeditions 20% faster' },
    cost: { knowledge: 5500, alloys: 150, components: 250 }, time: T6, requires: ['cartography'],
    effects: [{ type: 'feature', feature: 'surveyDrones' }],
  },
  // ---- Act V: Surface doctrine ----
  {
    id: 'isolationism', branch: 'defense', tier: 7, icon: '[[lock]]', act: 5, fork: 'surface', eureka: { kind: 'crises', n: 14 },
    name: { he: 'דוקטרינה: בידוד', en: 'Doctrine: Isolationism' },
    desc: { he: 'מבחוץ פחות מתעניינים: האיום −25%, חומות +20% · ניצולים מגיעים לאט יותר ב־25%', en: 'Less interest from outside: threat −25%, walls +20% · newcomers arrive 25% slower' },
    cost: { knowledge: 7000, data: 200, alloys: 120 }, time: T7, requires: ['gridAutomation'],
    effects: [{ type: 'feature', feature: 'isolationism' }],
  },
  {
    id: 'expansionism', branch: 'exploration', tier: 7, icon: '[[surface]]', act: 5, fork: 'surface', eureka: { kind: 'explored', n: 220 },
    name: { he: 'דוקטרינה: התפשטות', en: 'Doctrine: Expansionism' },
    desc: { he: 'מאחזים מניבים +40% ואפשר להחזיק 2 יותר · ניצולים מגיעים מהר ב־15% · האיום +10', en: 'Outposts yield +40% and you may hold 2 more · newcomers arrive 15% faster · threat +10' },
    cost: { knowledge: 7000, data: 200, alloys: 120 }, time: T7, requires: ['gridAutomation'],
    effects: [{ type: 'feature', feature: 'expansionism' }],
  },
  {
    id: 'merchantRepublic', branch: 'society', tier: 7, icon: '[[cart]]', act: 5, fork: 'surface', eureka: { kind: 'charters', n: 9 },
    name: { he: 'דוקטרינה: רפובליקת הסוחרים', en: 'Doctrine: Merchant Republic' },
    desc: { he: 'חוזים משלמים +30% · החנות זולה ב־15%', en: 'Contracts pay +30% · the shop is 15% cheaper' },
    cost: { knowledge: 7000, data: 200, alloys: 120 }, time: T7, requires: ['gridAutomation'],
    effects: [{ type: 'feature', feature: 'merchantRepublic' }],
  },
  // ---- Act V nodes ----
  {
    id: 'dataLattice', branch: 'infrastructure', tier: 7, icon: '[[chart]]', act: 5,
    name: { he: 'סריג נתונים', en: 'Data Lattice' },
    desc: { he: 'נתונים +25% · ידע +10%', en: 'Data +25% · knowledge +10%' },
    cost: { knowledge: 6500, data: 250, alloys: 100 }, time: T7, requires: ['quarryEngines'],
    effects: [{ type: 'resourceMult', resource: 'data', value: 0.25 }, { type: 'resourceMult', resource: 'knowledge', value: 0.1 }],
  },
  {
    id: 'skyGreenhouses', branch: 'survival', tier: 7, icon: '[[wheat]]', act: 5,
    name: { he: 'חממות עליונות', en: 'Sky Greenhouses' },
    desc: { he: 'אוכל +25%', en: 'Food +25%' },
    cost: { knowledge: 6500, data: 200, alloys: 100 }, time: T7, requires: ['closedLoopWater'],
    effects: [{ type: 'resourceMult', resource: 'food', value: 0.25 }],
  },
  {
    id: 'rapidResponse', branch: 'defense', tier: 7, icon: '[[eye]]', act: 5, eureka: { kind: 'crises', n: 12 },
    name: { he: 'כוח תגובה מהירה', en: 'Rapid Response Force' },
    desc: { he: 'אזהרה מפשיטה 2 דקות מוקדם יותר', en: 'Raid warnings come 2 minutes earlier' },
    cost: { knowledge: 6500, data: 200, alloys: 150 }, time: T7, requires: ['bunkerDoctrine'],
    effects: [{ type: 'feature', feature: 'rapidResponse' }],
  },
  {
    id: 'archivesOfAges', branch: 'society', tier: 7, icon: '[[books]]', act: 5, eureka: { kind: 'lore', n: 20 },
    name: { he: 'ארכיוני הדורות', en: 'Archives of Ages' },
    desc: { he: 'ידע +15% · +4 מורל', en: 'Knowledge +15% · +4 morale' },
    cost: { knowledge: 7000, data: 250 }, time: T7, requires: ['heritage'],
    effects: [{ type: 'resourceMult', resource: 'knowledge', value: 0.15 }, { type: 'morale', value: 4 }],
  },
  // ---- Act VI: Regime doctrine ----
  {
    id: 'republic', branch: 'society', tier: 8, icon: '[[crown]]', act: 6, fork: 'regime', eureka: { kind: 'pop', n: 140 },
    name: { he: 'דוקטרינה: רפובליקה', en: 'Doctrine: Republic' },
    desc: { he: '+10 מורל לכולם · השפעה +30%', en: '+10 morale for everyone · influence +30%' },
    cost: { knowledge: 8500, influence: 150, data: 200 }, time: T8, requires: ['education'],
    effects: [{ type: 'morale', value: 10 }, { type: 'resourceMult', resource: 'influence', value: 0.3 }],
  },
  {
    id: 'technocracy', branch: 'infrastructure', tier: 8, icon: '[[settings]]', act: 6, fork: 'regime', eureka: { kind: 'specialized', n: 14 },
    name: { he: 'דוקטרינה: טכנוקרטיה', en: 'Doctrine: Technocracy' },
    desc: { he: 'ידע +25% · נתונים +25% · חדרים +5%', en: 'Knowledge +25% · data +25% · every room +5%' },
    cost: { knowledge: 8500, influence: 150, data: 250 }, time: T8, requires: ['education'],
    effects: [{ type: 'resourceMult', resource: 'knowledge', value: 0.25 }, { type: 'resourceMult', resource: 'data', value: 0.25 }, { type: 'feature', feature: 'technocracy' }],
  },
  {
    id: 'confederation', branch: 'society', tier: 8, icon: '[[people]]', act: 6, fork: 'regime', eureka: { kind: 'explored', n: 240 },
    name: { he: 'דוקטרינה: קונפדרציה', en: 'Doctrine: Confederation' },
    desc: { he: '+15 מקומות לדיירים · ניצולים מגיעים מהר ב־15%', en: '+15 places for residents · newcomers arrive 15% faster' },
    cost: { knowledge: 8500, influence: 150, data: 200 }, time: T8, requires: ['education'],
    effects: [{ type: 'feature', feature: 'confederation' }],
  },
  // ---- Act VI nodes ----
  {
    id: 'civicHalls', branch: 'society', tier: 8, icon: '[[crown]]', act: 6,
    name: { he: 'אולמות אזרחיים', en: 'Civic Halls' },
    desc: { he: 'השפעה +25% · +4 מורל', en: 'Influence +25% · +4 morale' },
    cost: { knowledge: 8000, influence: 120, data: 150 }, time: T8, requires: ['archivesOfAges'],
    effects: [{ type: 'resourceMult', resource: 'influence', value: 0.25 }, { type: 'morale', value: 4 }],
  },
  {
    id: 'tradeRoads', branch: 'exploration', tier: 8, icon: '[[cart]]', act: 6,
    name: { he: 'דרכי סחר', en: 'Trade Roads' },
    desc: { he: 'שיירות מהירות ב־25%', en: 'Caravans 25% faster' },
    cost: { knowledge: 8000, influence: 100, data: 150 }, time: T8, requires: ['surveyDrones'],
    effects: [{ type: 'feature', feature: 'tradeRoads' }],
  },
  {
    id: 'peoplesFarms', branch: 'survival', tier: 8, icon: '[[farm]]', act: 6,
    name: { he: 'חוות העם', en: 'The People\'s Farms' },
    desc: { he: 'אוכל +15% · מים +15%', en: 'Food +15% · water +15%' },
    cost: { knowledge: 8000, influence: 100, data: 150 }, time: T8, requires: ['skyGreenhouses'],
    effects: [{ type: 'resourceMult', resource: 'food', value: 0.15 }, { type: 'resourceMult', resource: 'water', value: 0.15 }],
  },
  {
    id: 'shieldNetwork', branch: 'defense', tier: 8, icon: '[[armory]]', act: 6, eureka: { kind: 'crises', n: 18 },
    name: { he: 'רשת מגן', en: 'Shield Network' },
    desc: { he: 'חומות +20%', en: 'Walls +20%' },
    cost: { knowledge: 8500, influence: 120, alloys: 200 }, time: T8, requires: ['rapidResponse'],
    effects: [{ type: 'feature', feature: 'shieldNetwork' }],
  },
  // ---- Act VII: what crosses into the next world ----
  {
    id: 'archiveCrossing', branch: 'genesis', tier: 8, icon: '[[books]]', act: 7, fork: 'crossing', eureka: { kind: 'lore', n: 24 },
    name: { he: 'דוקטרינה: הארכיון', en: 'Doctrine: The Archive' },
    desc: { he: 'מורשת (תשלום בראשית) +15% · מה שלמדתם עובר איתכם', en: 'Legacy (the Genesis payout) +15% · what you learned crosses with you' },
    cost: { knowledge: 9500, seedCores: 40, influence: 150 }, time: T8, requires: ['seedVault'],
    effects: [{ type: 'feature', feature: 'arkLegacy' }],
  },
  {
    id: 'seedCrossing', branch: 'genesis', tier: 8, icon: '[[clover]]', act: 7, fork: 'crossing', eureka: { kind: 'charters', n: 12 },
    name: { he: 'דוקטרינה: מחסן הזרעים', en: 'Doctrine: The Seed Store' },
    desc: { he: 'העולם הבא מתחיל עם מלאי וקומות חפורות: חומרים, גרוטאות, ידע ושתי קומות', en: 'The next world starts with stock and dug floors: materials, scrap, knowledge and two floors' },
    cost: { knowledge: 9500, seedCores: 40, influence: 150 }, time: T8, requires: ['seedVault'],
    effects: [{ type: 'feature', feature: 'seedBank' }],
  },
  {
    id: 'vanguardCrossing', branch: 'genesis', tier: 8, icon: '[[people]]', act: 7, fork: 'crossing', eureka: { kind: 'pop', n: 160 },
    name: { he: 'דוקטרינה: החלוצים', en: 'Doctrine: The Vanguard' },
    desc: { he: 'שלושה מהעובדים המנוסים ביותר חוצים איתכם לעולם הבא', en: 'Three of your most experienced workers cross with you into the next world' },
    cost: { knowledge: 9500, seedCores: 40, influence: 150 }, time: T8, requires: ['seedVault'],
    effects: [{ type: 'feature', feature: 'vanguard' }],
  },
  // ---- Act VII nodes ----
  {
    id: 'newWorldForge', branch: 'infrastructure', tier: 8, icon: '[[alloys]]', act: 7,
    name: { he: 'כור העולם החדש', en: 'Forge of the New World' },
    desc: { he: 'סגסוגות +20% · רכיבים +20%', en: 'Alloys +20% · components +20%' },
    cost: { knowledge: 9000, seedCores: 30, alloys: 250 }, time: T8, requires: ['quarryEngines'],
    effects: [{ type: 'resourceMult', resource: 'alloys', value: 0.2 }, { type: 'resourceMult', resource: 'components', value: 0.2 }],
  },
  {
    id: 'seedSynthesis', branch: 'survival', tier: 8, icon: '[[clover]]', act: 7,
    name: { he: 'סינתזת זרעים', en: 'Seed Synthesis' },
    desc: { he: 'ליבות זרע +30% · אוכל +15%', en: 'Seed cores +30% · food +15%' },
    cost: { knowledge: 9000, seedCores: 30, influence: 120 }, time: T8, requires: ['peoplesFarms'],
    effects: [{ type: 'resourceMult', resource: 'seedCores', value: 0.3 }, { type: 'resourceMult', resource: 'food', value: 0.15 }],
  },
  {
    id: 'lastCensus', branch: 'society', tier: 8, icon: '[[chat]]', act: 7,
    name: { he: 'המפקד האחרון', en: 'The Last Census' },
    desc: { he: '+6 מורל · השפעה +15%', en: '+6 morale · influence +15%' },
    cost: { knowledge: 8500, seedCores: 25, influence: 150 }, time: T8, requires: ['civicHalls'],
    effects: [{ type: 'morale', value: 6 }, { type: 'resourceMult', resource: 'influence', value: 0.15 }],
  },
  {
    id: 'genesisCalculus', branch: 'genesis', tier: 8, icon: '[[hourglass]]', act: 7,
    name: { he: 'חשבון הבראשית', en: 'Genesis Calculus' },
    desc: { he: 'ידע +20%', en: 'Knowledge +20%' },
    cost: { knowledge: 9500, seedCores: 35, data: 300 }, time: T8, requires: ['seedVault'],
    effects: [{ type: 'resourceMult', resource: 'knowledge', value: 0.2 }],
  },
];

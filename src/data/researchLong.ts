import type { ResearchDef } from './research';
import { LATE_RESEARCH } from './researchLate';

/**
 * [Long game P3] The deeper research tree: four doctrine forks (one choice each, the others close for this run) and
 * nodes that open with the Acts. Times follow the plan's tiers (T3 0.8 h, T4 2.4 h, T5 6.5 h, T6 16 h of lab time at
 * base speed). A Eureka (a discount for a node that matches how the bunker is played) is listed with the node.
 */
export const LONG_RESEARCH: ResearchDef[] = [
  // ---- Power doctrine (Act II): fission, geothermal or solar ----
  {
    id: 'fission', branch: 'infrastructure', tier: 4, icon: '[[reactor]]', act: 2, fork: 'power', eureka: { kind: 'floors', n: 7 },
    name: { he: 'דוקטרינה: ביקוע', en: 'Doctrine: Fission' },
    desc: { he: 'כורים +60% · גנרטורים +20% · יותר סיכון להתכה', en: 'Reactors +60% · generators +20% · more meltdown risk' },
    cost: { knowledge: 1800, scrap: 300 }, time: 8640, requires: ['reactorTheory'],
    effects: [{ type: 'buildingMult', building: 'reactor', value: 0.6 }, { type: 'buildingMult', building: 'generator', value: 0.2 }],
  },
  {
    id: 'geothermal', branch: 'infrastructure', tier: 4, icon: '[[fire]]', act: 2, fork: 'power', eureka: { kind: 'floors', n: 8 },
    name: { he: 'דוקטרינה: גיאותרמי', en: 'Doctrine: Geothermal' },
    desc: { he: 'חשמל +20% · החורף לא מגדיל את צריכת החשמל', en: 'Power +20% · winter no longer raises power use' },
    cost: { knowledge: 1800, materials: 30000 }, time: 8640, requires: ['advancedEngineering'],
    effects: [{ type: 'resourceMult', resource: 'power', value: 0.2 }, { type: 'feature', feature: 'geothermal' }],
  },
  {
    id: 'solarArray', branch: 'infrastructure', tier: 4, icon: '[[sun]]', act: 2, fork: 'power', eureka: { kind: 'explored', n: 60 },
    name: { he: 'דוקטרינה: מערך סולארי', en: 'Doctrine: Solar Array' },
    desc: { he: 'גנרטורים +40% · בלי סיכון נוסף', en: 'Generators +40% · no added risk' },
    cost: { knowledge: 1800, scrap: 200, materials: 15000 }, time: 8640, requires: ['batteryBanks'],
    effects: [{ type: 'buildingMult', building: 'generator', value: 0.4 }],
  },
  // ---- Food doctrine (Act II): hydroponics, mycelium or surface farms ----
  {
    id: 'hydroDoctrine', branch: 'survival', tier: 4, icon: '[[hydroponics]]', act: 2, fork: 'food', eureka: { kind: 'specialized', n: 2 },
    name: { he: 'דוקטרינה: הידרופוניקה', en: 'Doctrine: Hydroponics' },
    desc: { he: 'חוות הידרופוניות +60%', en: 'Hydroponic farms +60%' },
    cost: { knowledge: 1600, materials: 20000 }, time: 8640, requires: ['hydroponicsResearch'],
    effects: [{ type: 'buildingMult', building: 'hydroponics', value: 0.6 }],
  },
  {
    id: 'mycelium', branch: 'survival', tier: 4, icon: '[[bug]]', act: 2, fork: 'food', eureka: { kind: 'floors', n: 7 },
    name: { he: 'דוקטרינה: תפטיר', en: 'Doctrine: Mycelium' },
    desc: { he: 'אוכל +30% · פטריות גדלות בחושך, גם בחורף (עונש החורף בחצי)', en: 'Food +30% · fungi grow in the dark, winter too (half the winter penalty)' },
    cost: { knowledge: 1600, water: 2000 }, time: 8640, requires: ['preservation'],
    effects: [{ type: 'resourceMult', resource: 'food', value: 0.3 }, { type: 'feature', feature: 'winterStores' }],
  },
  {
    id: 'surfaceFarms', branch: 'survival', tier: 4, icon: '[[wheat]]', act: 2, fork: 'food', eureka: { kind: 'explored', n: 50 },
    name: { he: 'דוקטרינה: חוות שטח', en: 'Doctrine: Surface Farms' },
    desc: { he: 'חוות +50% · +1,000 קיבולת אוכל', en: 'Farms +50% · +1,000 food storage' },
    cost: { knowledge: 1600, materials: 25000 }, time: 8640, requires: ['nutrition', 'hazmatSuits'],
    effects: [{ type: 'buildingMult', building: 'farm', value: 0.5 }, { type: 'cap', resource: 'food', value: 1000 }],
  },
  // ---- Society doctrine (Act III): commune, meritocracy or militia ----
  {
    id: 'commune', branch: 'society', tier: 5, icon: '[[heart]]', act: 3, fork: 'society', eureka: { kind: 'pop', n: 50 },
    name: { he: 'דוקטרינה: קומונה', en: 'Doctrine: Commune' },
    desc: { he: '+12 מורל לכולם', en: '+12 morale for everyone' },
    cost: { knowledge: 3500, food: 3000 }, time: 23400, requires: ['education'],
    effects: [{ type: 'morale', value: 12 }],
  },
  {
    id: 'meritocracy', branch: 'society', tier: 5, icon: '[[medal]]', act: 3, fork: 'society', eureka: { kind: 'specialized', n: 6 },
    name: { he: 'דוקטרינה: מריטוקרטיה', en: 'Doctrine: Meritocracy' },
    desc: { he: 'ניסיון בעבודה מצטבר פי 1.5 (מומחים מהר יותר)', en: 'Work experience builds 1.5 times faster (masters sooner)' },
    cost: { knowledge: 3500, components: 150 }, time: 23400, requires: ['education'],
    effects: [{ type: 'feature', feature: 'meritocracy' }],
  },
  {
    id: 'militia', branch: 'society', tier: 5, icon: '[[armory]]', act: 3, fork: 'society', eureka: { kind: 'crises', n: 6 },
    name: { he: 'דוקטרינה: מיליציה', en: 'Doctrine: Militia' },
    desc: { he: 'כל דייר שווה פי 2 בהגנה', en: 'Every resident counts double in defense' },
    cost: { knowledge: 3500, scrap: 600 }, time: 23400, requires: ['leadership', 'armoryResearch'],
    effects: [{ type: 'feature', feature: 'militia' }],
  },
  // ---- Defense doctrine (Act III): fortress, rangers or diplomacy ----
  {
    id: 'fortress', branch: 'defense', tier: 5, icon: '[[vault]]', act: 3, fork: 'defense', eureka: { kind: 'floors', n: 10 },
    name: { he: 'דוקטרינה: מבצר', en: 'Doctrine: Fortress' },
    desc: { he: 'חומות ×1.5: מלקטים נשברים מול הדלת', en: 'Walls ×1.5: scavengers break against the door' },
    cost: { knowledge: 3000, components: 200 }, time: 23400, requires: ['fortifiedDoor'],
    effects: [{ type: 'feature', feature: 'fortress' }],
  },
  {
    id: 'rangers', branch: 'defense', tier: 5, icon: '[[endurance]]', act: 3, fork: 'defense', eureka: { kind: 'crises', n: 5 },
    name: { he: 'דוקטרינה: סיירים', en: 'Doctrine: Rangers' },
    desc: { he: 'שומרים ×1.4: שודדים נתקלים במקצוענים', en: 'Guards ×1.4: marauders meet professionals' },
    cost: { knowledge: 3000, components: 200 }, time: 23400, requires: ['armoryResearch'],
    effects: [{ type: 'feature', feature: 'rangers' }],
  },
  {
    id: 'diplomacy', branch: 'defense', tier: 5, icon: '[[chat]]', act: 3, fork: 'defense', eureka: { kind: 'pop', n: 45 },
    name: { he: 'דוקטרינה: דיפלומטיה', en: 'Doctrine: Diplomacy' },
    desc: { he: 'מס לפושטים בחצי · פשיטות נדירות ב־20%', en: 'Half the raiders\' toll · 20% fewer raids' },
    cost: { knowledge: 3000, food: 4000 }, time: 23400, requires: ['leadership'],
    effects: [{ type: 'feature', feature: 'diplomacy' }],
  },
  // ---- Act II nodes ----
  {
    id: 'deepDrilling', branch: 'infrastructure', tier: 3, icon: '[[pick]]', act: 2, eureka: { kind: 'floors', n: 6 },
    name: { he: 'קידוח עמוק', en: 'Deep Drilling' },
    desc: { he: 'חפירת קומות מהירה ב־25%', en: 'Digging floors is 25% faster' },
    cost: { knowledge: 900, scrap: 150 }, time: 2880, requires: ['advancedEngineering'],
    effects: [{ type: 'feature', feature: 'deepDrilling' }],
  },
  {
    id: 'coldChain', branch: 'survival', tier: 3, icon: '[[water]]', act: 2,
    name: { he: 'שרשרת קירור', en: 'Cold Chain' },
    desc: { he: '+1,000 קיבולת אוכל ומים', en: '+1,000 food and water storage' },
    cost: { knowledge: 800, materials: 12000 }, time: 2880, requires: ['preservation'],
    effects: [{ type: 'cap', resource: 'food', value: 1000 }, { type: 'cap', resource: 'water', value: 1000 }],
  },
  {
    id: 'winterStores', branch: 'survival', tier: 3, icon: '[[snow]]', act: 2,
    name: { he: 'מחסני חורף', en: 'Winter Stores' },
    desc: { he: 'החורף מוריד רק חצי מהאוכל', en: 'Winter takes only half as much food' },
    cost: { knowledge: 1000, food: 1500 }, time: 2880, requires: ['preservation'],
    effects: [{ type: 'feature', feature: 'winterStores' }],
  },
  {
    id: 'tripwires', branch: 'defense', tier: 3, icon: '[[warning]]', act: 2, eureka: { kind: 'crises', n: 2 },
    name: { he: 'חוטי מלכודת', en: 'Tripwires' },
    desc: { he: '+15 לחומות', en: '+15 to walls' },
    cost: { knowledge: 700, scrap: 200 }, time: 2880, requires: ['armoryResearch'],
    effects: [{ type: 'feature', feature: 'tripwires' }],
  },
  {
    id: 'watchtower', branch: 'defense', tier: 3, icon: '[[eye]]', act: 2,
    name: { he: 'מגדל תצפית', en: 'Watchtower' },
    desc: { he: 'אזהרה מפשיטה 3 דקות מוקדם יותר', en: 'Raid warnings come 3 minutes earlier' },
    cost: { knowledge: 900, materials: 15000 }, time: 2880, requires: ['fortifiedDoor'],
    effects: [{ type: 'feature', feature: 'watchtower' }],
  },
  {
    id: 'longRangeRadio', branch: 'exploration', tier: 3, icon: '[[dish]]', act: 2, eureka: { kind: 'explored', n: 40 },
    name: { he: 'רדיו לטווח רחוק', en: 'Long-Range Radio' },
    desc: { he: 'ניצולים מגיעים מהר יותר ב־20%', en: 'Newcomers arrive 20% faster' },
    cost: { knowledge: 900, scrap: 150 }, time: 2880, requires: ['radioBasics'],
    effects: [{ type: 'feature', feature: 'longRangeRadio' }],
  },
  // ---- Act III nodes ----
  {
    // [plan4:ST-3] A second dig slot: two crews, two digs (a floor and a wing, or two wings) at once.
    id: 'parallelDig', branch: 'infrastructure', tier: 5, icon: '[[pick]]', act: 3,
    name: { he: 'חפירה מקבילה', en: 'Parallel Digging' },
    desc: { he: 'שתי חפירות במקביל: צוות שני חופר לצד הראשון', en: 'Two digs at once: a second crew works beside the first' },
    cost: { knowledge: 600, materials: 200 }, time: 3600, requires: ['deepDrilling'],
    effects: [{ type: 'feature', feature: 'parallelDig' }],
  },
  {
    id: 'assemblyTheory', branch: 'infrastructure', tier: 5, icon: '[[components]]', act: 3, eureka: { kind: 'specialized', n: 4 },
    name: { he: 'תורת ההרכבה', en: 'Assembly Theory' },
    desc: { he: 'רכיבים +25%', en: 'Components +25%' },
    cost: { knowledge: 3200, components: 120 }, time: 23400, requires: ['advancedEngineering'],
    effects: [{ type: 'resourceMult', resource: 'components', value: 0.25 }],
  },
  {
    id: 'medicalCenter', branch: 'survival', tier: 5, icon: '[[medbay]]', act: 3,
    name: { he: 'מרכז רפואי', en: 'Medical Center' },
    desc: { he: 'תרופות +40%', en: 'Medicine +40%' },
    cost: { knowledge: 3000, components: 100 }, time: 23400, requires: ['firstAid', 'education'],
    effects: [{ type: 'resourceMult', resource: 'medicine', value: 0.4 }],
  },
  {
    id: 'schools', branch: 'society', tier: 5, icon: '[[books]]', act: 3, eureka: { kind: 'pop', n: 40 },
    name: { he: 'בתי ספר', en: 'Schools' },
    desc: { he: 'ידע +25%', en: 'Knowledge +25%' },
    cost: { knowledge: 3500, components: 100 }, time: 23400, requires: ['education'],
    effects: [{ type: 'resourceMult', resource: 'knowledge', value: 0.25 }],
  },
  {
    id: 'cartography', branch: 'exploration', tier: 5, icon: '[[map]]', act: 3, eureka: { kind: 'explored', n: 120 },
    name: { he: 'קרטוגרפיה', en: 'Cartography' },
    desc: { he: '+1,500 קיבולת גרוטאות · משלחות יודעות לאן ללכת', en: '+1,500 scrap storage · teams know where to go' },
    cost: { knowledge: 3000, components: 120 }, time: 23400, requires: ['scavengingTactics'],
    effects: [{ type: 'cap', resource: 'scrap', value: 1500 }],
  },
  {
    id: 'armorPlating', branch: 'defense', tier: 5, icon: '[[armory]]', act: 3,
    name: { he: 'שריון', en: 'Armor Plating' },
    desc: { he: 'שומרים +20%', en: 'Guards +20%' },
    cost: { knowledge: 3000, components: 250 }, time: 23400, requires: ['armoryResearch'],
    effects: [{ type: 'feature', feature: 'armorPlating' }],
  },
  // ---- Act IV nodes ----
  {
    id: 'metallurgy', branch: 'infrastructure', tier: 6, icon: '[[alloys]]', act: 4, eureka: { kind: 'charters', n: 7 },
    name: { he: 'מטלורגיה', en: 'Metallurgy' },
    desc: { he: 'סגסוגות +25%', en: 'Alloys +25%' },
    cost: { knowledge: 4500, alloys: 80, components: 200 }, time: 57600, requires: ['assemblyTheory'],
    effects: [{ type: 'resourceMult', resource: 'alloys', value: 0.25 }],
  },
  {
    id: 'gridAutomation', branch: 'infrastructure', tier: 6, icon: '[[plug]]', act: 4,
    name: { he: 'רשת אוטומטית', en: 'Grid Automation' },
    desc: { he: 'חשמל +20% · חומרים +10%', en: 'Power +20% · materials +10%' },
    cost: { knowledge: 4500, alloys: 60 }, time: 57600, requires: ['advancedEngineering'],
    effects: [{ type: 'resourceMult', resource: 'power', value: 0.2 }, { type: 'resourceMult', resource: 'materials', value: 0.1 }],
  },
  {
    id: 'bunkerDoctrine', branch: 'defense', tier: 6, icon: '[[lock]]', act: 4, eureka: { kind: 'crises', n: 10 },
    name: { he: 'תורת הבונקר', en: 'Bunker Doctrine' },
    desc: { he: 'תבוסה בפשיטה לעולם לא הורסת חדר', en: 'A lost raid never wrecks a room' },
    cost: { knowledge: 4500, alloys: 100 }, time: 57600, requires: ['fortifiedDoor'],
    effects: [{ type: 'feature', feature: 'bunkerDoctrine' }],
  },
  {
    id: 'heritage', branch: 'society', tier: 6, icon: '[[crown]]', act: 4, eureka: { kind: 'lore', n: 15 },
    name: { he: 'מורשת', en: 'Heritage' },
    desc: { he: 'מורשת (תשלום בראשית) +10%', en: 'Legacy (the Genesis payout) +10%' },
    cost: { knowledge: 5000, alloys: 80 }, time: 57600, requires: ['education'],
    effects: [{ type: 'feature', feature: 'heritage' }],
  },
  {
    id: 'seedVault', branch: 'genesis', tier: 6, icon: '[[clover]]', act: 4,
    name: { he: 'כספת זרעים', en: 'Seed Vault' },
    desc: { he: 'אוכל +15% · ידע +10% · זרעי העולם הבא נשמרים', en: 'Food +15% · knowledge +10% · the next world\'s seeds are kept' },
    cost: { knowledge: 5000, alloys: 120, components: 300 }, time: 57600, requires: ['temporalTheory'],
    effects: [{ type: 'resourceMult', resource: 'food', value: 0.15 }, { type: 'resourceMult', resource: 'knowledge', value: 0.1 }],
  },
  // ---- [P2-1 / P2-8] The late tree: see researchLate.ts ----
  ...LATE_RESEARCH,
];

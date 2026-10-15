import type { ResearchDef } from './research';
import { LATE_RESEARCH } from './researchLate';
import { ROOM_RESEARCH } from './researchRooms'; // [plan4:BL-9..14,19,33]
import { INFRA_RESEARCH } from './researchInfra'; // plan4:BL-27/28/29

/**
 * [Long game P3] The deeper research tree: four doctrine forks (one choice each, the others close for this run) and
 * nodes that open with the Acts. Times follow the plan's tiers (T3 0.8 h, T4 2.4 h, T5 6.5 h, T6 16 h of lab time at
 * base speed). A Eureka (a discount for a node that matches how the bunker is played) is listed with the node.
 * [phase4] Doctrine nodes are chosen on the Crossroads screen (src/ui/components/Crossroads.ts), not researched: each desc says the rule
 * it changes. Nodes marked `auto` are filler that completes by itself (ResearchSystem.autoComplete) and never shows in the tree.
 */
export const LONG_RESEARCH: ResearchDef[] = [
  // ---- Power doctrine (Act II): fission, geothermal or solar ----
  {
    id: 'fission', branch: 'infrastructure', tier: 4, icon: '[[reactor]]', act: 2, fork: 'power', eureka: { kind: 'floors', n: 7 },
    name: { he: 'דוקטרינה: ביקוע', en: 'Doctrine: Fission' },
    // [phase4] Rule: spare power runs the workshops (ResearchSystem 'doctrine' modifier).
    desc: { he: 'כורים +60%, גנרטורים +20%. כלל: כשהרשת מוזנת במלואה, החשמל העודף מפעיל את בתי המלאכה: חומרים +15%. כורים עדיין יכולים להיתך.', en: 'Reactors +60%, generators +20%. Rule: while the grid is fully fed, spare power runs the workshops: materials +15%. Reactors can still melt down.' },
    cost: { knowledge: 1800, scrap: 300 }, time: 8640, requires: ['reactorTheory'],
    effects: [{ type: 'buildingMult', building: 'reactor', value: 0.6 }, { type: 'buildingMult', building: 'generator', value: 0.2 }],
  },
  {
    id: 'geothermal', branch: 'infrastructure', tier: 4, icon: '[[fire]]', act: 2, fork: 'power', eureka: { kind: 'floors', n: 8 },
    name: { he: 'דוקטרינה: גיאותרמי', en: 'Doctrine: Geothermal' },
    // [phase4] Rule: the deep floors work harder (ResearchSystem 'doctrine' modifier).
    desc: { he: 'חשמל +20%, החורף לא מגדיל את צריכת החשמל. כלל: החום מלמטה עובד בשבילכם: חדרים בשלוש הקומות העמוקות מייצרים +20%.', en: 'Power +20%, winter no longer raises power use. Rule: the heat from below works for you: rooms on your three deepest floors make +20%.' },
    cost: { knowledge: 1800, materials: 30000 }, time: 8640, requires: ['advancedEngineering'],
    effects: [{ type: 'resourceMult', resource: 'power', value: 0.2 }, { type: 'feature', feature: 'geothermal' }],
  },
  {
    id: 'solarArray', branch: 'infrastructure', tier: 4, icon: '[[sun]]', act: 2, fork: 'power', eureka: { kind: 'explored', n: 60 },
    name: { he: 'דוקטרינה: מערך סולארי', en: 'Doctrine: Solar Array' },
    // [phase4] Rule: the top floors work harder (ResearchSystem 'doctrine' modifier).
    desc: { he: 'גנרטורים +40%. כלל: האור יורד בפיר: חדרים בשתי הקומות העליונות מייצרים +20%.', en: 'Generators +40%. Rule: the light comes down the shaft: rooms on your top two floors make +20%.' },
    cost: { knowledge: 1800, scrap: 200, materials: 15000 }, time: 8640, requires: ['batteryBanks'],
    effects: [{ type: 'buildingMult', building: 'generator', value: 0.4 }],
  },
  // ---- Food doctrine (Act II): hydroponics, mycelium or surface farms ----
  {
    id: 'hydroDoctrine', branch: 'survival', tier: 4, icon: '[[hydroponics]]', act: 2, fork: 'food', eureka: { kind: 'pop', n: 30 }, // [phase4] was specialized 2: specialties now open in Act III
    name: { he: 'דוקטרינה: הידרופוניקה', en: 'Doctrine: Hydroponics' },
    desc: { he: 'חוות הידרופוניות +60%. כלל: ירק טרי כל יום: +4 מורל לכולם.', en: 'Hydroponic farms +60%. Rule: fresh greens every day: +4 morale for everyone.' }, // [phase4]
    cost: { knowledge: 1600, materials: 20000 }, time: 8640, requires: ['hydroponicsResearch'],
    effects: [{ type: 'buildingMult', building: 'hydroponics', value: 0.6 }, { type: 'morale', value: 4 }], // [phase4] +4 morale
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
    desc: { he: 'כל ניצול שווה פי 2 בהגנה', en: 'Every resident counts double in defense' },
    cost: { knowledge: 3500, scrap: 600 }, time: 23400, requires: ['leadership', 'armoryResearch'],
    effects: [{ type: 'feature', feature: 'militia' }],
  },
  // ---- Defense doctrine (Act III): fortress, rangers or diplomacy ----
  {
    id: 'fortress', branch: 'defense', tier: 5, icon: '[[vault]]', act: 3, fork: 'defense', eureka: { kind: 'floors', n: 10 },
    name: { he: 'דוקטרינה: מבצר', en: 'Doctrine: Fortress' },
    // [phase4] Rule: rarer, stronger raids (doctrineRaidPace / doctrineRaidStrength in ResearchSystem; read by the raid code).
    desc: { he: 'חומות ×1.5. כלל: פשיטות מגיעות ב־30% פחות פעמים, אבל חזקות ב־30%.', en: 'Walls ×1.5. Rule: raids come 30% less often, but 30% stronger.' },
    cost: { knowledge: 3000, components: 200 }, time: 23400, requires: ['fortifiedDoor'],
    effects: [{ type: 'feature', feature: 'fortress' }],
  },
  {
    id: 'rangers', branch: 'defense', tier: 5, icon: '[[endurance]]', act: 3, fork: 'defense', eureka: { kind: 'crises', n: 5 },
    name: { he: 'דוקטרינה: סיירים', en: 'Doctrine: Rangers' },
    // [phase4] Rule: earlier warnings (doctrineWarningBonus in ResearchSystem; read by the raid code).
    desc: { he: 'שומרים ×1.4. כלל: הסיירים שומרים על הדרכים: אזהרה מפשיטה מגיעה 5 דקות מוקדם יותר.', en: 'Guards ×1.4. Rule: rangers watch the roads: raid warnings come 5 minutes earlier.' },
    cost: { knowledge: 3000, components: 200 }, time: 23400, requires: ['armoryResearch'],
    effects: [{ type: 'feature', feature: 'rangers' }],
  },
  {
    id: 'diplomacy', branch: 'defense', tier: 5, icon: '[[chat]]', act: 3, fork: 'defense', eureka: { kind: 'pop', n: 45 },
    name: { he: 'דוקטרינה: דיפלומטיה', en: 'Doctrine: Diplomacy' },
    // [phase4] Rule: a truce while away (doctrineAwayTruce in ResearchSystem; read by AwayDanger).
    desc: { he: 'כלל: כשאתם לא במשחק, המס לפושטים משולם מעצמו ואף אחד לא מת בפשיטה. המס בחצי, ופשיטות נדירות ב־20%.', en: 'Rule: while you are away the toll is paid for you and nobody dies in a raid. The toll is halved and raids are 20% rarer.' },
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
    id: 'coldChain', auto: true, branch: 'survival', tier: 3, icon: '[[water]]', act: 2,
    name: { he: 'שרשרת קירור', en: 'Cold Chain' },
    desc: { he: '+1,000 קיבולת אוכל ומים', en: '+1,000 food and water storage' },
    cost: { knowledge: 800, materials: 12000 }, time: 2880, requires: ['preservation'],
    effects: [{ type: 'cap', resource: 'food', value: 1000 }, { type: 'cap', resource: 'water', value: 1000 }],
  },
  {
    id: 'winterStores', auto: true, branch: 'survival', tier: 3, icon: '[[snow]]', act: 2,
    name: { he: 'מחסני חורף', en: 'Winter Stores' },
    desc: { he: 'החורף מוריד רק חצי מהאוכל', en: 'Winter takes only half as much food' },
    cost: { knowledge: 1000, food: 1500 }, time: 2880, requires: ['preservation'],
    effects: [{ type: 'feature', feature: 'winterStores' }],
  },
  {
    id: 'tripwires', auto: true, branch: 'defense', tier: 3, icon: '[[warning]]', act: 2, eureka: { kind: 'crises', n: 2 },
    name: { he: 'חוטי מלכודת', en: 'Tripwires' },
    desc: { he: '+15 לחומות', en: '+15 to walls' },
    cost: { knowledge: 700, scrap: 200 }, time: 2880, requires: ['armoryResearch'],
    effects: [{ type: 'feature', feature: 'tripwires' }],
  },
  {
    id: 'watchtower', auto: true, branch: 'defense', tier: 3, icon: '[[eye]]', act: 2,
    name: { he: 'מגדל תצפית', en: 'Watchtower' },
    desc: { he: 'אזהרה מפשיטה 3 דקות מוקדם יותר', en: 'Raid warnings come 3 minutes earlier' },
    cost: { knowledge: 900, materials: 15000 }, time: 2880, requires: ['fortifiedDoor'],
    effects: [{ type: 'feature', feature: 'watchtower' }],
  },
  {
    id: 'longRangeRadio', auto: true, branch: 'exploration', tier: 3, icon: '[[dish]]', act: 2, eureka: { kind: 'explored', n: 40 },
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
    id: 'assemblyTheory', auto: true, branch: 'infrastructure', tier: 5, icon: '[[components]]', act: 3, eureka: { kind: 'specialized', n: 4 },
    name: { he: 'תורת ההרכבה', en: 'Assembly Theory' },
    desc: { he: 'רכיבים +25%', en: 'Components +25%' },
    cost: { knowledge: 3200, components: 120 }, time: 23400, requires: ['advancedEngineering'],
    effects: [{ type: 'resourceMult', resource: 'components', value: 0.25 }],
  },
  {
    id: 'medicalCenter', auto: true, branch: 'survival', tier: 5, icon: '[[medbay]]', act: 3,
    name: { he: 'מרכז רפואי', en: 'Medical Center' },
    desc: { he: 'תרופות +40%', en: 'Medicine +40%' },
    cost: { knowledge: 3000, components: 100 }, time: 23400, requires: ['firstAid', 'education'],
    effects: [{ type: 'resourceMult', resource: 'medicine', value: 0.4 }],
  },
  {
    id: 'schools', auto: true, branch: 'society', tier: 5, icon: '[[books]]', act: 3, eureka: { kind: 'pop', n: 40 },
    name: { he: 'בתי ספר', en: 'Schools' },
    desc: { he: 'ידע +25%', en: 'Knowledge +25%' },
    cost: { knowledge: 3500, components: 100 }, time: 23400, requires: ['education'],
    effects: [{ type: 'resourceMult', resource: 'knowledge', value: 0.25 }],
  },
  {
    id: 'cartography', auto: true, branch: 'exploration', tier: 5, icon: '[[map]]', act: 3, eureka: { kind: 'explored', n: 120 },
    name: { he: 'קרטוגרפיה', en: 'Cartography' },
    desc: { he: '+1,500 קיבולת גרוטאות · משלחות יודעות לאן ללכת', en: '+1,500 scrap storage · teams know where to go' },
    cost: { knowledge: 3000, components: 120 }, time: 23400, requires: ['scavengingTactics'],
    effects: [{ type: 'cap', resource: 'scrap', value: 1500 }],
  },
  {
    id: 'armorPlating', auto: true, branch: 'defense', tier: 5, icon: '[[armory]]', act: 3,
    name: { he: 'שריון', en: 'Armor Plating' },
    desc: { he: 'שומרים +20%', en: 'Guards +20%' },
    cost: { knowledge: 3000, components: 250 }, time: 23400, requires: ['armoryResearch'],
    effects: [{ type: 'feature', feature: 'armorPlating' }],
  },
  // ---- Act IV nodes ----
  {
    id: 'metallurgy', auto: true, branch: 'infrastructure', tier: 6, icon: '[[alloys]]', act: 4, eureka: { kind: 'charters', n: 7 },
    name: { he: 'מטלורגיה', en: 'Metallurgy' },
    desc: { he: 'סגסוגות +25%', en: 'Alloys +25%' },
    cost: { knowledge: 4500, alloys: 80, components: 200 }, time: 57600, requires: ['assemblyTheory'],
    effects: [{ type: 'resourceMult', resource: 'alloys', value: 0.25 }],
  },
  {
    id: 'gridAutomation', auto: true, branch: 'infrastructure', tier: 6, icon: '[[plug]]', act: 4,
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
    id: 'heritage', auto: true, branch: 'society', tier: 6, icon: '[[crown]]', act: 4, eureka: { kind: 'lore', n: 15 },
    name: { he: 'מסורת', en: 'Heritage' },
    desc: { he: 'איזוטופ-7 מבראשית +10%', en: 'Legacy (the Genesis payout) +10%' },
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
  // ---- [plan4] The unlocking nodes of the new rooms ----
  ...ROOM_RESEARCH,
  ...INFRA_RESEARCH, // plan4:BL-27/28/29
];

export interface PrestigeUpgradeDef {
  id: string;
  icon: string;
  maxLevel: number;
  baseCost: number;
  growth: number;
  name: Record<string, string>;
  desc: Record<string, string>;
  /** [P5] Keystone group: one keystone per group, for good (the others in it close). */
  keystone?: string;
}

/** [P5] Whether a keystone is owned (prestige upgrades hold it as level 1). */
export function hasKeystone(state: { prestige: { upgrades: Record<string, number> } }, id: string): boolean {
  return (state.prestige.upgrades[id] ?? 0) > 0;
}

/** [phase5] The keystone group that is the bunker's "class": chosen first, on the full-screen pick at the start of the next run. */
export const CLASS_GROUP = 'founding';

/** [phase5] The classes (the founding keystones), in the order the pick shows them. */
export function classDefs(): PrestigeUpgradeDef[] {
  return PRESTIGE_UPGRADES.filter(u => u.keystone === CLASS_GROUP);
}

/** [phase5] The class this bunker has, if any. */
export function classOf(state: { prestige: { upgrades: Record<string, number> } }): PrestigeUpgradeDef | undefined {
  return classDefs().find(u => (state.prestige.upgrades[u.id] ?? 0) > 0);
}

/**
 * [phase5] What a class changes, in plain words, one line each (the full-screen pick and the Genesis tab). The numbers are the ones the
 * game uses: the founding keystones' effects (GameEngine start, ContractSystem, ResearchSystem) plus the 'genesis' output modifier
 * (MetaSystem, CLASS_OUTPUT below).
 */
export const CLASS_LINES: Record<string, Record<'he' | 'en', string>[]> = {
  ksFounders: [
    { he: 'כל סיבוב מתחיל עם עוד שני ניצולים', en: 'Every run starts with two more survivors' },
    { he: 'אוכל ומים +10% כל הסיבוב', en: 'Food and water +10% all run' },
    { he: 'מתאים למי שבונה מהר ומאכלס חדרים', en: 'For a player who builds fast and fills rooms' },
  ],
  ksCartographer: [
    { he: 'חוזים משלמים +25%', en: 'Contracts pay +25%' },
    { he: 'גרוטאות +25% כל הסיבוב', en: 'Scrap +25% all run' },
    { he: 'מתאים למי שחי מהעולם שבחוץ', en: 'For a player who lives off the world outside' },
  ],
  ksScholar: [
    { he: 'מחקר מהיר ב־30%', en: 'Research 30% faster' },
    { he: 'ידע +15% כל הסיבוב', en: 'Knowledge +15% all run' },
    { he: 'מתאים למי שפותח דוקטרינות ומחקרים מוקדם', en: 'For a player who opens doctrines and research early' },
  ],
};

/** [phase5] The class's own output bonus per resource (read by MetaSystem's 'genesis' modifier). */
export const CLASS_OUTPUT: Record<string, Partial<Record<string, number>>> = {
  ksFounders: { food: 0.1, water: 0.1 },
  ksCartographer: { scrap: 0.25 },
  ksScholar: { knowledge: 0.15 },
};

/** [phase5] Act Ledger: the Act's resource +10% per level, every room, on top of the output ceiling once the lead marks it (see MetaSystem). */
export const ACT_LEDGER_STEP = 0.1;

/**
 * The Genesis shop. [phase5] A first Genesis at the end of Act VII pays about 2,000 Isotope-7 (+10% per earlier rebirth); the class
 * (a founding keystone, 400) comes first, and the deep upgrades on the Act's resource and on work time (Act Ledger, Systems Memory)
 * keep the shop worth filling over several runs (about 9,000 in all).
 */
export const PRESTIGE_UPGRADES: PrestigeUpgradeDef[] = [
  {
    id: 'echoPower', icon: '[[sparkle]]', maxLevel: 10, baseCost: 5, growth: 1.6,
    // [phase5] glossary: the echo is the "Genesis bonus" (בונוס בראשית), the Act currency is "משאב המערכה".
    name: { he: 'בונוס בראשית', en: 'Echo of the Past' },
    // [ux-wp2 M7] Now also the Act currencies (their roles go through the modifier stack).
    desc: { he: '+10% לכל הייצור לכל רמה, כולל משאב המערכה', en: '+10% all production per level, the Act\'s resource included' },
  },
  {
    // [phase5] The upgrade that acts on the bottleneck: the current Act's resource (materials in Acts I–III), every room.
    id: 'actLedger', icon: '[[note]]', maxLevel: 10, baseCost: 30, growth: 1.5,
    name: { he: 'פנקס המערכות', en: 'Act Ledger' },
    desc: { he: 'משאב המערכה +10% לכל רמה, בכל מערכה (חומרים במערכות I–III)', en: 'The Act\'s resource +10% per level, in every Act (materials in Acts I–III)' },
  },
  {
    // +150 worth per level (120 materials + 30 scrap); amounts above the starting storage are lost,
    // which pairs it with Storage Memory.
    id: 'quickStart', icon: '[[rocket]]', maxLevel: 3, baseCost: 15, growth: 2,
    name: { he: 'התחלה מהירה', en: 'Quick Start' },
    desc: { he: 'מתחילים עם עוד 120 חומרים ו־30 גרוטאות לכל רמה (עד גבול המחסן)', en: 'Start with +120 materials and +30 scrap per level (up to your storage)' },
  },
  {
    id: 'fastResearch', icon: '[[research]]', maxLevel: 10, baseCost: 6, growth: 1.6,
    name: { he: 'זיכרון מדעי', en: 'Scientific Memory' },
    // [ux-wp2 M7] +5% Act currency per level too (the 'memory' modifier in ResourceSystem).
    desc: { he: '+10% מהירות מחקר ו־+5% למשאב המערכה (רכיבים ואילך) לכל רמה', en: '+10% research speed and +5% to the Act\'s resource (components onward) per level' },
  },
  {
    id: 'veteranSurvivors', icon: '[[people]]', maxLevel: 3, baseCost: 10, growth: 2.2,
    name: { he: 'ותיקים', en: 'Veterans' },
    desc: { he: 'עוד ניצול/ה בתחילת כל משחק', en: 'One more survivor at the start' },
  },
  {
    id: 'hardyStock', icon: '[[strength]]', maxLevel: 3, baseCost: 8, growth: 2,
    name: { he: 'גנים חזקים', en: 'Hardy Stock' },
    desc: { he: '+1 לכל התכונות של כל ניצול חדש', en: '+1 to every stat of new survivors' },
  },
  {
    id: 'offlineEfficiency', icon: '[[moon]]', maxLevel: 4, baseCost: 6, growth: 1.7,
    name: { he: 'משמרת לילה', en: 'Night Shift' },
    desc: { he: '+5% ייצור בזמן שאתה לא משחק', en: '+5% production while away' },
  },
  {
    // [ux-wp2 M7] Was Scavenger's Luck (+10% expedition loot, worth nothing past Act II); the id stays so bought levels carry over.
    // Read by economy.ts: digs and charter work run faster (DigSystem/ProjectSystem speed), upgrades take less time (BuildingSystem).
    // [phase5] 15 levels (was 10): 0.95^15 ≈ half the time on every dig, room upgrade and project stage.
    id: 'lootLuck', icon: '[[clock]]', maxLevel: 15, baseCost: 5, growth: 1.5,
    name: { he: 'זיכרון מערכות', en: 'Systems Memory' },
    desc: { he: 'חפירות, שדרוגי חדרים ועבודה על פרויקט המערכה מהירים ב־5% לכל רמה', en: 'Digs, room upgrades and Act project work 5% faster per level' },
  },
  // Read by ResourceSystem.computeCaps (marked hook line).
  {
    id: 'storageMemory', icon: '[[storage]]', maxLevel: 4, baseCost: 30, growth: 1.8,
    name: { he: 'זיכרון מחסנים', en: 'Storage Memory' },
    desc: { he: '+25% מקום במחסן לכל המשאבים לכל רמה', en: '+25% storage for every resource per level' },
  },
  // Applied by MetaSystem.applyStartBonuses when a new run is set up.
  {
    id: 'preDug', icon: '[[pick]]', maxLevel: 2, baseCost: 80, growth: 2.5,
    name: { he: 'קומה חפורה מראש', en: 'Pre-dug Level' },
    desc: { he: 'כל משחק חדש מתחיל עם עוד קומה חפורה לכל רמה', en: 'Every new run starts with one more dug level per level' },
  },
  // Read by ResearchSystem.queueSlots.
  {
    id: 'labBench', icon: '[[laboratory]]', maxLevel: 2, baseCost: 50, growth: 2.4,
    name: { he: 'שולחן מעבדה שני', en: 'Second Lab Bench' },
    desc: { he: '+1 מקום בתור המחקר לכל רמה', en: '+1 research queue slot per level' },
  },
  // Read by ExplorationSystem (expedition team limit).
  {
    id: 'scoutTeams', icon: '[[walker]]', maxLevel: 3, baseCost: 40, growth: 2,
    name: { he: 'צוותי סיור', en: 'Scout Teams' },
    desc: { he: 'עוד צוות משלחת שיכול לצאת במקביל לכל רמה', en: 'One more expedition team out at the same time per level' },
  },
  // [P5] Keystones: one choice in each group shapes every later run.
  // [phase5] The founding group is the bunker's class: the first Genesis purchase (MetaSystem.buy refuses the rest of the shop until
  // one is owned), picked on a full-screen choice (GenesisClassPick) at the start of the next run.
  {
    id: 'ksFounders', icon: '[[people]]', maxLevel: 1, baseCost: 400, growth: 1, keystone: 'founding',
    name: { he: 'אבן יסוד: המייסדים', en: 'Keystone: The Founders' },
    desc: { he: 'כל סיבוב מתחיל עם עוד שני ניצולים; אוכל ומים +10%', en: 'Every run starts with two more survivors; food and water +10%' },
  },
  {
    id: 'ksCartographer', icon: '[[map]]', maxLevel: 1, baseCost: 400, growth: 1, keystone: 'founding',
    name: { he: 'אבן יסוד: הקרטוגרף', en: 'Keystone: The Cartographer' },
    desc: { he: 'חוזים משלמים +25%; גרוטאות +25%', en: 'Contracts pay +25%; scrap +25%' },
  },
  {
    id: 'ksScholar', icon: '[[books]]', maxLevel: 1, baseCost: 400, growth: 1, keystone: 'founding',
    name: { he: 'אבן יסוד: המלומד', en: 'Keystone: The Scholar' },
    desc: { he: 'מחקר מהיר ב־30%; ידע +15%', en: 'Research 30% faster; knowledge +15%' },
  },
  {
    id: 'ksBastion', icon: '[[vault]]', maxLevel: 1, baseCost: 700, growth: 1, keystone: 'line',
    name: { he: 'אבן יסוד: המעוז', en: 'Keystone: The Bastion' },
    desc: { he: 'האיום מבחוץ −15', en: 'Threat from outside −15' },
  },
  {
    id: 'ksArtisan', icon: '[[workshop]]', maxLevel: 1, baseCost: 700, growth: 1, keystone: 'line',
    name: { he: 'אבן יסוד: האומן', en: 'Keystone: The Artisan' },
    desc: { he: 'שדרוגי חדרים זולים ב־15%', en: 'Room upgrades 15% cheaper' },
  },
  {
    id: 'ksSettler', icon: '[[quarters]]', maxLevel: 1, baseCost: 700, growth: 1, keystone: 'line',
    name: { he: 'אבן יסוד: המתיישב', en: 'Keystone: The Settler' },
    desc: { he: 'תקרת האוכלוסייה של כל מערכה +10%', en: 'Each Act\'s population cap +10%' },
  },
];

export function upgradeCost(def: PrestigeUpgradeDef, level: number): number {
  return Math.round(def.baseCost * Math.pow(def.growth, level));
}

import type { GameState, ResourceType } from '../core/GameState';
import { actPrice } from './pricing';
import { TUNING } from './tuning';

/**
 * [LateGame B1] Big projects: the long goals of the second half of the game.
 * Every project is a chain of stages. A stage needs a pile of resources delivered to it (by hand, or from
 * storage overflow through ProjectSystem.absorb) AND crew work: `crew` people kept on the site for `hours`.
 * Each finished stage pays a permanent reward (the project's effect, in equal steps); the last stage opens
 * the project's finale. About 28 stages in all: roughly 4-6 days of play for an engaged player.
 */
export type ProjectId = 'radioMast' | 'purifier' | 'greenhouse' | 'metroTunnel' | 'archive' | 'wall' | 'vaultSeal' | 'genesisCore'
  | 'deepFoundry' | 'surfaceGate' | 'skyDome' | 'tradeLeague' | 'constitution' | 'ark';

export interface ProjectStage {
  cost: Partial<Record<ResourceType, number>>;
  /** Crew work needed, in hours of a full crew. */
  hours: number;
  /** People who must be on the site for full speed (fewer people work proportionally slower). */
  crew: number;
}

/** What a finished project gives in total; stage k of n gives k/n of it (counts, like the queue slot, arrive at the end). */
export interface ProjectEffects {
  /** Newcomers come this many times faster (2 = twice as fast). */
  arrivalSpeed?: number;
  /** Extra output per resource (0.4 = +40%). */
  resourceMult?: Partial<Record<ResourceType, number>>;
  /** Expeditions are this many times faster. */
  expeditionSpeed?: number;
  /** Extra research queue slots. */
  researchQueue?: number;
  /** Refinement research costs this much less (0.25 = -25%). */
  refineDiscount?: number;
  /** Extra defense against raiders (read by the Danger system through projectDefense). */
  defense?: number;
}

export interface ProjectDef {
  id: ProjectId;
  icon: string;
  name: Record<'he' | 'en', string>;
  desc: Record<'he' | 'en', string>;
  /** What the finale unlocks, in words. */
  finale: Record<'he' | 'en', string>;
  /** Story flag set when the last stage is done (other systems can read it). */
  flag: string;
  /** First era in which the project can be started. */
  era: number;
  /** [Long game] First Act in which it can be started (the Act's charter, see src/data/acts.ts). */
  act?: number;
  stages: ProjectStage[];
  effects: ProjectEffects;
}

const rep = (n: number, f: (i: number) => ProjectStage): ProjectStage[] => Array.from({ length: n }, (_, i) => f(i));
/** [Long game] A charter stage: hours of its Act's income (pricing.ts), plus the project's own flavour of goods. */
const charter = (act: number, flavour: Partial<Record<ResourceType, number>>, growth = 0.08) => (i: number): Partial<Record<ResourceType, number>> => {
  const price = actPrice(act, TUNING.charterStageHours[act] * (1 + growth * i)) as Partial<Record<ResourceType, number>>;
  for (const [r, v] of Object.entries(flavour) as [ResourceType, number][]) price[r] = (price[r] ?? 0) + v;
  return price;
};
/** Crew grows with the project: 2, 2, 3, 3, 4. */
const crewAt = (i: number) => (i < 2 ? 2 : i < 4 ? 3 : 4);

export const PROJECTS: ProjectDef[] = [
  {
    // [Long game] Act I's charter: the bunker becomes a place people can hold.
    id: 'vaultSeal', icon: '[[vault]]', flag: 'project:vaultSeal', era: 1, act: 1,
    name: { he: 'איטום דלת הכספת', en: 'Seal the Vault Door' },
    desc: { he: 'הדלת הגדולה של בונקר 17 לא נסגרת עד הסוף מאז האפר. בלי אטימה, אף אחד לא יישאר כאן לאורך זמן.', en: 'The great door of Bunker 17 has not closed all the way since the ashes. Without a seal, nobody will stay here for long.' },
    finale: { he: 'הבונקר אטום: מערכה II נפתחת', en: 'The bunker is sealed: Act II opens' },
    stages: [
      { cost: charter(1, { scrap: 40 }, 0.5)(0), hours: 8, crew: 2 },
      { cost: charter(1, { scrap: 60 }, 0.5)(1), hours: 14, crew: 2 },
      { cost: charter(1, { scrap: 90, knowledge: 300 }, 0.5)(2), hours: 20, crew: 3 },
    ],
    effects: { defense: 10 },
  },
  {
    id: 'radioMast', icon: '[[radioTower]]', flag: 'project:radioMast', era: 2, act: 2,
    name: { he: 'מגדל הרדיו בשטח', en: 'Field Radio Mast' },
    desc: { he: 'מגדל שידור ענק על פני השטח. הקול שלכם יגיע רחוק, ומי ששומע אותו יבוא.', en: 'A giant broadcast mast on the surface. Your voice will carry far, and those who hear it will come.' },
    finale: { he: 'ניצולים מגיעים פי 2 מהר יותר, ואות "שידור לעולם" יוצא לאוויר', en: 'Newcomers arrive twice as fast, and a "broadcast to the world" goes on air' },
    stages: rep(5, i => ({ cost: charter(2, { scrap: 200 })(i), hours: 6, crew: crewAt(i) })),
    effects: { arrivalSpeed: 2 },
  },
  {
    id: 'purifier', icon: '[[waterPurifier]]', flag: 'project:purifier', era: 2, act: 2,
    name: { he: 'מתקן טיהור מים', en: 'Water Purification Plant' },
    desc: { he: 'מתקן ענק שמנקה את מי התהום. יותר מים, ובלי חשש מהרעלה.', en: 'A huge plant that cleans the groundwater. More water, and no fear of poisoning.' },
    finale: { he: 'המים בבונקר +40%, ואין יותר הרעלת מים', en: 'Bunker water +40%, and no more water poisoning' },
    stages: rep(4, i => ({ cost: charter(2, { water: 5000 })(i), hours: 4.5, crew: crewAt(i) })),
    effects: { resourceMult: { water: 0.4 } },
  },
  {
    id: 'greenhouse', icon: '[[wheat]]', flag: 'project:greenhouse', era: 2, act: 3,
    name: { he: 'חממה על פני השטח', en: 'Surface Greenhouse' },
    desc: { he: 'חממה גדולה מעל הבונקר, תחת שמיים חדשים. לא עוד רק אוכל מתחת לאדמה.', en: 'A big greenhouse above the bunker, under new skies. Food that no longer grows only underground.' },
    finale: { he: 'האוכל +30%, ואזור ירוק נפתח על המפה', en: 'Food +30%, and a green zone opens on the map' },
    stages: rep(5, i => ({ cost: charter(3, { food: 4000, knowledge: 1500 })(i), hours: 6, crew: crewAt(i) })),
    effects: { resourceMult: { food: 0.3 } },
  },
  {
    id: 'metroTunnel', icon: '[[car]]', flag: 'project:metroTunnel', era: 2, act: 3,
    name: { he: 'מנהרה למטרו', en: 'Metro Tunnel' },
    desc: { he: 'מנהרה ארוכה אל קו הרכבת הישן. מסלול קבוע אל העיר, בלי לצאת לאבק.', en: 'A long tunnel to the old rail line. A fixed road to the city, without walking through the dust.' },
    finale: { he: 'משלחות מהירות פי 2, ונתיב סחר קבוע', en: 'Expeditions twice as fast, and a standing trade route' },
    stages: rep(5, i => ({ cost: charter(3, { scrap: 300 })(i), hours: 9, crew: crewAt(i) })),
    effects: { expeditionSpeed: 2 },
  },
  {
    id: 'archive', icon: '[[books]]', flag: 'project:archive', era: 2, act: 3,
    name: { he: 'ארכיון הידע', en: 'Knowledge Archive' },
    desc: { he: 'כל מה שהעולם הישן ידע, מסודר ושמור. המעבדה לא תתחיל יותר מאפס.', en: 'Everything the old world knew, sorted and kept. The lab will never start from zero again.' },
    finale: { he: 'תור מחקר נוסף, ומחקרי שכלול זולים ב־25%', en: 'One more research queue slot, and refinement research is 25% cheaper' },
    stages: rep(4, i => ({ cost: charter(3, { knowledge: 8000, blueprints: 3 })(i), hours: 7.5, crew: crewAt(i) })),
    effects: { researchQueue: 1, refineDiscount: 0.25 },
  },
  {
    id: 'wall', icon: '[[armory]]', flag: 'project:wall', era: 2, act: 4,
    name: { he: 'החומה', en: 'The Wall' },
    desc: { he: 'חומה סביב הכניסה. מי שבא לקחת, יחשוב פעמיים.', en: 'A wall around the entrance. Whoever comes to take will think twice.' },
    finale: { he: 'הגנה +50 מפני פושטים', en: '+50 defense against raiders' },
    stages: rep(5, i => ({ cost: charter(4, { scrap: 400 })(i), hours: 6, crew: crewAt(i) })),
    effects: { defense: 50 },
  },
  {
    // [Long game] Act IV's charter and the road to Genesis: a seed of the new world, built from the bunker's best goods.
    id: 'genesisCore', icon: '[[isotope7]]', flag: 'project:genesisCore', era: 3, act: 7,
    name: { he: 'ליבת בראשית', en: 'Genesis Core' },
    desc: { he: 'מכונה שתשמור את כל מה שלמדתם, כדי שהעולם הבא יתחיל ממקום טוב יותר. דורשת את הסגסוגות והרכיבים הטובים ביותר שהבונקר יודע לייצר.', en: 'A machine that keeps everything you have learned, so the next world starts from a better place. It takes the finest alloys and components the bunker can make.' },
    finale: { he: 'פרויקט בראשית נפתח', en: 'Project Genesis opens' },
    stages: rep(6, i => ({ cost: charter(7, {}, 0.15)(i), hours: 10, crew: 4 + Math.floor(i / 2) })),
    effects: { resourceMult: { knowledge: 0.3 } },
  },
  {
    // [P5] Act IV: the furnaces under the deepest floor.
    id: 'deepFoundry', icon: '[[alloys]]', flag: 'project:deepFoundry', era: 3, act: 4,
    name: { he: 'היציקה העמוקה', en: 'The Deep Foundry' },
    desc: { he: 'כבשנים ענקיים בעומק הסלע, שם החום של כדור הארץ עושה חצי מהעבודה.', en: 'Huge furnaces deep in the rock, where the earth\'s own heat does half the work.' },
    finale: { he: 'סגסוגות +25%, ומערכה V נפתחת', en: 'Alloys +25%, and Act V opens' },
    stages: rep(5, i => ({ cost: charter(4, { scrap: 500 })(i), hours: 8, crew: 4 })),
    effects: { resourceMult: { alloys: 0.25 } },
  },
  {
    // [P5] Act V: back to the surface, for good.
    id: 'surfaceGate', icon: '[[door]]', flag: 'project:surfaceGate', era: 3, act: 5,
    name: { he: 'שער פני השטח', en: 'The Surface Gate' },
    desc: { he: 'מעלית ענק ושער כפול: הדרך החוצה כבר לא תהיה מסע, אלא יציאה של בוקר.', en: 'A giant lift and a double gate: going outside will no longer be an expedition, just a morning walk.' },
    finale: { he: 'משלחות מהירות פי 1.5', en: 'Expeditions 1.5 times faster' },
    stages: rep(5, i => ({ cost: charter(5, { materials: 200000 })(i), hours: 10, crew: 5 })),
    effects: { expeditionSpeed: 1.5 },
  },
  {
    id: 'skyDome', icon: '[[sun]]', flag: 'project:skyDome', era: 3, act: 5,
    name: { he: 'כיפת השמיים', en: 'The Sky Dome' },
    desc: { he: 'כיפה שקופה מעל הכניסה: ילדים שנולדו בבונקר יראו שמיים בפעם הראשונה.', en: 'A clear dome over the entrance: children born in the bunker will see the sky for the first time.' },
    finale: { he: 'אוכל +20% והמורל עולה', en: 'Food +20% and morale rises' },
    stages: rep(5, i => ({ cost: charter(5, { food: 20000 })(i), hours: 10, crew: 5 })),
    effects: { resourceMult: { food: 0.2 } },
  },
  {
    // [P5] Act VI: the bunker becomes a republic among neighbours.
    id: 'tradeLeague', icon: '[[cart]]', flag: 'project:tradeLeague', era: 3, act: 6,
    name: { he: 'ברית הסחר', en: 'The Trade League' },
    desc: { he: 'דרכים קבועות, מחסנים משותפים ושוק אחד לכל היישובים.', en: 'Fixed roads, shared stores and one market for every settlement.' },
    finale: { he: 'ניצולים מגיעים פי 1.5 מהר יותר', en: 'Newcomers arrive 1.5 times faster' },
    stages: rep(5, i => ({ cost: charter(6, { materials: 300000 })(i), hours: 10, crew: 5 })),
    effects: { arrivalSpeed: 1.5 },
  },
  {
    id: 'constitution', icon: '[[books]]', flag: 'project:constitution', era: 3, act: 6,
    name: { he: 'החוקה', en: 'The Constitution' },
    desc: { he: 'מי מחליט, איך, ומה אסור לעולם. נכתבת יחד עם כל מי שגר כאן.', en: 'Who decides, how, and what is never allowed. Written together with everyone who lives here.' },
    finale: { he: 'ידע +20% ותור מחקר נוסף', en: 'Knowledge +20% and one more research slot' },
    stages: rep(4, i => ({ cost: charter(6, { knowledge: 20000 })(i), hours: 12, crew: 4 })),
    effects: { resourceMult: { knowledge: 0.2 }, researchQueue: 1 },
  },
  {
    // [P5] Act VII: what will cross into the next world.
    id: 'ark', icon: '[[vault]]', flag: 'project:ark', era: 3, act: 7,
    name: { he: 'התיבה', en: 'The Ark' },
    desc: { he: 'כספת שתעבור לעולם הבא: זרעים, ספרים, שמות, ושיר שהילדים שרים.', en: 'A vault that will cross into the next world: seeds, books, names, and a song the children sing.' },
    finale: { he: 'התיבה מוכנה', en: 'The Ark is ready' },
    stages: rep(5, i => ({ cost: charter(7, { alloys: 3000, data: 1500 })(i), hours: 10, crew: 6 })),
    effects: { defense: 30 },
  },
];

export const PROJECT_IDS = PROJECTS.map(p => p.id);

export function getProject(id: string | null | undefined): ProjectDef | undefined {
  return id ? PROJECTS.find(p => p.id === id) : undefined;
}

/** Stages finished in one project (the whole project when equal to its stage count). */
export function stagesDone(state: GameState, id: string): number {
  const def = getProject(id);
  if (!def) return 0;
  return Math.min(def.stages.length, state.lateGame?.projects?.[id]?.stage ?? 0);
}

export function projectDone(state: GameState, id: string): boolean {
  const def = getProject(id);
  return !!def && stagesDone(state, id) >= def.stages.length;
}

/** Fraction of the project's total reward already earned. */
function earned(state: GameState, def: ProjectDef): number {
  return stagesDone(state, def.id) / def.stages.length;
}

/** Newcomer speed factor (1 = none). */
export function projectArrivalSpeed(state: GameState): number {
  let f = 1;
  for (const p of PROJECTS) if (p.effects.arrivalSpeed) f += (p.effects.arrivalSpeed - 1) * earned(state, p);
  return f;
}

/** Extra output of a resource from finished stages (0.3 = +30%). */
export function projectResourceBonus(state: GameState, r: ResourceType): number {
  let v = 0;
  const projects = state.lateGame?.projects;
  if (!projects) return 0;
  for (const p of PROJECTS) {
    const m = p.effects.resourceMult?.[r];
    if (m && projects[p.id]) v += m * earned(state, p);
  }
  return v;
}

/** Expedition speed factor (1 = none). */
export function projectExpeditionSpeed(state: GameState): number {
  let f = 1;
  for (const p of PROJECTS) if (p.effects.expeditionSpeed) f += (p.effects.expeditionSpeed - 1) * earned(state, p);
  return f;
}

/** Extra research queue slots (whole slots, granted when the project is finished). */
export function projectQueueSlots(state: GameState): number {
  let n = 0;
  for (const p of PROJECTS) if (p.effects.researchQueue && projectDone(state, p.id)) n += p.effects.researchQueue;
  return n;
}

/** Discount on refinement research (0.25 = -25%). */
export function projectRefineDiscount(state: GameState): number {
  let v = 0;
  for (const p of PROJECTS) if (p.effects.refineDiscount) v += p.effects.refineDiscount * earned(state, p);
  return v;
}

/** Extra raid defense from the wall. The Danger system adds this to its defense total. */
export function projectDefense(state: GameState): number {
  let v = 0;
  for (const p of PROJECTS) if (p.effects.defense) v += p.effects.defense * earned(state, p);
  return Math.round(v);
}

/** Finished projects (for the surface markers). */
export function doneProjects(state: GameState): string[] {
  return PROJECTS.filter(p => projectDone(state, p.id)).map(p => p.id);
}

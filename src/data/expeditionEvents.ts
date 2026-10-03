import type { ResourceType } from '../core/GameState';
import type { BiomeId } from './surface';
import type { IconName } from '../ui/icons';

/**
 * Decisions on the road (Sprint 6): halfway through a trip the team radios home with a choice.
 * The first option is always the cautious one, taken automatically if nobody answers for a while.
 */
export interface ExpeditionOption {
  key: string;
  label: Record<'he' | 'en', string>;
  result: Record<'he' | 'en', string>;
  lootMult?: number;
  /** Added to every member's chance of getting hurt (0.2 = +20%). */
  injury?: number;
  /** Multiplies the remaining trip time. */
  timeMult?: number;
  loot?: Partial<Record<ResourceType, number>>;
  recruit?: number;
  /** Reveals the hexes two steps around the target. */
  reveal?: boolean;
}

export interface ExpeditionEvent {
  id: string;
  icon: IconName;
  biomes?: BiomeId[];
  title: Record<'he' | 'en', string>;
  text: Record<'he' | 'en', string>;
  options: ExpeditionOption[];
}

export const EXPEDITION_EVENTS: ExpeditionEvent[] = [
  {
    id: 'lockedDoor', icon: 'door',
    title: { he: 'דלת נעולה', en: 'A Locked Door' },
    text: { he: 'מצאנו דלת פלדה של מקלט פרטי. מבפנים נשמע רק שקט. אפשר לפרוץ, אבל המשקוף נראה רעוע.', en: 'We found the steel door of a private shelter. Only silence inside. We could force it, but the frame looks shaky.' },
    options: [
      { key: 'leave', label: { he: 'להמשיך הלאה', en: 'Move on' }, result: { he: 'השארנו את הדלת לשבט הבא.', en: 'We left the door for the next clan.' } },
      { key: 'force', label: { he: 'לפרוץ', en: 'Force it' }, lootMult: 1.6, injury: 0.2, result: { he: 'הדלת נכנעה. מחסן מלא, ושריטות למזכרת.', en: 'The door gave in. A full pantry, and a few scratches to remember it by.' } },
    ],
  },
  {
    id: 'stranger', icon: 'person',
    title: { he: 'זר בדרך', en: 'A Stranger on the Road' },
    text: { he: 'מישהו מכורבל בשמיכה ליד מדורה כבויה. הוא רזה מאוד ומבקש אוכל.', en: 'Someone huddled in a blanket by a dead fire. Very thin, asking for food.' },
    options: [
      { key: 'pass', label: { he: 'לעבור בשקט', en: 'Pass quietly' }, result: { he: 'לא הסתכלנו אחורה.', en: 'We didn\'t look back.' } },
      { key: 'help', label: { he: 'לחלוק את הצידה', en: 'Share our rations' }, lootMult: 0.85, recruit: 0.6, result: { he: 'חלקנו את הלחם. הוא שאל אם יש מקום אצלנו.', en: 'We shared the bread. He asked if there is room with us.' } },
    ],
  },
  {
    id: 'storm', icon: 'rad', biomes: ['wasteland', 'shatteredCity', 'ruins', 'militaryZone'],
    title: { he: 'סערת אבק רדיואקטיבית', en: 'Radioactive Dust Storm' },
    text: { he: 'ענן אפור עולה מהאופק ומונה הגייגר משתולל. אפשר למצוא מחסה ולחכות, או לרוץ עד היעד.', en: 'A grey cloud rises on the horizon and the Geiger counter goes wild. We can shelter and wait, or run for the target.' },
    options: [
      { key: 'shelter', label: { he: 'לחכות במחסה', en: 'Wait it out' }, timeMult: 1.35, result: { he: 'חיכינו במרתף עד שהשמיים התבהרו.', en: 'We waited in a basement until the sky cleared.' } },
      { key: 'run', label: { he: 'לרוץ דרכה', en: 'Run through it' }, injury: 0.3, timeMult: 0.85, result: { he: 'הגענו מהר, משתעלים ומכוסים אבק.', en: 'We made it fast, coughing and covered in dust.' } },
    ],
  },
  {
    id: 'cache', icon: 'storage',
    title: { he: 'מטמון', en: 'A Cache' },
    text: { he: 'מתחת לרצפה של חנות שרופה: ארגזים. יותר ממה שנוכל לסחוב בלי להאט.', en: 'Under the floor of a burnt shop: crates. More than we can carry without slowing down.' },
    options: [
      { key: 'light', label: { he: 'לקחת רק את הטוב', en: 'Take only the best' }, loot: { materials: 15 }, result: { he: 'בחרנו בקפידה ושמרנו על הקצב.', en: 'We picked carefully and kept our pace.' } },
      { key: 'all', label: { he: 'לסחוב הכול', en: 'Haul everything' }, lootMult: 1.45, timeMult: 1.25, result: { he: 'הגב כואב, אבל העגלה מלאה.', en: 'Our backs ache, but the cart is full.' } },
    ],
  },
  {
    id: 'tracks', icon: 'map',
    title: { he: 'עקבות טריים', en: 'Fresh Tracks' },
    text: { he: 'עקבות של קבוצה גדולה, מובילים מהשביל אל הגבעות. אולי מחנה. אולי מארב.', en: 'Tracks of a large group, leading off the path into the hills. Maybe a camp. Maybe an ambush.' },
    options: [
      { key: 'avoid', label: { he: 'להתרחק', en: 'Steer clear' }, result: { he: 'הקפנו את האזור מרחוק.', en: 'We circled wide around the area.' } },
      { key: 'follow', label: { he: 'לעקוב', en: 'Follow them' }, reveal: true, injury: 0.15, result: { he: 'מהגבעה ראינו את כל העמק. סימנו הכול במפה.', en: 'From the hilltop we saw the whole valley. We marked everything on the map.' } },
    ],
  },
  {
    id: 'spores', icon: 'gasmask', biomes: ['toxicForest'],
    title: { he: 'ענן נבגים', en: 'Spore Cloud' },
    text: { he: 'הפטריות כאן שחררו ענן צהוב. בצד השני של השביל צומחים עשבי מרפא נדירים.', en: 'The fungi here released a yellow cloud. On the far side of the trail grow rare healing herbs.' },
    options: [
      { key: 'around', label: { he: 'לעקוף', en: 'Go around' }, timeMult: 1.2, result: { he: 'הדרך הארוכה, אבל נשמנו אוויר נקי.', en: 'The long way, but we breathed clean air.' } },
      { key: 'masks', label: { he: 'מסכות ולקטוף', en: 'Masks on, harvest' }, loot: { medicine: 8 }, injury: 0.2, result: { he: 'קטפנו שק שלם, והמסננים כמעט נגמרו.', en: 'We picked a full sack, and the filters nearly gave out.' } },
    ],
  },
  {
    id: 'collapse', icon: 'pick', biomes: ['caves'],
    title: { he: 'מנהרה קרסה', en: 'Tunnel Collapse' },
    text: { he: 'המנהרה שלפנינו חסומה. מאחורי הסלעים זורם נחל תת־קרקעי.', en: 'The tunnel ahead is blocked. Behind the rocks an underground stream is running.' },
    options: [
      { key: 'back', label: { he: 'לחזור ולמצוא דרך אחרת', en: 'Find another way' }, timeMult: 1.25, result: { he: 'מצאנו מעבר צר ועקום.', en: 'We found a narrow, crooked passage.' } },
      { key: 'dig', label: { he: 'לחפור דרך הסלעים', en: 'Dig through' }, loot: { water: 20 }, injury: 0.15, result: { he: 'פרצנו לנחל. מילאנו כל מימייה שהייתה לנו.', en: 'We broke through to the stream and filled every canteen we had.' } },
    ],
  },
  {
    id: 'drone', icon: 'satellite', biomes: ['militaryZone', 'shatteredCity'],
    title: { he: 'רחפן סיור', en: 'Patrol Drone' },
    text: { he: 'רחפן צבאי ישן עדיין מסייר. אם נפיל אותו, החלקים שלו שווים הון.', en: 'An old military drone is still patrolling. If we bring it down, its parts are worth a fortune.' },
    options: [
      { key: 'hide', label: { he: 'להסתתר עד שיעבור', en: 'Hide until it passes' }, timeMult: 1.1, result: { he: 'שכבנו בתעלה עד שהזמזום התרחק.', en: 'We lay in a ditch until the buzzing faded.' } },
      { key: 'shoot', label: { he: 'להפיל אותו', en: 'Shoot it down' }, loot: { scrap: 35, knowledge: 10 }, injury: 0.25, result: { he: 'הוא נפל בעשן. לפני כן הוא הספיק לירות.', en: 'It went down in smoke. Not before it fired back.' } },
    ],
  },
];

export function expeditionEvent(id: string): ExpeditionEvent | undefined {
  return EXPEDITION_EVENTS.find(e => e.id === id);
}

export function eventsFor(biome: string): ExpeditionEvent[] {
  return EXPEDITION_EVENTS.filter(e => !e.biomes || e.biomes.includes(biome as BiomeId));
}

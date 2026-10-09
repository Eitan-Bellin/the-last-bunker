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
  // ---- [ux-wp5 C11] eight more, so a road is not the same road every time (the first option is always the careful one) ----
  {
    id: 'bridge', icon: 'warning',
    title: { he: 'גשר שבור', en: 'A Broken Bridge' },
    text: { he: 'הגשר מעל הערוץ חצוי באמצע. אפשר לעקוף דרך הוואדי, או לקפוץ על הקורות שנשארו.', en: 'The bridge over the gorge is broken in the middle. We can go around through the wadi, or jump the beams that are left.' },
    options: [
      { key: 'around', label: { he: 'לעקוף דרך הוואדי', en: 'Go around through the wadi' }, timeMult: 1.3, result: { he: 'הדרך הארוכה. הרגליים יזכרו אותה.', en: 'The long way. Our legs will remember it.' } },
      { key: 'jump', label: { he: 'לעבור על הקורות', en: 'Cross on the beams' }, timeMult: 0.8, injury: 0.2, result: { he: 'עברנו. לא כולנו בלי שריטה.', en: 'We made it across. Not all of us without a scratch.' } },
    ],
  },
  {
    id: 'dogs', icon: 'skull', biomes: ['wasteland', 'ruins', 'shatteredCity'],
    title: { he: 'להקת כלבים', en: 'A Pack of Dogs' },
    text: { he: 'כלבים רזים מקיפים אותנו מרחוק. הם רעבים, ואנחנו נושאים אוכל.', en: 'Thin dogs circle us at a distance. They are hungry, and we are carrying food.' },
    options: [
      { key: 'feed', label: { he: 'לזרוק להם מהצידה', en: 'Throw them some rations' }, lootMult: 0.9, result: { he: 'הם לקחו ונעלמו. אחד מהם הלך אחרינו עוד שעה.', en: 'They took it and vanished. One of them followed us for another hour.' } },
      { key: 'stand', label: { he: 'לעמוד מולם', en: 'Stand our ground' }, injury: 0.25, lootMult: 1.1, result: { he: 'הם נסוגו, אבל לא בלי נשיכה.', en: 'They backed off, but not without a bite.' } },
    ],
  },
  {
    id: 'greenhouse', icon: 'farm', biomes: ['ruins', 'toxicForest', 'wasteland'],
    title: { he: 'חממה ישנה', en: 'An Old Greenhouse' },
    text: { he: 'זכוכית שבורה, ובפנים, בין העשבים, עוד צומחים ירקות. מישהו טיפל בזה פעם, הרבה זמן.', en: 'Broken glass, and inside, among the weeds, vegetables still grow. Someone tended this once, for a long time.' },
    options: [
      { key: 'some', label: { he: 'לקטוף מה שמוכן', en: 'Pick what is ripe' }, loot: { food: 12 }, result: { he: 'מילאנו תיק אחד, והשארנו את השאר שיגדל.', en: 'We filled one bag and left the rest to grow.' } },
      { key: 'all', label: { he: 'לעקור את הערוגות', en: 'Dig up the beds' }, loot: { food: 28 }, timeMult: 1.2, result: { he: 'לקחנו הכול, עם השורשים. הגב כואב.', en: 'We took everything, roots and all. Our backs ache.' } },
    ],
  },
  {
    id: 'ambulance', icon: 'medicine', biomes: ['shatteredCity', 'ruins'],
    title: { he: 'אמבולנס הפוך', en: 'An Overturned Ambulance' },
    text: { he: 'אמבולנס שוכב על הצד באמצע הכביש. הדלת האחורית נעולה, ומשהו בפנים מריח רע.', en: 'An ambulance lies on its side in the middle of the road. The back door is locked, and something inside smells bad.' },
    options: [
      { key: 'cab', label: { he: 'לבדוק רק את התא', en: 'Check the cab only' }, loot: { medicine: 4 }, result: { he: 'בתא היה ארגז עזרה ראשונה, כמעט שלם.', en: 'There was a first-aid box in the cab, almost whole.' } },
      { key: 'back', label: { he: 'לפרוץ את הדלת האחורית', en: 'Force the back door' }, loot: { medicine: 10 }, injury: 0.15, result: { he: 'מצאנו תרופות. ועוד דברים שעדיף לא לספר.', en: 'We found medicine. And other things better left untold.' } },
    ],
  },
  {
    id: 'camp', icon: 'tent', biomes: ['wasteland', 'militaryZone', 'ruins'],
    title: { he: 'מחנה נוודים', en: 'A Nomad Camp' },
    text: { he: 'מדורות ועגלות בצד הדרך. הנוודים מסמנים לנו להתקרב: יש להם מפה, ואין להם מלח.', en: 'Fires and carts by the road. The nomads wave us over: they have a map, and no salt.' },
    options: [
      { key: 'pass', label: { he: 'לנופף ולהמשיך', en: 'Wave and keep going' }, result: { he: 'הם נופפו בחזרה. אולי בפעם הבאה.', en: 'They waved back. Maybe next time.' } },
      { key: 'trade', label: { he: 'להחליף חלק מהשלל במפה', en: 'Trade some loot for the map' }, lootMult: 0.85, reveal: true, result: { he: 'המפה שלהם טובה משלנו. סימנו עליה דרכים שלא הכרנו.', en: 'Their map is better than ours. It showed roads we never knew.' } },
    ],
  },
  {
    id: 'basement', icon: 'people',
    title: { he: 'משפחה במרתף', en: 'A Family in a Basement' },
    text: { he: 'מתחת לבית הרוס: אמא ושני ילדים. הם לא מבקשים כלום, רק מסתכלים על התרמילים שלנו.', en: 'Under a ruined house: a mother and two children. They ask for nothing, they just look at our packs.' },
    options: [
      { key: 'leave', label: { he: 'להשאיר להם אוכל', en: 'Leave them some food' }, lootMult: 0.8, result: { he: 'השארנו מה שיכולנו. הקטן נופף לנו עד הפינה.', en: 'We left what we could. The little one waved until the corner.' } },
      { key: 'invite', label: { he: 'להזמין אותם לבונקר', en: 'Invite them to the bunker' }, lootMult: 0.7, recruit: 0.5, result: { he: 'היא חשבה הרבה זמן. ואז אספה את הדברים.', en: 'She thought for a long time. Then she gathered their things.' } },
    ],
  },
  {
    id: 'minefield', icon: 'warning', biomes: ['militaryZone', 'wasteland'],
    title: { he: 'שלט של שדה מוקשים', en: 'A Minefield Sign' },
    text: { he: 'שלט חלוד: "סכנה, מוקשים". מעבר לגדר, דרך קצרה ישר אל היעד, ועקבות צמיגים ישנים.', en: 'A rusty sign: "Danger, mines". Beyond the fence, a short road straight to the target, and old tire tracks.' },
    options: [
      { key: 'around', label: { he: 'לעקוף את הגדר', en: 'Go around the fence' }, timeMult: 1.3, result: { he: 'עקפנו. אף אחד לא הצטער.', en: 'We went around. Nobody was sorry.' } },
      { key: 'tracks', label: { he: 'ללכת בעקבות הצמיגים', en: 'Walk in the tire tracks' }, timeMult: 0.75, injury: 0.25, lootMult: 1.15, result: { he: 'צעד אחרי צעד, בלי לדבר. בצד השני מצאנו ג׳יפ צבאי, עם ציוד.', en: 'Step by step, without a word. On the far side we found an army jeep, with gear.' } },
    ],
  },
  {
    id: 'watchtower', icon: 'watchtower', biomes: ['toxicForest', 'wasteland', 'caves'],
    title: { he: 'מגדל תצפית', en: 'A Fire Lookout' },
    text: { he: 'מגדל תצפית של כבאים, מאה מדרגות ברזל. מלמעלה אפשר לראות רחוק, אם המדרגות יחזיקו.', en: 'A firefighters\' lookout tower, a hundred iron steps. From the top you can see far, if the steps hold.' },
    options: [
      { key: 'skip', label: { he: 'להמשיך בדרך', en: 'Keep to the road' }, result: { he: 'המגדל נשאר מאחורינו, שקט.', en: 'The tower stayed behind us, silent.' } },
      { key: 'climb', label: { he: 'לטפס למעלה', en: 'Climb up' }, reveal: true, timeMult: 1.1, injury: 0.1, result: { he: 'מלמעלה ראינו את כל האזור. מדרגה אחת לא החזיקה.', en: 'From the top we saw the whole area. One step didn\'t hold.' } },
    ],
  },
];

export function expeditionEvent(id: string): ExpeditionEvent | undefined {
  return EXPEDITION_EVENTS.find(e => e.id === id);
}

export function eventsFor(biome: string): ExpeditionEvent[] {
  return EXPEDITION_EVENTS.filter(e => !e.biomes || e.biomes.includes(biome as BiomeId));
}

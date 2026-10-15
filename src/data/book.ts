/**
 * The Bunker Book (balance plan Q6): a short dictionary of the game's own words. Each entry says what a thing is, what it is
 * for and where to find it, in two or three sentences. Panels open it at their topic through the "?" plate (Sheet.setHelp);
 * the Menu has the whole book. Text lives here (not in the i18n files) because it is prose that is read, not UI strings.
 * The words follow the glossary in store/ux-review/GLOSSARY.md (checked by tools/sim/glossary-lint.mjs).
 *
 * [ux-wp6] The book opens as the game does: an entry with `act` is a locked line until that Act (or after a first Genesis),
 * and a `spoiler` entry is not even named before then (it only counts in "N more later"). The "rooms" group is not written
 * here: the panel builds it from the room types the bunker already has (buildings.json).
 */
export type BookGroup = 'basics' | 'people' | 'rooms' | 'decisions' | 'world';

export interface BookEntry {
  id: string;
  icon: string;
  group: BookGroup;
  title: Record<'he' | 'en', string>;
  text: Record<'he' | 'en', string>;
  /** [ux-wp6] First Act in which the entry is open (none = from the start). */
  act?: number;
  /** [ux-wp6] Before its Act the entry is hidden, not shown as a locked title (late-game names). */
  spoiler?: boolean;
}

export const BOOK_GROUPS: { id: BookGroup; icon: string; name: Record<'he' | 'en', string> }[] = [
  { id: 'basics', icon: '[[flag]]', name: { he: 'מושגי יסוד', en: 'The basics' } },
  { id: 'people', icon: '[[people]]', name: { he: 'אנשים ועבודה', en: 'People and work' } },
  { id: 'rooms', icon: '[[build]]', name: { he: 'החדרים שלכם', en: 'Your rooms' } },
  { id: 'decisions', icon: '[[inbox]]', name: { he: 'החלטות', en: 'Decisions' } },
  { id: 'world', icon: '[[surface]]', name: { he: 'העולם שבחוץ', en: 'The world outside' } },
];

/** Which book entry each panel's "?" plate opens. */
export const HELP_TOPICS: Record<string, string> = {
  command: 'goal', research: 'research', projects: 'charter', people: 'people', build: 'mk', inbox: 'inbox', resources: 'resources',
  journal: 'journal', menu: 'saves', genesis: 'genesis', surface: 'surface', building: 'mk', ruin: 'ruins',
};

export const BOOK: BookEntry[] = [
  // ---- the basics ----
  {
    id: 'goal', icon: '[[target]]', group: 'basics',
    title: { he: 'מה עושים כאן?', en: 'What am I doing here?' },
    text: {
      he: 'משקמים את בונקר 17 ושורדים. המשחק מתחלק לשבע מערכות, ולכל מערכה יש יעדים ופרויקט מערכה גדול. בסוף המערכה השביעית מחכה פרויקט בראשית: סיבוב חדש עם שדרוגים קבועים. לסיפור ארבעה סופים, לפי הדרך שתבחרו. שורת היעד שמעל הלוח אומרת מה חוסם אתכם עכשיו, והקשה עליה לוקחת לשם. השבב עם הדגל (למעלה) פותח את מרכז הפיקוד: כל הדרישות, תחזית ומה שחוסם.',
      en: 'You restore Bunker 17 and survive. The game has seven Acts, and each has goals and a big Act project. At the end of the seventh waits Project Genesis: a new run with permanent upgrades. The story has four endings, depending on the way you choose. The line above the board says what blocks you right now, and a tap takes you there. The flag chip (top) opens the Command panel: every requirement, a forecast, and what blocks you.',
    },
  },
  {
    id: 'act', icon: '[[flag]]', group: 'basics',
    title: { he: 'מערכה', en: 'Act' },
    text: {
      he: 'פרק בסיבוב שלכם. כל מערכה מרימה תקרות (רמת חדרים, אוכלוסייה, עומק) ופותחת מערכות חדשות. עוברים הלאה כשכל היעדים ופרויקטי המערכה הושלמו. השבב עם הדגל מראה את מספר המערכה (I עד VII) ואחוז ההתקדמות בה: "I·34%" הוא 34% ממערכה I.',
      en: 'A chapter of your run. Each Act raises the ceilings (room level, people, depth) and opens new systems. You move on when all of its goals and Act projects are done. The flag chip shows the Act (I to VII) and how far through it you are: "I·34%" means 34% of Act I.',
    },
  },
  {
    id: 'era', icon: '[[sun]]', group: 'basics',
    title: { he: 'עידן', en: 'Era' },
    text: {
      he: 'המראה והאווירה של הבונקר: השריד, השיקום, המושבה, העיר התחתית. העידן מתקדם לבד לפי מה שבניתם (אנשים, קומות, מחקר). את היעדים קובעת המערכה; אם אחד מהם הוא להגיע לעידן, שורת היעד אומרת מה עוד חסר.',
      en: 'The bunker\'s look and mood: the Remnant, Restoration, the Colony, the Undercity. The era moves on by itself with what you build (people, levels, research). The Act sets the goals; if one of them is to reach an era, the goal line says what is still missing.',
    },
  },
  {
    id: 'charter', icon: '[[build]]', group: 'basics',
    title: { he: 'פרויקט המערכה', en: 'The Act project (charter)' },
    text: {
      he: 'מבנה גדול על פני השטח, בשלבים. כל שלב דורש סחורה (מועברת ביד, או מגלישת מחסנים מלאים) וגם שעות עבודה של צוות. פרויקט פעיל אחד בכל רגע. סיום פרויקטי המערכה פותח את המערכה הבאה, ולכל פרויקט יש פרס קבוע. כפתור "פרויקטים" במרכז הפיקוד.',
      en: 'A large structure on the surface, built in stages. Each stage needs goods (delivered by hand, or from full storage overflowing) and crew hours. One project is active at a time. Finishing the Act\'s projects opens the next Act, and every project pays a permanent reward. The Projects button is in the Command panel.',
    },
  },
  {
    id: 'crew', icon: '[[worker]]', group: 'basics',
    title: { he: 'צוות', en: 'Crew' },
    text: {
      he: 'אנשים ששובצו לפרויקט או לחפירה במקום לחדר. פחות אנשים מהנדרש: עובדים לאט יותר. אנשים במשלחת לא עובדים. ממערכה II מנהל העבודה יכול לשבץ בטלנים אוטומטית.',
      en: 'People stationed on a project or a dig instead of a room. Fewer than needed means slower work. People out on an expedition do not work. From Act II the Foreman can place idle people for you.',
    },
  },
  {
    id: 'mk', icon: '[[up]]', group: 'basics',
    title: { he: 'רמת חדר ושדרוג', en: 'Room level and upgrades' },
    text: {
      he: 'לכל חדר יש רמה, מ־1 עד 10. שדרוג עולה בשעות של הכנסה, לא במספר קבוע, וכל מערכה מגבילה את הרמה המרבית. חדר שמגיע לתקרת המערכה מחכה למערכה הבאה. חלק מהחדרים יכולים לקבל התמחות, בפאנל של החדר.',
      en: 'Every room has a level, from 1 to 10. An upgrade costs hours of income, not a fixed number, and each Act caps the highest level. A room at the Act\'s ceiling waits for the next Act. Some rooms can take a specialty, in the room\'s panel.',
    },
  },
  {
    id: 'resources', icon: '[[materials]]', group: 'basics',
    title: { he: 'משאבים ומחסנים', en: 'Resources and storage' },
    text: {
      he: 'לכל משאב יש מחסן עם תקרה. הקישו על משאב למעלה כדי לראות ממה הוא בא, לאן הוא הולך, ובעוד כמה זמן הוא מתמלא או נגמר. "▾" למעלה מראה את שאר המשאבים. מה שעולה על התקרה לא הולך לאיבוד לגמרי: הפרויקט הפעיל לוקח ממנו, והשאר הופך לזיכויי סחר.',
      en: 'Every resource has a store with a ceiling. Tap a resource at the top to see where it comes from, where it goes, and when it fills up or runs out. The "▾" at the top shows the rest of the resources. What exceeds the ceiling is not lost entirely: the active project takes some, and the rest becomes trade credits.',
    },
  },
  {
    id: 'tier2', icon: '[[alloys]]', group: 'basics', act: 3, spoiler: true,
    title: { he: 'משאבי המערכות המאוחרות', en: 'The late Acts\' resources' },
    text: {
      he: 'רכיבים, סגסוגות, נתונים, השפעה וליבות זרע. כל אחד מיוצר בחדר שמתמחה בכך (התמחות מהפאנל של החדר) ונפתח במערכה שלו. מהמערכה שלו והלאה רוב המחירים, בשדרוגים, בחפירות ובפרויקטים, דורשים אותו.',
      en: 'Components, alloys, data, influence and seed cores. Each is made by a room specialized for it (a specialty from the room\'s panel) and opens in its own Act. From that Act on, most prices, for upgrades, digs and projects, ask for it.',
    },
  },
  {
    id: 'credits', icon: '[[credits]]', group: 'basics',
    title: { he: 'זיכויי סחר וחנות', en: 'Trade credits and the shop' },
    text: {
      he: 'זיכויי סחר נצברים מגלישת מחסנים ומהזמנות יום. מוציאים אותם בחנות (ביומן, לשונית חנות): שרטוטים, האצת מחקר, האצת פרויקט, איזוטופ-7. לכל פריט הגבלה יומית, והמחירים עולים עם המערכה.',
      en: 'Trade credits come from storage overflow and daily orders. Spend them in the shop (Journal, Shop tab): blueprints, research speed-ups, project boosts, Isotope-7. Each item has a daily limit, and prices rise with the Act.',
    },
  },
  {
    id: 'journal', icon: '[[journal]]', group: 'basics',
    title: { he: 'היומן', en: 'The Journal' },
    text: {
      he: 'שלוש לשוניות: ממצאים (פתקים, קלטות ותמונות שהשאירו הדיירים הקודמים; חלקם נותנים בונוס קבוע לחדר), פרקי הסיפור שכבר קרו (אפשר לצפות בהם שוב), והחנות שבה מוציאים זיכויי סחר. ממצאים מתגלים כשמפנים הריסות.',
      en: 'Three tabs: finds (notes, tapes and photos the old residents left; some give a room a lasting bonus), the story chapters so far (you can watch them again), and the shop where trade credits are spent. Finds turn up when you clear ruins.',
    },
  },
  {
    id: 'morale', icon: '[[happy]]', group: 'basics',
    title: { he: 'מורל', en: 'Morale' },
    text: {
      he: 'ממוצע האושר של הניצולים. מורל גבוה מגדיל את תפוקת כל החדרים ומורל נמוך מקטין אותה. חוקים, עונות, פרויקטים ואירועים משפיעים עליו, והפירוט נמצא בפאנל האנשים ובפאנל של כל אדם.',
      en: 'The survivors\' average happiness. High morale raises every room\'s output, low morale lowers it. Laws, seasons, projects and events move it, and the breakdown is in the People panel and in each person\'s panel.',
    },
  },
  {
    id: 'beds', icon: '[[quarters]]', group: 'basics',
    title: { he: 'מיטות ותקרת אוכלוסייה', en: 'Beds and the population ceiling' },
    text: {
      he: 'ניצולים חדשים צריכים מיטות (חדרי מגורים). בנוסף, כל מערכה מגבילה את מספר הניצולים: מיטות שמעבר לתקרה נשארות ריקות עד המערכה הבאה (מסומן במנעול ליד מספר האנשים).',
      en: 'Newcomers need beds (quarters). On top of that each Act caps how many survivors can live here: beds beyond the ceiling stay empty until the next Act (a lock appears by the headcount).',
    },
  },
  {
    id: 'door', icon: '[[door]]', group: 'basics',
    title: { he: 'הדלת', en: 'The Door' },
    text: {
      he: 'ניצולים מגיעים לדלת בקצב קבוע: השעון שליד מספר האנשים סופר לאחור עד הבא, ו"!" אומר שאין מיטה פנויה. בלי מיטה הם מחכים בחוץ. מורל גבוה, מגדל רדיו וחוקים מסוימים מזרזים את ההגעה.',
      en: 'Survivors arrive at the door on a clock: the timer by the headcount counts down to the next one, and "!" means there is no free bed. With no bed they wait outside. High morale, the radio mast and some laws speed arrivals up.',
    },
  },
  {
    id: 'touch', icon: '[[hand]]', group: 'basics',
    title: { he: 'מגע ומצלמה', en: 'Touch and camera' },
    text: {
      he: 'גררו באצבע כדי להזיז את המבט. צבטו בשתי אצבעות כדי להתקרב ולהתרחק. הקשה כפולה על חדר ממקדת בו, ועוד הקשה כפולה חוזרת לתצוגה הרחבה. לחצו והחזיקו על ניצול כדי להרים אותו, גררו אותו לחדר ושחררו כדי לשבץ אותו שם. כשיש אגפים, אפשר להרחיב קומה לצדדים. את הטיפים אפשר להציג שוב בהגדרות.',
      en: 'Drag with a finger to move around. Pinch with two fingers to zoom in and out. Double-tap a room to frame it, and double-tap again to return to the wide view. Press and hold a survivor to pick them up, drag them to a room and let go to assign them there. Once there are wings, a floor can be widened sideways. The tips can be shown again in Settings.',
    },
  },
  {
    id: 'moraleChannels', icon: '[[happy]]', group: 'basics',
    title: { he: 'מורל: שלושה ערוצים', en: 'Morale: three channels' },
    text: {
      he: 'חדרי מורל נחלקים לשלושה ערוצים, ולכל ערוץ תקרה משלו: בסיס (קפיטריה, אגם, אטריום; עד 22), נוחות (אולם מועדון, גן ילדים, מקלחות; עד 6) ותרבות (ספרייה, אולם זיכרון; עד 6). חדר נוסף באותו ערוץ מפסיק לעזור כשהתקרה מלאה, אז כדאי לגוון. הפירוט נמצא בפאנל האנשים.',
      en: 'Morale rooms feed three channels, each with its own ceiling: base (canteen, lake, atrium; up to 22), comfort (commons, nursery, bathhouse; up to 6) and culture (library, memorial hall; up to 6). Another room in a full channel stops helping, so mix them. The breakdown is in the People panel.',
    },
  },
  {
    id: 'neighbours', icon: '[[compound]]', group: 'basics',
    title: { he: 'חדרים שכנים', en: 'Neighbouring rooms' },
    text: {
      he: 'חדרים שנוגעים זה בזה באותה קומה יכולים לעזור זה לזה. שני חדרים מאותו סוג ורמה מוסיפים 10% כל אחד. זוגות מיוחדים נותנים עוד, למשל קפיטריה ליד אולם מועדון, או ספרייה ליד מעבדה. הבונוס עולה עד שלושה שכנים ולא יותר מ-20%, והוא מוצג בפאנל החדר ובשעת ההצבה. אש עוברת בין שכנים.',
      en: 'Rooms that touch on the same floor can help each other. Two rooms of the same type and level add 10% each. Special pairs give more, such as a canteen beside a commons, or a library beside a laboratory. The bonus counts up to three neighbours and at most 20%, and shows in the room panel and while you place a room. Fire spreads between neighbours.',
    },
  },
  {
    id: 'placeRules', icon: '[[lock]]', group: 'basics',
    title: { he: 'חוקי מקום ומגבלות', en: 'Where rooms may stand' },
    text: {
      he: 'לחלק מהחדרים יש חוק מקום: חוות פטריות רק בקומות העמוקות, עמדת שער ותא טיהור בקומת הכניסה, פאנלים, טורבינה ומגדל על הגג, בריכות דגים ליד האגם. ולחדרים רבים יש מספר מקסימלי של עותקים. בתפריט הבנייה השורה הכהה מסבירה למה אי אפשר לבנות עכשיו.',
      en: 'Some rooms have a place rule: the mushroom farm only on the deep levels, the gate post and the decon chamber on the entrance floor, panels, turbines and the watchtower on the roof, fish ponds beside the lake. Many rooms also have a limit on copies. In the build menu the dim line says why you cannot build one right now.',
    },
  },
  {
    id: 'weatherPower', icon: '[[sun]]', group: 'basics', act: 2,
    title: { he: 'חשמל מהשמיים', en: 'Power from the sky' },
    text: {
      he: 'פאנלים סולאריים נותנים חשמל רק ביום, וטורבינת רוח נותנת לפי הרוח, לפעמים הרבה ולפעמים כמעט כלום. לא צריך להאכיל אותם, ואין להם תקלות חשמל. מצבר ענק שומר את העודף ליום שאין בו כלום. שניהם בנויים על הגג, ושימו לב לשעות החושך.',
      en: 'Solar panels give power only by day, and a wind turbine gives it by the wind: sometimes plenty, sometimes almost none. They need no fuel and never short out. A battery bank keeps the surplus for the hours with nothing. Both stand on the roof, so watch the dark hours.',
    },
  },
  // [plan4:BL-24,25,34..38] wave 3
  {
    id: 'actRooms', icon: '[[componentsPlant]]', group: 'basics', act: 3, spoiler: true,
    title: { he: 'חדרי המערכות', en: 'Act rooms' },
    text: {
      he: 'בכל מערכה מאוחרת נפתח חדר שמייצר את המשאב שלה, בלי שיצטרכו לתפוס חדר רגיל בתפקיד: מפעל רכיבים, יצקת סגסוגות, מרכז נתונים, פורום האזרחים ומעבדת זרעים. מחירם בכמה שעות הכנסה של המערכה, ויש רק אחד מכל סוג. הם אוכלים אותם חומרים כמו התפקיד, אז דאגו להם. הם מופיעים בתפריט הבנייה תחת "חדרי מערכה".',
      en: 'In each late Act a room opens that makes its resource, so no ordinary room has to be given the matching role: the components plant, alloy foundry, data center, citizens\' forum and seed lab. They cost a few hours of the Act\'s income, and you can have only one of each. They eat the same inputs as the role, so keep them stocked. They sit in the build menu under "Act rooms".',
    },
  },
  {
    id: 'actDistricts', icon: '[[geothermal]]', group: 'basics', act: 4, spoiler: true,
    title: { he: 'מערת קיטור וכספת טרום־מלחמה', en: 'Steam vent and pre-war vault' },
    text: {
      he: 'שני מחוזות חדשים נפתחים בחפירה לצד, אחרי מחקר ומערכה מתאימים: מערת קיטור (מערכה IV) נותנת חשמל בלי דלק, אבל מערה שחוקה עלולה להתפוצץ, אז תחזקו אותה. כספת טרום־מלחמה (מערכה V) מייצרת שרטוטים לאט, אחד כל כמה שעות כשהיא מאוישת. בחפירה אפשר לבחור בין המחוזות הפנויים.',
      en: 'Two new districts open by tunnelling sideways, after the right research and Act: the geothermal vent (Act IV) gives power with no fuel, but a worn vent can burst, so keep it maintained. The pre-war vault (Act V) makes blueprints slowly, one every few hours when it is staffed. When you dig, you can choose between the districts on offer.',
    },
  },
  // ---- people and work ----
  {
    id: 'people', icon: '[[people]]', group: 'people',
    title: { he: 'אנשים ותכונות', en: 'People and their stats' },
    text: {
      he: 'לכל ניצול חמש תכונות: [[strength]] כוח (חווה, מחזור, שומרים), [[intelligence]] אינטליגנציה (מעבדה, מרפאה, מטהר מים), [[agility]] זריזות (סדנה, נשקייה, מוסך), [[charisma]] כריזמה (חדר אוכל, רדיו, שוק) ו[[endurance]] סיבולת (גנרטור, משאבת מים, חוות פטריות). מי שעובד בחדר שמתאים לתכונה החזקה שלו מייצר יותר. משבצים בגרירה לחדר או מהפאנל של החדר, ובטלנים לא מייצרים כלום.',
      en: 'Every survivor has five stats: [[strength]] strength (farm, recycler, guards), [[intelligence]] intelligence (laboratory, medbay, water purifier), [[agility]] agility (workshop, armory, garage), [[charisma]] charisma (canteen, radio, market) and [[endurance]] endurance (generator, water pump, mushroom farm). Someone working in a room that suits their strongest stat makes more. Assign by dragging to a room or from the room\'s panel; idle people make nothing.',
    },
  },
  {
    id: 'mastery', icon: '[[medal]]', group: 'people',
    title: { he: 'מומחיות ואימון', en: 'Mastery and training' },
    text: {
      he: 'עובד שנשאר בתפקיד צובר דרגה (1 עד 5) שמוסיפה לתפוקת החדר. אפשר לזרז בחדר כושר בתשלום. בדרגה 5 בוחרים התמחות: אמן (+15% בחדר) או מורה (כולם בחדר לומדים מהר יותר).',
      en: 'A worker who stays in a role earns a rank (1 to 5) that adds to the room\'s output. A Training Room speeds it up for a price. At rank 5 you pick a specialty: Master (+15% in the room) or Mentor (everyone there learns faster).',
    },
  },
  {
    id: 'foreman', icon: '[[worker]]', group: 'people', act: 2,
    title: { he: 'מנהל העבודה', en: 'The Foreman' },
    text: {
      he: 'ממערכה II מנהל העבודה עושה את השגרה בשבילכם, לפי פקודות קבע: תחזוקה, העברת עודפים לפרויקט, שיבוץ בטלנים, אימון מהיר, מענה לחוזים בטוחים וסגירת דלתות בשעת סכנה (בחירה שלכם, עם מחיר בייצור). הוא פועל כל דקה גם כשאתם רחוקים, ומדווח מה עשה. הפקודות במרכז הפיקוד.',
      en: 'From Act II the Foreman does the routine for you, by standing orders: servicing, delivering spare goods to the project, placing idle people, quick training, answering safe contracts and shutting doors in danger (your choice, with a cost in output). He works every minute, also while you are away, and reports what he did. The orders are in the Command panel.',
    },
  },
  {
    id: 'dig', icon: '[[pick]]', group: 'people',
    title: { he: 'חפירה', en: 'Digging' },
    text: {
      he: 'קומה חדשה נחפרת בצוות ובזמן: משלמים מראש, ואז הצוות עובד שעות. כל מערכה קובעת את העומק המרבי. אם החפירה דורשת יותר ממה שהמחסן מחזיק, צריך מחסן גדול יותר.',
      en: 'A new floor is dug by a crew over time: you pay first, then the crew works for hours. Each Act sets the greatest depth. If a dig asks for more than storage can hold, you need bigger storage.',
    },
  },
  {
    id: 'ruins', icon: '[[broom]]', group: 'people',
    title: { he: 'הריסות ושיקום', en: 'Ruins and restoration' },
    text: {
      he: 'חדרים הרוסים (בתחילת המשחק, או אחרי תבוסה בפשיטה) מתחילים כהריסות. מקישים, משבצים אנשים, והם מפנים את ההריסות עד שהחדר חוזר לחיים. לפעמים מוצאים שם ממצא ליומן.',
      en: 'Wrecked rooms (at the start of the game, or after a lost raid) begin as ruins. Tap one, assign people, and they clear the rubble until the room comes back to life. Sometimes they turn up a find for the Journal.',
    },
  },
  {
    id: 'children', icon: '[[baby]]', group: 'people',
    title: { he: 'ילדים וחינוך', en: 'Children and school' },
    text: {
      he: 'ילדים לא עובדים. הם גדלים עם הזמן, ומהר יותר בגן ילדים. בגן ובבית הספר יש מקומות לילדים (נפרדים ממקומות העבודה): גררו ילד לשם. ילד שבילה את רוב ילדותו בבית ספר יגדל וירוויח נקודה בתכונה, ובית הספר גם מוסיף ידע.',
      en: 'Children do not work. They grow up with time, and faster in a nursery. The nursery and the school hold children in places of their own (separate from work places): drag a child there. A child who spent most of childhood in school grows up with a point in a stat, and the school also adds knowledge.',
    },
  },
  // ---- decisions ----
  {
    id: 'inbox', icon: '[[inbox]]', group: 'decisions', act: 2,
    title: { he: 'תיבת ההחלטות', en: 'The Decisions inbox' },
    text: {
      he: 'מהמערכה השנייה החלטות שאינן דחופות מחכות בתיבת ההחלטות ככרטיסים, עם זמן מוגבל ובררת מחדל בטוחה אם לא עונים. רק מצבי חירום (פשיטה, אסון) והסיפור קופצים בעצמם. אפשר לענות מאוחר יותר, לא מפסידים כלום.',
      en: 'From the second Act, decisions that are not urgent wait in the Decisions inbox as cards, with a time limit and a safe default if you do not answer. Only emergencies (a raid, a disaster) and the story pop up by themselves. You can answer later and lose nothing.',
    },
  },
  {
    id: 'contracts', icon: '[[cart]]', group: 'decisions', act: 2,
    title: { he: 'חוזים', en: 'Contracts' },
    text: {
      he: 'שותפים בחוץ מציעים עסקאות: הם מבקשים סחורה נדירה (בערך שעה מהייצור שלכם) או צוות לכמה שעות, ומשלמים במה שהמחירים של המערכה דורשים, וגם ביחסים טובים יותר. חוזה "בטוח" לא מרוקן מחסן ולא מוריד עובדים מחדרים. אפשר לקבל את כולם בלחיצה, או להשאיר את זה למנהל העבודה.',
      en: 'Partners outside offer deals: they ask for a scarce good (about an hour of your own production) or a crew for a few hours, and pay in what the Act\'s prices ask for, plus better relations. A "safe" contract does not strip a store or pull people off rooms. Take them all with one tap, or leave it to the Foreman.',
    },
  },
  {
    id: 'research', icon: '[[research]]', group: 'decisions',
    title: { he: 'מחקר', en: 'Research' },
    text: {
      he: 'מחקר אחד פעיל, ותור קצר מאחוריו (המחקרים שבתור כבר שולמו). אאוריקה (תנאי מיוחד) מזרזת מחקר. שכלולים חוזרים כשהעץ נגמר. מחקר מכין חדרים חדשים, תכונות והתמחויות. העץ מראה את מה שאפשר לחקור עכשיו ובמערכה הבאה; השאר נפתח בהמשך.',
      en: 'One research is active, with a short queue behind it (queued ones are already paid). A Eureka (a special condition) speeds a research up. Refinements come back when the tree runs out. Research unlocks new rooms, traits and specialties. The tree shows what can be studied now and in the next Act; the rest opens later.',
    },
  },
  {
    id: 'doctrine', icon: '[[books]]', group: 'decisions', act: 2,
    title: { he: 'דוקטרינות', en: 'Doctrines' },
    text: {
      he: 'מזלגות במחקר: בכל קבוצה בוחרים דרך אחת, והאחרות נסגרות עד בראשית. הבחירה משנה את הבונקר וגם את הסוף של הסיבוב. הדוקטרינות מסומנות בעץ המחקר.',
      en: 'Forks in research: in each group you pick one path, and the others close until Genesis. The choice changes the bunker and the run\'s ending too. Doctrines are marked in the research tree.',
    },
  },
  {
    id: 'laws', icon: '[[books]]', group: 'decisions', act: 3,
    title: { he: 'חוקים', en: 'Laws' },
    text: {
      he: 'מספר משבצות לחוקים (במרכז הפיקוד). כל חוק הוא עסקה: ייצור מול מורל, הגנה מול חופש. בתי ספר חינם, דלתות פתוחות, משטר צבאי ועוד. אפשר לבטל, וגם זה בחירה.',
      en: 'A few law slots (in the Command panel). Every law is a trade: output against morale, defense against freedom. Free Schools, Open Doors, Martial Law and more. You can repeal, and that is a choice too.',
    },
  },
  {
    id: 'ending', icon: '[[trophy]]', group: 'decisions', act: 2,
    title: { he: 'סופים', en: 'Endings' },
    text: {
      he: 'כשהמערכה האחרונה נגמרת, הסיפור נסגר לפי הדרך ששיחקתם: חבר העמים, המבצר, הגן או התיבה. במרכז הפיקוד רואים לאן הסוף נוטה ומה מעלה כל ציון. כל סיבוב יכול להגיע לסוף אחר.',
      en: 'When the last Act ends, the story closes the way you played: the Commonwealth, the Fortress, the Garden or the Ark. The Command panel shows where the ending leans and what raises each score. Each run can reach a different ending.',
    },
  },
  // ---- the world outside ----
  {
    id: 'surface', icon: '[[surface]]', group: 'world',
    title: { he: 'פני השטח ומשלחות', en: 'The surface and expeditions' },
    text: {
      he: 'מפה של אזורים סביב הבונקר. שולחים צוות לחקור אזור: זה לוקח זמן, וממשיך גם כשאתם רחוקים. משלחות מביאות סחורה, ניצולים, ידע וסיכון. שיירות סחר הולכות לשותפים.',
      en: 'A map of regions around the bunker. Send a team to explore one: it takes time and also runs while you are away. Expeditions bring goods, survivors, knowledge and risk. Trade caravans go to partners.',
    },
  },
  {
    id: 'outposts', icon: '[[surface]]', group: 'world', act: 3,
    title: { he: 'מאחזים', en: 'Outposts' },
    text: {
      he: 'מקימים מאחז על אזור שחקרתם: הוא מייצר בכל שעה גם כשאתם רחוקים. פשיטות יכולות לפגוע בו (מתקנים, לא מאבדים). ממערכה III.',
      en: 'Claim an explored region with an outpost: it produces every hour, also while you are away. Raids can damage it (you repair it, you do not lose it). From Act III.',
    },
  },
  {
    id: 'threat', icon: '[[skull]]', group: 'world',
    title: { he: 'איום ופשיטות', en: 'Threat and raids' },
    text: {
      he: 'מדד האיום אומר כמה הבונקר מפתה. פשיטה מגיעה עם אזהרה של כמה דקות: מחזיקים, שולחים שומרים, מתחבאים או משלמים מכס. מי שמפסיד מאבד סחורה ולפעמים חדר. אחרי פגיעה קשה יש הפוגה. ככל שהמערכה מתקדמת הפשיטות גדולות יותר.',
      en: 'The threat meter says how tempting the bunker looks. A raid comes with a few minutes\' warning: hold, send the guards, hide, or pay a toll. The loser loses goods and sometimes a room. After a hard hit there is a breather. The further the Act, the bigger the raids.',
    },
  },
  {
    id: 'disasters', icon: '[[warning]]', group: 'world',
    title: { he: 'תקלות ואסונות', en: 'Incidents and disasters' },
    text: {
      he: 'שריפה, הצפה, קריסה, התפרצות קיטור: מופיעים עם אזהרה. אפשר לטפל מהר (תיקון קצר) או לשבץ צוות. תחזוקה שוטפת של חדרים מקטינה את הסיכוי.',
      en: 'Fire, flood, cave-in, steam burst: they come with a warning. You can fix them fast (a quick repair) or assign a team. Regular servicing of rooms lowers the odds.',
    },
  },
  {
    id: 'seasons', icon: '[[clover]]', group: 'world', act: 2,
    title: { he: 'עונות', en: 'Seasons' },
    text: {
      he: 'ארבע עונות, כל אחת בערך ארבעה ימים, גם כשאתם רחוקים. כל עונה משנה את הייצור והסכנה (אביב: יותר אוכל, קיץ: פחות מים ופושטים חזקים, סתיו: קציר, חורף: פחות אוכל וצריכת חשמל גבוהה). הקישו על סמל העונה בראש המסך לתחזית.',
      en: 'Four seasons of about four days each, turning also while you are away. Each changes output and danger (spring: more food, summer: less water and stronger raiders, autumn: harvest, winter: less food and more power use). Tap the season icon at the top for the forecast.',
    },
  },
  {
    id: 'partners', icon: '[[flag]]', group: 'world',
    title: { he: 'השותפים', en: 'The partners' },
    text: {
      he: 'המסוף, שבט החלודה וד"ר נועה. היחסים איתם גדלים עם שיירות וחוזים, ופותחים הטבות. מה שמחליטים בסיפור משפיע עליהם.',
      en: 'Terminus, the Rust Clan and Dr. Noa. Relations with them grow with caravans and contracts and unlock perks. What you decide in the story affects them.',
    },
  },
  {
    id: 'genesis', icon: '[[isotope7]]', group: 'world',
    title: { he: 'בראשית: היעד הרחוק', en: 'Genesis: the far goal' },
    text: {
      he: 'בסוף מערכה VII נפתח פרויקט בראשית: הבונקר מתאפס, ובתמורה מקבלים איזוטופ-7 שקונים בו שדרוגים קבועים לסיבוב הבא. ההישגים, השדרוגים, הממצאים והכרוניקה נשמרים, והבונקר שסיימתם נשאר "בית" ששולח לבונקר החדש חלק מההכנסה. לפני כל סיבוב בוחרים אתר וקשיים נוספים. הכפתור בתפריט, לשונית בראשית.',
      en: 'At the end of Act VII Project Genesis opens: the bunker resets, and you get Isotope-7 to buy permanent upgrades for the next run. Achievements, upgrades, finds and the Chronicle are kept, and the bunker you finished stays on as a "home" that sends part of its income to the new one. Before each run you pick a site and extra hardships. The button is in the Menu, Genesis tab.',
    },
  },
  {
    id: 'nextWorld', icon: '[[map]]', group: 'world', act: 6,
    title: { he: 'העולם הבא', en: 'The next world' },
    text: {
      he: 'אחרי בראשית בוחרים איפה מתחיל הסיבוב הבא, ולכל אתר כללים משלו. מה שעובר הלאה: איזוטופ-7, אבני היסוד, השדרוגים הקבועים, הממצאים, ההישגים והכרוניקה. הבונקר הנוכחי נשאר בית ושולח לחדש חלק מההכנסה שלו. מה שמתאפס: החדרים, הניצולים, המחקר, המפה והמערכה.',
      en: 'After Genesis you choose where the next run begins, and each site has rules of its own. What carries over: Isotope-7, the keystones, the permanent upgrades, the finds, the achievements and the Chronicle. This bunker stays on as a home and sends part of its income to the new one. What starts over: the rooms, the survivors, research, the map and the Act.',
    },
  },
  {
    id: 'saves', icon: '[[save]]', group: 'world',
    title: { he: 'שמירה וגיבויים', en: 'Saves and backups' },
    text: {
      he: 'המשחק נשמר לבד כל כמה שניות, וגיבוי אוטומטי נשמר לפני שינויים גדולים. בהגדרות אפשר לייצא את השמירה לקובץ ולשחזר גיבוי.',
      en: 'The game saves by itself every few seconds, and an automatic backup is kept before big changes. In Settings you can export the save to a file and restore a backup.',
    },
  },
];

export function getBookEntry(id: string): BookEntry | undefined {
  return BOOK.find(e => e.id === id);
}

/** [ux-wp6] Whether an entry is open for a player in `act` (a second run onward has seen everything). */
export function bookEntryOpen(e: BookEntry, act: number, veteran: boolean): boolean {
  return veteran || !e.act || e.act <= act;
}

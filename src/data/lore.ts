import type { BuildingType } from '../core/GameState';

/**
 * The story of Bunker 17's previous residents, found piece by piece:
 * notes and logs in the ruins, tapes in flooded rooms, letters on the surface.
 * Some finds carry practical knowledge that permanently boosts a room type.
 */

export type LoreKind = 'note' | 'log' | 'tape' | 'photo' | 'letter';

export interface LoreEntry {
  id: string;
  kind: LoreKind;
  title: Record<string, string>;
  author: Record<string, string>;
  date: Record<string, string>;
  body: Record<string, string>;
  /** Permanent production bonus for a room type, from knowledge in the text. */
  bonus?: { type: BuildingType; pct: number };
}

export const LORE: LoreEntry[] = [
  {
    id: 'welcome', kind: 'note',
    title: { he: 'למי שמוצא את המקום הזה', en: 'To whoever finds this place' },
    author: { he: 'ד"ר נועה הלפרין, מהנדסת ראשית', en: 'Dr. Noa Halperin, chief engineer' },
    date: { he: 'שנה 4', en: 'Year 4' },
    body: {
      he: 'אם אתם קוראים את זה, הדלת עוד נפתחת. טוב. השארנו לכם מה שיכולנו: הגנרטור ב־B3 חי, רק צריך יד חזקה. הזרעים ארוזים ליד החווה. אל תשתו מהמים ב־B3 לפני שהמשאבה עובדת. ובבקשה, תשאירו את האורות דולקים. הם החזיקו אותנו בחיים יותר מהאוכל.',
      en: 'If you are reading this, the door still opens. Good. We left you what we could: the generator on B3 is alive, it just needs a strong hand. The seeds are packed by the farm. Don\'t drink the water on B3 before the pump works. And please, keep the lights on. They kept us alive more than the food did.',
    },
  },
  {
    id: 'day1', kind: 'log',
    title: { he: 'יומן השומר, יום 1', en: 'Warden\'s log, day 1' },
    author: { he: 'יוסי בן־עמי, אחראי המקלט', en: 'Yossi Ben-Ami, shelter warden' },
    date: { he: 'יום האפר', en: 'Ashes Day' },
    body: {
      he: 'הדלת נסגרה ב־14:52. ארבעים ואחד בפנים. שמעתי את הדפיקות מבחוץ עוד שעה אחרי. לא פתחתי. אלוהים יסלח לי, לא פתחתי. מחר נספור את המלאי.',
      en: 'The door sealed at 14:52. Forty-one inside. I heard knocking from outside for an hour after. I did not open. God forgive me, I did not open. Tomorrow we count the stores.',
    },
  },
  {
    id: 'drawing', kind: 'photo',
    title: { he: 'ציור של ילדה', en: 'A child\'s drawing' },
    author: { he: 'מאיה, בת 7', en: 'Maya, age 7' },
    date: { he: 'שנה 1', en: 'Year 1' },
    body: {
      he: 'ציור בעפרונות: שמש צהובה גדולה, עץ, וארבעים ואחת דמויות קטנות מחזיקות ידיים. מתחת, בכתב ילדותי: "אמא אומרת שהשמש עוד שם. היא רק מחכה לנו."',
      en: 'A crayon drawing: a big yellow sun, a tree, and forty-one small figures holding hands. Below, in a child\'s hand: "Mom says the sun is still there. It is just waiting for us."',
    },
  },
  {
    id: 'rations', kind: 'log',
    title: { he: 'יומן השומר, יום 212', en: 'Warden\'s log, day 212' },
    author: { he: 'יוסי בן־עמי', en: 'Yossi Ben-Ami' },
    date: { he: 'שנה 1', en: 'Year 1' },
    body: {
      he: 'קיצצנו מנות לשליש. הפסקנו לספור ימים בקול. נועה אומרת שאם נגדל תפוחי אדמה תחת המנורות הוורודות נוכל להחזיק לנצח. אף אחד לא מאמין לה, אבל כולם מתנדבים לחפור.',
      en: 'We cut rations to a third. We stopped counting days out loud. Noa says if we grow potatoes under the pink lamps we can last forever. Nobody believes her, but everyone volunteers to dig.',
    },
  },
  {
    id: 'generatorTape', kind: 'tape',
    title: { he: 'קלטת: איך מתניעים את הזקן', en: 'Tape: how to start the old man' },
    author: { he: 'ד"ר נועה הלפרין', en: 'Dr. Noa Halperin' },
    date: { he: 'שנה 2', en: 'Year 2' },
    body: {
      he: '"...הגנרטור הזה ותיק ממני. כשהוא נחנק, אל תכבו אותו. פותחים את משנק האוויר חצי סיבוב, מכים פעמיים על הווסת עם המפתח הגדול, ונותנים לו לנשום. הוא יודע מה הוא עושה. אנחנו רק צריכים להקשיב לו..." [רעש סטטי]',
      en: '"...this generator is older than me. When it chokes, don\'t shut it down. Open the air choke half a turn, hit the governor twice with the big wrench, and let it breathe. It knows what it is doing. We just have to listen to it..." [static]',
    },
    bonus: { type: 'generator', pct: 10 },
  },
  {
    id: 'seeds', kind: 'note',
    title: { he: 'רשימת זרעים', en: 'Seed inventory' },
    author: { he: 'רחל כהן, אחראית חווה', en: 'Rachel Cohen, farm keeper' },
    date: { he: 'שנה 3', en: 'Year 3' },
    body: {
      he: 'תפוחי אדמה, 4 שקים. שעועית, 2. עגבניות, קופסה אחת, שמורה למקרה חירום. טיפ: להשקות בלילה, כשהמנורות כבויות, ככה פחות מים מתאדים. ולדבר עם הצמחים. אני רצינית.',
      en: 'Potatoes, 4 sacks. Beans, 2. Tomatoes, one tin, kept for emergencies. Tip: water at night when the lamps are off, less water evaporates. And talk to the plants. I mean it.',
    },
    bonus: { type: 'farm', pct: 10 },
  },
  {
    id: 'flood', kind: 'log',
    title: { he: 'יומן השומר, יום 1,140', en: 'Warden\'s log, day 1,140' },
    author: { he: 'יוסי בן־עמי', en: 'Yossi Ben-Ami' },
    date: { he: 'שנה 3', en: 'Year 3' },
    body: {
      he: 'הנהר מעלינו שינה מסלול. המים פרצו לקומה 3 בלילה. הצלחנו להציל את הגנרטור על הבמה, אבל הסדנה והמחסן התחתון אבודים. נועה אוטמת את הצנרת. בלי משאבה שעובדת, B3 תישאר ביצה.',
      en: 'The river above us changed course. Water broke into level 3 at night. We saved the generator on its plinth, but the workshop and the lower store are lost. Noa is sealing the pipes. Without a working pump, B3 stays a swamp.',
    },
  },
  {
    id: 'signal', kind: 'tape',
    title: { he: 'קלטת: האות', en: 'Tape: the signal' },
    author: { he: 'עמית ורד, קשר', en: 'Amit Vered, radio operator' },
    date: { he: 'שנה 3', en: 'Year 3' },
    body: {
      he: '[צפצופים] "...שוב זה. אותו שידור, כל לילה ב־03:00. קול של אישה, מספרים, ואז מילה אחת: בראשית. נועה אומרת שזה לא מקליט ישן, זה משדר חי. מישהו שם בחוץ, ויש לו חשמל..."',
      en: '[beeps] "...there it is again. The same broadcast, every night at 03:00. A woman\'s voice, numbers, and then one word: Genesis. Noa says it\'s not an old recording, it\'s a live transmitter. Someone is out there, and they have power..."',
    },
    bonus: { type: 'radioTower', pct: 15 },
  },
  {
    id: 'vote', kind: 'log',
    title: { he: 'פרוטוקול ההצבעה', en: 'Minutes of the vote' },
    author: { he: 'מועצת בונקר 17', en: 'Bunker 17 council' },
    date: { he: 'שנה 4', en: 'Year 4' },
    body: {
      he: 'שאלה: האם לשלוח משלחת אל מקור האות "בראשית". בעד: 19. נגד: 17. נמנעים: 3. הוחלט: 12 מתנדבים ייצאו בעוד שבוע. השאר יחזיקו את הבונקר. נועה הצביעה נגד, ואז התנדבה ראשונה.',
      en: 'Question: whether to send an expedition to the source of the "Genesis" signal. For: 19. Against: 17. Abstained: 3. Decided: 12 volunteers leave in a week. The rest hold the bunker. Noa voted against, then volunteered first.',
    },
  },
  {
    id: 'goodbye', kind: 'letter',
    title: { he: 'מכתב שלא נשלח', en: 'An unsent letter' },
    author: { he: 'דוד, לבתו', en: 'David, to his daughter' },
    date: { he: 'שנה 4', en: 'Year 4' },
    body: {
      he: 'מאיה שלי. אני יוצא עם נועה. אם נמצא את בראשית, נחזור עם אור אמיתי, עם שמש. אם לא, תזכרי שהשמש עוד שם. היא רק מחכה לך. תשמרי על הציור שלך. אוהב, אבא.',
      en: 'My Maya. I am going with Noa. If we find Genesis, we will come back with real light, with sun. If not, remember the sun is still there. It is just waiting for you. Keep your drawing safe. Love, Dad.',
    },
  },
  {
    id: 'medicine', kind: 'note',
    title: { he: 'מדריך עזרה ראשונה בכתב יד', en: 'Handwritten first-aid guide' },
    author: { he: 'ד"ר עלי מנסור', en: 'Dr. Ali Mansour' },
    date: { he: 'שנה 2', en: 'Year 2' },
    body: {
      he: 'חום גבוה: לקרר, לא לחמם. פצע מזוהם: מים רתוחים ומלח, אין אנטיביוטיקה לבזבז. ואם מישהו לא אוכל שלושה ימים, זה לא הבטן. זה הלב. שבו איתו בערב.',
      en: 'High fever: cool, don\'t warm. Infected wound: boiled water and salt, no antibiotics to waste. And if someone hasn\'t eaten in three days, it isn\'t the stomach. It\'s the heart. Sit with them in the evening.',
    },
    bonus: { type: 'medbay', pct: 15 },
  },
  {
    id: 'sickness', kind: 'log',
    title: { he: 'יומן השומר, יום 1,610', en: 'Warden\'s log, day 1,610' },
    author: { he: 'יוסי בן־עמי', en: 'Yossi Ben-Ami' },
    date: { he: 'שנה 5', en: 'Year 5' },
    body: {
      he: 'המשלחת לא חזרה. ארבעה חודשים. השיעול התחיל אצל הזקנים ועבר לכולם. עלי עושה מה שהוא יכול. אני כותב את זה כדי שמישהו ידע: לא ויתרנו. פשוט נגמר לנו הזמן.',
      en: 'The expedition has not returned. Four months. The cough started with the elders and spread to everyone. Ali does what he can. I write this so someone knows: we did not give up. We simply ran out of time.',
    },
  },
  {
    id: 'photo41', kind: 'photo',
    title: { he: 'תמונה קבוצתית', en: 'Group photo' },
    author: { he: 'בונקר 17', en: 'Bunker 17' },
    date: { he: 'שנה 1, חנוכה', en: 'Year 1, Hanukkah' },
    body: {
      he: 'צילום דהוי: ארבעים ואחד אנשים צפופים בחדר האוכל, חנוכייה מאולתרת מצינורות, כולם מחייכים למצלמה. מאחור כתוב: "הלילה הראשון שלא פחדנו."',
      en: 'A faded photo: forty-one people crowded in the canteen, a menorah improvised from pipes, everyone smiling at the camera. On the back: "The first night we were not afraid."',
    },
  },
  {
    id: 'workshopNotes', kind: 'note',
    title: { he: 'מחברת הסדנה', en: 'Workshop notebook' },
    author: { he: 'בוריס', en: 'Boris' },
    date: { he: 'שנה 2', en: 'Year 2' },
    body: {
      he: 'כל דבר אפשר לפרק. צינור הוא מוט. מוט הוא בורג. בורג הוא כלי. אל תזרקו כלום, גם לא את מה שנראה כמו זבל. במיוחד לא את מה שנראה כמו זבל.',
      en: 'Everything can be taken apart. A pipe is a rod. A rod is a bolt. A bolt is a tool. Throw nothing away, not even what looks like junk. Especially not what looks like junk.',
    },
    bonus: { type: 'workshop', pct: 10 },
  },
  {
    id: 'lastTape', kind: 'tape',
    title: { he: 'קלטת אחרונה', en: 'The last tape' },
    author: { he: 'יוסי בן־עמי', en: 'Yossi Ben-Ami' },
    date: { he: 'שנה 5', en: 'Year 5' },
    body: {
      he: '"...נשארנו שלושה. מאיה, אני, ושקט. אנחנו יוצאים מחר בבוקר לכיוון צפון, בעקבות נועה. אני משאיר את הדלת סגורה אבל לא נעולה. מי שמוצא את זה: הבונקר שלכם עכשיו. תהיו טובים ממנו. תהיו טובים מאיתנו."',
      en: '"...three of us left. Maya, me, and silence. We leave tomorrow morning heading north, following Noa. I am leaving the door closed but not locked. Whoever finds this: the bunker is yours now. Be better than it. Be better than us."',
    },
  },
  {
    id: 'mapFragment', kind: 'note',
    title: { he: 'קרע של מפה', en: 'A map fragment' },
    author: { he: 'משלחת בראשית', en: 'The Genesis expedition' },
    date: { he: 'שנה 4', en: 'Year 4' },
    body: {
      he: 'פיסת מפה רטובה, עם קו בעיפרון שיוצא מבונקר 17 צפונה. ליד צלב קטן כתוב: "מצפה הכוכבים הישן. הכניסה מתחת לכיפה." ובשוליים: "אם נכשלנו, תמשיכו מכאן."',
      en: 'A damp scrap of map, a pencil line running north from Bunker 17. Beside a small cross: "The old observatory. The entrance is under the dome." In the margin: "If we failed, continue from here."',
    },
  },
  {
    id: 'reactorPlans', kind: 'note',
    title: { he: 'שרטוט של כור קטן', en: 'Blueprint of a small reactor' },
    author: { he: 'ד"ר נועה הלפרין', en: 'Dr. Noa Halperin' },
    date: { he: 'שנה 3', en: 'Year 3' },
    body: {
      he: 'שרטוטים מפורטים בעיפרון, עם הערות בשוליים: "מספיק להאיר עיר קטנה. צריך עוד שתי קומות עומק וגישה למי קירור. אולי בדור הבא." מתחת, בכתב אחר: "הדור הבא זה אתם."',
      en: 'Detailed pencil blueprints with notes in the margin: "Enough to light a small city. Needs two more levels of depth and access to cooling water. Maybe the next generation." Below, in another hand: "The next generation is you."',
    },
    bonus: { type: 'reactor', pct: 10 },
  },
  {
    id: 'genesisLetter', kind: 'letter',
    title: { he: 'מכתב מבראשית', en: 'A letter from Genesis' },
    author: { he: 'נועה', en: 'Noa' },
    date: { he: 'שנה 5', en: 'Year 5' },
    body: {
      he: 'מצאנו אותם. בראשית אמיתי: מעבדה עמוק מתחת למצפה, אנשים שמנסים לשלוח מסר אחורה בזמן, לפני האפר. הם צריכים איזוטופ, הרבה איזוטופ. אם הבונקר עוד עומד, תבנו. תגדלו. ויום אחד תשלחו את המסר בעצמכם.',
      en: 'We found them. Genesis is real: a lab deep under the observatory, people trying to send a message back in time, before the ashes. They need isotope, a lot of isotope. If the bunker still stands, build. Grow. And one day, send the message yourselves.',
    },
  },
];

export function getLore(id: string): LoreEntry | undefined {
  return LORE.find(l => l.id === id);
}

/** Total production bonus (as a fraction) from lore the player has found. */
export function loreBonus(found: string[] | undefined, type: BuildingType): number {
  if (!found?.length) return 0;
  let pct = 0;
  for (const id of found) {
    const e = getLore(id);
    if (e?.bonus?.type === type) pct += e.bonus.pct;
  }
  return pct / 100;
}

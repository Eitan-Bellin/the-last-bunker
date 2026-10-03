import type { GameState, ResourceType } from '../core/GameState';
import { hexDistance } from './surface';
import { hasFeature } from '../systems/ResearchSystem';
import { GENESIS_MIN_ERA, GENESIS_MIN_SURVIVORS } from '../systems/MetaSystem';

/**
 * The storyline (Sprint 6): chapters told by recurring characters, each unlocked by a milestone.
 * Choices leave flags (`choice:<chapter>:<key>`) that later chapters, events and systems read.
 */

export type CharacterId = 'ezra' | 'gideon' | 'noa' | 'maya' | 'crew';

export interface Character {
  id: CharacterId;
  /** Painted portrait file in art/portraits (crew uses one of the player's own survivors). */
  portrait: string | null;
  name: Record<'he' | 'en', string>;
  role: Record<'he' | 'en', string>;
  color: string;
}

export const CHARACTERS: Record<CharacterId, Character> = {
  ezra: {
    id: 'ezra', portrait: 'p09', color: '#7fd6ff',
    name: { he: 'עזרא', en: 'Ezra' }, role: { he: 'קשר, מקלט "המסוף"', en: 'Radio operator, Terminus shelter' },
  },
  gideon: {
    id: 'gideon', portrait: 'p13', color: '#ff9a5a',
    name: { he: 'גדעון', en: 'Gideon' }, role: { he: 'ראש שבט החלודה', en: 'Chief of the Rust Clan' },
  },
  noa: {
    id: 'noa', portrait: 'p14', color: '#c8a6ff',
    name: { he: 'ד"ר נועה הלפרין', en: 'Dr. Noa Halperin' }, role: { he: 'המהנדסת הראשית של בונקר 17', en: 'Bunker 17\'s chief engineer' },
  },
  maya: {
    id: 'maya', portrait: 'p07', color: '#ffd27a',
    name: { he: 'מאיה', en: 'Maya' }, role: { he: 'הילדה מהציור', en: 'The girl from the drawing' },
  },
  crew: {
    id: 'crew', portrait: null, color: '#9fe8a8',
    name: { he: 'ראש צוות החפירה', en: 'Dig crew chief' }, role: { he: 'מהאנשים שלכם', en: 'One of your people' },
  },
};

export interface StoryLine {
  who: CharacterId | 'narrator';
  text: Record<'he' | 'en', string>;
  /** Only spoken when this holds (S9: late chapters echo earlier choices, e.g. Gideon as ally or enemy). */
  when?: (s: GameState) => boolean;
}

export interface StoryEffect {
  gain?: Partial<Record<ResourceType, number>>;
  cost?: Partial<Record<ResourceType, number>>;
  morale?: number;
  /** How long the morale buff lasts, in play seconds (default 600). */
  moraleFor?: number;
  flags?: string[];
  /** A named survivor joins the bunker. */
  joins?: { name: string; portrait: string; stats: Partial<Record<'strength' | 'intelligence' | 'agility' | 'charisma' | 'endurance', number>>; traits: string[] };
  /** A group of unnamed newcomers joins, even past the bed count: they sleep in the corridors until new quarters are built. */
  group?: number;
  /** Adults who leave the bunker for good (singles first, never story characters or people on the surface). */
  leaves?: number;
  /** Adults who get hurt (sickness, a fight); never below 15 HP, so a story choice can't kill. */
  hurt?: { count: number; damage: number };
}

export interface StoryChoice {
  key: string;
  label: Record<'he' | 'en', string>;
  /** Only offered when this holds (choices that depend on earlier decisions). */
  when?: (s: GameState) => boolean;
  effect: StoryEffect;
  reply: StoryLine[];
  /** Optional chance-based alternative outcome (e.g. a fight). */
  check?: (s: GameState) => number;
  failReply?: StoryLine[];
  failEffect?: StoryEffect;
}

export interface Chapter {
  id: string;
  number: number;
  title: Record<'he' | 'en', string>;
  trigger: (s: GameState) => boolean;
  lines: StoryLine[];
  choices?: StoryChoice[];
  /** Applied when a chapter without choices ends. */
  effect?: StoryEffect;
}

const has = (s: GameState, f: string) => s.storyFlags.includes(f);
const built = (s: GameState, t: string) => s.buildings.some(b => b.type === t && !(b.isConstructing && b.level === 1));
const space = (s: GameState) => s.survivors.length < s.maxPopulation;

// Faction state read by the late chapters (S9), so earlier choices echo.
const gideonInside = (s: GameState) => has(s, 'gideon:joined');
/** The Clan owes the bunker: Gideon lives here, or their freezing people were taken in. */
const clanFriend = (s: GameState) => gideonInside(s) || has(s, 'clan:sheltered') || has(s, 'clan:children');
const clanFoe = (s: GameState) => !clanFriend(s);
const terminusAlly = (s: GameState) => has(s, 'terminus:ally');
const terminusSaved = (s: GameState) => has(s, 'terminus:merged') || has(s, 'terminus:saved');
const mayaHome = (s: GameState) => s.survivors.some(x => x.name === 'Maya' && !x.child);
/** An expedition has reached the outer rings of the map (distance 6+ from the bunker). */
const outerRing = (s: GameState) => s.explorationMap.some(h => h.explored && hexDistance(h.x, h.y) >= 6);
/** Genesis is ready: the same gate as the rebirth button (MetaSystem.rebirthRequirements). */
const genesisReady = (s: GameState) => hasFeature(s, 'genesis') && s.survivors.length >= GENESIS_MIN_SURVIVORS && (s.era ?? 0) >= GENESIS_MIN_ERA;

export const CHAPTERS: Chapter[] = [
  {
    id: 'static', number: 1,
    title: { he: 'קול ברעש הלבן', en: 'A Voice in the Static' },
    trigger: s => built(s, 'generator') && s.stats.totalPlayTime > 240,
    lines: [
      { who: 'narrator', text: { he: 'כשהגנרטור התעורר, גם מקלט הרדיו הישן שעל הקיר נדלק. רעש לבן. ואז קול.', en: 'When the generator woke, the old radio on the wall woke with it. White noise. Then a voice.' } },
      { who: 'ezra', text: { he: '...בונקר 17? אם מישהו שומע: הסורק שלנו קלט חום אצלכם בפעם הראשונה מזה שנתיים. כאן עזרא, ממקלט "המסוף" בתחנת הרכבת התחתית הישנה.', en: '...Bunker 17? If anyone hears this: our scope just picked up heat from you for the first time in two years. This is Ezra, from the Terminus shelter in the old subway station.' } },
      { who: 'ezra', text: { he: 'המכשיר שלכם רק קולט. אם תבנו מגדל רדיו, נוכל לדבר באמת. אני אחכה. אנחנו טובים בלחכות.', en: 'Your set can only listen. Build a radio tower and we can really talk. I\'ll wait. We\'re good at waiting.' } },
    ],
    effect: { gain: { knowledge: 15 } },
  },
  {
    id: 'terminus', number: 2,
    title: { he: 'המסוף', en: 'Terminus' },
    trigger: s => has(s, 'story:static') && built(s, 'radioTower'),
    lines: [
      { who: 'ezra', text: { he: 'עכשיו אני שומע אתכם! ברוכים הבאים לעולם, בונקר 17. אנחנו שלושים ושניים איש מתחת לרציף 4. יש לנו מים ופטריות, ואין לנו כמעט שום דבר אחר.', en: 'Now I can hear you! Welcome to the world, Bunker 17. We are thirty-two people under platform 4. We have water and mushrooms, and almost nothing else.' } },
      { who: 'ezra', text: { he: 'אני מציע ברית: נחלוק ידע ותוכניות, ונשלח אליכם את מי שמחפש בית. אבל אם תגלו לנו איפה אתם, גם אחרים עלולים לשמוע.', en: 'I propose an alliance: we share knowledge and plans, and send you whoever is looking for a home. But if you tell us where you are, others might hear too.' } },
    ],
    choices: [
      {
        key: 'ally', label: { he: 'לשתף את המיקום ולכרות ברית', en: 'Share our location and ally' },
        effect: { gain: { blueprints: 1, knowledge: 25 }, flags: ['terminus:ally'] },
        reply: [{ who: 'ezra', text: { he: 'מעולה. שולח לכם שרטוטים של מסנן מים. ואל תדאגו מגדעון. טוב, תדאגו קצת.', en: 'Great. Sending you water filter blueprints. And don\'t worry about Gideon. Well, worry a little.' } }],
      },
      {
        key: 'hidden', label: { he: 'להישאר בצל', en: 'Stay hidden' },
        effect: { morale: 6, flags: ['terminus:hidden'] },
        reply: [{ who: 'ezra', text: { he: 'מבין. זהירות היא מה שהשאיר את כולנו בחיים. התדר פתוח אם תשנו את דעתכם.', en: 'I understand. Caution is what kept all of us alive. The channel stays open if you change your mind.' } }],
      },
    ],
  },
  {
    id: 'toll', number: 3,
    title: { he: 'המכס', en: 'The Toll' },
    trigger: s => s.stats.totalPlayTime > 1800 && s.survivors.length >= 6 && has(s, 'story:static'),
    lines: [
      { who: 'narrator', text: { he: 'מצלמת הכניסה מראה שישה אנשים בבגדי עור מטולאים. האחד בקדמה, עם זקן אדום, מקיש על הדלת בקת של רובה.', en: 'The entrance camera shows six people in patched leather. The one in front, with a red beard, taps on the door with a rifle butt.' } },
      { who: 'gideon', text: { he: 'ערב טוב, שכנים! אני גדעון, וכל מה שבין הנהר להרים שייך לשבט החלודה. כולל האוויר שאתם נושמים כשאתם יוצאים לחטט.', en: 'Evening, neighbors! I\'m Gideon, and everything between the river and the hills belongs to the Rust Clan. Including the air you breathe when you go out scavenging.' } },
      { who: 'gideon', text: { he: 'מכס קטן, ואף אחד לא נפגע. שישים מנות אוכל. אז מה יהיה?', en: 'A small toll and nobody gets hurt. Sixty rations of food. So what will it be?' } },
    ],
    choices: [
      {
        key: 'pay', label: { he: 'לשלם את המכס', en: 'Pay the toll' },
        effect: { cost: { food: 60 }, flags: ['gideon:paid'] },
        reply: [{ who: 'gideon', text: { he: 'אנשים נבונים! השבט זוכר חברים. אולי ניפגש שוב, בתנאים טובים יותר.', en: 'Sensible folk! The Clan remembers its friends. Maybe we\'ll meet again, on better terms.' } }],
      },
      {
        key: 'refuse', label: { he: 'לסרב ולנעול את הדלת', en: 'Refuse and bolt the door' },
        effect: { morale: 10, flags: ['gideon:enemy'] },
        reply: [{ who: 'gideon', text: { he: 'אמיצים. או טיפשים. בחוץ זה בדרך כלל אותו דבר. נתראה, בונקר 17.', en: 'Brave. Or stupid. Out here it\'s usually the same thing. See you around, Bunker 17.' } }],
      },
    ],
  },
  {
    id: 'maya', number: 4,
    title: { he: 'הילדה מהציור', en: 'The Girl from the Drawing' },
    trigger: s => (s.era ?? 0) >= 1 && s.stats.totalPlayTime > 2700 && space(s) && (s.lore ?? []).length >= 5,
    lines: [
      { who: 'narrator', text: { he: 'מישהי דופקת על הדלת. שלוש דפיקות, הפסקה, ועוד שתיים. כמו מי שיודעת שזה הקוד.', en: 'Someone knocks. Three knocks, a pause, then two more. Like someone who knows it\'s the code.' } },
      { who: 'maya', text: { he: 'זה עדיין בונקר 17? ...אני מאיה. גרתי כאן. יוסי ואני יצאנו צפונה אחרי נועה, אבל יוסי לא הגיע. חזרתי לבד.', en: 'Is this still Bunker 17? ...I\'m Maya. I lived here. Yossi and I went north after Noa, but Yossi didn\'t make it. I came back alone.' } },
      { who: 'maya', text: { he: 'אמא תמיד אמרה שהשמש מחכה לנו. אני חושבת שהיא חיכתה לכם. אפשר להישאר?', en: 'Mom always said the sun was waiting for us. I think it was waiting for you. Can I stay?' } },
    ],
    effect: {
      morale: 8,
      joins: { name: 'Maya', portrait: 'p07', stats: { intelligence: 9, agility: 8, charisma: 7 }, traits: ['optimist'] },
    },
  },
  {
    id: 'deep', number: 5,
    title: { he: 'משהו מתחת', en: 'Something Below' },
    trigger: s => s.currentFloors >= 5 || ((s.era ?? 0) >= 2 && s.currentFloors >= 4),
    lines: [
      { who: 'crew', text: { he: 'תקשיבו לזה. כשאנחנו מכים בקיר המערבי, הוא מצלצל. כמו פעמון. יש שם חלל, גדול.', en: 'Listen to this. When we hit the west wall it rings. Like a bell. There\'s a hollow back there, a big one.' } },
      { who: 'crew', text: { he: 'ובלילה יש רוח שעולה מהסדקים. רוח, מתחת לאדמה. אם נחפור לצדדים ולא רק למטה, אולי נמצא עוד מקום לגור בו.', en: 'And at night there\'s wind coming through the cracks. Wind, underground. If we dig sideways instead of only down, we might find more room to live.' } },
    ],
    effect: { gain: { knowledge: 30 }, flags: ['districts:unlocked'] },
  },
  {
    id: 'clan', number: 6,
    title: { he: 'שבט החלודה', en: 'The Rust Clan' },
    trigger: s => has(s, 'story:toll') && s.stats.totalPlayTime > 5400 && s.buildings.length >= 10,
    lines: [
      { who: 'gideon', text: { he: 'בונקר 17! זוכרים אותי? החורף היה קשה לשבט. אני כאן כדי לדבר על העתיד שלנו. ביחד, או אחד במקום השני.', en: 'Bunker 17! Remember me? Winter was hard on the Clan. I\'m here to talk about our future. Together, or one instead of the other.' } },
    ],
    choices: [
      {
        key: 'welcome', label: { he: 'להציע לו מקום אצלנו', en: 'Offer him a place with us' },
        effect: { cost: { food: 40 }, morale: 4, flags: ['gideon:joined'], joins: { name: 'Gideon', portrait: 'p13', stats: { strength: 11, endurance: 10, charisma: 6 }, traits: ['tough'] } },
        reply: [{ who: 'gideon', text: { he: 'מקום... אצלכם? אף אחד לא הציע לי מקום כבר עשר שנים. בסדר. השבט יכול להסתדר בלעדיי. אני אשמור על הדלת שלכם.', en: 'A place... with you? Nobody\'s offered me a place in ten years. All right. The Clan can manage without me. I\'ll guard your door.' } }],
      },
      {
        key: 'fight', label: { he: 'לגרש אותם בכוח', en: 'Drive them off by force' },
        effect: { gain: { scrap: 80, materials: 60 }, morale: 10, flags: ['gideon:beaten'] },
        check: s => Math.min(0.9, 0.35 + s.buildings.filter(b => b.type === 'armory').length * 0.2 + s.survivors.length * 0.01),
        reply: [{ who: 'narrator', text: { he: 'ההגנה החזיקה. השבט נסוג ומשאיר מאחור ציוד ועגלה מלאה גרוטאות. גדעון צועק משהו מרחוק, אבל לא חוזר.', en: 'The defenses held. The Clan pulls back, leaving gear and a cart full of scrap. Gideon shouts something from afar, but doesn\'t come back.' } }],
        failEffect: { cost: { materials: 80, food: 40 }, morale: -8, flags: ['gideon:won'] },
        failReply: [{ who: 'gideon', text: { he: 'לא רע בכלל, בונקר 17. אבל לא מספיק. ניקח את מה שמגיע לנו ונלך. בפעם הבאה, תחשבו על ההצעה.', en: 'Not bad at all, Bunker 17. But not enough. We\'ll take what we\'re owed and go. Next time, think about the offer.' } }],
      },
    ],
  },
  {
    id: 'genesis', number: 7,
    title: { he: 'בראשית', en: 'Genesis' },
    // Era 3 also brings Noa's call, so a bunker that never built a radio tower still meets her before the late chapters.
    trigger: s => has(s, 'vaultFound') || ((has(s, 'story:terminus') || (s.era ?? 0) >= 3) && s.stats.totalPlayTime > 7200 && (s.era ?? 0) >= 2),
    lines: [
      { who: 'ezra', text: { he: 'בונקר 17, יש לי מישהי על הקו. היא ביקשה אתכם בשם. היא אומרת שהיא בנתה את הגנרטור שלכם.', en: 'Bunker 17, I\'ve got someone on the line. She asked for you by name. She says she built your generator.' } },
      { who: 'noa', text: { he: 'כאן נועה הלפרין. אני... לא האמנתי שמישהו יחזיר את האורות שם. אנחנו חיים, שמונה מאיתנו, במעבדת בראשית מתחת למצפה הכוכבים.', en: 'This is Noa Halperin. I... never believed anyone would bring the lights back there. We are alive, eight of us, in the Genesis lab under the observatory.' } },
      { who: 'noa', text: { he: 'בראשית יכולה לשלוח הודעה אחורה בזמן, לפני האפר. היא צריכה איזוטופ-7, יותר ממה שבונקר אחד יכול לייצר בחיים אחדים. אבל אם תתחילו מחדש, שוב ושוב, ותזכרו...', en: 'Genesis can send a message back in time, before the ashes. It needs isotope-7, more than one bunker can make in one lifetime. But if you start over, again and again, and remember...' } },
      { who: 'noa', text: { he: 'תבנו. תגדלו. וכשתהיו מוכנים, תשלחו את ההודעה בעצמכם. אני שולחת לכם את השרטוטים.', en: 'Build. Grow. And when you are ready, send the message yourselves. I\'m sending you the blueprints.' } },
    ],
    effect: { gain: { blueprints: 2, knowledge: 60 }, flags: ['genesis:known'] },
  },

  // ── S9: the mid and late game, up to the first rebirth ──────────────────────────────────────────
  // The tension cycle of the plan: hard choices between people and supplies, the three factions
  // (the Rust Clan, Terminus, Noa's Genesis lab) coming back with what the player chose before.
  {
    id: 'winter', number: 8,
    title: { he: 'החורף הארוך', en: 'The Long Winter' },
    trigger: s => s.survivors.length >= 30 && has(s, 'story:toll'),
    lines: [
      { who: 'narrator', text: { he: 'שלג אפור יורד כבר שבוע. במצלמת הכניסה נראית שיירה קטנה: אנשים עטופים בשמיכות, ילדים על הכתפיים, עגלה בלי סוס.', en: 'Grey snow has been falling for a week. The entrance camera shows a small column: people wrapped in blankets, children on shoulders, a cart with no horse.' } },
      { who: 'gideon', when: gideonInside, text: { he: 'אלה האנשים שלי. מה שנשאר משבט החלודה. המחנה ליד הנהר קפא, והם הלכו שלושה ימים כדי להגיע לדלת שלנו.', en: 'Those are my people. What\'s left of the Rust Clan. The camp by the river froze, and they walked three days to reach our door.' } },
      { who: 'gideon', when: s => !gideonInside(s) && has(s, 'gideon:paid'), text: { he: 'שכנים. פעם ביקשתי מכם מכס, ושילמתם בלי לירות. אז אני מקווה שתקשיבו גם עכשיו. המחנה שלנו קפא.', en: 'Neighbors. Once I asked you for a toll, and you paid without a shot fired. So I hope you\'ll listen now too. Our camp froze.' } },
      { who: 'gideon', when: s => !gideonInside(s) && !has(s, 'gideon:paid'), text: { he: 'אני יודע. בפעם הקודמת באתי עם רובים. היום אני בא עם ילדים. המחנה שלנו קפא, ואין לנו לאן ללכת.', en: 'I know. Last time I came with rifles. Today I come with children. Our camp froze, and we have nowhere else to go.' } },
      { who: 'gideon', text: { he: 'שמונה אנשים. הם יאכלו, הם יישנו במסדרונות, הם יריבו על השמיכות. אבל הם יודעים לעבוד קשה. מה אתם אומרים?', en: 'Eight people. They\'ll eat, they\'ll sleep in the corridors, they\'ll fight over blankets. But they know how to work hard. What do you say?' } },
    ],
    choices: [
      {
        key: 'all', label: { he: 'לפתוח את הדלת לכל השמונה', en: 'Open the door to all eight' },
        effect: { cost: { food: 120 }, group: 8, flags: ['clan:sheltered'] },
        reply: [
          { who: 'gideon', text: { he: 'תודה. אני לא טוב עם המילה הזאת, אז אגיד אותה פעם אחת: תודה.', en: 'Thank you. I\'m no good with that word, so I\'ll say it once: thank you.' } },
          { who: 'narrator', text: { he: 'הלילה ישנים גם במסדרונות. צריך עוד מגורים, ומהר.', en: 'Tonight people sleep in the corridors too. We need more quarters, and fast.' } },
        ],
      },
      {
        key: 'young', label: { he: 'לקבל רק את הצעירים והחולים', en: 'Take in only the young and the sick' },
        effect: { cost: { food: 40 }, group: 3, morale: -4, flags: ['clan:children'] },
        reply: [{ who: 'gideon', text: { he: 'שלושה מתוך שמונה. זה יותר ממה שהעולם נתן לנו בזמן האחרון. השאר יסתדרו. איכשהו.', en: 'Three out of eight. That\'s more than the world has given us lately. The rest will manage. Somehow.' } }],
      },
      {
        key: 'supplies', label: { he: 'לתת להם ציוד ולשלוח אותם הלאה', en: 'Give them supplies and send them on' },
        effect: { cost: { food: 100, water: 80 }, morale: -6, flags: ['clan:turned'] },
        reply: [{ who: 'gideon', text: { he: 'אוכל לדרך. זה לא בית, אבל זה גם לא כלום. רק אל תצפו שהם ישכחו את הדלת הזאת.', en: 'Food for the road. It\'s not a home, but it\'s not nothing. Just don\'t expect them to forget this door.' } }],
      },
    ],
  },
  {
    id: 'platform', number: 9,
    title: { he: 'רציף 4', en: 'Platform 4' },
    trigger: s => (s.era ?? 0) >= 3 && has(s, 'story:static'),
    lines: [
      { who: 'ezra', when: terminusAlly, text: { he: 'בונקר 17! המנהרה שלכם פרצה הלילה לקו שלנו. שמעתי את המקדחות שלכם מרציף 4, כמו שכנים שמזיזים רהיטים.', en: 'Bunker 17! Your tunnel broke into our line last night. I heard your drills from platform 4, like neighbors moving furniture.' } },
      { who: 'ezra', when: s => !terminusAlly(s), text: { he: 'בונקר 17. אף פעם לא אמרתם לנו איפה אתם. אבל הלילה המקדחות שלכם פרצו לתוך המנהרה שלנו, אז עכשיו אנחנו יודעים.', en: 'Bunker 17. You never told us where you were. But last night your drills broke into our tunnel, so now we know.' } },
      { who: 'ezra', text: { he: 'ויש לי בקשה. הנהר עולה לתוך התחנה. בעוד חודש המסוף יהיה מתחת למים, ואין לנו לאן ללכת.', en: 'And I have a request. The river is rising into the station. In a month Terminus will be under water, and we have nowhere to go.' } },
      { who: 'crew', text: { he: 'הם מכירים את המנהרות יותר טוב מכולם. אבל עוד אנשים זה עוד פיות להאכיל, ואנחנו כבר צפופים.', en: 'They know the tunnels better than anyone. But more people means more mouths, and we\'re already crowded.' } },
    ],
    choices: [
      {
        key: 'merge', label: { he: 'להביא את אנשי המסוף לעיר', en: 'Bring Terminus into the city' },
        effect: { cost: { food: 80 }, gain: { knowledge: 150 }, group: 8, flags: ['terminus:merged'] },
        reply: [{ who: 'ezra', text: { he: 'שמונה מאיתנו יבואו הלילה, עם הארכיון. האחרים ילכו למקלט האחות שלנו במורד הנהר. בונקר 17... תודה על האור.', en: 'Eight of us will come tonight, with the archive. The others go to our sister shelter downriver. Bunker 17... thank you for the light.' } }],
      },
      {
        key: 'pumps', label: { he: 'לשלוח משאבות ומהנדסים להציל את התחנה', en: 'Send pumps and engineers to save the station' },
        effect: { cost: { materials: 300, scrap: 60 }, gain: { blueprints: 2 }, morale: 6, flags: ['terminus:saved'] },
        reply: [{ who: 'ezra', text: { he: 'התחנה יבשה! הילדים רצים על הרציף בפעם הראשונה מזה חודש. המסוף לא ישכח את זה. הנה כל השרטוטים שיש לנו.', en: 'The station is dry! The kids are running on the platform for the first time in a month. Terminus won\'t forget this. Here are all the blueprints we have.' } }],
      },
      {
        key: 'seal', label: { he: 'לאטום את המנהרה', en: 'Seal the tunnel' },
        effect: { gain: { materials: 120 }, morale: -6, flags: ['terminus:sealed'] },
        reply: [
          { who: 'narrator', text: { he: 'הצוות מפרק את תמוכות הפלדה של המנהרה ואוטם אותה בבטון.', en: 'The crew strips the tunnel\'s steel supports and seals it with concrete.' } },
          { who: 'ezra', text: { he: 'מבין. כל אחד שומר על שלו. ...אם מישהו מאיתנו יגיע פעם לדלת שלכם, לפחות תפתחו לו.', en: 'I understand. Everyone guards their own. ...If one of us ever reaches your door, at least open it.' } },
        ],
      },
    ],
  },
  {
    id: 'fever', number: 10,
    title: { he: 'קדחת האפר', en: 'Ash Fever' },
    trigger: s => s.survivors.length >= 40 && has(s, 'story:genesis'),
    lines: [
      { who: 'narrator', text: { he: 'זה התחיל בשיעול בחדר האוכל. אחרי יומיים, תשעה אנשים בוערים מחום, ובמרפאה אין יותר מיטות.', en: 'It started with a cough in the canteen. Two days later nine people are burning with fever, and the medbay has no beds left.' } },
      { who: 'crew', when: s => has(s, 'clan:sheltered') || has(s, 'clan:children'), text: { he: 'זה התחיל במסדרון שבו ישנים אנשי השבט. אנשים כבר מתחילים ללחוש עליהם.', en: 'It started in the corridor where the Clan\'s people sleep. People are already whispering about them.' } },
      { who: 'noa', text: { he: 'ראיתי את זה פעם, במעבדה. קדחת האפר. יש לי נסיוב, אבל כדי לייצר עוד אני צריכה ידיים. שלחו לי מישהו מכם, חזק ושקט, לעבוד איתי.', en: 'I\'ve seen this before, in the lab. Ash fever. I have a serum, but to make more I need hands. Send me one of your people, strong and quiet, to work with me.' } },
      { who: 'noa', text: { he: 'אני לא אשקר לכם: הדרך ארוכה, ומי שיבוא לא יחזור בקרוב.', en: 'I won\'t lie to you: the road is long, and whoever comes won\'t be back soon.' } },
    ],
    choices: [
      {
        key: 'quarantine', label: { he: 'לסגור אגף ולהשתמש בתרופות שלנו', en: 'Close off a wing and use our own medicine' },
        effect: { cost: { medicine: 20, water: 80 }, morale: -4 },
        reply: [{ who: 'crew', text: { he: 'אטמנו את האגף והרתחנו כל סדין. זה לקח את רוב התרופות שלנו, אבל הקדחת נעצרה בדלת.', en: 'We sealed the wing and boiled every sheet. It took most of our medicine, but the fever stopped at the door.' } }],
      },
      {
        key: 'serum', label: { he: 'לשלוח מתנדב לנועה', en: 'Send a volunteer to Noa' },
        effect: { leaves: 1, gain: { medicine: 50 }, morale: 6, flags: ['noa:volunteer'] },
        reply: [{ who: 'noa', text: { he: 'מישהו מכם כבר בדרך אליי. הנסיוב יוצא אליכם הלילה. תודה, בונקר 17.', en: 'One of yours is already on the way. The serum leaves for you tonight. Thank you, Bunker 17.' } }],
      },
      {
        key: 'endure', label: { he: 'לחכות שזה יעבור', en: 'Wait for it to pass' },
        effect: { hurt: { count: 8, damage: 40 }, morale: -8, moraleFor: 1200 },
        reply: [{ who: 'narrator', text: { he: 'הקדחת נשברת אחרי שבוע. כולם שרדו, בקושי. אף אחד לא ישכח את השבוע הזה.', en: 'The fever breaks after a week. Everyone made it, barely. Nobody will forget that week.' } }],
      },
    ],
  },
  {
    id: 'trail', number: 11,
    title: { he: 'השביל של יוסי', en: 'Yossi\'s Trail' },
    // After Maya told her story (or once the bunker is well settled), so Yossi's name means something.
    trigger: s => outerRing(s) && (has(s, 'story:maya') || (s.era ?? 0) >= 2),
    lines: [
      { who: 'crew', text: { he: 'הצוות שלנו הגיע לקצה המפה, מעבר לכביש המת. מצאנו שם מחנה ישן: אוהל, מדורה קרה, ותיק.', en: 'Our team reached the edge of the map, past the dead highway. We found an old camp there: a tent, a cold fire, and a backpack.' } },
      { who: 'crew', text: { he: 'בתיק הייתה מחברת. על הכריכה כתוב "יוסי".', en: 'There was a notebook in the backpack. The cover says "Yossi".' } },
      { who: 'maya', when: mayaHome, text: { he: 'זה כתב היד שלו. הוא צייר את כל הדרך למצפה הכוכבים. הוא היה כל כך קרוב...', en: 'That\'s his handwriting. He drew the whole way to the observatory. He was so close...' } },
      { who: 'narrator', text: { he: 'בעמוד האחרון יש סימון ליד משאית צבאית הפוכה: "תאי איזוטופ. עדיין חמים. כבד מדי לסחוב לבד."', en: 'The last page marks an overturned army truck nearby: "Isotope cells. Still warm. Too heavy to carry alone."' } },
    ],
    choices: [
      {
        key: 'cells', label: { he: 'לחלץ את תאי האיזוטופ', en: 'Recover the isotope cells' },
        // Geiger counters and a medbay make the hot work survivable.
        check: s => Math.min(0.9, 0.45 + (hasFeature(s, 'geiger') ? 0.25 : 0) + (built(s, 'medbay') ? 0.1 : 0)),
        effect: { gain: { isotope7: 20, scrap: 80 }, flags: ['trail:cells'] },
        reply: [{ who: 'crew', text: { he: 'הוצאנו אותם. מונה הגייגר צורח, אבל התאים שלמים. איזוטופ-7 נשמר גם אחרי בראשית. נועה תרצה לראות את זה.', en: 'We got them out. The Geiger counter is screaming, but the cells are whole. Isotope-7 survives even Genesis. Noa will want to see this.' } }],
        failEffect: { gain: { scrap: 30 }, hurt: { count: 3, damage: 45 }, morale: -6, flags: ['trail:burned'] },
        failReply: [{ who: 'narrator', text: { he: 'הקרינה הייתה חזקה מדי. שלושה מהצוות חוזרים חולים, והתאים נשארים במשאית.', en: 'The radiation was too strong. Three of the team come back sick, and the cells stay in the truck.' } }],
      },
      {
        key: 'home', label: { he: 'להביא את יוסי הביתה', en: 'Bring Yossi home' },
        effect: { gain: { knowledge: 80 }, morale: 12, moraleFor: 1800, flags: ['maya:peace'] },
        reply: [
          { who: 'narrator', text: { he: 'קוברים את יוסי בגינה, מתחת למנורת הצמיחה. מישהו שותל לידו פרח.', en: 'They bury Yossi in the garden, under the grow lamp. Someone plants a flower next to him.' } },
          { who: 'maya', when: mayaHome, text: { he: 'תודה. עכשיו הוא בבית, כמו שהוא תמיד רצה.', en: 'Thank you. Now he\'s home, like he always wanted.' } },
        ],
      },
    ],
  },
  {
    id: 'gate', number: 12,
    title: { he: 'השער', en: 'The Gate' },
    trigger: s => s.survivors.length >= 50 && has(s, 'story:toll'),
    lines: [
      { who: 'narrator', when: clanFriend, text: { he: 'חמישים אנשים חיים עכשיו מתחת לאדמה. בחוץ, ליד הדלת, מחכים עשרה אנשים משבט החלודה. הם באו בלי נשק.', en: 'Fifty people now live underground. Outside, by the door, ten people of the Rust Clan are waiting. They came unarmed.' } },
      { who: 'gideon', when: clanFriend, text: { he: 'השבט החליט. אנחנו לא רוצים לקחת יותר. אנחנו רוצים לשמור. תנו לנו לשמור על הדרכים שלכם, ואף שודד לא יתקרב לדלת הזאת.', en: 'The Clan has decided. We don\'t want to take anymore. We want to guard. Let us watch your roads, and no raider will come near this door.' } },
      { who: 'narrator', when: clanFoe, text: { he: 'חמישים אנשים חיים עכשיו מתחת לאדמה, והאורות שלכם נראים מקילומטרים. בבוקר, משאית משוריינת עוצרת מול הדלת. כל שבט החלודה עומד מאחוריה.', en: 'Fifty people now live underground, and your lights can be seen for miles. In the morning an armored truck stops at the door. The whole Rust Clan stands behind it.' } },
      { who: 'gideon', when: clanFoe, text: { he: 'חמישים פיות, בונקר 17. אתם המקום הכי עשיר שנשאר בעולם. אז זה המכס האחרון: חצי ממה שיש לכם, ואנחנו נעלמים לתמיד.', en: 'Fifty mouths, Bunker 17. You\'re the richest place left in the world. So this is the last toll: half of what you have, and we disappear for good.' } },
    ],
    choices: [
      {
        key: 'wardens', when: clanFriend, label: { he: 'למנות אותם לשומרי הדרכים', en: 'Make them the road wardens' },
        effect: { cost: { food: 120 }, gain: { scrap: 100, materials: 150 }, morale: 8, moraleFor: 1800, flags: ['clan:wardens'] },
        reply: [{ who: 'gideon', text: { he: 'שומרי הדרכים. טוב, זה נשמע יותר טוב מ"שודדים". נתחיל הלילה.', en: 'Road Wardens. Well, it sounds better than "raiders". We start tonight.' } }],
      },
      {
        key: 'united', when: clanFriend, label: { he: 'להכניס את כולם פנימה', en: 'Bring them all inside' },
        effect: { cost: { food: 80 }, group: 6, flags: ['clan:united'] },
        reply: [{ who: 'gideon', text: { he: 'כל השבט מתחת לגג אחד. אבא שלי לא היה מאמין.', en: 'The whole Clan under one roof. My father wouldn\'t have believed it.' } }],
      },
      {
        key: 'fight', when: clanFoe, label: { he: 'להגן על הדלת', en: 'Defend the door' },
        check: s => Math.min(0.9, 0.3 + s.buildings.filter(b => b.type === 'armory').length * 0.15 + s.survivors.length * 0.006
          + (hasFeature(s, 'fortifiedDoor') ? 0.1 : 0)),
        effect: { gain: { scrap: 150, materials: 120 }, morale: 12, moraleFor: 1800, flags: ['clan:broken'] },
        reply: [{ who: 'narrator', text: { he: 'המשאית נסוגה עם צמיג בוער. גדעון מרים יד מרחוק, והפעם הוא לא צועק. השבט לא יחזור.', en: 'The truck pulls back with a burning tire. Gideon raises a hand from afar, and this time he doesn\'t shout. The Clan won\'t be back.' } }],
        failEffect: { cost: { materials: 200, food: 120 }, hurt: { count: 4, damage: 35 }, morale: -10, flags: ['clan:raided'] },
        failReply: [{ who: 'gideon', text: { he: 'כמעט, בונקר 17. כמעט. ניקח את המכס בעצמנו.', en: 'Almost, Bunker 17. Almost. We\'ll collect the toll ourselves.' } }],
      },
      {
        key: 'pay', when: clanFoe, label: { he: 'לשלם את המכס האחרון', en: 'Pay the last toll' },
        effect: { cost: { food: 150, materials: 200 }, flags: ['clan:tribute'] },
        reply: [{ who: 'gideon', text: { he: 'מילה זה מילה. לא תראו אותנו יותר.', en: 'A deal is a deal. You won\'t see us again.' } }],
      },
      {
        key: 'peace', when: clanFoe, label: { he: 'להציע להם מקום אצלנו', en: 'Offer them a place with us' },
        effect: { cost: { food: 100 }, group: 4, flags: ['clan:peace'] },
        reply: [{ who: 'gideon', text: { he: 'מקום? ...אחרי כל מה שהיה? טוב. ארבעה מאיתנו יישארו, השאר ילכו דרומה. אולי ככה זה נגמר: לא במלחמה.', en: 'A place? ...After everything? All right. Four of us will stay, the rest go south. Maybe this is how it ends: not with a war.' } }],
      },
    ],
  },
  {
    id: 'decision', number: 13,
    title: { he: 'ההחלטה הגדולה', en: 'The Big Decision' },
    trigger: genesisReady,
    lines: [
      { who: 'noa', text: { he: 'בונקר 17, המכונה חמה. בראשית מוכנה.', en: 'Bunker 17, the machine is warm. Genesis is ready.' } },
      { who: 'noa', text: { he: 'כשתלחצו, כל מה שבניתם ייעלם: האולמות, החוות, הפנים. תתעוררו שוב בחדר החשוך ההוא. אבל תזכרו. ובכל פעם תחזרו חזקים יותר.', en: 'When you press it, everything you built will be gone: the halls, the farms, the faces. You\'ll wake up in that dark room again. But you will remember. And every time, you\'ll come back stronger.' } },
      { who: 'noa', when: s => s.prestige.rebirthCount > 0, text: { he: 'כבר עשיתם את זה פעם, נכון? אני שומעת את זה בקול שלכם. הפעם הגעתם מהר יותר.', en: 'You\'ve done this before, haven\'t you? I can hear it in your voice. You got here faster this time.' } },
      { who: 'noa', when: s => has(s, 'noa:volunteer'), text: { he: 'מי ששלחתם אליי עומד כאן לידי, ושולח לכם דרישת שלום.', en: 'The one you sent me is standing right here, and sends you their love.' } },
      { who: 'ezra', when: terminusSaved, text: { he: 'מה שלא תבחרו, המסוף איתכם. אנחנו חייבים לכם תחנה שלמה.', en: 'Whatever you choose, Terminus is with you. We owe you a whole station.' } },
      { who: 'gideon', when: s => gideonInside(s) || has(s, 'clan:wardens') || has(s, 'clan:united') || has(s, 'clan:peace'), text: { he: 'עשר שנים לקחתי מאנשים. אתם נתתם לי משהו להפסיד. אל תבזבזו את זה.', en: 'For ten years I took from people. You gave me something to lose. Don\'t waste it.' } },
      { who: 'maya', when: mayaHome, text: { he: 'אמא אמרה שהשמש מחכה לנו. אולי היא מחכה גם לנו של הפעם הבאה.', en: 'Mom said the sun was waiting for us. Maybe it\'s waiting for the next us, too.' } },
      { who: 'narrator', text: { he: 'פרויקט בראשית מחכה בתפריט, בלשונית "בראשית". מתי ללחוץ, זה כבר בידיים שלכם.', en: 'Project Genesis waits in the menu, under the Genesis tab. When to press it is up to you.' } },
    ],
    choices: [
      {
        key: 'truth', label: { he: 'לספר לכולם את האמת', en: 'Tell everyone the truth' },
        effect: { morale: 15, moraleFor: 3600, flags: ['genesis:truth'] },
        reply: [{ who: 'crew', text: { he: 'אספנו את כולם בחדר האוכל. היה שקט ארוך. ואז מישהו צחק, ומישהו אחר בכה. ואז כולם חזרו לעבודה, חזק יותר מאי פעם.', en: 'We gathered everyone in the canteen. There was a long silence. Then someone laughed, and someone else cried. Then everyone went back to work, harder than ever.' } }],
      },
      {
        key: 'fuel', label: { he: 'להזין את הליבה בכל מה שאפשר', en: 'Feed the core everything we can spare' },
        effect: { cost: { scrap: 150, knowledge: 300 }, gain: { isotope7: 25 }, flags: ['genesis:fueled'] },
        reply: [{ who: 'noa', text: { he: 'האות יהיה חזק יותר, וגם ההתחלה הבאה שלכם. איזוטופ-7 שומר את מה שהזמן מוחק.', en: 'The signal will be stronger, and so will your next beginning. Isotope-7 keeps what time erases.' } }],
      },
      {
        key: 'wait', label: { he: 'לא עכשיו. יש לנו עוד חיים לחיות כאן', en: 'Not yet. We still have a life to live here' },
        effect: { morale: 8, moraleFor: 1200, flags: ['genesis:wait'] },
        reply: [{ who: 'noa', text: { he: 'המכונה תחכה. גם אני.', en: 'The machine will wait. So will I.' } }],
      },
    ],
  },
];

/**
 * Lines and choices with a `when` depend on the live game (S9). StorySystem binds the state here,
 * so the dialog and the journal replay show exactly the variant that fits this bunker.
 */
let liveState: (() => GameState) | null = null;

export function bindStoryState(get: () => GameState): void {
  liveState = get;
}

export function shownLines(lines: StoryLine[]): StoryLine[] {
  const s = liveState?.();
  return lines.filter(l => !l.when || (!!s && l.when(s)));
}

export function shownChoices(ch: Chapter): StoryChoice[] {
  const s = liveState?.();
  return (ch.choices ?? []).filter(c => !c.when || (!!s && c.when(s)));
}

export function getChapter(id: string): Chapter | undefined {
  return CHAPTERS.find(c => c.id === id);
}

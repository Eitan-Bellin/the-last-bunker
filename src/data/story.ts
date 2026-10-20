import type { GameState, ResourceType, SurvivorState } from '../core/GameState';
import { hexDistance } from './surface';
import { hasFeature } from '../systems/ResearchSystem';
import { genesisGateMet } from '../systems/MetaSystem';
import { localizeName } from './names';
import { genderOf } from './portraits';
import { resolveGender } from '../i18n/I18nManager';
import { beatDue, firstLaw, inAct, signatureDue } from './acts'; // [phase5] the Acts' signature problems and mid-Act beats

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
  /** [ux-wp5 C3] A find for the journal (lore id) that comes with this moment. */
  lore?: string;
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
  /** [ux-wp5 C10] A short moment between the chapters (no chapter number; not counted with the chapters). */
  interlude?: boolean;
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
const genesisReady = (s: GameState) => genesisGateMet(s);
/** [phase5] Act V's expedition: each outpost held (up to 4), the scouts and the decoded signal make the northern road safer. */
const northOdds = (s: GameState) => Math.min(0.95, 0.35 + 0.1 * Math.min(4, ((s.longGame?.world.outposts ?? []) as unknown[]).length)
  + (has(s, 'north:scouted') ? 0.15 : 0) + (has(s, 'north:decoded') ? 0.1 : 0) + (built(s, 'medbay') ? 0.05 : 0));
/** [phase5] Act VI's vote: the side the bunker backs wins more often with influence in hand and the tables canvassed. */
const voteOdds = (s: GameState, base: number) => Math.min(0.95, base + (s.resources.influence?.amount ?? 0) / 3000
  + (has(s, 'vote:canvassed') ? 0.15 : 0) + (has(s, 'vote:promised') ? 0.1 : 0));
/** [Q1] The run is in this Act or later (a bunker from before the long game counts as Act VII: it keeps the classic story timing). */
const actAtLeast = (s: GameState, n: number) => !s.longGame || s.longGame.meta.legacy || s.longGame.meta.act >= n;

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
      { who: 'maya', text: { he: 'ואת זה תשמרו אתם. מכתב מאבא שלי. הוא אף פעם לא שלח אותו, אבל אני יודעת אותו בעל פה.', en: 'And you keep this. A letter from my dad. He never sent it, but I know it by heart.' } },
    ],
    effect: {
      morale: 8,
      lore: 'goodbye',
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
  // [phase5] Act II's mid-Act beat: the first frost warns of the winter (the Act's signature) half a day ahead.
  {
    id: 'frost', number: 8,
    title: { he: 'הכפור הראשון', en: 'The First Frost' },
    trigger: s => beatDue(s, 2) && has(s, 'story:toll'),
    lines: [
      { who: 'narrator', text: { he: 'הבוקר מצא הצוות קרח על האנטנה. האוויר בחוץ מריח כמו ברזל.', en: 'This morning the crew found ice on the antenna. The air outside smells of iron.' } },
      { who: 'ezra', when: s => has(s, 'story:terminus'), text: { he: 'בונקר 17, כאן עזרא. המדחום שלנו ירד בלילה מתחת לאפס, וזו רק ההתחלה. החורף הזה יהיה ארוך.', en: 'Bunker 17, Ezra here. Our thermometer dropped below zero last night, and that is only the start. This winter will be a long one.' } },
      { who: 'narrator', when: s => !has(s, 'story:terminus'), text: { he: 'המדחום ליד הדלת ירד בלילה מתחת לאפס. כולם יודעים מה זה אומר: החורף הזה יהיה ארוך.', en: 'The thermometer by the door dropped below zero last night. Everyone knows what that means: this winter will be a long one.' } },
      { who: 'gideon', when: gideonInside, text: { he: 'המחנה של השבט נמצא ליד הנהר. אוהלים מבד ופח. הם לא יעברו חורף כזה.', en: 'The Clan\'s camp is by the river. Tents of canvas and tin. They won\'t last a winter like this.' } },
      { who: 'crew', when: s => !gideonInside(s), text: { he: 'ראינו עשן מהמחנה של שבט החלודה ליד הנהר. אוהלים מבד ופח. הם לא יעברו חורף כזה, ובסוף הם יגיעו לדלת שלנו.', en: 'We saw smoke from the Rust Clan\'s camp by the river. Tents of canvas and tin. They won\'t last a winter like this, and sooner or later they will come to our door.' } },
      { who: 'crew', text: { he: 'יש לנו בערך חצי יום לפני שהשלג סוגר את הדרכים. על מה עובדים קודם?', en: 'We have about half a day before the snow closes the roads. What do we work on first?' } },
    ],
    choices: [
      {
        key: 'stock', label: { he: 'לאגור אוכל לחורף', en: 'Store food for the winter' },
        effect: { cost: { scrap: 300 }, flags: ['winter:stocked'] },
        reply: [{ who: 'crew', text: { he: 'מילאנו את המחסן עד התקרה: שימורים, פטריות מיובשות, שקי קמח. אם יבואו אורחים, יהיה מה לשים על השולחן.', en: 'We filled the storeroom to the ceiling: tins, dried mushrooms, sacks of flour. If guests come, there will be something to put on the table.' } }],
      },
      {
        key: 'beds', label: { he: 'לפנות מסדרון חם לאורחים', en: 'Clear a warm corridor for guests' },
        effect: { cost: { materials: 40000 }, flags: ['winter:beds'] },
        reply: [{ who: 'crew', text: { he: 'פינינו את המסדרון בקומה העליונה ותלינו שמיכות על הצינורות החמים. זה לא מלון, אבל זה חם.', en: 'We cleared the corridor on the top level and hung blankets over the warm pipes. It is no hotel, but it is warm.' } }],
      },
      {
        key: 'word', label: { he: 'לשלוח לשבט הודעה שהדלת פתוחה', en: 'Send word to the Clan that the door is open' },
        effect: { morale: 3, flags: ['winter:invited'] },
        reply: [{ who: 'narrator', text: { he: 'מישהו מהשבט ענה ברדיו הישן שלהם. רק מילה אחת: "שמענו."', en: 'Someone from the Clan answered on their old radio. Just one word: "Heard."' } }],
      },
    ],
  },
  {
    id: 'winter', number: 9,
    title: { he: 'החורף הארוך', en: 'The Long Winter' },
    // [phase5] Act II's signature: half a day after the frost (the old trigger, 30 people, for a bunker past Act II or from before the long game).
    trigger: s => (inAct(s, 2) ? signatureDue(s, 2) : s.survivors.length >= 30) && has(s, 'story:toll'),
    lines: [
      { who: 'narrator', text: { he: 'שלג אפור יורד כבר שבוע. במצלמת הכניסה נראית שיירה קטנה: אנשים עטופים בשמיכות, ילדים על הכתפיים, עגלה בלי סוס.', en: 'Grey snow has been falling for a week. The entrance camera shows a small column: people wrapped in blankets, children on shoulders, a cart with no horse.' } },
      { who: 'narrator', when: s => has(s, 'winter:invited'), text: { he: 'הם באו כי שמעו שהדלת פתוחה. אף אחד לא צריך לדפוק.', en: 'They came because they heard the door was open. Nobody has to knock.' } },
      { who: 'gideon', when: gideonInside, text: { he: 'אלה האנשים שלי. מה שנשאר משבט החלודה. המחנה ליד הנהר קפא, והם הלכו שלושה ימים כדי להגיע לדלת שלנו.', en: 'Those are my people. What\'s left of the Rust Clan. The camp by the river froze, and they walked three days to reach our door.' } },
      { who: 'gideon', when: s => !gideonInside(s) && has(s, 'gideon:paid'), text: { he: 'שכנים. פעם ביקשתי מכם מכס, ושילמתם בלי לירות. אז אני מקווה שתקשיבו גם עכשיו. המחנה שלנו קפא.', en: 'Neighbors. Once I asked you for a toll, and you paid without a shot fired. So I hope you\'ll listen now too. Our camp froze.' } },
      { who: 'gideon', when: s => !gideonInside(s) && !has(s, 'gideon:paid'), text: { he: 'אני יודע. בפעם הקודמת באתי עם רובים. היום אני בא עם ילדים. המחנה שלנו קפא, ואין לנו לאן ללכת.', en: 'I know. Last time I came with rifles. Today I come with children. Our camp froze, and we have nowhere else to go.' } },
      { who: 'gideon', text: { he: 'שמונה אנשים. הם יאכלו, הם יישנו במסדרונות, הם יריבו על השמיכות. אבל הם יודעים לעבוד קשה. מה אתם אומרים?', en: 'Eight people. They\'ll eat, they\'ll sleep in the corridors, they\'ll fight over blankets. But they know how to work hard. What do you say?' } },
      { who: 'crew', when: s => has(s, 'winter:stocked'), text: { he: 'המחסן מלא. הפעם יש מספיק כדי לחלוק.', en: 'The storeroom is full. This time there is enough to share.' } },
      { who: 'crew', when: s => has(s, 'winter:beds'), text: { he: 'המסדרון העליון מוכן, עם שמיכות על הצינורות החמים.', en: 'The top corridor is ready, with blankets on the warm pipes.' } },
    ],
    choices: [
      {
        // [phase5] Food is cheap by Act II, so the price is real now; a bunker that got ready for the cold keeps everyone well.
        key: 'all', label: { he: 'לפתוח את הדלת לכל השמונה', en: 'Open the door to all eight' },
        effect: { cost: { food: 1200 }, group: 8, flags: ['clan:sheltered'] },
        check: s => Math.min(1, 0.55 + (has(s, 'winter:beds') ? 0.3 : 0) + (has(s, 'winter:stocked') ? 0.3 : 0)),
        reply: [
          { who: 'gideon', text: { he: 'תודה. אני לא טוב עם המילה הזאת, אז אגיד אותה פעם אחת: תודה.', en: 'Thank you. I\'m no good with that word, so I\'ll say it once: thank you.' } },
          { who: 'narrator', text: { he: 'הלילה ישנים גם במסדרונות. צריך עוד מגורים, ומהר.', en: 'Tonight people sleep in the corridors too. We need more quarters, and fast.' } },
        ],
        failEffect: { cost: { food: 1200 }, group: 8, hurt: { count: 3, damage: 30 }, morale: -4, flags: ['clan:sheltered', 'winter:cold'] },
        failReply: [
          { who: 'gideon', text: { he: 'תודה. אני לא טוב עם המילה הזאת, אז אגיד אותה פעם אחת: תודה.', en: 'Thank you. I\'m no good with that word, so I\'ll say it once: thank you.' } },
          { who: 'narrator', text: { he: 'המסדרונות היו קרים מדי. בשבוע הראשון שלושה חלו, אבל כולם נשארו בחיים. בחורף הבא, מתכוננים מראש.', en: 'The corridors were too cold. Three fell sick in the first week, but everyone lived. Next winter, we get ready in time.' } },
        ],
      },
      {
        key: 'young', label: { he: 'לקבל רק את הצעירים והחולים', en: 'Take in only the young and the sick' },
        effect: { cost: { food: 400 }, group: 3, morale: -4, flags: ['clan:children'] },
        reply: [{ who: 'gideon', text: { he: 'שלושה מתוך שמונה. זה יותר ממה שהעולם נתן לנו בזמן האחרון. השאר יסתדרו. איכשהו.', en: 'Three out of eight. That\'s more than the world has given us lately. The rest will manage. Somehow.' } }],
      },
      {
        key: 'supplies', label: { he: 'לתת להם ציוד ולשלוח אותם הלאה', en: 'Give them supplies and send them on' },
        effect: { cost: { food: 1000, water: 800 }, morale: -6, flags: ['clan:turned'] },
        reply: [{ who: 'gideon', text: { he: 'אוכל לדרך. זה לא בית, אבל זה גם לא כלום. רק אל תצפו שהם ישכחו את הדלת הזאת.', en: 'Food for the road. It\'s not a home, but it\'s not nothing. Just don\'t expect them to forget this door.' } }],
      },
    ],
  },
  {
    id: 'platform', number: 10,
    title: { he: 'רציף 4', en: 'Platform 4' },
    trigger: s => (s.era ?? 0) >= 3 && actAtLeast(s, 3) && has(s, 'story:static'),
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
  // [phase5] Act III: a quarrel halfway through the Act sets up its signature, the colony's first law (told once a law is passed).
  {
    id: 'quarrel', number: 11,
    title: { he: 'הריב בחדר האוכל', en: 'The Canteen Quarrel' },
    trigger: s => beatDue(s, 3),
    lines: [
      { who: 'narrator', text: { he: 'זה התחיל בשאלה מי שוטף את הסירים, ונגמר בשולחן הפוך בחדר האוכל.', en: 'It started with who washes the pots, and it ended with a table turned over in the canteen.' } },
      { who: 'crew', text: { he: 'הוותיקים אומרים שהחדשים לא עובדים. החדשים אומרים שהוותיקים שומרים לעצמם את המשמרות הטובות. שני הצדדים קצת צודקים.', en: 'The old hands say the newcomers don\'t work. The newcomers say the old hands keep the good shifts for themselves. Both sides are a little right.' } },
      { who: 'ezra', when: s => has(s, 'terminus:merged'), text: { he: 'האנשים שלי רגילים לכללים של התחנה. פה אין כללים, רק הרגלים. ובהרגלים, מי שהיה כאן ראשון תמיד מנצח.', en: 'My people are used to the station\'s rules. Here there are no rules, only habits. And with habits, whoever was here first always wins.' } },
      { who: 'gideon', when: clanFriend, text: { he: 'אצל השבט היה כלל אחד: מי שצועק הכי חזק. אל תחזרו על הטעות שלנו.', en: 'The Clan had one rule: whoever shouts loudest. Don\'t repeat our mistake.' } },
      { who: 'crew', text: { he: 'עיר צריכה חוק, לא רק מנהל עבודה. אבל עד שנכתוב אותו, צריך להחליט מה עושים עם הערב הזה.', en: 'A city needs a law, not just a foreman. But until we write one, we have to decide what to do about tonight.' } },
      { who: 'narrator', when: s => !firstLaw(s), text: { he: 'החוקים נמצאים במרכז הפיקוד, בלשונית "מדיניות".', en: 'The laws are in the Command panel, under the Policies tab.' } },
    ],
    choices: [
      {
        key: 'assembly', label: { he: 'לכנס את כולם לאספה פתוחה', en: 'Call everyone to an open assembly' },
        effect: { morale: 4, moraleFor: 1800, flags: ['quarrel:assembly'] },
        reply: [{ who: 'narrator', text: { he: 'האספה נמשכה עד אחרי חצות. אף אחד לא שכנע אף אחד, אבל כולם הסכימו על דבר אחד: צריך חוק כתוב.', en: 'The assembly ran past midnight. Nobody convinced anybody, but everyone agreed on one thing: we need a written law.' } }],
      },
      {
        key: 'lottery', label: { he: 'לחלק את המשמרות מחדש בהגרלה', en: 'Redraw the shifts by lottery' },
        effect: { morale: 2, flags: ['quarrel:lottery'] },
        reply: [{ who: 'crew', text: { he: 'הגרלה הוגנת. כולם רטנו באותה מידה, וזה כנראה סימן טוב. אבל הגרלה היא לא חוק.', en: 'A fair lottery. Everyone grumbled the same amount, which is probably a good sign. But a lottery is not a law.' } }],
      },
      {
        key: 'firm', label: { he: 'להעניש את שני הצדדים', en: 'Punish both sides' },
        effect: { morale: -4, gain: { materials: 20000 }, flags: ['quarrel:firm'] },
        reply: [{ who: 'narrator', text: { he: 'שני הצדדים קיבלו שבוע של משמרות לילה. השקט חזר. השאלה נשארה.', en: 'Both sides got a week of night shifts. The quiet came back. The question stayed.' } }],
      },
    ],
  },
  {
    id: 'firstLaw', number: 12,
    title: { he: 'כתוב על הקיר', en: 'Written on the Wall' },
    // [phase5] Act III's signature: after the quarrel, once the colony has passed a law (ActSystem keeps the first one as a flag).
    trigger: s => signatureDue(s, 3) && !!firstLaw(s),
    lines: [
      { who: 'narrator', text: { he: 'מישהו הביא דלי צבע לבן. עד הערב, החוק הראשון של העיר כתוב על הקיר של חדר האוכל, באותיות בגובה של ילד.', en: 'Someone brought a bucket of white paint. By evening the city\'s first law is written on the canteen wall, in letters as tall as a child.' } },
      { who: 'crew', when: s => firstLaw(s) === 'rationing', text: { he: '"כל אחד מקבל אותה מנה." קל לכתוב. קשה יותר לאכול.', en: '"Everyone gets the same portion." Easy to write. Harder to eat.' } },
      { who: 'crew', when: s => firstLaw(s) === 'doubleShifts', text: { he: '"בינתיים, כולם עובדים כפול." אף אחד לא מחא כפיים, אבל אף אחד גם לא יצא מהחדר.', en: '"For now, everyone works double." Nobody clapped, but nobody walked out either.' } },
      { who: 'crew', when: s => firstLaw(s) === 'openDoors', text: { he: '"הדלת פתוחה לכל מי שמגיע." מישהו הוסיף מתחת בעיפרון: "גם בלילה?"', en: '"The door is open to whoever comes." Someone added underneath in pencil: "At night too?"' } },
      { who: 'crew', when: s => firstLaw(s) === 'martialLaw', text: { he: '"השומרים מחליטים עד שהסכנה עוברת." השומרים עמדו ליד הקיר כל הערב. אף אחד לא שאל מתי היא עוברת.', en: '"The guards decide until the danger passes." The guards stood by the wall all evening. Nobody asked when it passes.' } },
      { who: 'crew', when: s => firstLaw(s) === 'freeSchools', text: { he: '"כל ילד לומד לקרוא." הילדים כתבו את זה בעצמם, עם שתי שגיאות כתיב שאף אחד לא תיקן.', en: '"Every child learns to read." The children painted it themselves, with two spelling mistakes nobody fixed.' } },
      { who: 'crew', when: s => firstLaw(s) === 'dayOfRest', text: { he: '"יום אחד בשבוע, אף אחד לא עובד." מישהו כבר שאל איזה יום. הוויכוח נמשך עד עכשיו.', en: '"One day a week, nobody works." Someone already asked which day. The argument is still going.' } },
      { who: 'crew', text: { he: 'עכשיו זה כתוב. השאלה היא איך שומרים עליו.', en: 'Now it is written. The question is how we keep it.' } },
    ],
    choices: [
      {
        key: 'sign', label: { he: 'כולם חותמים מתחת', en: 'Everyone signs under it' },
        effect: { morale: 6, moraleFor: 3600, flags: ['law:signed'] },
        reply: [{ who: 'narrator', text: { he: 'חתימות ממלאות את הקיר, חלקן רק איקס. הקיר כבר לא נראה כמו קיר של בונקר.', en: 'Signatures fill the wall, some of them just an X. It no longer looks like a bunker wall.' } }],
      },
      {
        key: 'keepers', label: { he: 'למנות שלושה שומרי חוק, אחד מכל קבוצה', en: 'Name three keepers of the law, one from each group' },
        effect: { morale: 3, moraleFor: 3600, gain: { knowledge: 2000 }, flags: ['law:keepers'] },
        reply: [{ who: 'crew', text: { he: 'שלושה אנשים, אחד מכל קבוצה. הם כבר מתווכחים ביניהם, וזה בדיוק הרעיון.', en: 'Three people, one from each group. They already argue among themselves, which is exactly the point.' } }],
      },
      {
        key: 'quiet', label: { he: 'לאכוף בשקט, בלי טקסים', en: 'Enforce it quietly, no ceremony' },
        effect: { morale: -1, gain: { materials: 30000 }, flags: ['law:quiet'] },
        reply: [{ who: 'narrator', text: { he: 'בלי טקס ובלי נאומים. מחר בבוקר, החוק פשוט נמצא שם.', en: 'No ceremony and no speeches. Tomorrow morning the law is simply there.' } }],
      },
    ],
  },
  {
    id: 'fever', number: 13,
    title: { he: 'קדחת האפר', en: 'Ash Fever' },
    // [Q1] A bunker of 40 reaches Act III within days; the fever belongs to the expansion (Act IV).
    trigger: s => s.survivors.length >= 40 && actAtLeast(s, 4) && has(s, 'story:genesis'),
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
    id: 'trail', number: 14,
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
    id: 'gate', number: 15,
    title: { he: 'השער', en: 'The Gate' },
    trigger: s => s.survivors.length >= 50 && actAtLeast(s, 5) && has(s, 'story:toll'),
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
  // ---- [P2-7] The late chapters (Acts IV-VII): the story keeps going until Genesis ----
  {
    id: 'ashStorm', number: 16,
    title: { he: 'סופת האפר הגדולה', en: 'The Great Ash Storm' },
    trigger: s => actAtLeast(s, 4) && has(s, 'story:static'),
    lines: [
      { who: 'narrator', text: { he: 'הרדיו קורא לזה "סופת האפר הגדולה מזה שבע שנים": חומה אפורה, שלושה ימים. כל מי שבחוץ צריך להיות מתחת לאדמה עד הערב.', en: 'The radio calls it "the biggest ash storm in seven years": a wall of grey, three days long. Everyone outside must be underground by tonight.' } },
      { who: 'ezra', when: terminusAlly, text: { he: 'בונקר 17, הסופה מגיעה אלינו קודם. שמענו את המאחזים שלכם נסגרים. אם יש לכם מקום, יש כאן אנשים בלי קיר.', en: 'Bunker 17, the storm hits us first. We heard your outposts closing up. If you have room, there are people here with no wall.' } },
      { who: 'crew', text: { he: 'הצוותים בשטח שואלים: לחכות בחוץ ולהחזיק, או לרוץ פנימה ולהשאיר הכול לסופה? והמסננים יאכלו חשמל שלוש ימים.', en: 'The crews out there ask: stay and hold, or run inside and leave everything to the storm? And the filters will drink power for three days.' } },
    ],
    choices: [
      {
        key: 'sealed', label: { he: 'לאטום את הכול ולחכות', en: 'Seal everything and wait' },
        effect: { cost: { food: 150 }, morale: 4, moraleFor: 1800, flags: ['storm:sealed'] },
        reply: [{ who: 'narrator', text: { he: 'שלושה ימים של שקט מתחת לאדמה. מישהו מנגן במסדרון. כשהסופה עוברת, הכול שלם, והכול אפור.', en: 'Three days of quiet underground. Someone plays music in the corridor. When the storm passes, everything is intact, and everything is grey.' } }],
      },
      {
        key: 'crews', label: { he: 'לשלוח צוותים להגן על המאחזים', en: 'Send crews to shelter the outposts' },
        effect: { gain: { scrap: 400 }, morale: 5, moraleFor: 1800, flags: ['storm:crews'] },
        check: s => Math.min(0.9, 0.6 + (built(s, 'medbay') ? 0.15 : 0)),
        reply: [{ who: 'crew', text: { he: 'חזרנו, כולם. החזקנו זה את זה בבור ליד הכביש, ואפר עד הברכיים. אבל המאחזים עומדים.', en: 'We\'re back, all of us. We held each other in a pit by the road, ash up to our knees. But the outposts stand.' } }],
        failReply: [{ who: 'crew', text: { he: 'לא כולם חזרו בלי פגיעה. אנשים התנשמו אפר שלושה ימים. המאחזים שרדו, אנחנו קצת פחות.', en: 'Not everyone came back unhurt. People breathed ash for three days. The outposts survived; we a little less.' } }],
        failEffect: { hurt: { count: 5, damage: 30 }, morale: -6, moraleFor: 1200, flags: ['storm:crews', 'storm:hurt'] },
      },
      {
        key: 'refuge', label: { he: 'לפתוח את הדלת לכל מי שנתפס בחוץ', en: 'Open the door to everyone caught outside' },
        effect: { cost: { food: 200 }, group: 5, flags: ['storm:refuge'] },
        reply: [{ who: 'narrator', text: { he: 'חמישה אנשים מגיעים בריצה, שחורים מאפר. אחד מהם מחזיק גור כלבים בתוך הז\'קט.', en: 'Five people arrive running, black with ash. One of them holds a puppy inside his jacket.' } }],
      },
    ],
  },
  {
    id: 'railLine', number: 17,
    title: { he: 'הקו מהתחנה', en: 'The Line from the Station' },
    trigger: s => actAtLeast(s, 4) && has(s, 'story:platform'),
    lines: [
      { who: 'ezra', when: terminusSaved, text: { he: 'התחנה יבשה, והפסים מתחתיה ישרים. אני חושב שאפשר להריץ עגלה בין הרציף שלנו לבונקר שלכם.', en: 'The station is dry and the rails beneath it are straight. I think we can run a handcart between our platform and your bunker.' } },
      { who: 'ezra', when: s => !terminusSaved(s), text: { he: 'המנהרה שלכם עוברת מתחת לקו הישן. אם נחבר אותה, אפשר להריץ עגלה בין הרציף שלנו לבונקר שלכם.', en: 'Your tunnel runs beneath the old line. If we connect it, a handcart could run between our platform and your bunker.' } },
      { who: 'crew', text: { he: 'עגלה בלי מנוע, שני אנשים וכוח של רגליים. אבל אז הסחר לא תלוי באבק. ומי שרוצה לבוא, יבוא בלי להיפגש עם אף אחד.', en: 'A cart with no engine, two people and leg power. But then trade no longer depends on the dust. And anyone who wants to come can come without meeting anyone.' } },
    ],
    choices: [
      {
        key: 'build', label: { he: 'לחבר את הקו', en: 'Connect the line' },
        effect: { cost: { materials: 8000, scrap: 150 }, gain: { knowledge: 600 }, morale: 4, moraleFor: 1800, flags: ['terminus:rail'] },
        reply: [{ who: 'ezra', text: { he: 'העגלה הראשונה הגיעה אליכם עם סל פטריות ושיר. תתרגלו: מעכשיו אנחנו שכנים בלי מרחק.', en: 'The first cart reached you with a basket of mushrooms and a song. Get used to it: from now on we are neighbours with no distance between us.' } }],
      },
      {
        key: 'closed', label: { he: 'להשאיר את המנהרה אטומה', en: 'Keep the tunnel sealed' },
        effect: { gain: { materials: 2000 }, flags: ['terminus:railSealed'] },
        reply: [{ who: 'ezra', text: { he: 'מבין. גבול זה גבול. אבל הדלת אצלי נשארת לא נעולה.', en: 'I understand. A border is a border. But my door stays unlocked.' } }],
      },
    ],
  },
  // [phase5] Act IV: the lookouts see an army on the ridge (the beat), and a day later it reaches the Wall (the signature, resolved by
  // ActSystem.resolveSiege by the numbers: three waves against the bunker's defense and this chapter's preparation).
  {
    id: 'ridge', number: 18,
    title: { he: 'עשן על הרכס', en: 'Smoke on the Ridge' },
    trigger: s => beatDue(s, 4),
    lines: [
      { who: 'narrator', text: { he: 'בלילה ספרו השומרים מדורות על הרכס. עשרים. שלושים. בבוקר הם הפסיקו לספור.', en: 'At night the lookouts counted fires on the ridge. Twenty. Thirty. By morning they stopped counting.' } },
      { who: 'gideon', when: clanFriend, text: { he: 'אני מכיר את הדגלים האלה. הטור האפור: מה שנשאר מכל הכנופיות שהשבט גירש מהנהר. הם שמעו שיש פה עיר, והם רעבים.', en: 'I know those flags. The Grey Column: what is left of every gang the Clan drove from the river. They heard there is a city here, and they are hungry.' } },
      { who: 'crew', when: clanFoe, text: { he: 'הם קוראים לעצמם הטור האפור: כל הכנופיות מהנהר, ביחד, בפעם הראשונה. הם שמעו שיש פה עיר, והם רעבים.', en: 'They call themselves the Grey Column: every gang from the river, together for the first time. They heard there is a city here, and they are hungry.' } },
      { who: 'crew', text: { he: 'הם יגיעו לחומה מחר בערב, בשלושה גלים, אחד אחרי השני. יש לנו יום להתכונן.', en: 'They will reach the Wall tomorrow evening, in three waves, one after another. We have a day to get ready.' } },
      { who: 'narrator', when: s => !has(s, 'project:wall'), text: { he: 'החומה עוד לא גמורה. כל שלב שייבנה עד מחר יעמוד בדרכם, וכך גם כל שומר בנשקייה.', en: 'The Wall is not finished yet. Every stage built by tomorrow will stand in their way, and so will every guard in the Armory.' } },
    ],
    choices: [
      {
        key: 'fortify', label: { he: 'לחזק את הדלת ואת החומה', en: 'Reinforce the door and the Wall' },
        effect: { cost: { materials: 300000, scrap: 1500 }, flags: ['siege:fortified'] },
        reply: [{ who: 'crew', text: { he: 'לוחות פלדה על הדלת, שקי חול לאורך החומה. זה מכוער. זה יחזיק.', en: 'Steel plates on the door, sandbags along the Wall. It is ugly. It will hold.' } }],
      },
      {
        key: 'allies', when: s => clanFriend(s) || terminusAlly(s) || terminusSaved(s), label: { he: 'לקרוא לשבט ולמסוף לעזרה', en: 'Call the Clan and Terminus for help' },
        effect: { flags: ['siege:allies'] },
        reply: [{ who: 'narrator', text: { he: 'השבט יתקוף אותם מהאגף המערבי. המסוף שולח כל מי שיודע לירות. לא תעמדו לבד.', en: 'The Clan will hit their west flank. Terminus is sending everyone who can shoot. You won\'t stand alone.' } }],
      },
      {
        key: 'drill', label: { he: 'לאמן את כולם לקרב', en: 'Drill everyone for the fight' },
        effect: { cost: { food: 3000 }, morale: -2, flags: ['siege:drilled'] },
        reply: [{ who: 'crew', text: { he: 'כל מי שיכול להחזיק צינור מתאמן במסדרון. הילדים סוחבים מים. אף אחד לא ישן הרבה.', en: 'Everyone who can hold a pipe trains in the corridor. The children carry water. Nobody sleeps much.' } }],
      },
      {
        key: 'trust', label: { he: 'לסמוך על מה שיש', en: 'Trust what we have' },
        effect: { flags: ['siege:trust'] },
        reply: [{ who: 'crew', text: { he: 'הגנה היא הגנה. מחר נראה כמה היא שווה.', en: 'Defense is defense. Tomorrow we will see what it is worth.' } }],
      },
    ],
  },
  {
    id: 'siege', number: 19,
    title: { he: 'המצור על החומה', en: 'The Siege of the Wall' },
    trigger: s => inAct(s, 4) && has(s, 'siege:done'),
    lines: [
      { who: 'narrator', text: { he: 'הם הגיעו עם החושך, בשלושה גלים, בדיוק כמו שאמרו השומרים.', en: 'They came with the dark, in three waves, just as the lookouts said.' } },
      { who: 'narrator', when: s => has(s, 'siege:held'), text: { he: 'הגל הראשון נשבר על החומה. השני על הדלת. השלישי כבר לא הגיע עד הסוף. עם שחר, הרכס ריק.', en: 'The first wave broke on the Wall. The second on the door. The third never made it all the way. At dawn the ridge is empty.' } },
      { who: 'narrator', when: s => has(s, 'siege:bent'), text: { he: 'החומה החזיקה, אבל לא בכל מקום. מה שעבר אותה פרץ לחצר והגיע עד הדלת לפני שנהדף.', en: 'The Wall held, but not everywhere. What got past it broke into the yard and reached the door before it was pushed back.' } },
      { who: 'narrator', when: s => has(s, 'siege:broke'), text: { he: 'החומה לא החזיקה. הטור האפור פרץ לחצר, לקח כל מה שיכול היה, ונעלם מעבר לרכס לפני הבוקר.', en: 'The Wall did not hold. The Grey Column broke into the yard, took everything it could, and vanished over the ridge before morning.' } },
      { who: 'gideon', when: s => has(s, 'siege:allies') && clanFriend(s), text: { he: 'אמרתי לכם שלא תעמדו לבד.', en: 'I told you you wouldn\'t stand alone.' } },
      { who: 'crew', text: { he: 'עכשיו צריך להחליט מה עושים עם הבוקר.', en: 'Now we have to decide what to do with the morning.' } },
    ],
    choices: [
      {
        key: 'feast', when: s => has(s, 'siege:held'), label: { he: 'משתה על החומה', en: 'A feast on the Wall' },
        effect: { cost: { food: 1500 }, gain: { scrap: 800 }, morale: 10, moraleFor: 3600, flags: ['siege:feast'] },
        reply: [{ who: 'narrator', text: { he: 'שולחנות ארוכים לאורך החומה, מרק חם, ומישהו מנגן במפוחית שמצא בשלל. העיר ישנה בשקט בפעם הראשונה מזה יומיים.', en: 'Long tables along the Wall, hot soup, and someone playing a harmonica found in the loot. The city sleeps quietly for the first time in two days.' } }],
      },
      {
        key: 'pursue', when: s => has(s, 'siege:held'), label: { he: 'לרדוף אחריהם עד הרכס', en: 'Chase them over the ridge' },
        check: () => 0.7,
        effect: { gain: { scrap: 1500, materials: 150000 }, morale: 4, flags: ['siege:pursued'] },
        reply: [{ who: 'crew', text: { he: 'מצאנו את המחנה שלהם ריק: עגלות, כלים, ומחסן שלם של גרוטאות. הטור האפור לא יחזור.', en: 'We found their camp empty: carts, tools, and a whole store of scrap. The Grey Column won\'t be back.' } }],
        failEffect: { gain: { scrap: 400 }, hurt: { count: 2, damage: 30 }, flags: ['siege:pursued'] },
        failReply: [{ who: 'crew', text: { he: 'הם חיכו לנו מעבר לרכס. חזרנו עם שני פצועים ומעט שלל. בפעם הבאה, נישאר מאחורי החומה.', en: 'They were waiting for us past the ridge. We came back with two hurt and a little loot. Next time we stay behind the Wall.' } }],
      },
      {
        key: 'repair', when: s => has(s, 'siege:bent'), label: { he: 'לתקן את הפרצה מיד', en: 'Repair the breach at once' },
        effect: { cost: { materials: 200000 }, hurt: { count: 2, damage: 25 }, morale: 2, flags: ['siege:repaired'] },
        reply: [{ who: 'crew', text: { he: 'עד הצהריים הפרצה סגורה, והפעם בבטון. שניים מהשומרים במרפאה, אבל הם יחזרו.', en: 'By noon the breach is closed, with concrete this time. Two of the guards are in the medbay, but they will be back.' } }],
      },
      {
        key: 'rest', when: s => has(s, 'siege:bent'), label: { he: 'לטפל בפצועים ולנוח', en: 'Tend the hurt and rest' },
        effect: { hurt: { count: 2, damage: 25 }, morale: 4, moraleFor: 1800, flags: ['siege:rested'] },
        reply: [{ who: 'narrator', text: { he: 'יום שלם בלי עבודה. אנשים ישנים, אוכלים, ומספרים שוב ושוב מה ראו בלילה.', en: 'A whole day without work. People sleep, eat, and tell each other again and again what they saw in the night.' } }],
      },
      {
        key: 'rebuild', when: s => has(s, 'siege:broke'), label: { he: 'לרדת למטה ולבנות מחדש', en: 'Pull back below and rebuild' },
        effect: { cost: { materials: 400000, food: 3000 }, hurt: { count: 4, damage: 35 }, morale: -6, moraleFor: 1800, flags: ['siege:rebuilt'] },
        reply: [{ who: 'crew', text: { he: 'ספרנו מה נשאר, וזה יותר ממה שחשבנו. מחר מתחילים לבנות, והחומה הבאה תהיה גבוהה יותר.', en: 'We counted what is left, and it is more than we thought. Tomorrow we start building, and the next wall will be higher.' } }],
      },
      {
        key: 'pay', when: s => has(s, 'siege:broke'), label: { he: 'לשלם להם כדי שיעזבו את הרכס', en: 'Pay them to leave the ridge' },
        effect: { cost: { food: 5000, scrap: 3000 }, hurt: { count: 2, damage: 25 }, morale: -8, moraleFor: 1800, flags: ['siege:paid'] },
        reply: [{ who: 'narrator', text: { he: 'עגלה אחרי עגלה יוצאת מהשער. הטור האפור לוקח, מסתובב, ונעלם. אף אחד לא מסתכל לאף אחד בעיניים.', en: 'Cart after cart leaves the gate. The Grey Column takes it, turns, and is gone. Nobody looks anyone in the eye.' } }],
      },
    ],
  },
  {
    id: 'noaDemand', number: 20,
    title: { he: 'מה נועה צריכה', en: 'What Noa Needs' },
    trigger: s => actAtLeast(s, 5) && has(s, 'story:fever'),
    lines: [
      { who: 'noa', text: { he: 'בונקר 17, אני בונה את המסנן האחרון של בראשית, ואני עומדת מול קיר: אני צריכה את הנתונים שלכם. שנים של מדידות, אחד אחד.', en: 'Bunker 17, I am building Genesis\'s last filter and I have hit a wall: I need your data. Years of measurements, one by one.' } },
      { who: 'noa', when: s => has(s, 'noa:volunteer'), text: { he: 'מי ששלחתם אליי כבר יודע לקרוא אותם. הוא ישלח לכם דרישת שלום ועוד שאלה אחת.', en: 'The one you sent me already knows how to read them. He sends greetings and one more question.' } },
      { who: 'crew', text: { he: 'נתונים זה מה שמחזיק אותנו בראש. אבל נועה תיתן משהו בתמורה: את מה שהיא כבר יודעת על העולם הבא.', en: 'Data is what keeps us ahead. But Noa will give something back: what she already knows about the next world.' } },
    ],
    choices: [
      {
        key: 'share', label: { he: 'לשתף את כל הנתונים', en: 'Share all of the data' },
        effect: { cost: { knowledge: 1200 }, gain: { isotope7: 8 }, flags: ['noa:shared'] },
        reply: [{ who: 'noa', text: { he: 'קיבלתי. תראו, זה עובד. אני שולחת איזוטופ ואת תוכניות המסנן. מי שיבוא אחריכם יודה לכם, גם אם לא יידע על מי.', en: 'Received. Look, it works. I am sending isotope and the filter plans. Whoever comes after you will be grateful, even if they never know to whom.' } }],
      },
      {
        key: 'half', label: { he: 'לשתף את מה שלא קשור להגנה', en: 'Share what has nothing to do with defense' },
        effect: { cost: { knowledge: 400 }, gain: { isotope7: 3 }, flags: ['noa:half'] },
        reply: [{ who: 'noa', text: { he: 'מובן. אתם עדיין מגינים על עצמכם. אסתדר עם זה.', en: 'Understood. You are still protecting yourselves. I will manage.' } }],
      },
      {
        key: 'keep', label: { he: 'להשאיר את הנתונים אצלנו', en: 'Keep the data with us' },
        effect: { morale: 2, flags: ['noa:kept'] },
        reply: [{ who: 'noa', text: { he: 'אפשר לכבד את זה. אני אבנה בלי. תהיו מוכנים לתוצאה, טובה או לא.', en: 'That can be respected. I will build without it. Be ready for the result, good or not.' } }],
      },
    ],
  },
  {
    id: 'sunriseGate', number: 21,
    title: { he: 'בוקר בחוץ', en: 'Morning Outside' },
    trigger: s => has(s, 'project:surfaceGate'),
    lines: [
      { who: 'narrator', text: { he: 'שער פני השטח נפתח ללא רעש. בפעם הראשונה מאז האפר, יוצאים מהבונקר בלי ציוד ובלי מסכות. השמש עולה, חיוורת, מאחורי ענן דק.', en: 'The Surface Gate opens without a sound. For the first time since the ashes, people leave the bunker with no gear and no masks. The sun rises, pale, behind a thin cloud.' } },
      { who: 'maya', when: mayaHome, text: { he: 'זו השמש מהציור. היא באמת צהובה. יוסי צדק.', en: 'It is the sun from the drawing. It really is yellow. Yossi was right.' } },
      { who: 'crew', text: { he: 'מה עושים עם הבוקר הראשון? כולם מסתכלים אלינו.', en: 'What do we do with the first morning? Everyone is looking at us.' } },
    ],
    choices: [
      {
        key: 'children', label: { he: 'לתת לילדים לצאת ראשונים', en: 'Let the children go out first' },
        effect: { morale: 10, moraleFor: 3600, flags: ['dawn:children'] },
        reply: [{ who: 'narrator', text: { he: 'ילדים רצים בעשב הדל, עם הידיים פשוטות לשמיים. מישהו בוכה מאחור ולא מתבייש.', en: 'Children run across the thin grass with their arms open to the sky. Someone behind them cries and is not ashamed.' } }],
      },
      {
        key: 'ceremony', label: { he: 'לערוך טקס זיכרון לאלה שלא הגיעו', en: 'Hold a ceremony for those who did not make it' },
        effect: { morale: 6, moraleFor: 3600, gain: { knowledge: 400 }, flags: ['dawn:ceremony'] },
        reply: [{ who: 'narrator', text: { he: 'שמות נקראים בקול, אחד אחד. כשמסיימים, השמש כבר גבוהה.', en: 'Names are read aloud, one by one. By the time they finish, the sun is already high.' } }],
      },
      {
        key: 'work', label: { he: 'לחזור לעבודה: יש הרבה לבנות', en: 'Get back to work: there is a lot to build' },
        effect: { gain: { materials: 6000, scrap: 150 }, morale: -2, moraleFor: 1200, flags: ['dawn:work'] },
        reply: [{ who: 'crew', text: { he: 'לא כולם אהבו, אבל הצוותים עובדים עד הערב, ובערב יש מה לראות: הקירות הראשונים של העיר החדשה.', en: 'Not everyone liked it, but the crews work until evening, and by evening there is something to see: the first walls of the new city.' } }],
      },
    ],
  },
  // [phase5] Act V: a signal from beyond the map (the beat) and the expedition that answers it half a day later (the signature). The
  // outposts the bunker holds, the scouts and the decoded signal make the road safer; a failed expedition comes back hurt, never stuck.
  {
    id: 'signal', number: 22,
    title: { he: 'אות מהצפון', en: 'A Signal from the North' },
    trigger: s => beatDue(s, 5),
    lines: [
      { who: 'ezra', when: s => has(s, 'story:terminus'), text: { he: 'בונקר 17, תקשיבו לזה. אנחנו קולטים את זה כבר שלושה לילות.', en: 'Bunker 17, listen to this. We have been picking it up for three nights.' } },
      { who: 'narrator', text: { he: 'שלושה צפצופים קצרים, אחד ארוך, ומספר. שוב ושוב, מאז שמישהו פתח את התדר.', en: 'Three short beeps, one long, and a number. Over and over, ever since someone opened the channel.' } },
      { who: 'noa', text: { he: 'אני מכירה את הקוד הזה. זו תחנת הזרעים הצפונית, מלפני האפר. אם מישהו שם עדיין משדר, יש שם זרעים, ואולי גם אנשים.', en: 'I know that code. It is the Northern Seed Station, from before the ashes. If someone there is still sending, there are seeds there, and maybe people.' } },
      { who: 'crew', text: { he: 'זה מעבר לקצה המפה. משלחת תצטרך יום שלם רק כדי להגיע. כל מאחז בדרך הוא עוד מקום לנוח, לשתות, לברוח אליו.', en: 'It is past the edge of the map. An expedition would need a whole day just to get there. Every outpost on the way is one more place to rest, to drink, to run to.' } },
    ],
    choices: [
      {
        key: 'scouts', label: { he: 'לשלוח סיירים לסמן את הדרך', en: 'Send scouts to mark the road' },
        effect: { cost: { food: 3000, water: 3000 }, flags: ['north:scouted'] },
        reply: [{ who: 'crew', text: { he: 'הסיירים יצאו עם סמרטוטים אדומים, לקשור על כל עמוד בדרך. מי שילך אחריהם לא יאבד.', en: 'The scouts left with red rags to tie to every post on the road. Whoever follows them won\'t get lost.' } }],
      },
      {
        key: 'decode', label: { he: 'להקשיב עוד וללמוד את הקוד', en: 'Listen longer and learn the code' },
        effect: { gain: { knowledge: 2000 }, flags: ['north:decoded'] },
        reply: [{ who: 'noa', text: { he: 'תנו לי לילה אחד עם הקלטות. אם יש שם מישהו, אני רוצה לדעת מה הוא אומר לפני שאנחנו דופקים בדלת שלו.', en: 'Give me one night with the recordings. If someone is there, I want to know what they are saying before we knock on their door.' } }],
      },
    ],
  },
  {
    id: 'northStation', number: 23,
    title: { he: 'התחנה הצפונית', en: 'The Northern Station' },
    trigger: s => signatureDue(s, 5),
    lines: [
      { who: 'narrator', text: { he: 'המשלחת מחכה בשער: תרמילים, מסננים, רדיו אחד ושני חבלים ארוכים.', en: 'The expedition waits at the gate: packs, filters, one radio and two long ropes.' } },
      { who: 'crew', when: s => has(s, 'north:scouted'), text: { he: 'הסיירים סימנו את הדרך בסמרטוטים אדומים. מי שילך, לא יאבד.', en: 'The scouts marked the road with red rags. Whoever goes won\'t get lost.' } },
      { who: 'noa', when: s => has(s, 'north:decoded'), text: { he: 'הקוד השתנה מאתמול. מישהו שם עונה לנו.', en: 'The code changed since yesterday. Someone there is answering us.' } },
      { who: 'crew', text: { he: 'כמה אנשים שולחים?', en: 'How many do we send?' } },
    ],
    choices: [
      {
        key: 'full', label: { he: 'לשלוח משלחת מלאה', en: 'Send a full expedition' },
        effect: { cost: { food: 4000, water: 4000 }, gain: { isotope7: 6, knowledge: 4000, data: 800 }, group: 4, morale: 8, moraleFor: 3600, flags: ['north:found'] },
        check: s => northOdds(s),
        reply: [{ who: 'narrator', text: { he: 'בתחנה עוד שמרו ארבעה אנשים במעילים אפורים על בנק הזרעים, שיישאר קר. הם חזרו הביתה עם המשלחת, ואיתם ארגזים של זרעים.', en: 'At the station, four people in grey coats were still keeping the seed bank cold. They came home with the expedition, and with crates of seeds.' } }],
        failEffect: { cost: { food: 4000, water: 4000 }, gain: { knowledge: 1000 }, hurt: { count: 4, damage: 40 }, morale: -6, moraleFor: 1800, flags: ['north:lost'] },
        failReply: [{ who: 'narrator', text: { he: 'סופת אבק תפסה אותם באמצע הדרך. הם חזרו עם כוויות ובידיים ריקות. האות עדיין מצפצף.', en: 'A dust storm caught them halfway. They came back burned and empty-handed. The signal still beeps.' } }],
      },
      {
        key: 'small', label: { he: 'לשלוח צוות קטן', en: 'Send a small team' },
        effect: { cost: { food: 1000, water: 1000 }, gain: { knowledge: 2000, data: 300 }, flags: ['north:mapped'] },
        check: s => Math.min(0.95, northOdds(s) + 0.3),
        reply: [{ who: 'crew', text: { he: 'הגענו, צילמנו, וחזרנו. התחנה עומדת, ומישהו גר בה. הם לא פתחו לנו, אבל השאירו לנו מפה.', en: 'We got there, took pictures, and came back. The station stands, and someone lives in it. They did not open for us, but they left us a map.' } }],
        failEffect: { cost: { food: 1000, water: 1000 }, hurt: { count: 2, damage: 30 }, flags: ['north:mapped'] },
        failReply: [{ who: 'crew', text: { he: 'לא הגענו. הדרך קרסה לתוך ערוץ, ושניים מאיתנו נפצעו בטיפוס חזרה.', en: 'We did not make it. The road had fallen into a gully, and two of us got hurt climbing back.' } }],
      },
      {
        key: 'stay', label: { he: 'להשאיר את האות לבדו', en: 'Leave the signal alone' },
        effect: { morale: -3, flags: ['north:ignored'] },
        reply: [{ who: 'noa', text: { he: 'אז מישהו אחר ימצא אותו. אני מקווה שהוא יהיה אדיב.', en: 'Then someone else will find it. I hope they will be kind.' } }],
      },
    ],
  },
  // [phase5] Act VI: three tables in the canteen (the beat) and, a day later, the vote itself (the signature, "The First Vote"):
  // influence is spent to back a side, and the influence held (and the canvassing) decides whether that side wins.
  {
    id: 'factions', number: 24,
    title: { he: 'שלושה שולחנות', en: 'Three Tables' },
    trigger: s => beatDue(s, 6),
    lines: [
      { who: 'narrator', text: { he: 'בחדר האוכל יש עכשיו שלושה שולחנות שלא מתערבבים: הוותיקים, אנשי השבט ואנשי המסוף.', en: 'The canteen now has three tables that do not mix: the old hands, the Clan\'s people and Terminus\'s.' } },
      { who: 'crew', text: { he: 'כולם מדברים על הצבעה: מי ינהל את העיר, ואיך. בעוד חצי יום פותחים את הקלפיות, ומי שירצה לנצח יצטרך השפעה, כלומר אנשים שסומכים עליו.', en: 'Everyone is talking about a vote: who governs the city, and how. In half a day the ballot boxes open, and whoever wants to win will need influence: people who trust them.' } },
      { who: 'gideon', when: clanFriend, text: { he: 'השולחן שלי יצביע בשביל מי שהקשיב לנו כשאף אחד אחר לא הקשיב.', en: 'My table will vote for whoever listened to us when nobody else did.' } },
      { who: 'ezra', when: terminusSaved, text: { he: 'המסוף יצביע בשביל מי שישאיר את העגלות נוסעות. אני צוחק. בערך.', en: 'Terminus will vote for whoever keeps the carts running. I am joking. Mostly.' } },
    ],
    choices: [
      {
        key: 'canvass', label: { he: 'לעבור בין השולחנות ולהקשיב', en: 'Go from table to table and listen' },
        effect: { cost: { influence: 300 }, flags: ['vote:canvassed'] },
        reply: [{ who: 'narrator', text: { he: 'שלושה ערבים, שלושה שולחנות, הרבה תה דליל. אף אחד לא הבטיח כלום, אבל כולם זוכרים מי ישב איתם.', en: 'Three evenings, three tables, a lot of weak tea. Nobody promised anything, but everyone remembers who sat with them.' } }],
      },
      {
        key: 'promise', label: { he: 'להבטיח לכל שולחן כיסא במועצה', en: 'Promise every table a seat on the council' },
        effect: { morale: 3, moraleFor: 1800, flags: ['vote:promised'] },
        reply: [{ who: 'crew', text: { he: 'הבטחה יפה. עכשיו צריך לעמוד בה.', en: 'A fine promise. Now we have to keep it.' } }],
      },
      {
        key: 'aloof', label: { he: 'להישאר מחוץ לזה', en: 'Stay out of it' },
        effect: { morale: -2, flags: ['vote:aloof'] },
        reply: [{ who: 'crew', text: { he: 'אפשר להישאר בחוץ. אבל ההצבעה תקרה גם בלעדינו.', en: 'We can stay out of it. But the vote will happen with or without us.' } }],
      },
    ],
  },
  {
    id: 'firstVote', number: 25,
    title: { he: 'ההצבעה הראשונה', en: 'The First Vote' },
    // [phase5] Act VI's signature: half a day after the three tables (the old trigger for a bunker past Act VI or from before the long game).
    trigger: s => (inAct(s, 6) ? signatureDue(s, 6) : actAtLeast(s, 6) && s.survivors.length >= 100 && has(s, 'story:gate')),
    lines: [
      { who: 'narrator', text: { he: 'מאה ועשרים איש מתחת לאדמה, ועוד מאות בחוץ. מי שמחליט עליהם? עד היום זה הייתם אתם. אבל הם התחילו לשאול.', en: 'A hundred and twenty people underground, and hundreds more outside. Who decides for them? Until now it was you. But they have started to ask.' } },
      { who: 'crew', text: { he: 'בחדר האוכל מדברים על הצבעה. לא נגדכם. עם. אבל אם נאמר לא, זה ייראה כמו נשק.', en: 'In the canteen they talk about a vote. Not against you. With you. But if we say no, it will look like a weapon.' } },
      { who: 'gideon', when: clanFriend, text: { he: 'שבט החלודה הצביע פעם בעשר שנים: מי שצעק חזק. אתם יכולים יותר טוב מזה.', en: 'The Rust Clan voted once in ten years: whoever shouted loudest. You can do better than that.' } },
      { who: 'crew', when: s => inAct(s, 6), text: { he: 'כל צד שתתמכו בו יעלה לנו השפעה. וככל שיש לנו יותר השפעה, יותר אנשים יקשיבו.', en: 'Whichever side we back will cost us influence. And the more influence we hold, the more people will listen.' } },
    ],
    choices: [
      {
        key: 'republic', label: { he: 'בחירות פתוחות לכולם', en: 'Open elections for everyone' },
        effect: { morale: 8, moraleFor: 7200, cost: { influence: 900 }, flags: ['vote:republic'] },
        check: s => (inAct(s, 6) ? voteOdds(s, 0.35) : 1),
        reply: [{ who: 'narrator', text: { he: 'ארבע קלפיות בחדר האוכל. יוצאים אחרי שעה, מופתעים כמה קל. מי שהפסיד לוחץ יד למי שניצח.', en: 'Four ballot boxes in the canteen. People leave an hour later, surprised how easy it was. The loser shakes the winner\'s hand.' } }],
        failEffect: { cost: { influence: 900 }, morale: -3, moraleFor: 3600, flags: ['vote:council', 'vote:lost'] },
        failReply: [{ who: 'narrator', text: { he: 'הבחירות הפתוחות הפסידו באחד עשר קולות. המועצה של המומחים לוקחת את הכיסאות. האנשים שלכם רוטנים, אבל נשארים.', en: 'Open elections lost by eleven votes. The council of experts takes the chairs. Your people grumble, but they stay.' } }],
      },
      {
        key: 'council', label: { he: 'מועצה של מומחים', en: 'A council of experts' },
        effect: { cost: { influence: 400 }, gain: { knowledge: 800 }, morale: -2, moraleFor: 3600, flags: ['vote:council'] },
        check: s => (inAct(s, 6) ? voteOdds(s, 0.45) : 1),
        reply: [{ who: 'narrator', text: { he: 'תשעה אנשים ישבו שבוע בחדר סגור. כשיצאו, יש להם חוקה בת ארבעה עמודים, ושתי מחלוקות שאף אחד לא פתר.', en: 'Nine people sat in a closed room for a week. When they came out, they had a four-page constitution, and two disputes nobody had settled.' } }],
        failEffect: { cost: { influence: 400 }, morale: 4, moraleFor: 3600, flags: ['vote:republic', 'vote:lost'] },
        failReply: [{ who: 'narrator', text: { he: 'העיר בחרה אחרת: בחירות פתוחות לכולם. הצד שלכם הפסיד, אבל בחדר האוכל שרים עד הבוקר.', en: 'The city chose otherwise: open elections for everyone. Your plan lost, but in the canteen they sing until morning.' } }],
      },
      {
        key: 'warden', label: { he: 'להישאר כמו שאנחנו', en: 'Stay as we are' },
        effect: { morale: -5, moraleFor: 3600, flags: ['vote:warden'] },
        // [phase5] Without influence, "stay as we are" can lose too: the city votes for open elections over your head.
        check: s => (inAct(s, 6) ? voteOdds(s, 0.15) : 1),
        reply: [{ who: 'crew', text: { he: 'הם לא יפגינו. לא עכשיו. אבל אני שמעתי איך שקט נשמע כשהוא מחכה.', en: 'They will not protest. Not now. But I have heard what silence sounds like when it is waiting.' } }],
        failEffect: { morale: -6, moraleFor: 3600, flags: ['vote:republic', 'vote:lost'] },
        failReply: [{ who: 'narrator', text: { he: 'העיר הצביעה בלי לשאול אתכם: בחירות פתוחות לכולם. אתם עדיין כאן, אבל כבר לא לבד בראש השולחן.', en: 'The city voted without asking you: open elections for everyone. You are still here, but no longer alone at the head of the table.' } }],
      },
    ],
  },
  {
    id: 'gideonSeat', number: 26,
    title: { he: 'מקום סביב השולחן', en: 'A Seat at the Table' },
    trigger: s => actAtLeast(s, 6) && has(s, 'story:gate') && has(s, 'story:firstVote'),
    lines: [
      { who: 'gideon', when: clanFriend, text: { he: 'הילדים שלי לומדים לקרוא בבית הספר שלכם. אבל מי שקובע את מה שמלמדים הוא לא אחד מאיתנו. אני לא מבקש הרבה. כיסא.', en: 'My kids are learning to read in your school. But whoever decides what is taught is not one of us. I am not asking for much. A chair.' } },
      { who: 'gideon', when: clanFoe, text: { he: 'עברו שנים. הבנתי שאפשר גם לבקש. אנחנו רוצים להיות חלק מהמה שאתם בונים, לא להסתכל עליו מהכביש.', en: 'Years have passed. I learned that one can also ask. We want to be part of what you are building, not watch it from the road.' } },
      { who: 'crew', text: { he: 'חלק מהאנשים לא ישמחו. אחרים יגידו שזה מאוחר מדי. אבל זה גם מה שיישמר מהם כשיבוא הדור הבא.', en: 'Some people will not be happy. Others will say it is too late. But it is also what will remain of them when the next generation comes.' } },
    ],
    choices: [
      {
        key: 'seat', label: { he: 'לתת להם מקום קבוע במועצה', en: 'Give them a permanent seat on the council' },
        effect: { morale: 4, moraleFor: 3600, gain: { influence: 150 }, flags: ['clan:seat'] },
        reply: [{ who: 'gideon', text: { he: 'כיסא. זה כל מה שביקשתי, ועכשיו אני מפחד שאשבור אותו.', en: 'A chair. That is all I asked for, and now I am afraid I will break it.' } }],
      },
      {
        key: 'observer', label: { he: 'מקום כמשקיפים, ללא הצבעה', en: 'A seat as observers, with no vote' },
        effect: { gain: { influence: 60 }, flags: ['clan:observer'] },
        reply: [{ who: 'gideon', text: { he: 'משקיפים. טוב. נשקיף, ובינתיים נלמד.', en: 'Observers. Fine. We will observe, and meanwhile learn.' } }],
      },
      {
        key: 'no', label: { he: 'להודות להם ולסרב', en: 'Thank them and refuse' },
        effect: { morale: 1, flags: ['clan:noSeat'] },
        reply: [{ who: 'gideon', text: { he: 'מובן. עוד שנה, אולי. אני סבלני עכשיו. זה דבר חדש אצלי.', en: 'Understood. Another year, maybe. I am patient now. That is new for me.' } }],
      },
    ],
  },
  // [phase5] Act VII: the last census (the beat) counts what the city has, so the Ark's choice (the signature) weighs something.
  {
    id: 'lastCensus', number: 27,
    title: { he: 'המפקד האחרון', en: 'The Last Census' },
    trigger: s => beatDue(s, 7),
    lines: [
      { who: 'noa', text: { he: 'מדדתי את התיבה שלכם על הנייר. יש בה מקום לדבר אחד גדול ולשניים קטנים. לא יותר.', en: 'I measured your Ark on paper. It has room for one big thing and two small ones. No more.' } },
      { who: 'crew', text: { he: 'אז סופרים. כל חדר, כל ארגז, כל שם. בפעם הראשונה מאז שהגענו, מישהו כותב את כל מה שיש לנו.', en: 'So we count. Every room, every crate, every name. For the first time since we came here, someone writes down everything we have.' } },
      { who: 'maya', when: mayaHome, text: { he: 'אמא הייתה סופרת את הקופסאות בלילה, כשחשבה שאני ישנה. עכשיו אני מבינה למה.', en: 'Mom used to count the tins at night, when she thought I was asleep. Now I understand why.' } },
    ],
    choices: [
      {
        key: 'names', label: { he: 'לרשום כל שם, גם של מי שכבר איננו', en: 'Write down every name, even of those who are gone' },
        effect: { morale: 4, moraleFor: 3600, flags: ['census:names'] },
        reply: [{ who: 'narrator', text: { he: 'הרשימה ארוכה יותר ממה שמישהו ציפה. אנשים עומדים בתור כדי להוסיף שם אחד ששכחו.', en: 'The list is longer than anyone expected. People queue to add one name that was forgotten.' } }],
      },
      {
        key: 'seeds', label: { he: 'לספור את הזרעים, צנצנת אחרי צנצנת', en: 'Count the seeds, jar by jar' },
        effect: { gain: { knowledge: 3000 }, flags: ['census:seeds'] },
        reply: [{ who: 'crew', text: { he: 'שמונה סוגים שגדלו כאן, ועוד שלושה שאף אחד לא זכר שיש לנו. החווה תתגעגע אליהם.', en: 'Eight kinds that grew here, and three more nobody remembered we had. The farm will miss them.' } }],
      },
      {
        key: 'songs', label: { he: 'להקליט את מה שהילדים שרים', en: 'Record what the children sing' },
        effect: { morale: 6, moraleFor: 3600, flags: ['census:songs'] },
        reply: [{ who: 'narrator', text: { he: 'הילדים שרים לתוך מיקרופון ישן. באמצע אחד השירים מישהו מתחיל לבכות, וכולם מעמידים פנים שלא שמעו.', en: 'The children sing into an old microphone. Halfway through one song someone starts to cry, and everyone pretends not to hear.' } }],
      },
    ],
  },
  {
    id: 'arkChapter', number: 28,
    title: { he: 'מה בתיבה', en: 'What Goes in the Ark' },
    // [phase5] Act VII's signature: once the Ark is built, after the last census (any other Act, or a bunker from before: as before).
    trigger: s => has(s, 'project:ark') && (!inAct(s, 7) || has(s, 'story:lastCensus')),
    lines: [
      { who: 'crew', when: s => has(s, 'census:names') || has(s, 'census:seeds') || has(s, 'census:songs'), text: { he: 'המפקד גמור. עכשיו יודעים בדיוק מה משאירים מאחור.', en: 'The census is done. Now we know exactly what we leave behind.' } },
      { who: 'maya', when: mayaHome, text: { he: 'אמא הייתה אומרת שמה שמחזיקים בידיים אחרי שהכול נשרף, זה מה שחשוב. מה נשים בתיבה?', en: 'Mom used to say that what you hold in your hands after everything has burned is what matters. What do we put in the Ark?' } },
      { who: 'narrator', when: s => !mayaHome(s), text: { he: 'התיבה עומדת פתוחה בחדר הכספת: מגירות ריקות, ושלוש מדפים להחליט עליהם.', en: 'The Ark stands open in the vault room: empty drawers, and three shelves to decide about.' } },
      { who: 'crew', text: { he: 'מקום לדבר אחד גדול, ולשני קטנים. מה אנחנו שולחים לעולם הבא?', en: 'Room for one big thing, and two small ones. What are we sending to the next world?' } },
    ],
    choices: [
      {
        key: 'names', label: { he: 'שמות: כל מי שחי כאן', en: 'Names: everyone who lived here' },
        effect: { morale: 8, moraleFor: 3600, flags: ['ark:names'] },
        reply: [{ who: 'narrator', text: { he: 'ארבע מאות שמות על גליל נחושת: גם אלה שמתו, גם אלה שנולדו כאן, גם אלה שרק עברו. הילדים חותמים בצד.', en: 'Four hundred names on a copper scroll: those who died, those who were born here, those who only passed through. The children sign at the side.' } }],
      },
      {
        key: 'seeds', label: { he: 'זרעים: מה שגדל כאן', en: 'Seeds: what grew here' },
        effect: { gain: { food: 800, knowledge: 300 }, morale: 4, moraleFor: 3600, flags: ['ark:seeds'] },
        reply: [{ who: 'narrator', text: { he: 'שמונה סוגי זרעים, כל אחד בצנצנת עם תאריך ושם של מי שזרע. החווה מריחה כמו בית.', en: 'Eight kinds of seeds, each in a jar with a date and the name of the one who sowed it. The farm smells like home.' } }],
      },
      {
        key: 'song', label: { he: 'שיר: השיר שהילדים שרים', en: 'A song: the one the children sing' },
        effect: { morale: 12, moraleFor: 3600, flags: ['ark:song'] },
        reply: [{ who: 'narrator', text: { he: 'מקליטים אותו במסדרון הראשי. הילדים שרים פעמיים, כי בפעם הראשונה כולם צחקו.', en: 'They record it in the main corridor. The children sing it twice, because the first time everyone laughed.' } }],
      },
    ],
  },
  {
    id: 'decision', number: 29,
    title: { he: 'ההחלטה הגדולה', en: 'The Big Decision' },
    // [Q1] Fires only when the Genesis button itself is open (the last Act done), not at the old research + 40 people gate.
    trigger: genesisReady,
    lines: [
      { who: 'noa', text: { he: 'בונקר 17, המכונה חמה. בראשית מוכנה.', en: 'Bunker 17, the machine is warm. Genesis is ready.' } },
      { who: 'noa', text: { he: 'כשתלחצו, כל מה שבניתם ייעלם: האולמות, החוות, הפנים. תתעוררו שוב בחדר החשוך ההוא. אבל תזכרו. ובכל פעם תחזרו חזקים יותר.', en: 'When you press it, everything you built will be gone: the halls, the farms, the faces. You\'ll wake up in that dark room again. But you will remember. And every time, you\'ll come back stronger.' } },
      { who: 'noa', when: s => s.prestige.rebirthCount > 0, text: { he: 'כבר עשיתם את זה פעם, נכון? אני שומעת את זה בקול שלכם. הפעם הגעתם מהר יותר.', en: 'You\'ve done this before, haven\'t you? I can hear it in your voice. You got here faster this time.' } },
      { who: 'noa', when: s => has(s, 'noa:volunteer'), text: { he: 'מי ששלחתם אליי עומד כאן לידי, ושולח לכם דרישת שלום.', en: 'The one you sent me is standing right here, and sends you their love.' } },
      { who: 'ezra', when: terminusSaved, text: { he: 'מה שלא תבחרו, המסוף איתכם. אנחנו חייבים לכם תחנה שלמה.', en: 'Whatever you choose, Terminus is with you. We owe you a whole station.' } },
      { who: 'gideon', when: s => gideonInside(s) || has(s, 'clan:wardens') || has(s, 'clan:united') || has(s, 'clan:peace'), text: { he: 'עשר שנים לקחתי מאנשים. אתם נתתם לי משהו להפסיד. אל תבזבזו את זה.', en: 'For ten years I took from people. You gave me something to lose. Don\'t waste it.' } },
      { who: 'maya', when: mayaHome, text: { he: 'אמא אמרה שהשמש מחכה לנו. אולי היא מחכה גם לנו של הפעם הבאה.', en: 'Mom said the sun was waiting for us. Maybe it\'s waiting for the next us, too.' } },
      { who: 'narrator', when: s => has(s, 'ark:song'), text: { he: 'במסדרון הראשי הילדים שרים את השיר מהתיבה. כולם יודעים אותו בעל פה.', en: 'In the main corridor the children sing the song from the Ark. Everyone knows it by heart.' } },
      { who: 'narrator', when: s => has(s, 'ark:names'), text: { he: 'גליל הנחושת עם השמות עומד בראש התיבה. כל אחד מוצא בו את אהוביו.', en: 'The copper scroll of names rests on top of the Ark. Everyone finds their loved ones in it.' } },
      { who: 'narrator', when: s => has(s, 'vote:republic'), text: { he: 'קלפיות הצבעה עדיין עומדות בחדר האוכל. מחר, כנראה, יצביעו על משהו אחר.', en: 'The ballot boxes still stand in the canteen. Tomorrow, probably, they will vote on something else.' } },
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

// ---- [ux-wp5 C10] Between the chapters: short moments from Act III on, so the long middle of a run still has a voice ----

/** World seconds since the last story moment before an interlude may come (chapters keep their own pace). */
export const INTERLUDE_GAP = 2.5 * 86400;

/** World time of the last chapter or interlude told in this run (the Chronicle keeps it), or the start of the Act. */
function lastStoryAt(s: GameState): number {
  const lg = s.longGame;
  if (!lg) return 0;
  const run = lg.meta.runIndex;
  const list = lg.chronicle ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].k === 'chapter' && list[i].run === run) return Math.max(list[i].t, lg.meta.actSince);
  return lg.meta.actSince;
}
const quietLong = (s: GameState) => !!s.longGame && s.longGame.meta.worldT - lastStoryAt(s) >= INTERLUDE_GAP;
const STORY_PEOPLE = new Set(['Maya', 'Gideon']);

/** The people an interlude speaks of, picked from the bunker the same way every time (so a replay names the same people). */
type CastKey = 'child' | 'baby' | 'kid' | 'a' | 'b' | 'elder';
function castOf(s: GameState): Partial<Record<CastKey, SurvivorState>> {
  const out: Partial<Record<CastKey, SurvivorState>> = {};
  const ppl = s.survivors.filter(x => !STORY_PEOPLE.has(x.name));
  out.child = ppl.find(x => (x.parentIds?.length ?? 0) > 0); // the first one born here
  out.kid = ppl.find(x => x.child);
  // The youngest one born here who is still small.
  out.baby = ppl.filter(x => x.child && (x.parentIds?.length ?? 0) > 0).sort((p, q) => (q.bornAt ?? 0) - (p.bornAt ?? 0))[0];
  const a = ppl.find(x => !x.child && x.partnerId && ppl.some(p => p.id === x.partnerId));
  if (a) { out.a = a; out.b = ppl.find(p => p.id === a.partnerId); }
  out.elder = ppl.find(x => !x.child && !x.parentIds?.length);
  return out;
}
const cast = (s: GameState, ...keys: CastKey[]) => { const c = castOf(s); return keys.every(k => !!c[k]); };

const tell = (he: string, en: string, who: StoryLine['who'] = 'narrator'): StoryLine => ({ who, text: { he, en } });

export const INTERLUDES: Chapter[] = [
  {
    id: 'i_firstSteps', number: 0, interlude: true,
    title: { he: 'צעד ראשון', en: 'A First Step' },
    trigger: s => actAtLeast(s, 3) && quietLong(s) && cast(s, 'baby'),
    lines: [
      tell('{baby} עשה/תה צעד ראשון היום, בין השולחנות בחדר האוכל. ארבעים איש הפסיקו לאכול כדי להסתכל.', '{baby} took a first step today, between the canteen tables. Forty people stopped eating to watch.'),
      tell('מישהו הציע לכתוב את זה ביומן. כתבנו. מתחת לדוח המים, באותיות גדולות.', 'Someone said we should write it in the log. We did. Under the water report, in big letters.', 'crew'),
    ],
    effect: { morale: 3, moraleFor: 900 },
  },
  {
    id: 'i_curtain', number: 0, interlude: true,
    title: { he: 'וילון משלושה דגלים', en: 'A Curtain of Three Flags' },
    trigger: s => actAtLeast(s, 3) && quietLong(s) && cast(s, 'a', 'b'),
    lines: [
      tell('{a} ו{b} ביקשו פינה משלהם. קיבלו אחת בקומה השקטה, ווילון שתפרו להם משלושה דגלים ישנים.', '{a} and {b} asked for a corner of their own. They got one on the quiet level, and a curtain sewn for them from three old flags.'),
      tell('אף אחד לא זוכר של מי היו הדגלים. עכשיו הם של שניהם.', 'Nobody remembers whose flags they were. Now they belong to the two of them.'),
    ],
    effect: { morale: 3, moraleFor: 900 },
  },
  {
    id: 'i_stations', number: 0, interlude: true,
    title: { he: 'שמות התחנות', en: 'The Names of the Stations' },
    trigger: s => actAtLeast(s, 4) && quietLong(s) && has(s, 'story:terminus'),
    lines: [
      tell('הערב אין לי חדשות. רק רציתי להקריא את שמות התחנות של הקו הישן, אחת אחרי השנייה. שמישהו יזכור אותן.', 'No news tonight. I just wanted to read out the names of the stations on the old line, one after another. So someone remembers them.', 'ezra'),
      tell('הוא הקריא שלושים ושבע תחנות. בחדר הרדיו אף אחד לא זז עד הסוף.', 'He read thirty-seven stations. In the radio room, nobody moved until the end.'),
    ],
    effect: { morale: 3, moraleFor: 900 },
  },
  {
    id: 'i_reading', number: 0, interlude: true,
    title: { he: 'יציאת חירום', en: 'Emergency Exit' },
    trigger: s => actAtLeast(s, 4) && quietLong(s) && mayaHome(s) && cast(s, 'kid'),
    lines: [
      tell('אני מלמדת את הילדים לקרוא מהשלטים שעל הקירות. אין לנו ספרים, אבל יש לנו הרבה חצים.', 'I\'m teaching the children to read from the signs on the walls. We have no books, but we have a lot of arrows.', 'maya'),
      tell('{kid} הקריא/ה בקול "יציאת חירום", ושאל/ה מה זה יציאה. מאיה חשבה הרבה זמן לפני שענתה.', '{kid} read "EMERGENCY EXIT" out loud and asked what an exit is. Maya thought for a long time before she answered.'),
    ],
    effect: { morale: 3, moraleFor: 900 },
  },
  {
    id: 'i_gideonNote', number: 0, interlude: true,
    title: { he: 'פתק על חץ', en: 'A Note on an Arrow' },
    trigger: s => actAtLeast(s, 5) && quietLong(s) && has(s, 'story:clan'),
    lines: [
      tell('בבוקר מצאנו חץ נעוץ בדלת, ועליו פתק.', 'In the morning there was an arrow in the door, with a note on it.'),
      { who: 'gideon', when: clanFriend, text: { he: '"השבט חי. החורף עבר. אם תצטרכו ידיים, תצעקו חזק. גדעון."', en: '"The Clan lives. Winter passed. If you need hands, shout loud. Gideon."' } },
      { who: 'gideon', when: clanFoe, text: { he: '"אנחנו עדיין כאן. אנחנו עדיין זוכרים. אבל גם אנחנו עייפים. ג׳."', en: '"We are still here. We still remember. But we are tired too. G."' } },
    ],
    effect: { morale: 2, moraleFor: 900 },
  },
  {
    id: 'i_elder', number: 0, interlude: true,
    title: { he: 'איך היה פעם', en: 'How It Used to Be' },
    trigger: s => actAtLeast(s, 5) && quietLong(s) && cast(s, 'elder') && s.survivors.length >= 40,
    lines: [
      tell('הערב, בחדר האוכל, הצעירים ביקשו מ{elder} לספר איך היה פעם: כשהמנורות היו ורודות, המרק היה דליל, והדלת נפתחה פעם בשבוע.', 'Tonight in the canteen, the young ones asked {elder} to tell how it used to be: when the lamps were pink, the soup was thin, and the door opened once a week.'),
      tell('הסיפור נגמר מאוחר. בסוף כולם ביקשו לשמוע אותו שוב מחר.', 'The story ran late. At the end everyone asked to hear it again tomorrow.'),
    ],
    effect: { morale: 3, moraleFor: 900 },
  },
  {
    id: 'i_cake', number: 0, interlude: true,
    title: { he: 'עוגה משעועית', en: 'A Bean Cake' },
    trigger: s => actAtLeast(s, 5) && quietLong(s) && cast(s, 'child') && has(s, 'story:i_firstSteps'),
    lines: [
      tell('הילדים אפו עוגה משעועית ומסוכר שאף אחד לא ידע שיש לנו. היום יום ההולדת של {child}, הראשון/ה שנולד/ה כאן.', 'The children baked a cake from beans and sugar nobody knew we had. It is {child}\'s birthday, the first one born here.'),
      tell('לא היו נרות, אז כיבינו לרגע את כל האורות בקומה. כולם שרו בחושך.', 'There were no candles, so we turned off every light on the level for a moment. Everyone sang in the dark.', 'crew'),
    ],
    effect: { morale: 3, moraleFor: 900 },
  },
  {
    id: 'i_noaNoticed', number: 0, interlude: true,
    title: { he: 'מישהו שם לב', en: 'Someone Noticed' },
    trigger: s => actAtLeast(s, 6) && quietLong(s) && has(s, 'story:genesis'),
    lines: [
      tell('מדדתי משהו הלילה: את קרינת האיזוטופ מהכיוון שלכם. היא עלתה. אתם בונים משהו.', 'I measured something tonight: the isotope reading from your direction. It went up. You are building something.', 'noa'),
      tell('לא ביקשתי כלום. רק רציתי שתדעו שמישהו שם לב.', 'I\'m not asking for anything. I just wanted you to know someone noticed.', 'noa'),
    ],
    effect: { morale: 3, moraleFor: 900 },
  },
  {
    id: 'i_quietNight', number: 0, interlude: true,
    title: { he: 'לילה בלי אזעקה', en: 'A Night Without Alarms' },
    trigger: s => actAtLeast(s, 6) && quietLong(s),
    lines: [
      tell('לילה שלם בלי אזעקה אחת. השומר נרדם ליד הדלת, ואף אחד לא העיר אותו.', 'A whole night without a single alarm. The lookout fell asleep by the door, and nobody woke them.'),
      tell('בבוקר כולם עשו את עצמם כאילו לא שמו לב.', 'In the morning everyone pretended not to have noticed.'),
    ],
    effect: { morale: 3, moraleFor: 900 },
  },
];

/** Fills an interlude's names ({child}, {a}, ...) in both languages; the Hebrew "/" forms follow the one person a line names. */
function withNames(line: StoryLine, s: GameState | undefined): StoryLine {
  if (!s || !line.text.en.includes('{')) return line;
  const c = castOf(s);
  const named = new Set<SurvivorState>();
  const fill = (text: string, lang: 'he' | 'en') => text.replace(/\{(\w+)\}/g, (m, k: string) => {
    const p = c[k as CastKey];
    if (!p) return m;
    named.add(p);
    return lang === 'he' ? (localizeName(p.name, 'he') ?? p.name) : p.name;
  });
  const en = fill(line.text.en, 'en');
  let he = fill(line.text.he, 'he');
  if (named.size === 1) he = resolveGender(he, genderOf([...named][0]));
  return { ...line, text: { he, en } };
}

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
  return lines.filter(l => !l.when || (!!s && l.when(s))).map(l => withNames(l, s));
}

export function shownChoices(ch: Chapter): StoryChoice[] {
  const s = liveState?.();
  return (ch.choices ?? []).filter(c => !c.when || (!!s && c.when(s)));
}

export function getChapter(id: string): Chapter | undefined {
  return CHAPTERS.find(c => c.id === id) ?? INTERLUDES.find(c => c.id === id);
}

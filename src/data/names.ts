import type { Gender } from './portraits';

/**
 * [ux-wp5 C5] The people's names. A survivor's name is stored once, in English (old saves keep theirs as they are),
 * and shown in Hebrew through this table. Each English name is paired with one Hebrew name of the same gender, so a
 * person keeps one identity in both languages. The Hebrew name decides the grammatical gender (as before).
 *
 * The first 20 pairs are the original pool (their Hebrew side is fixed: saves depend on it). New people are drawn from
 * the large pool below, unique among the living; when every name is taken a letter is added ("Adam B." / "אדם ב׳").
 * Never used: the story's people (Noa, Maya, Gideon, Ezra, David, Yossi, Rachel, Ali, Boris, Amit) and "Saul", the trader.
 */

/** The original 20 names (index-paired with their Hebrew names, as in every save made so far). */
const LEGACY_EN = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery', 'Quinn', 'Dana',
  'Max', 'Eli', 'Kai', 'Sage', 'Rowan', 'River', 'Sky', 'Phoenix', 'Blake', 'Drew'];
const LEGACY_HE = ['דני', 'יעל', 'אורי', 'נועה', 'עידו', 'מיכל', 'איתי', 'שירה', 'ליאור', 'תמר',
  'רועי', 'הילה', 'גל', 'דנה', 'אלון', 'ענבל', 'עמית', 'רונית', 'ניר', 'הדר'];
const LEGACY_G: Gender[] = ['m', 'f', 'm', 'f', 'm', 'f', 'm', 'f', 'n', 'f', 'm', 'f', 'n', 'f', 'm', 'f', 'n', 'f', 'm', 'n'];
/** Old names no longer handed out: Taylor is "נועה" (Dr. Noa of the story) and the unisex ones need slashes in Hebrew. */
const LEGACY_RETIRED = new Set(['Taylor', 'Quinn', 'Kai', 'Sky', 'Drew']);

const MALE_EN = ['Adam', 'Aaron', 'Ethan', 'Leo', 'Owen', 'Lucas', 'Henry', 'Oliver', 'Jack', 'Samuel',
  'Daniel', 'Gabriel', 'Isaac', 'Jonah', 'Caleb', 'Felix', 'Hugo', 'Oscar', 'Theo', 'Victor',
  'Arthur', 'Simon', 'Peter', 'Paul', 'Mark', 'Vincent', 'Nathan', 'Elias', 'Tobias', 'Julian',
  'Marcus', 'Anton', 'Ivan', 'Mateo', 'Diego', 'Rafael', 'Omar', 'Karim', 'Yusuf', 'Tariq',
  'Hassan', 'Kenji', 'Hiro', 'Tomas', 'Pavel', 'Milan', 'Luka', 'Emil', 'Otto', 'Bruno',
  'Carl', 'Frank', 'George', 'Harold', 'Ian', 'Joel', 'Kevin', 'Liam', 'Mason', 'Neil',
  'Patrick', 'Quentin', 'Ray', 'Scott', 'Troy', 'Walter', 'Wesley', 'Xavier', 'Zane', 'Abel',
  'Cyrus', 'Dmitri', 'Erik', 'Finn', 'Glen', 'Hector', 'Ismael', 'Jasper', 'Kofi', 'Lionel'];
const MALE_HE = ['אדם', 'אהרון', 'איתן', 'יונתן', 'עומר', 'נדב', 'יואב', 'אסף', 'גיא', 'עידן',
  'תומר', 'אביב', 'אמיר', 'אליה', 'בועז', 'גלעד', 'דביר', 'הראל', 'חגי', 'יאיר',
  'כפיר', 'לביא', 'מתן', 'נתנאל', 'עמרי', 'פלג', 'צבי', 'רון', 'אבנר', 'ברק',
  'דורון', 'אבי', 'אביתר', 'אהוד', 'אוהד', 'אופיר', 'אורן', 'אייל', 'אלעד', 'אמנון',
  'אריה', 'בני', 'גדי', 'גיל', 'דור', 'זאב', 'חיים', 'חנן', 'טוביה', 'יגאל',
  'ידידיה', 'יהודה', 'יחיאל', 'ירון', 'ישי', 'מאיר', 'מנחם', 'משה', 'נחום', 'נתן',
  'סער', 'עוז', 'עזרי', 'עמוס', 'ערן', 'פנחס', 'צחי', 'קובי', 'ראובן', 'רפאל',
  'שגיא', 'שלמה', 'שמעון', 'שמואל', 'תמיר', 'אליאב', 'אלחנן', 'בצלאל', 'סמיר', 'ואדים'];
const FEMALE_EN = ['Ada', 'Alice', 'Amelia', 'Anna', 'Bella', 'Clara', 'Chloe', 'Daisy', 'Diana', 'Edith',
  'Elena', 'Ella', 'Emma', 'Erin', 'Eva', 'Fiona', 'Freya', 'Grace', 'Hannah', 'Hazel',
  'Helen', 'Ida', 'Iris', 'Isla', 'Ivy', 'Jade', 'Jane', 'Julia', 'June', 'Kate',
  'Laura', 'Lea', 'Lena', 'Lily', 'Lucy', 'Lydia', 'Mabel', 'Martha', 'Mila', 'Nadia',
  'Nina', 'Nora', 'Olive', 'Olivia', 'Paula', 'Pearl', 'Petra', 'Rosa', 'Ruby', 'Ruth',
  'Sara', 'Selma', 'Sofia', 'Stella', 'Tess', 'Thea', 'Una', 'Vera', 'Violet', 'Wendy',
  'Yara', 'Zoe', 'Agnes', 'Beatrice', 'Celia', 'Dora', 'Esther', 'Flora', 'Greta', 'Hilda',
  'Ines', 'Joan', 'Kira', 'Leila', 'Magda', 'Nell', 'Opal', 'Rhea', 'Talia', 'Yasmin'];
const FEMALE_HE = ['אביגיל', 'אדוה', 'אורית', 'אורנה', 'אילנה', 'איריס', 'אלה', 'אלינור', 'אסנת', 'אפרת',
  'בתיה', 'גאיה', 'גילה', 'גלית', 'דבורה', 'דליה', 'דפנה', 'הגר', 'הדס', 'הודיה',
  'ורד', 'זהבה', 'חגית', 'חנה', 'טליה', 'טובה', 'יהודית', 'יונית', 'יפעת', 'כנרת',
  'לאה', 'לילך', 'לימור', 'מאירה', 'מירב', 'מירי', 'מלכה', 'נטע', 'נילי', 'נירית',
  'נעמה', 'סיגל', 'עדינה', 'ענת', 'עפרה', 'צופיה', 'ציפי', 'קרן', 'רבקה', 'רות',
  'רינה', 'רעות', 'שושנה', 'שולה', 'שלומית', 'שני', 'שרה', 'תהילה', 'אסתר', 'אושרת',
  'אביטל', 'בלה', 'גליה', 'דנית', 'זיוה', 'כוכבה', 'ליבי', 'מרים', 'נורית', 'עינב',
  'פזית', 'רוית', 'מרגלית', 'אנה', 'לנה', 'נדיה', 'סלמה', 'ליילה', 'ראניה', 'סמירה'];

interface NameDef { en: string; he: string; g: Gender }

const TABLE: NameDef[] = [
  ...LEGACY_EN.map((en, i) => ({ en, he: LEGACY_HE[i], g: LEGACY_G[i] })),
  ...MALE_EN.map((en, i) => ({ en, he: MALE_HE[i], g: 'm' as Gender })),
  ...FEMALE_EN.map((en, i) => ({ en, he: FEMALE_HE[i], g: 'f' as Gender })),
];
const BY_EN = new Map(TABLE.map(d => [d.en, d]));

/** The names new people are drawn from (more than 150 per language). */
export const NAME_POOL: readonly string[] = TABLE.filter(d => !LEGACY_RETIRED.has(d.en)).map(d => d.en);

/** Hebrew letters for the second, third... person of the same name (ב׳, ג׳, ...). English uses B., C., ... */
const SUFFIX_EN = 'BCDEFGHJKLMNPRSTVWZ';
const SUFFIX_HE = 'בגדהוזחטיכלמנסעפצקר';
const SUFFIXED = /^(.+) ([A-Z])\.$/;

function split(name: string): { base: string; n: number } {
  const m = SUFFIXED.exec(name);
  if (!m) return { base: name, n: -1 };
  return { base: m[1], n: SUFFIX_EN.indexOf(m[2]) };
}

/** The name in the reader's language (unknown names, like the story's own people, come back unchanged). */
export function localizeName(name: string, locale: 'en' | 'he'): string | null {
  if (locale !== 'he') return null;
  const { base, n } = split(name);
  const def = BY_EN.get(base);
  if (!def) return null;
  return n >= 0 ? `${def.he} ${SUFFIX_HE[n] ?? ''}׳` : def.he;
}

/** The gender a name carries in Hebrew sentences ('n' for the old unisex names), or null when the name is not in the table. */
export function nameGenderOf(name: string): Gender | null {
  return BY_EN.get(split(name).base)?.g ?? null;
}

/**
 * A name for a new person: one roll of `rng` (so a seeded run draws exactly as many numbers as before), then the first
 * name from there that nobody living carries; if all are taken, the rolled name with the first free letter.
 */
export function pickName(roll: number, taken: ReadonlySet<string>): string {
  const pool = NAME_POOL;
  const start = Math.min(pool.length - 1, Math.max(0, Math.floor(roll * pool.length)));
  for (let k = 0; k < pool.length; k++) {
    const cand = pool[(start + k) % pool.length];
    if (!taken.has(cand)) return cand;
  }
  const base = pool[start];
  for (let n = 0; n < SUFFIX_EN.length; n++) {
    const cand = `${base} ${SUFFIX_EN[n]}.`;
    if (!taken.has(cand)) return cand;
  }
  return base;
}

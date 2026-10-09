#!/usr/bin/env node
// [ux-wp6] Glossary lint (store/ux-review/GLOSSARY.md): one Hebrew name per game concept, and buttons speak in the plural.
// Errors: src/i18n/he.json and the Hebrew prose of src/data/book.ts. Warnings (not failing): the Hebrew text of the other
// src/data/*.ts files, which belong to other parts of the game and are listed so they can follow the glossary later.
// Usage: node tools/sim/glossary-lint.mjs [--strict]   (--strict also fails on the warnings)
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const B = '(^|[^\\u05d0-\\u05ea])'; // a Hebrew word starts here
const E = '(?=[^\\u05d0-\\u05ea]|$)'; // and ends here
const P = '(?:ו?(?:ה|ל|ב|מ|ש|כ|מה|לה|שה|וה|כש)?)'; // the one-letter prefixes Hebrew glues on

/** Each rule: what is banned, what to write instead, and (optionally) strings where the word means something else. */
const RULES = [
  { re: new RegExp(`${B}${P}קרדיט(ים)?${E}`), use: 'זיכויים / זיכויי סחר (credits)' },
  { re: new RegExp(`${B}${P}תוכני(ת|ות)${E}`), use: 'שרטוט / שרטוטים (blueprints)' },
  { re: /לוח הפיקוד/, use: 'מרכז הפיקוד (the Command panel)' },
  { re: new RegExp(`${B}${P}זירוז${E}`), use: 'האצה (rush / boost)' },
  { re: /לידה מחדש|נולדתם מחדש/, use: 'בראשית (Genesis)' },
  { re: new RegExp(`${B}(?:ה|ל|ב|לה|וה|של)ריצה${E}`), use: 'סיבוב / "הסיבוב הזה" (a run)', allow: /מגיעים בריצה/ },
  { re: /ציר זמן/, use: 'סיבוב (a run)' },
  { re: new RegExp(`${B}${P}אמנ(ה|ות)${E}`), use: 'פרויקט המערכה (a charter)' },
  { re: new RegExp(`${B}${P}משוש(ה|ים)${E}`), use: 'אזור / אזורים (a map region)' },
  { re: /(^|[^A-Za-z])Mk\s?\d*(?![A-Za-z])/, use: 'רמה (room level)', hebrewOnly: true },
  { re: /מטבע המערכה/, use: 'משאב המערכה / "מה שהמחירים במערכה דורשים"' },
  { re: new RegExp(`${B}${P}מורשת${E}`), use: 'איזוטופ-7 (the Genesis payout)' },
  { re: /תיבת יום|תיבת היום/, use: 'מטמון היום (the day chest)' },
  { re: new RegExp(`${B}${P}תיבה${E}`), use: 'תיבת ההחלטות (inbox) / מטמון היום (day chest); "התיבה" only for the Ark ending', allow: /חבר העמים|^התיבה$/ },
  { re: new RegExp(`${B}${P}דיירי?ם?${E}(?! הקודמים)`), use: 'ניצולים (the bunker\'s people; "הדיירים הקודמים" only for the old residents in the lore)', allow: /41 הדיירים/ },
  { re: new RegExp(`${B}(?:ה|ל|מה|של)שורד(ים)?${E}`), use: 'ניצול / ניצולים (survivors)' },
  { re: new RegExp(`${B}${P}הד${E}`), use: 'בונוס בראשית (the echo modifier)', allow: /מהדהד/ },
  // Buttons and commands speak to the player in the plural ("שדרגו", not "שדרג").
  { re: /^(שדרג|שלח|בנה|סגור|פתח|הפעל|הוסף|התחל|קח|תקן|כבה|תן|ענה|סמן|העתק|הקש|חפור|שבץ|הכנס|השאר|המשך|לחץ|גרור|בחר|חזור)(?= |$)/, use: 'plural address (שדרגו, שלחו, בנו...) or a noun (שדרוג, סגירה)' },
];

const hebrew = s => /[א-ת]/.test(s);
function check(where, key, text, out) {
  for (const r of RULES) {
    if (r.hebrewOnly && !hebrew(text)) continue;
    const m = text.match(r.re);
    if (!m) continue;
    if (r.allow && r.allow.test(text)) continue;
    out.push(`${where} ${key}: "${m[0].trim()}" -> ${r.use}\n     ${text.length > 140 ? text.slice(0, 140) + '...' : text}`);
  }
}

/** The Hebrew string literals of a TypeScript data file ({ he: '...' } and he: "..."). */
function hebrewLiterals(file) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  const re = /\bhe:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ key: `line ${line}`, text: m[2].replace(/\\'/g, '\'').replace(/\\"/g, '"') });
  }
  return out;
}

const errors = [];
const warnings = [];
const he = JSON.parse(readFileSync(join(ROOT, 'src', 'i18n', 'he.json'), 'utf8'));
for (const [k, v] of Object.entries(he)) check('he.json', k, String(v), errors);
for (const { key, text } of hebrewLiterals(join(ROOT, 'src', 'data', 'book.ts'))) check('book.ts', key, text, errors);
const dataDir = join(ROOT, 'src', 'data');
for (const f of readdirSync(dataDir).filter(f => f.endsWith('.ts') && f !== 'book.ts').sort()) {
  for (const { key, text } of hebrewLiterals(join(dataDir, f))) check(`data/${f}`, key, text, warnings);
}

const strict = process.argv.includes('--strict');
if (warnings.length) console.log(`glossary: ${warnings.length} warning(s) in other data files (owned elsewhere; follow GLOSSARY.md when touched)\n - ${warnings.join('\n - ')}`);
if (errors.length || (strict && warnings.length)) {
  console.error(`glossary: ${errors.length} problem(s)\n - ${errors.join('\n - ')}`);
  process.exit(1);
}
console.log(`glossary OK (${Object.keys(he).length} Hebrew strings and the Bunker Book follow store/ux-review/GLOSSARY.md)`);

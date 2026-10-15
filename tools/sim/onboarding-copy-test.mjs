// [ux-redesign QA W3] The onboarding copy rules (store/ux-redesign/03-plan.md, W3a): every line the spotlight bubble, the advisor
// strip, the walkthrough and the lock popover show is at most eight words, exists in both languages, and keeps the same {placeholders}.
// Reads the locale files only (no game code). Run: node tools/sim/onboarding-copy-test.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (l) => JSON.parse(readFileSync(resolve(ROOT, 'src', 'i18n', `${l}.json`), 'utf8'));
const he = load('he');
const en = load('en');

/** Short lines: the bubble, the strip (advisor + tutorial steps), the walk, the lock / unlock lines, the arrows and the home button. */
const SHORT = /^(ux3a\.(spot|walk|unlock|guide|crisis|collect|rec|obj)\.|ux3a\.(skip|next|done|lock\.show|tutorialAgain)$|ux3b\.(arrow\.|home$))/;
const MAX_WORDS = 8;

let fails = 0;
const fail = (msg) => { fails++; console.error('FAIL', msg); };

// A placeholder ({f}, {res}, {n}, {name}, {what}) stands for one or two words; count it as one.
const words = (s) => s.replace(/\{\w+\}/g, 'X').replace(/\[\[\w+\]\]/g, '').trim().split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

const keys = new Set([...Object.keys(he), ...Object.keys(en)].filter(k => SHORT.test(k)));
if (keys.size < 40) fail(`expected the W3 onboarding keys, found only ${keys.size}`);
for (const k of [...keys].sort()) {
  for (const [lang, dict] of [['he', he], ['en', en]]) {
    const v = dict[k];
    if (typeof v !== 'string' || !v.trim()) { fail(`${k}: missing in ${lang}`); continue; }
    const n = words(v);
    if (n > MAX_WORDS) fail(`${k} (${lang}) has ${n} words (max ${MAX_WORDS}): "${v}"`);
  }
  if (typeof he[k] === 'string' && typeof en[k] === 'string' && holes(he[k]) !== holes(en[k])) {
    fail(`${k}: placeholders differ he {${holes(he[k])}} vs en {${holes(en[k])}}`);
  }
}

// Every tutorial step the advisor shortens (advisor.ts SHORT) has a line in both languages.
const advisor = readFileSync(resolve(ROOT, 'src', 'ui', 'onboarding', 'advisor.ts'), 'utf8');
const block = advisor.match(/const SHORT[^{]*\{([\s\S]*?)\};/);
if (!block) fail('advisor.ts SHORT table not found');
else {
  for (const id of [...block[1].matchAll(/(\w+):/g)].map(m => m[1])) {
    if (!he[`ux3a.obj.${id}`] || !en[`ux3a.obj.${id}`]) fail(`ux3a.obj.${id}: the advisor shortens this step but a language has no line`);
  }
}

if (fails) { console.error(`onboarding-copy-test: ${fails} failure(s)`); process.exit(1); }
console.log(`onboarding-copy-test OK (${keys.size} short lines, he + en, max ${MAX_WORDS} words)`);

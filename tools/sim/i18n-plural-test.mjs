#!/usr/bin/env node
// [ux-redesign w5] Plural lint: counted phrases go through plural() (src/ui/format.ts) with <key>.one / .two / .other in both languages.
// Checks: every plural family is complete in en and he; every plural('<key>', ...) call names a family that exists; the Hebrew dual
// form (.two) spells the two out ("שני", "שתי", "יומיים") instead of "2 ..."; and no new hand-split "n === 1 ? 'a' : 'b'" key pairs.
// Plain Node, no bundle. Exit 1 on any problem. Usage: node tools/sim/i18n-plural-test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = lang => JSON.parse(readFileSync(join(ROOT, 'src', 'i18n', `${lang}.json`), 'utf8'));
const T = { en: load('en'), he: load('he') };
const problems = [];
const FORMS = ['one', 'two', 'other'];

// 1. Complete families. A family is a base with a ".two" key, or with both ".one" and ".other" (either alone can be an ordinary name:
// wp3.missing.one, wp3.cause.other).
const bases = new Set();
for (const k of Object.keys(T.en)) {
  const m = /^(.+)\.(one|two|other)$/.exec(k);
  if (m && (`${m[1]}.two` in T.en || (`${m[1]}.one` in T.en && `${m[1]}.other` in T.en))) bases.add(m[1]);
}
for (const base of bases) {
  for (const lang of ['en', 'he']) {
    for (const f of FORMS) if (!(`${base}.${f}` in T[lang])) problems.push(`${lang}: plural family ${base} lacks .${f}`);
  }
  const two = T.he[`${base}.two`];
  // The Hebrew dual: written out, not "2 ..." (a signed "+2" next to an icon is a count badge and may stay a digit).
  if (two && /(^|[^+\d])\{n\}/.test(two)) problems.push(`he: ${base}.two still says {n}; write the dual out ("שני", "שתי", "יומיים")`);
  if (two && /(^|\s)2\s+[א-ת]/.test(two) && !/\+2/.test(two)) problems.push(`he: ${base}.two says "2 <noun>": write the dual out`);
}

// 2. Every plural() call in src names a family that exists (literal keys only; template keys are checked by prefix).
const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.ts')) files.push(p); } };
walk(join(ROOT, 'src'));
let calls = 0;
const HAND_SPLIT = /===\s*1\s*\?\s*'([\w.]+)'\s*:\s*'([\w.]+)'/g;
// Pairs that are not one-vs-many counts of the same phrase (a name instead of a number, or two numbers in one sentence): kept by design.
const ALLOWED_SPLIT = new Set([]); // [final] night.raidsLost now takes its counts from night.raidsLostPart
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).split(sep).join('/');
  for (const m of text.matchAll(/\bplural\(\s*'([\w.]+)'/g)) {
    calls++;
    if (!bases.has(m[1])) problems.push(`${rel}: plural('${m[1]}') but ${m[1]}.one/.two/.other are not in the string tables`);
  }
  for (const m of text.matchAll(/\bplural\(\s*`([\w.]+)\$\{/g)) {
    calls++;
    if (![...bases].some(b => b.startsWith(m[1]))) problems.push(`${rel}: plural(\`${m[1]}...\`) matches no plural family`);
  }
  for (const m of text.matchAll(HAND_SPLIT)) {
    const pair = `${m[1]}|${m[2]}`;
    if (m[1] in T.en && m[2] in T.en && !ALLOWED_SPLIT.has(pair)) problems.push(`${rel}: hand-split count keys ${m[1]} / ${m[2]}: use plural()`);
  }
}

// 3. The forms Intl picks in each language exist (1, 2, 5, 20, 100 in Hebrew; 1, 2, 5 in English).
for (const [lang, ns] of [['he', [1, 2, 5, 20, 100]], ['en', [0, 1, 2, 5]]]) {
  const pr = new Intl.PluralRules(lang);
  for (const n of ns) {
    const cat = pr.select(n);
    if (!FORMS.includes(cat) && cat !== 'many') problems.push(`${lang}: Intl.PluralRules says "${cat}" for ${n}, plural() has no such form`);
  }
}

if (problems.length) {
  console.error(`i18n-plural-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`i18n-plural-test OK (${bases.size} plural families, ${calls} plural() calls)`);

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = '/home/user/last-bunker-qa';
const he = JSON.parse(readFileSync(ROOT + '/src/i18n/he.json', 'utf8'));
const en = JSON.parse(readFileSync(ROOT + '/src/i18n/en.json', 'utf8'));
const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!/node_modules|dist/.test(p)) walk(p); } else if (/\.(ts|html|mjs|js)$/.test(f)) files.push(p); } };
walk(ROOT + '/src'); walk(ROOT + '/tools'); walk(ROOT + '/public'); files.push(ROOT + '/index.html');
const text = files.map(f => [f, readFileSync(f, 'utf8')]);
const srcOnly = text.filter(([f]) => f.includes('/src/'));
// 1. literal t('key'
const lit = new Map(); const dyn = new Map();
const re = /\b(?:i18n\.t|\.t|t)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
for (const [f, s] of srcOnly) {
  for (const m of s.matchAll(re)) {
    const k = m[2];
    if (m[1] === '`' && k.includes('${')) { const pre = k.split('${')[0]; dyn.set(pre, (dyn.get(pre) ?? 0) + 1); }
    else if (/^[a-zA-Z0-9_.-]+$/.test(k)) lit.set(k, (lit.get(k) ?? []).concat(f.replace(ROOT + '/', '')));
  }
}
const missingHe = [...lit.keys()].filter(k => !(k in he));
const missingEn = [...lit.keys()].filter(k => !(k in en));
console.log('literal keys used', lit.size, 'dyn prefixes', dyn.size);
console.log('used but missing in he:', missingHe.length, missingHe.slice(0, 40).join(' '));
console.log('used but missing in en:', missingEn.length, missingEn.slice(0, 40).join(' '));
console.log('he-only', Object.keys(he).filter(k => !(k in en)).join(' ') || '-', '| en-only', Object.keys(en).filter(k => !(k in he)).join(' ') || '-');
// 2. orphans: key string appears nowhere in src/tools besides the json files
const allSrc = text.filter(([f]) => !/i18n\/(he|en)\.json/.test(f)).map(([, s]) => s).join('\n');
const orphans = [];
for (const k of Object.keys(he)) {
  if (lit.has(k)) continue;
  // dynamic prefix match
  if ([...dyn.keys()].some(p => p && k.startsWith(p))) continue;
  if (allSrc.includes(`'${k}'`) || allSrc.includes(`"${k}"`) || allSrc.includes('`' + k + '`')) continue;
  orphans.push(k);
}
console.log('orphans (no literal use, no dynamic prefix, not quoted anywhere):', orphans.length);
console.log(orphans.join(' '));
console.log('dyn prefixes:', [...dyn.keys()].join(' '));
// 3. placeholder parity he vs en
const ph = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const mismatch = Object.keys(he).filter(k => k in en && ph(he[k]) !== ph(en[k]));
console.log('placeholder mismatch he/en:', mismatch.length);
for (const k of mismatch) console.log('  ', k, '| he:', ph(he[k]), '| en:', ph(en[k]));
// 4. call-site param check for literal keys
const probs = [];
for (const [f, s] of srcOnly) {
  for (const m of s.matchAll(/\b(?:i18n\.t|\.t)\(\s*(['"])([a-zA-Z0-9_.-]+)\1\s*(,\s*\{)?/g)) {
    const k = m[2]; if (!(k in en)) continue;
    const need = [...new Set([...en[k].matchAll(/\{(\w+)\}/g)].map(x => x[1]))];
    if (!need.length && !m[3]) continue;
    let given = [];
    if (m[3]) {
      // read balanced object
      let i = m.index + m[0].length; let depth = 1; let j = i;
      while (j < s.length && depth > 0) { const c = s[j]; if (c === '{') depth++; else if (c === '}') depth--; j++; }
      const body = s.slice(i, j - 1);
      // top-level keys: split on commas at depth 0
      let d = 0, cur = '', parts = [];
      for (const c of body) { if ('({['.includes(c)) d++; if (')}]'.includes(c)) d--; if (c === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += c; }
      parts.push(cur);
      given = parts.map(p => p.trim()).filter(Boolean).map(p => (p.startsWith('...') ? '...' : p.match(/^['"]?(\w+)['"]?/)?.[1]));
    } else {
      // called without params but string has placeholders: check if passes variable as 2nd arg
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 40);
      if (/^\s*,/.test(after)) continue; // variable params
    }
    if (given.includes('...')) continue;
    const miss = need.filter(n => !given.includes(n));
    if (miss.length) probs.push(`${f.replace(ROOT + '/src/', '')}:${s.slice(0, m.index).split('\n').length} ${k} needs {${miss.join(',')}} given [${given.filter(x=>x!=='g').join(',')}]`);
  }
}
console.log('call sites missing params:', probs.length);
console.log(probs.slice(0, 60).join('\n'));
console.log('\n=== refined orphans');
const fam = [], real = [];
for (const k of orphans) {
  const base = k.slice(0, k.lastIndexOf('.'));
  const used = allSrc.includes(`'${base}'`) || allSrc.includes(`"${base}"`) || allSrc.includes('`' + base + '.') || allSrc.includes(`'${base}.'`) || allSrc.includes('`' + base + '`');
  (used ? fam : real).push(k);
}
console.log('real orphans', real.length, real.join(' '));
console.log('family-covered', fam.length);

#!/usr/bin/env node
// [ux-redesign W1] Design-token test: one :root (src/styles/tokens.css), every brief token defined, every resource has a colour,
// text and UI colours pass WCAG contrast on the three surfaces, reduced motion zeroes movement, the TS mirror (src/ui/kit/tokens.ts)
// matches the CSS, kit.css uses tokens only, and the self-hosted fonts are wired. Exit 1 on any problem.
// Usage: node tools/sim/tokens-test.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokensCss = stripComments(read('src/styles/tokens.css'));
const kitCss = stripComments(read('src/styles/kit.css'));

/** Declarations of the first block whose selector is exactly `sel`. */
function block(css, sel) {
  const re = new RegExp(`(^|\\})\\s*${sel.replace(/[[\]().*"=]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`);
  const m = re.exec(css);
  if (!m) return null;
  const out = new Map();
  for (const d of m[2].split(';')) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    const k = d.slice(0, i).trim();
    if (k.startsWith('--')) out.set(k, d.slice(i + 1).trim());
  }
  return out;
}

// ---- 1. one :root -------------------------------------------------------------------------------------------------------------------
const plainRoots = (css) => (css.match(/(^|[},;\s]):root\s*\{/g) ?? []).length;
const root = block(tokensCss, ':root');
if (!root) fail('tokens.css: no :root block');
if (plainRoots(tokensCss) !== 1) fail(`tokens.css: ${plainRoots(tokensCss)} plain :root blocks (want exactly 1)`);
for (const f of ['src/style.css', 'src/styles/bunker-os.css', 'src/styles/kit.css']) {
  const n = plainRoots(stripComments(read(f)));
  if (n) fail(`${f}: still has ${n} :root block(s); tokens live in src/styles/tokens.css`);
}
if (!/@import\s+['"]\.\/styles\/tokens\.css['"]/.test(read('src/style.css'))) fail('style.css does not @import ./styles/tokens.css');
if (!/@import\s+['"]\.\/styles\/kit\.css['"]/.test(read('src/style.css'))) fail('style.css does not @import ./styles/kit.css');

const tok = root ?? new Map();
/** Resolves var(--x[, fallback]) chains inside tokens.css. */
function resolveVal(v, depth = 0) {
  if (depth > 10) return v;
  return v.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]*))?\)/g, (_m, name, fb) => (tok.has(name) ? resolveVal(tok.get(name), depth + 1) : fb ?? `<undefined ${name}>`));
}

// ---- 2. every token of the brief ----------------------------------------------------------------------------------------------------
const REQUIRED = {
  '--surface-0': '#14161A', '--surface-1': '#1F2329', '--surface-2': '#2A3038', '--border': '#3A424C', '--overlay': 'rgba(0, 0, 0, 0.7)',
  '--text-primary': '#ECE6D8', '--text-secondary': '#A8A194', '--primary': '#E8A33D', '--primary-pressed': '#C7862A',
  '--success': '#6FBF73', '--danger': '#E5533D', '--warning': '#F2C14E', '--info': '#5BA4CF', '--power': '#F5D547', '--water': '#4FB3E8',
  '--food': '#8CC152', '--scrap': '#B0866A', '--radiation': '#9BE15D', '--currency-premium': '#7FD3E8',
  '--sp-1': '4px', '--sp-2': '8px', '--sp-3': '12px', '--sp-4': '16px', '--sp-5': '24px', '--sp-6': '32px', '--sp-7': '48px', '--sp-8': '64px',
  '--r-panel': '6px', '--r-card': '12px', '--r-full': '999px',
  '--type-caption': '12px', '--type-body': '14px', '--type-body-l': '16px', '--type-subtitle': '18px', '--type-title': '22px',
  '--type-headline': '28px', '--type-hero': '40px',
  '--dur-press': '60ms', '--dur-release': '150ms', '--dur-popup-in': '250ms', '--dur-popup-out': '180ms', '--dur-screen': '300ms',
  '--dur-toast': '200ms', '--toast-hold': '2500ms', '--stagger': '40ms',
};
for (const [k, v] of Object.entries(REQUIRED)) {
  if (!tok.has(k)) fail(`tokens.css: missing ${k}`);
  else if (tok.get(k).toLowerCase() !== v.toLowerCase()) fail(`tokens.css: ${k} is ${tok.get(k)}, the brief says ${v}`);
}
for (const k of ['--text-disabled', '--terminal', '--elev-btn', '--elev-btn-pressed', '--ease-out-back', '--ease-in', '--ease-in-out', '--ease-out',
  '--font-body', '--font-title', '--font-display', '--font-mono', '--num-tabular', '--hit-min']) if (!tok.has(k)) fail(`tokens.css: missing ${k}`);
// Elevation: base 5px key edge, 1px pressed.
if (!/\b5px\b/.test(tok.get('--elev-btn') ?? '')) fail('--elev-btn is not a 5px base shadow');
if (!/\b1px\b/.test(tok.get('--elev-btn-pressed') ?? '')) fail('--elev-btn-pressed is not a 1px shadow');
// Layers: the stacking the game had before (sheets 20 < nav 22 < toasts 30 < dialogs 40 < ... < splash).
const Z = ['--z-world', '--z-hud', '--z-panels', '--z-nav', '--z-toasts', '--z-popups', '--z-tooltip', '--z-story', '--z-tutorial', '--z-system', '--z-splash'];
const zv = Z.map((k) => Number(tok.get(k)));
if (zv.some((n) => !Number.isFinite(n))) fail(`tokens.css: a z-index layer is missing (${Z.filter((_k, i) => !Number.isFinite(zv[i])).join(', ')})`);
else if (zv.some((n, i) => i && n <= zv[i - 1])) fail(`tokens.css: z layers out of order: ${Z.map((k, i) => `${k}=${zv[i]}`).join(' ')}`);
const OLD_Z = { '--z-world': 0, '--z-hud': 10, '--z-panels': 20, '--z-nav': 22, '--z-toasts': 30, '--z-popups': 40 };
for (const [k, v] of Object.entries(OLD_Z)) if (Number(tok.get(k)) !== v) fail(`${k} must stay ${v} (the number the game used), is ${tok.get(k)}`);
// Legacy names still defined (the older sheets read them).
for (const k of ['--bg-dark', '--bg-panel', '--bg-card', '--bg-card-hi', '--accent', '--accent-glow', '--text-dim', '--positive', '--negative', '--radius',
  '--amber', '--phosphor', '--phosphor-dim', '--phosphor-faint', '--crt-bg', '--crt-bg-2', '--steel-1', '--steel-2', '--steel-3', '--rivet', '--r-s', '--r-m', '--r-l']) {
  if (!tok.has(k)) fail(`tokens.css: legacy name ${k} is gone (older stylesheets still use it)`);
}
// Every var() the game's stylesheets read is defined somewhere (tokens, or set at runtime / locally).
const RUNTIME = new Set(['--fs', '--fs-hud', '--tap', '--chip-h', '--nav-h', '--hud-top-h', '--kb-inset', '--dx', '--ok', '--warn', '--bad', '--chip-i', '--chip-c']);
const styleFiles = ['src/style.css', ...readdirSync(join(ROOT, 'src/styles')).filter((f) => f.endsWith('.css')).map((f) => `src/styles/${f}`)];
const definedAnywhere = new Set(tok.keys());
for (const f of styleFiles) for (const m of stripComments(read(f)).matchAll(/(--[\w-]+)\s*:/g)) definedAnywhere.add(m[1]);
// ...or set from code (element.style.setProperty('--x', ...), inline style="--x: ...").
const walkTs = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkTs(`${d}/${e.name}`) : e.name.endsWith('.ts') ? [`${d}/${e.name}`] : []));
for (const f of walkTs('src')) for (const m of read(f).matchAll(/['"`;\s](--[\w-]+)['"`:]/g)) definedAnywhere.add(m[1]);
for (const f of styleFiles) {
  for (const m of stripComments(read(f)).matchAll(/var\((--[\w-]+)\s*(,)?/g)) {
    const [, name, hasFallback] = m;
    if (!definedAnywhere.has(name) && !RUNTIME.has(name) && !hasFallback && !name.startsWith('--k-')) fail(`${f}: var(${name}) is not defined in any stylesheet`);
  }
}

// ---- 3. a colour for every resource ------------------------------------------------------------------------------------------------
const resIds = [...read('src/data/resources.ts').matchAll(/\{\s*id:\s*'(\w+)'/g)].map((m) => m[1]);
if (resIds.length < 10) fail(`could not read the resource ids from src/data/resources.ts (found ${resIds.length})`);
for (const id of resIds) {
  if (!tok.has(`--res-${id}`)) fail(`tokens.css: resource ${id} has no --res-${id} colour`);
}

// ---- 4. contrast ---------------------------------------------------------------------------------------------------------------------
function rgb(v) {
  const s = resolveVal(v).trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) return m[1].split(',').slice(0, 3).map((x) => Number(x.trim()));
  return null;
}
const lum = ([r, g, b]) => {
  const c = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const SURFACES = ['--surface-0', '--surface-1', '--surface-2'];
function check(fg, min, on = SURFACES, label = 'text') {
  const f = rgb(tok.get(fg) ?? '');
  if (!f) { fail(`contrast: ${fg} is not a plain colour`); return; }
  const row = [];
  for (const s of on) {
    const b = rgb(tok.get(s) ?? '');
    if (!b) { fail(`contrast: ${s} is not a plain colour`); continue; }
    const r = ratio(f, b);
    row.push(r.toFixed(2));
    if (r < min) fail(`contrast: ${fg} on ${s} is ${r.toFixed(2)}:1, ${label} needs ${min}:1`);
  }
  notes.push(`${fg.padEnd(20)} ${row.join(' / ')}  (min ${min})`);
}
for (const t of ['--text-primary', '--text-secondary', '--text-tertiary', '--danger-text']) check(t, 4.5);
for (const t of ['--primary', '--primary-pressed', '--success', '--danger', '--warning', '--info', '--power', '--water', '--food', '--scrap',
  '--radiation', '--currency-premium', ...resIds.map((id) => `--res-${id}`)]) check(t, 3, SURFACES, 'UI');
// Disabled text is exempt from AA (WCAG 1.4.3), but kept at 3:1 so a locked label is still readable; pair it with a dashed edge.
check('--text-disabled', 3, SURFACES, 'disabled (documented exception)');
check('--text-on-primary', 4.5, ['--primary', '--primary-pressed'], 'text on a primary button');

// ---- 5. motion: reduced zeroes every movement duration ---------------------------------------------------------------------------------
const reduced = block(tokensCss, ':root[data-motion="reduced"]');
const MOVE = ['--dur-press', '--dur-release', '--dur-popup-in', '--dur-popup-out', '--dur-screen', '--dur-toast', '--stagger', '--dur-shake'];
if (!reduced) fail('tokens.css: no :root[data-motion="reduced"] block');
else for (const k of MOVE) if (!/^0(ms|s)?$/.test(reduced.get(k) ?? '')) fail(`reduced motion does not zero ${k} (${reduced.get(k) ?? 'unset'})`);
if (!/prefers-reduced-motion:\s*reduce/.test(tokensCss)) fail('tokens.css: no prefers-reduced-motion fallback for the first paint');

// ---- 6. the TypeScript mirror --------------------------------------------------------------------------------------------------------
const tsMirror = read('src/ui/kit/tokens.ts');
const msBlock = /export const MS = \{([\s\S]*?)\}/.exec(tsMirror)?.[1] ?? '';
const pxBlock = /export const PX = \{([\s\S]*?)\}/.exec(tsMirror)?.[1] ?? '';
const pairs = (b) => [...b.matchAll(/'?([\w-]+)'?\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]);
const cssMs = (v) => { const m = /^([\d.]+)(ms|s)$/.exec(v ?? ''); return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : NaN; };
if (!pairs(msBlock).length) fail('src/ui/kit/tokens.ts: MS not found');
for (const [k, v] of pairs(msBlock)) if (cssMs(tok.get(`--${k}`)) !== v) fail(`kit/tokens.ts MS['${k}'] = ${v} but --${k} is ${tok.get(`--${k}`)}`);
for (const [k, v] of pairs(pxBlock)) if (tok.get(`--${k}`) !== `${v}px`) fail(`kit/tokens.ts PX['${k}'] = ${v} but --${k} is ${tok.get(`--${k}`)}`);

// ---- 7. kit.css: tokens only ----------------------------------------------------------------------------------------------------------
kitCss.split('\n').forEach((line, i) => {
  if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(line)) fail(`kit.css:${i + 1}: raw colour (use a token): ${line.trim()}`);
  const raw = line.replace(/var\([^)]*\)/g, '').match(/(?<![\w-])\d*\.?\d+(px|ms|s|em|rem|ch)\b/g);
  if (raw && raw.some((x) => !/^0(px|ms|s)?$/.test(x))) fail(`kit.css:${i + 1}: raw size/time ${raw.join(', ')} (use a token): ${line.trim()}`);
  const fs = /font-size:\s*([^;]+);/.exec(line);
  if (fs && !/^calc\(var\(--type-[\w-]+\) \* var\(--fs, 1\)\)$/.test(fs[1].trim())) fail(`kit.css:${i + 1}: font-size must be calc(var(--type-*) * var(--fs, 1)): ${fs[1]}`);
  if (/\b(margin|padding|border)-(left|right)\b|\b(left|right):/.test(line) && !/k-tip-x/.test(line)) fail(`kit.css:${i + 1}: physical left/right (use logical properties for RTL): ${line.trim()}`);
});

// ---- 8. fonts are self-hosted -----------------------------------------------------------------------------------------------------------
const html = read('index.html');
if (/fonts\.googleapis\.com/.test(html)) fail('index.html still loads Google Fonts over the network');
if (!/href="\.\/fonts\/fonts\.css"/.test(html)) fail('index.html does not link ./fonts/fonts.css');
const fontsCss = existsSync(join(ROOT, 'public/fonts/fonts.css')) ? read('public/fonts/fonts.css') : '';
if (!fontsCss) fail('public/fonts/fonts.css is missing');
const fams = new Set();
for (const m of fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
  const fam = /font-family:\s*'([^']+)'/.exec(m[1])?.[1];
  const url = /url\(\.\/([^)]+)\)/.exec(m[1])?.[1];
  fams.add(fam);
  if (!url || !existsSync(join(ROOT, 'public/fonts', url))) fail(`fonts.css: ${fam} points at a missing file (${url})`);
}
for (const f of ['Rubik', 'Secular One', 'Karantina']) if (!fams.has(f)) fail(`fonts.css: no @font-face for ${f}`);
for (const m of html.matchAll(/rel="preload" href="\.\/(fonts\/[^"]+)"/g)) if (!existsSync(join(ROOT, 'public', m[1]))) fail(`index.html preloads a missing font: ${m[1]}`);

for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.error(`tokens-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`tokens-test OK (${tok.size} tokens, ${resIds.length} resource colours)`);

import { i18n } from '../i18n/I18nManager';

/**
 * [ux-redesign W1] Number, time and plural formatting for the whole interface (store/ux-redesign/DESIGN-SYSTEM.md, "Formatting").
 * Pure functions of the current language (i18n); tools/sim/format-test.mjs checks them in Hebrew and English.
 */

const MINUS = '−';
/** Up to this, a number is written out in full ("9,999"); above it, short with a unit ("15.2K"). */
const EXACT_MAX = 9_999;
/** Short units, each a thousand times the one before; the last one carries any size. */
const UNITS: readonly [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
/** Guards Math.floor against binary fractions (0.29 * 100 = 28.999…): a relative nudge far below any shown digit. */
const REL_EPS = 1e-14;
const cut = (x: number): number => Math.floor(x * (1 + REL_EPS));

const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 3600;
const SEC_PER_DAY = 86_400;

const localeTag = (): string => (i18n.currentLocale === 'he' ? 'he-IL' : 'en-US');

/** Three significant digits, cut (never rounded up) so a short number never shows more than there is: 15.27 -> "15.2", 152.9 -> "152". */
function threeDigits(v: number, top: boolean): string {
  const decimals = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  const p = 10 ** decimals;
  // (never "1000K": a value a hair under the next unit stays "999K"; the top unit T may grow past 999)
  const units = top ? cut(v * p) : Math.min(cut(v * p), 1000 * p - 1);
  return (units / p).toFixed(decimals);
}

/**
 * A count or amount for display: exact with a thousands separator up to 9,999, then 3 significant digits with K / M / B / T
 * ("15.2K", "152K", "1.52M", "3.40B", "1.20T"). Fractions are cut, never rounded up; negatives get a real minus sign.
 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return MINUS + fmtNum(-n);
  const whole = cut(n);
  if (whole <= EXACT_MAX) return whole.toLocaleString(localeTag());
  for (const [size, unit] of UNITS) {
    if (n >= size) return threeDigits(n / size, unit === UNITS[0][1]) + unit;
  }
  return String(Math.floor(n)); // unreachable: n > 9,999 always meets K
}

/**
 * A price for a cost chip ([ux-wp4] P17, moved here from dom.ts `costAmount`): exact up to 9,999, then short like the HUD ("470K", "2.4M"),
 * always rounded UP so a short price is never less than what is asked.
 */
export function fmtCost(n: number): string {
  if (n < 10_000) return String(Math.ceil(n));
  if (n < 999_500) return `${Math.ceil(n / 1000)}K`;
  if (n < 9_995_000) return `${(Math.ceil(n / 100_000) / 10).toFixed(1)}M`;
  if (n < 999_500_000) return `${Math.ceil(n / 1_000_000)}M`;
  return `${(Math.ceil(n / 100_000_000) / 10).toFixed(1)}B`;
}

/**
 * A production rate (moved here from dom.ts `rateText`): per second as usual, but a trickle (under 0.005 a second) per hour,
 * since "+0.00 /s" says nothing.
 */
export function fmtRate(perSecond: number): string {
  if (perSecond > 0 && perSecond < 0.005) return `${i18n.formatRate(perSecond * SEC_PER_HOUR)} ${i18n.t('resources.perHour')}`;
  return `${i18n.formatRate(perSecond)} ${i18n.t('resources.perSecond')}`;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * A time left or taken, in the two largest units: "2d 4h", "4h 12m", "12:05" (minutes:seconds under an hour), "45s".
 * Hebrew: "2י׳ 4ש׳", "4ש׳ 12ד׳", "12:05", "45שנ׳" (one unit style everywhere: שנ׳ seconds, ד׳ minutes, ש׳ hours, י׳ days). A zero second unit is dropped ("2d", "4h"). Rounds up: 0.2 s left is "1s".
 */
export function fmtDuration(seconds: number): string {
  const total = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  if (total >= SEC_PER_DAY) {
    const d = Math.floor(total / SEC_PER_DAY), h = Math.floor((total % SEC_PER_DAY) / SEC_PER_HOUR);
    return h ? i18n.t('kit.dur.dh', { d, h }) : i18n.t('kit.dur.d', { d });
  }
  if (total >= SEC_PER_HOUR) {
    const h = Math.floor(total / SEC_PER_HOUR), m = Math.floor((total % SEC_PER_HOUR) / SEC_PER_MIN);
    return m ? i18n.t('kit.dur.hm', { h, m }) : i18n.t('kit.dur.h', { h });
  }
  if (total >= SEC_PER_MIN) return `${Math.floor(total / SEC_PER_MIN)}:${pad2(total % SEC_PER_MIN)}`;
  return i18n.t('kit.dur.s', { s: total });
}

const rulesCache = new Map<string, Intl.PluralRules>();
function pluralRules(): Intl.PluralRules {
  const tag = i18n.currentLocale;
  let r = rulesCache.get(tag);
  if (!r) {
    r = new Intl.PluralRules(tag);
    rulesCache.set(tag, r);
  }
  return r;
}

/**
 * The right form of a counted phrase, by the language's plural rules (Intl.PluralRules): Hebrew has a dual ("שני ניצולים"), English not.
 * The string table holds `<key>.one`, `<key>.two` and `<key>.other` (every plural key has all three in both languages; English `.two`
 * repeats `.other`). A category the table lacks (an engine that still says "many") falls back to `.other`.
 * `{n}` in the text becomes the number (with a thousands separator); other `params` are substituted as with `i18n.t`.
 */
export function plural(key: string, n: number, params: Record<string, string | number> = {}): string {
  const cat = pluralRules().select(n);
  const exact = `${key}.${cat}`;
  const k = i18n.has(exact) ? exact : `${key}.other`;
  return i18n.t(k, { n: i18n.formatNumber(n), ...params });
}

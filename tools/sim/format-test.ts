// [ux-redesign W1] Checks for src/ui/format.ts (bundled and run by format-test.mjs): numbers, prices, durations and plurals in both languages.
import { i18n } from '../../src/i18n/I18nManager';
import { fmtCost, fmtDuration, fmtNum, plural } from '../../src/ui/format';
import { badgeText, chipState } from '../../src/ui/kit/Display';

/** dom.ts `costAmount` as it was before it moved to format.ts: fmtCost must say exactly the same. */
function legacyCostAmount(n: number): string {
  if (n < 10_000) return String(Math.ceil(n));
  if (n < 999_500) return `${Math.ceil(n / 1000)}K`;
  if (n < 9_995_000) return `${(Math.ceil(n / 100_000) / 10).toFixed(1)}M`;
  if (n < 999_500_000) return `${Math.ceil(n / 1_000_000)}M`;
  return `${(Math.ceil(n / 100_000_000) / 10).toFixed(1)}B`;
}

export function formatChecks(): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const eq = (what: string, got: string, want: string): void => {
    if (got !== want) problems.push(`${what}: got "${got}", want "${want}"`);
  };

  for (const lang of ['en', 'he'] as const) {
    i18n.setLocale(lang);
    // ---- fmtNum
    const NUM: [number, string][] = [
      [0, '0'], [7, '7'], [7.9, '7'], [999, '999'], [1000, '1,000'], [9999, '9,999'], [9999.99, '9,999'],
      [10_000, '10.0K'], [15_270, '15.2K'], [99_999, '99.9K'], [152_900, '152K'], [999_999, '999K'],
      [1_000_000, '1.00M'], [1_520_000, '1.52M'], [15_200_000, '15.2M'], [999_999_999, '999M'],
      [3_400_000_000, '3.40B'], [1_200_000_000_000, '1.20T'], [5_000_000_000_000_000, '5000T'], [290, '290'], [-15_270, '−15.2K'], [-5, '−5'],
    ];
    for (const [n, want] of NUM) eq(`${lang} fmtNum(${n})`, fmtNum(n), want);
    // A short number never shows more than there is.
    for (const n of [10_000, 12_345, 99_950, 999_500, 1_999_999, 47_123_456, 999_999_999_999]) {
      const s = fmtNum(n);
      const m = /^([\d.]+)([KMBT])$/.exec(s);
      const mult = m ? { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2] as 'K' | 'M' | 'B' | 'T'] : 0;
      if (!m || Number(m[1]) * mult > n + 1e-6) problems.push(`${lang} fmtNum(${n}) = "${s}" rounds up or is malformed`);
      if (m && m[1].replace('.', '').replace(/^0+/, '').length !== 3) problems.push(`${lang} fmtNum(${n}) = "${s}" is not 3 significant digits`);
    }
    // ---- fmtCost = the old costAmount
    for (let i = 0; i < 4000; i++) {
      const n = Math.floor(10 ** (i / 400)) + (i % 7) * 0.37;
      if (fmtCost(n) !== legacyCostAmount(n)) { problems.push(`fmtCost(${n}) = ${fmtCost(n)}, costAmount said ${legacyCostAmount(n)}`); break; }
    }
    // ---- fmtDuration
    const D = lang === 'he'
      ? [[2 * 86400 + 4 * 3600 + 59, '2י׳ 4ש׳'], [4 * 3600 + 12 * 60 + 30, '4ש׳ 12ד׳'], [12 * 60 + 5, '12:05'], [45, '45שנ׳'], [0, '0שנ׳'], [0.2, '1שנ׳'],
        [60, '1:00'], [3600, '1ש׳'], [86400, '1י׳'], [59.5, '1:00']]
      : [[2 * 86400 + 4 * 3600 + 59, '2d 4h'], [4 * 3600 + 12 * 60 + 30, '4h 12m'], [12 * 60 + 5, '12:05'], [45, '45s'], [0, '0s'], [0.2, '1s'],
        [60, '1:00'], [3600, '1h'], [86400, '1d'], [59.5, '1:00']];
    for (const [s, want] of D as [number, string][]) eq(`${lang} fmtDuration(${s})`, fmtDuration(s), want);
    eq(`${lang} fmtDuration(NaN)`, fmtDuration(Number.NaN), lang === 'he' ? '0שנ׳' : '0s');
  }

  // ---- plural (Intl.PluralRules; Hebrew has a dual)
  i18n.setLocale('he');
  eq('he plural 1', plural('kit.survivors', 1), 'ניצול אחד');
  eq('he plural 2', plural('kit.survivors', 2), 'שני ניצולים');
  eq('he plural 5', plural('kit.survivors', 5), '5 ניצולים');
  eq('he plural 20', plural('kit.survivors', 20), '20 ניצולים'); // CLDR once said "many" for 20: falls back to .other
  eq('he plural 1500', plural('kit.survivors', 1500), '1,500 ניצולים');
  eq('he plural minutes 2', plural('kit.minutes', 2), 'שתי דקות');
  i18n.setLocale('en');
  eq('en plural 1', plural('kit.survivors', 1), '1 survivor');
  eq('en plural 2', plural('kit.survivors', 2), '2 survivors');
  eq('en plural 0', plural('kit.survivors', 0), '0 survivors');
  eq('en plural 1500', plural('kit.survivors', 1500), '1,500 survivors');

  // ---- kit helpers that are pure
  eq('badge 0', badgeText(0), '0');
  eq('badge 99', badgeText(99), '99');
  eq('badge 100', badgeText(100), '99+');
  eq('chip 50%', chipState(50, 100), 'normal');
  eq('chip 20%', chipState(20, 100), 'low');
  eq('chip 14%', chipState(14, 100), 'danger');
  eq('chip no cap', chipState(0, undefined), 'normal');

  notes.push(`he: ${fmtNum(15_270)} · ${fmtNum(1_520_000)} · ${(i18n.setLocale('he'), fmtDuration(2 * 86400 + 4 * 3600))} · ${plural('kit.survivors', 2)}`);
  return { problems, notes };
}

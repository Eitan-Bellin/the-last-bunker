import { EAGER_LOCALES } from './locales';

export type Locale = 'en' | 'he';

/** Grammatical gender of the person a sentence is about ('n' = unknown or mixed: the string keeps its "X/Y" forms). */
export type Gender = 'm' | 'f' | 'n';

const FINAL_TO_MEDIAL: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const GENDER_SLASH = /([א-ת]+)\/([א-ת]+)/g;

/**
 * Hebrew strings are written for both genders ("נפצע/ה", "עלה/תה", "בן/בת"). When the speaker is known, pick the right form.
 * Masculine = the part before the slash. Feminine = the whole word after it, or the base with the suffix added.
 */
export function resolveGender(text: string, g: Gender): string {
  if (g === 'n') return text;
  return text.replace(GENDER_SLASH, (_m, a: string, b: string) => {
    if (g === 'm') return a;
    if (b.length >= a.length) return b; // a full word of its own: בן/בת, היה/הייתה
    if (b === 'תה' && a.endsWith('ה')) return `${a.slice(0, -1)}תה`; // עלה/תה
    const last = a[a.length - 1];
    return (FINAL_TO_MEDIAL[last] ? a.slice(0, -1) + FINAL_TO_MEDIAL[last] : a) + b;
  });
}

const LOCALE_KEY = 'lastbunker_lang';

/** Filled at once in dev and in the sim; in the production build `main.ts` hands the tables over with `provide()` (see locales.ts). */
const strings: Record<Locale, Record<string, string>> = EAGER_LOCALES ?? { en: {}, he: {} };

export class I18nManager {
  private locale: Locale = 'en';

  get isRTL(): boolean {
    return this.locale === 'he';
  }

  get currentLocale(): Locale {
    return this.locale;
  }

  setLocale(locale: Locale): void {
    this.locale = locale;
    document.documentElement.dir = this.isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }

  /** The language the player picked (or `fallback`); reads storage only. */
  storedLocale(fallback: Locale): Locale {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LOCALE_KEY);
    } catch {
      stored = null;
    }
    return stored === 'en' || stored === 'he' ? stored : fallback;
  }

  loadStoredLocale(fallback: Locale): void {
    let locale = this.storedLocale(fallback);
    const other: Locale = locale === 'he' ? 'en' : 'he';
    if (!this.isLoaded(locale) && this.isLoaded(other)) locale = other; // the chosen language could not be fetched (offline): never show raw keys
    this.setLocale(locale);
  }

  /** True when the strings of `locale` are in memory (always, unless the build loads them on demand). */
  isLoaded(locale: Locale): boolean {
    return Object.keys(strings[locale]).length > 0;
  }

  /** Hands over a string table that was fetched on demand (production build only). */
  provide(locale: Locale, table: Record<string, string>): void {
    strings[locale] = table;
  }

  storeLocale(locale: Locale): void {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // storage unavailable (private mode); locale applies to this session only
    }
  }

  /** `params.g` ('m' | 'f') picks the gendered forms of a Hebrew sentence about one person; it is not substituted into the text. */
  t(key: string, params?: Record<string, string | number>): string {
    let text = strings[this.locale]?.[key] ?? strings.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (k === 'g') continue;
        text = text.split(`{${k}}`).join(String(v));
      }
      if (this.locale === 'he' && (params.g === 'm' || params.g === 'f')) text = resolveGender(text, params.g);
    }
    return text;
  }

  has(key: string): boolean {
    return key in (strings[this.locale] ?? {}) || key in strings.en;
  }

  formatNumber(n: number): string {
    return n.toLocaleString(this.locale === 'he' ? 'he-IL' : 'en-US');
  }

  formatCompact(n: number): string {
    if (n < 1000) return Math.floor(n).toString();
    // Round first, then pick the unit: 999,950 is "1.0M", not "1000.0K".
    if (n < 999_950) return (n / 1000).toFixed(1) + 'K';
    if (n < 999_950_000) return (n / 1_000_000).toFixed(1) + 'M';
    return (n / 1_000_000_000).toFixed(1) + 'B';
  }

  formatDuration(seconds: number): string {
    const total = Math.max(0, Math.ceil(seconds));
    if (total < 60) return this.t('time.s', { n: total });
    if (total < 3600) {
      const m = Math.floor(total / 60);
      return total % 60 === 0 ? this.t('time.mOnly', { m }) : this.t('time.m', { m, s: total % 60 });
    }
    return this.t('time.h', { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60) });
  }

  formatRate(perSecond: number): string {
    const sign = perSecond > 0.005 ? '+' : perSecond < -0.005 ? '−' : '';
    const abs = Math.abs(perSecond);
    const digits = abs >= 10 ? 0 : abs >= 1 ? 1 : 2;
    return `${sign}${abs.toFixed(digits)}`;
  }
}

export const i18n = new I18nManager();

import en from './en.json';
import he from './he.json';

export type Locale = 'en' | 'he';

const LOCALE_KEY = 'lastbunker_lang';

const strings: Record<Locale, Record<string, string>> = { en, he };

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

  loadStoredLocale(fallback: Locale): void {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LOCALE_KEY);
    } catch {
      stored = null;
    }
    this.setLocale(stored === 'en' || stored === 'he' ? stored : fallback);
  }

  storeLocale(locale: Locale): void {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // storage unavailable (private mode); locale applies to this session only
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    let text = strings[this.locale]?.[key] ?? strings.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.split(`{${k}}`).join(String(v));
      }
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
    if (n < 1_000_000) return (n / 1000).toFixed(1) + 'K';
    if (n < 1_000_000_000) return (n / 1_000_000).toFixed(1) + 'M';
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

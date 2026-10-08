import en from './en.json';
import he from './he.json';

/**
 * Plan 4 wave 3 (perf): the production build defines `__LAZY_LOCALES__` (vite.config.ts), so the two string tables are NOT part of the
 * main chunk: `main.ts` fetches the player's language before the game starts (and the other one when the page is idle, so the language
 * switch and the offline copy still work). Everywhere else (the dev server, the sim and test bundles run in Node) the constant does not
 * exist and the tables are linked in as before, so `i18n.t` works synchronously with no setup. In the build the branch folds to
 * `null` and the two imports above are dropped as unused.
 */
declare const __LAZY_LOCALES__: boolean | undefined;
const lazy = typeof __LAZY_LOCALES__ !== 'undefined' && __LAZY_LOCALES__;

export const EAGER_LOCALES: { en: Record<string, string>; he: Record<string, string> } | null = lazy ? null : { en, he };

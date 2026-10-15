/**
 * [world:C0] The `?city` switch (architecture D9), [world:M1] made persistent with a session kill switch.
 *
 * Read once at module load, like GFX.airy. The order of precedence:
 *  1. the query: `?city` (any value but `0`) selects the city, `?city=0` the classic tower; either one is remembered in localStorage
 *     (`lastbunker_city` = '1' / '0'), so a later visit without the param keeps the choice;
 *  2. the remembered choice;
 *  3. `DEFAULT_CITY` (one line to flip when the city ships).
 * Node-safe: without `location` / `localStorage` (sim, lint, tests) it is off. Every storage access is wrapped (private windows, blocked
 * storage), and a broken store simply falls through to the default.
 *
 * `CITY` is a live binding: `disableCityForSession()` turns it off for the rest of the session (the city chunk failed to load offline, see
 * BunkerRenderer.mountCity). Readers must check it at call time, never copy it into a module constant.
 */

/** The world a player gets with no `?city` param and nothing remembered. Flip to true to ship the city by default. */
export const DEFAULT_CITY = false;

/** localStorage key of the remembered choice ('1' city, '0' classic). */
export const CITY_STORE_KEY = 'lastbunker_city';

/** True when a query string asks for the city: the `city` param is present and is not `0`. */
export function cityFromSearch(search: string): boolean {
  return cityParam(search) === true;
}

/** The query's choice: true (`?city`, `?city=1`, ...), false (`?city=0`), or null when the param is absent. */
export function cityParam(search: string): boolean | null {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (!q.has('city')) return null;
  return q.get('city') !== '0';
}

/** Pure resolution (tests): the query wins, then the remembered value ('1' / '0'; anything else is ignored), then the default. */
export function resolveCity(search: string, stored: string | null, def: boolean = DEFAULT_CITY): boolean {
  const p = cityParam(search);
  if (p !== null) return p;
  if (stored === '1') return true;
  if (stored === '0') return false;
  return def;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // a sandboxed frame throws on the getter itself
  }
}

function readStored(): string | null {
  try {
    return storage()?.getItem(CITY_STORE_KEY) ?? null;
  } catch {
    return null;
  }
}

function boot(): boolean {
  if (typeof location === 'undefined' || typeof location.search !== 'string') return false;
  const p = cityParam(location.search);
  if (p !== null) {
    try {
      storage()?.setItem(CITY_STORE_KEY, p ? '1' : '0');
    } catch {
      // full or blocked storage: the param still applies to this visit
    }
  }
  return resolveCity(location.search, readStored());
}

/** The world in use this session. Live binding (see the file comment). */
export let CITY: boolean = boot();

/** Why the city was switched off this session (null while it runs or was never on). */
export let cityDisabledReason: string | null = null;

/**
 * Turns the city off for the rest of this session (the remembered choice is kept: the next visit, online, tries again). Must run before
 * anything is drawn with the city projection; BunkerRenderer.init calls it when the city chunk cannot be loaded.
 */
export function disableCityForSession(reason: string): void {
  if (!CITY) return;
  CITY = false;
  cityDisabledReason = reason;
}

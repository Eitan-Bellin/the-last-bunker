/**
 * [world:C0] The `?city` switch (architecture D9). Read once at module load, like GFX.airy: `?city` (any value but `0`) selects the city
 * projection and renderer; no param or `?city=0` keeps the classic tower. Node-safe: without `location` (sim, lint, tests) it is off.
 */

/** True when a query string asks for the city: the `city` param is present and is not `0`. */
export function cityFromSearch(search: string): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return q.has('city') && q.get('city') !== '0';
}

export const CITY: boolean = typeof location !== 'undefined' && typeof location.search === 'string' && cityFromSearch(location.search);

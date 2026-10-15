import { i18n } from '../i18n/I18nManager';

/**
 * [plan4:ST-16] How a floor is named on screen: "B1" for the first basement level (floor index 0) and so on down; the surface (gate-house) row,
 * floor index -1, is "Surface" ("B0" would read as a mistake). Every `B${floor + 1}` label goes through here.
 */
export function floorTag(floor: number): string {
  if (floor < 0) return i18n.t('floor.surface');
  // [ux-w2f #41] Hebrew reads "קומה 3", not a Latin "B3" inside right-to-left text; English keeps the compact "B3".
  // [ux-redesign w2fix] The words come from i18n (floor.tag), not a Hebrew literal in code.
  return i18n.t('floor.tag', { n: floor + 1 });
}

/**
 * [ux-redesign w2fix] The same tag inside a bidi isolate (FSI ... PDI), for strings that mix it with a room name and
 * numbers ("Farm · B2 (1/3)"), so "B2" or "קומה 2" never trades places with its neighbours in the other direction.
 */
export function floorTagIso(floor: number): string {
  // [ux-redesign w3fix B7] The isolate keeps the order, not the line together: a no-break space (U+00A0) between the word and the
  // number keeps "קומה 3" on one line ("Surface" and "B3" have no space to replace).
  return String.fromCharCode(0x2068) + floorTag(floor).replace(/ /g, String.fromCharCode(0xa0)) + String.fromCharCode(0x2069);
}

/**
 * [ux-redesign final F7] A tidy list of floors for a sentence: "B2, B4–B9" in English, "קומה 2, קומות 4–9" in Hebrew (the UI-side
 * twin of placementRank.floorRangesLabel, which keeps the Latin form for the world signs). 0-based in, as the ruler shows them out.
 */
export function floorRangesTag(floors: number[]): string {
  const f = [...new Set(floors)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < f.length;) {
    let j = i;
    while (j + 1 < f.length && f[j + 1] === f[j] + 1) j++;
    parts.push(j === i ? floorTag(f[i]) : i18n.t('floor.range', { a: f[i] + 1, b: f[j] + 1 }));
    i = j + 1;
  }
  return parts.join(', ');
}

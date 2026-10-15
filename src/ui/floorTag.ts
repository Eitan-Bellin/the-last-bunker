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
  return String.fromCharCode(0x2068) + floorTag(floor) + String.fromCharCode(0x2069);
}

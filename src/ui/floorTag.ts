import { i18n } from '../i18n/I18nManager';

/**
 * [plan4:ST-16] How a floor is named on screen: "B1" for the first basement level (floor index 0) and so on down; the surface (gate-house) row,
 * floor index -1, is "Surface" ("B0" would read as a mistake). Every `B${floor + 1}` label goes through here.
 */
export function floorTag(floor: number): string {
  if (floor < 0) return i18n.t('floor.surface');
  // [ux-w2f #41] Hebrew reads "קומה 3", not a Latin "B3" inside right-to-left text; English keeps the compact "B3".
  return i18n.currentLocale === 'he' ? `קומה ${floor + 1}` : `B${floor + 1}`;
}

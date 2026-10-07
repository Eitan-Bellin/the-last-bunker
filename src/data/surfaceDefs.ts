import type { BuildingType } from '../core/GameState';
import type { BuildingDef } from './buildingDefs';

/**
 * [plan4:ST-16] The rooms of the surface (gate-house) row.
 *
 * CONTRACT with Rooms-Data (buildings.json): a room that stands only on the surface row has `"place": { "floors": "surface" }`
 * (BL-16 solarArray, BL-17 windTurbine, BL-18 watchtower); a room that may stand on the surface row OR on floor 0 has
 * `"place": { "floors": "entranceOrSurface" }` (BL-19 gatePost, and the garage); `decon` stays `"entrance"` (floor 0 only).
 * The row is floor -1, slots -11..-4, and opens with `layout.surfaceOpen` (Act II). `shape: 'daylight' | 'wind'` is the weather curve (BL-8).
 *
 * Until those definitions are merged these three are a minimal fallback: `withSurfaceFallbacks` adds a type ONLY when buildings.json has no
 * entry for it, so the real definitions always win and this file can be deleted after the merge.
 */
const FALLBACK: Partial<Record<BuildingType, BuildingDef>> = {
  solarArray: {
    name: { en: 'Solar Array', he: 'שדה פאנלים' },
    description: { en: 'Panels on the old gate-house yard. Power by day, nothing at night, and no crew needed.', he: 'פאנלים בחצר בית השער הישן. חשמל ביום, כלום בלילה, ובלי עובדים.' },
    tier: 2, size: { w: 2, h: 1 }, maxLevel: 10, baseCost: { materials: 100, scrap: 30 }, costMultiplier: 1.8, constructionTime: 90,
    production: { power: { base: 3, perLevel: 0.5 } }, shape: 'daylight', slots: 2, maxCopies: 4, place: { floors: 'surface' }, priceByAct: true,
    maxWorkers: 0, powerConsumption: 0, color: '#D9B84A',
  },
  windTurbine: {
    name: { en: 'Wind Turbine', he: 'טורבינת רוח' },
    description: { en: 'A tall turbine on the open ground. The windier the day, the more power it makes.', he: 'טורבינה גבוהה בשטח הפתוח. ככל שהרוח חזקה יותר, יוצא ממנה יותר חשמל.' },
    tier: 3, size: { w: 1, h: 1 }, maxLevel: 10, baseCost: { materials: 140, scrap: 40 }, costMultiplier: 2, constructionTime: 150,
    production: { power: { base: 2.4, perLevel: 0.5 } }, shape: 'wind', slots: 1, maxCopies: 4, place: { floors: 'surface' }, priceByAct: true,
    maxWorkers: 0, powerConsumption: 0, color: '#8FB4C8',
  },
  watchtower: {
    name: { en: 'Watchtower', he: 'מגדל תצפית' },
    description: { en: 'A lookout on the roof of the world. Sees raiders sooner and helps defend the gate.', he: 'עמדת תצפית על גג העולם. רואה שודדים מוקדם יותר ועוזרת להגן על השער.' },
    tier: 2, size: { w: 1, h: 1 }, maxLevel: 10, baseCost: { materials: 80, scrap: 20 }, costMultiplier: 1.7, constructionTime: 80,
    effects: { defense: { base: 4, perLevel: 2 }, earlyWarning: { base: 30, perLevel: 30 } }, slots: 1, maxCopies: 2, place: { floors: 'surface' }, priceByAct: true,
    optimalStat: 'agility', statBonusPerPoint: 0.05, maxWorkers: 1, powerConsumption: 0.5, color: '#7A7A60',
  },
};

/** The surface row's own types, whoever defines them (the build menu, the bot and the renderer ask for them by name). */
export const SURFACE_TYPES: BuildingType[] = ['solarArray', 'windTurbine', 'watchtower'];

/** buildings.json plus the fallback definitions for the surface types it does not hold yet. Mutates and returns `defs`. */
export function withSurfaceFallbacks(defs: Record<BuildingType, BuildingDef>): Record<BuildingType, BuildingDef> {
  for (const t of SURFACE_TYPES) if (!defs[t] && FALLBACK[t]) defs[t] = FALLBACK[t]!;
  return defs;
}

/**
 * Canva exports several paintings per page (3×3 sheets) to save round trips.
 * Each sheet lists its grid and which art key sits in each cell, row by row.
 */
export interface Sheet {
  file: string;
  cols: number;
  rows: number;
  keys: (string | null)[];
}

export const SHEETS: Sheet[] = [
  {
    file: 'sheets/sheet-W1.png', cols: 3, rows: 3,
    keys: ['rooms/reactor-0', 'rooms/hydroponics-0', 'rooms/storage-0', 'rooms/quarters-1', 'rooms/farm-1', 'rooms/reactor-1',
      'rooms/hydroponics-1', 'rooms/storage-1', 'rooms/quarters-2'],
  },
  {
    file: 'sheets/sheet-S1.png', cols: 3, rows: 3,
    keys: ['rooms/waterPump-0', 'rooms/workshop-0', 'rooms/medbay-0', 'rooms/canteen-0', 'rooms/laboratory-0', 'rooms/radioTower-0',
      'rooms/waterPurifier-0', 'rooms/trainingRoom-0', 'rooms/armory-0'],
  },
  {
    file: 'sheets/sheet-S2.png', cols: 3, rows: 3,
    keys: ['rooms/generator-1', 'rooms/waterPump-1', 'rooms/workshop-1', 'rooms/medbay-1', 'rooms/canteen-1', 'rooms/laboratory-1',
      'rooms/radioTower-1', 'rooms/waterPurifier-1', 'rooms/trainingRoom-1'],
  },
  {
    file: 'sheets/sheet-S3.png', cols: 3, rows: 3,
    keys: ['rooms/armory-1', 'rooms/generator-2', 'rooms/waterPump-2', 'rooms/workshop-2', 'rooms/medbay-2', 'rooms/canteen-2',
      'rooms/laboratory-2', 'rooms/radioTower-2', 'rooms/waterPurifier-2'],
  },
];

SHEETS.push(
  {
    file: 'sheets/sheet-W2.png', cols: 3, rows: 3,
    keys: ['rooms/farm-2', 'rooms/reactor-2', 'rooms/hydroponics-2', 'rooms/storage-2', 'ruins/collapsed-wide', 'ruins/debris-wide',
      'ruins/flooded-wide', 'ruins/wreck-farm', null],
  },
  {
    file: 'sheets/sheet-S4.png', cols: 3, rows: 3,
    keys: ['rooms/trainingRoom-2', 'rooms/armory-2', 'ruins/collapsed-narrow', 'ruins/debris-narrow', 'ruins/flooded-narrow',
      'ruins/wreck-generator', 'ruins/wreck-waterPump', 'ruins/wreck-canteen', 'ruins/wreck-medbay'],
  },
  { file: 'sheets/sheet-P1.png', cols: 3, rows: 1, keys: ['story/intro-1', 'story/intro-2', 'story/intro-3'] },
  { file: 'sheets/sheet-L1.png', cols: 2, rows: 2, keys: ['backdrops/surface-0', 'backdrops/surface-1', 'backdrops/surface-2', 'backdrops/surface-3'] },
  {
    file: 'sheets/sheet-S5.png', cols: 3, rows: 3,
    keys: ['ruins/wreck-workshop', 'portraits/p01', 'portraits/p02', 'portraits/p03', 'portraits/p04', 'portraits/p05', 'portraits/p06', null, null],
  },
);

SHEETS.push(
  { file: 'sheets/sheet-L2.png', cols: 2, rows: 2, keys: ['districts/cave', 'districts/lake', 'districts/metro', null] },
  { file: 'sheets/sheet-T1.png', cols: 2, rows: 1, keys: ['halls/atrium', 'halls/reactorHall'] },
  { file: 'sheets/sheet-R1.png', cols: 1, rows: 1, keys: ['backdrops/rock'] },
  {
    file: 'sheets/sheet-B1.png', cols: 3, rows: 2,
    keys: ['biomes/ruins', 'biomes/wasteland', 'biomes/toxicForest', 'biomes/shatteredCity', 'biomes/caves', 'biomes/militaryZone'],
  },
  {
    file: 'sheets/sheet-S6.png', cols: 3, rows: 3,
    keys: ['portraits/p07', 'portraits/p08', 'portraits/p09', 'portraits/p10', 'portraits/p11', 'portraits/p12',
      'portraits/p13', 'portraits/p14', null],
  },
);

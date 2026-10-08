/** The names of the ambience beds, kept apart from the synthesis code (beds.ts) so the audio engine can know them before that code is fetched. */
export type BedKey = 'remnant' | 'restoration' | 'colony' | 'undercity' | 'city';

export const ERA_BEDS: BedKey[] = ['remnant', 'restoration', 'colony', 'undercity'];

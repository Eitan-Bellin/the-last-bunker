/**
 * Plan 4 wave 3 (perf): the sound recipes that are only needed once the audio context exists (the effects, the music themes, the era
 * beds). AudioEngine fetches this module with a dynamic import when sound starts (and the page fetches it when idle after start, so it
 * is cached for offline play); nothing else may import these files statically or they would be pulled back into the main chunk.
 */
export { SFX } from './sfx';
export { EXPEDITION_SECONDS, LOOP_SECONDS, LOOP_TAIL, colonyTheme, darkTheme, expeditionPulse, remnantTheme, shelterTheme, undercityTheme } from './music';
export { BEDS, BED_SECONDS } from './beds';

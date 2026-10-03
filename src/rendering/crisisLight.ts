/**
 * gfx-p0 crisis lighting: room id → how far an incident pulls that room's lamps down this frame (1 = untouched).
 * Written by the incident layer every frame; the painted rooms multiply it into their lamp flicker, so a blackout
 * really turns the lamps off (and, through `roomFlicker`, the structure and the people go dark with them).
 * Lives in its own module so paintedRoom and incidentFx do not import each other.
 */
export const crisisLight = new Map<string, number>();

import type { BuildingType, Ruin } from '../core/GameState';
import { roomSlots } from '../data/buildingDefs';

/**
 * Registry of every painted asset in the game.
 * Raw paintings are generated in Canva, exported as PNG into art-src/raw/<key-with-dashes>.png,
 * processed by tools/art.html (crop, exposure balance, WebP) into public/art/<key>.webp.
 * Light spots are in normalized image coordinates and drive the live lighting layer.
 */

export type ArtKind = 'room' | 'ruin' | 'portrait' | 'backdrop' | 'story' | 'district' | 'hall' | 'biome' | 'kit';

export interface LightSpot {
  x: number;
  y: number;
  /** Radius relative to the image width. */
  r: number;
  color: number;
  /** 0 = steady, 1 = candle-like flicker. */
  flicker?: number;
}

export type FxKind = 'drip' | 'smoke' | 'steam' | 'sparks' | 'blink' | 'pulse' | 'bubbles' | 'screen'
  // gfx-p0 rooms: painted motion for every painting.
  | 'stream' | 'mist' | 'leaf' | 'ripple' | 'flame' | 'tube' | 'twinkle' | 'weld' | 'ecg' | 'radar'
  | 'needle' | 'reel' | 'fan' | 'moth' | 'haze';

/** A spot in the painting that gets a live effect layered on top. */
export interface FxSpot {
  kind: FxKind;
  x: number;
  y: number;
  color?: number;
  /** Effect-specific size/spread relative to the image width. */
  size?: number;
  /** Width/height of a screen, glow strip, tank or heat-haze region, relative to the image size. */
  w?: number;
  h?: number;
  /** Where falling water lands, rising bubbles pop or leaves settle (relative y). */
  to?: number;
  /** Width of the ripple ring where drops land (relative to the image width). */
  ring?: number;
  /** Speed multiplier (blink, pulse, emitter rate). */
  rate?: number;
  /** Needle rest angle in radians (0 = up, clockwise) and its swing. */
  a?: number;
  amp?: number;
  /** Screens: false = no rolling scan band (lit meters, dials). */
  band?: boolean;
}

export interface ArtEntry {
  key: string;
  kind: ArtKind;
  /** Output size in pixels. */
  out: [number, number];
  /** Vertical crop focus (0 = keep top, 1 = keep bottom). */
  focusY?: number;
  lights?: LightSpot[];
  fx?: FxSpot[];
}

/** Visual tier of a room: 0 = salvaged and rusty, 1 = restored, 2 = advanced. */
export type RoomTier = 0 | 1 | 2;

export function roomTier(level: number): RoomTier {
  return level >= 5 ? 2 : level >= 3 ? 1 : 0;
}

export const WIDE_OUT: [number, number] = [720, 522];
export const NARROW_OUT: [number, number] = [480, 522];

const AMBER = 0xffc777;
const PINK = 0xff6ad5;
const ORANGE = 0xff8a3a;
const CANDLE = 0xffb35a;

/** Lights painted into each room image, so the live glow sits exactly on the painted lamps. */
const ROOM_LIGHTS: Record<string, LightSpot[]> = {
  'quarters-0': [
    { x: 0.49, y: 0.2, r: 0.22, color: AMBER, flicker: 0.4 },
    { x: 0.587, y: 0.69, r: 0.06, color: CANDLE, flicker: 1 },
  ],
  'farm-0': [
    { x: 0.49, y: 0.19, r: 0.18, color: AMBER, flicker: 0.3 },
    { x: 0.24, y: 0.36, r: 0.09, color: PINK },
    { x: 0.42, y: 0.36, r: 0.09, color: PINK },
    { x: 0.59, y: 0.36, r: 0.09, color: PINK },
    { x: 0.76, y: 0.36, r: 0.09, color: PINK },
  ],
  'generator-0': [
    { x: 0.23, y: 0.2, r: 0.2, color: AMBER, flicker: 0.5 },
    { x: 0.82, y: 0.4, r: 0.08, color: ORANGE, flicker: 0.2 },
  ],
};

/** Live effects anchored to painted props (pipes, engines, panels). */
const fx = (kind: FxKind, x: number, y: number, o: Partial<FxSpot> = {}): FxSpot => ({ kind, x, y, ...o });
// gfx-p0 rooms: colours for the painted-motion layer.
const WATER = 0x9fd8ff;
const STEAM = 0xd8d2c6;
const CYAN = 0x5fe8e0;
const ICE = 0x58c8ff;
const CRT = 0x6dff9a;
const LED_G = 0x7dff6a;
const RED = 0xff3a2a;
const GAS = 0x4aa8ff;
const TUBE = 0xffa040;
/** Lit screen of w×h (relative to the image). */
const scr = (x: number, y: number, w: number, h: number, color = CYAN, o: Partial<FxSpot> = {}): FxSpot => fx('screen', x, y, { w, h, color, ...o });
const led = (x: number, y: number, color = LED_G, size = 0.004, rate?: number): FxSpot => fx('blink', x, y, { color, size, rate });
/** Gauge needle quivering around its painted angle (len relative to width). */
const needle = (x: number, y: number, len = 0.012, a = 0.75, amp = 0.1): FxSpot => fx('needle', x, y, { size: len, a, amp });
const moth = (x: number, y: number): FxSpot => fx('moth', x, y, { size: 0.035 });
/** Radio set shared by tiers 0 and 1: glowing valves, lit VU meters, the tuning needle, the on-air lamp. */
const RADIO: FxSpot[] = [
  ...[0.135, 0.18, 0.222, 0.265].map(x => fx('flame', x, 0.385, { size: 0.01, color: TUBE, rate: 0.5 })),
  ...[[0.14, 0.485], [0.22, 0.485], [0.32, 0.485]].map(([x, y]) => scr(x, y, 0.06, 0.03, AMBER, { band: false })),
  ...[[0.435, 0.49], [0.505, 0.49], [0.505, 0.548]].map(([x, y]) => scr(x, y, 0.04, 0.035, AMBER, { band: false })),
  needle(0.33, 0.585, 0.05, 0, 0.55),
  led(0.77, 0.215, RED, 0.012, 1.3),
];
/** Gauges and outflows shared by the purifier tiers 0 and 1. */
const PURIFIER = (tapY: number): FxSpot[] => [
  fx('stream', 0.855, 0.645, { to: tapY, color: WATER, size: 0.006 }),
  fx('stream', 0.534, 0.8, { to: 0.875, color: WATER, size: 0.008, ring: 0.05 }),
  needle(0.23, 0.43), needle(0.41, 0.43), needle(0.855, 0.258),
];

const ROOM_FX: Record<string, FxSpot[]> = {
  'quarters-0': [
    fx('flame', 0.587, 0.685, { size: 0.008, color: CANDLE }),
    fx('smoke', 0.587, 0.66, { color: 0xcfc6b8, size: 0.01 }),
    fx('drip', 0.43, 0.09, { to: 0.89, color: WATER, ring: 0.04 }),
    moth(0.49, 0.2),
  ],
  'quarters-1': [
    fx('flame', 0.062, 0.23, { size: 0.008, color: CANDLE }),
    fx('flame', 0.83, 0.262, { size: 0.008, color: CANDLE }),
    moth(0.484, 0.2),
  ],
  'quarters-2': [
    scr(0.383, 0.355, 0.024, 0.06), scr(0.383, 0.638, 0.024, 0.06), scr(0.917, 0.355, 0.024, 0.06), scr(0.917, 0.638, 0.024, 0.06),
    scr(0.473, 0.587, 0.018, 0.04), scr(0.535, 0.587, 0.018, 0.04),
    led(0.385, 0.318, CYAN), led(0.92, 0.312, CYAN),
  ],
  'farm-0': [
    fx('stream', 0.848, 0.56, { to: 0.765, color: WATER, size: 0.004, ring: 0.03 }),
    fx('pulse', 0.5, 0.45, { color: PINK, size: 0.45 }),
    moth(0.49, 0.2),
  ],
  'farm-1': [
    fx('stream', 0.853, 0.7, { to: 0.775, color: WATER, size: 0.004, ring: 0.03 }),
    fx('pulse', 0.5, 0.45, { color: PINK, size: 0.45 }),
  ],
  'farm-2': [
    scr(0.055, 0.465, 0.07, 0.075), scr(0.952, 0.465, 0.07, 0.075),
    ...[[0.34, 0.523], [0.49, 0.523], [0.625, 0.523], [0.335, 0.775], [0.625, 0.775]].map(([x, y]) => scr(x, y, 0.045, 0.02, CYAN, { band: false })),
    fx('mist', 0.36, 0.34, { to: 0.42, color: 0xe8f4ff, size: 0.02 }),
    fx('stream', 0.855, 0.645, { to: 0.775, color: WATER, size: 0.005, ring: 0.035 }),
  ],
  'generator-0': [
    fx('smoke', 0.5, 0.47, { color: 0x9a948a, size: 0.05 }),
    fx('sparks', 0.82, 0.46, { color: 0xffd27a }),
    fx('blink', 0.82, 0.4, { color: ORANGE, size: 0.012 }),
    needle(0.768, 0.357, 0.011), needle(0.815, 0.357, 0.011, 0.5), needle(0.865, 0.357, 0.011, 0.9),
    fx('haze', 0.38, 0.53, { w: 0.36, h: 0.24 }),
  ],
  'generator-1': [
    fx('smoke', 0.52, 0.4, { color: 0x9a948a, size: 0.03 }),
    led(0.766, 0.382), led(0.815, 0.382), led(0.864, 0.382),
    needle(0.766, 0.338, 0.012), needle(0.815, 0.338, 0.012, 0.5), needle(0.864, 0.338, 0.012, 0.9),
    fx('haze', 0.38, 0.53, { w: 0.36, h: 0.24 }),
  ],
  'generator-2': [
    fx('pulse', 0.39, 0.6, { w: 0.3, h: 0.16, color: 0xffb050, rate: 2.6 }),
    scr(0.766, 0.338, 0.04, 0.04, CYAN, { band: false }), scr(0.815, 0.338, 0.04, 0.04, CYAN, { band: false }), scr(0.864, 0.338, 0.04, 0.04, CYAN, { band: false }),
    scr(0.766, 0.43, 0.03, 0.09), scr(0.815, 0.43, 0.03, 0.09), scr(0.864, 0.43, 0.03, 0.09),
    scr(0.975, 0.53, 0.03, 0.05),
    led(0.175, 0.685, CYAN, 0.005),
    fx('haze', 0.39, 0.5, { w: 0.34, h: 0.22 }),
  ],
  'waterPump-0': [
    fx('stream', 0.765, 0.565, { to: 0.655, color: WATER, size: 0.006, ring: 0.035 }),
    fx('stream', 0.52, 0.79, { to: 0.93, color: WATER, size: 0.03, ring: 0.08 }),
    fx('drip', 0.312, 0.37, { to: 0.67, color: WATER }),
    needle(0.155, 0.46, 0.014), needle(0.605, 0.305, 0.013, 0.6),
  ],
  'waterPump-1': [
    fx('stream', 0.52, 0.8, { to: 0.93, color: WATER, size: 0.03, ring: 0.08 }),
    fx('drip', 0.765, 0.6, { to: 0.67, color: WATER, rate: 0.6 }),
    needle(0.155, 0.46, 0.014), needle(0.605, 0.305, 0.013, 0.6),
  ],
  'waterPump-2': [
    fx('stream', 0.52, 0.78, { to: 0.84, color: 0xbfefff, size: 0.03 }),
    fx('ripple', 0.52, 0.84, { size: 0.09, color: 0xbfefff }),
    fx('bubbles', 0.52, 0.96, { to: 0.85, size: 0.1, color: 0xdff6ff }),
    fx('bubbles', 0.86, 0.43, { to: 0.36, size: 0.02, color: 0xdff6ff }),
    scr(0.155, 0.47, 0.035, 0.035, ICE, { band: false }), scr(0.597, 0.305, 0.035, 0.035, ICE, { band: false }),
    scr(0.477, 0.385, 0.025, 0.025, ICE), scr(0.48, 0.5, 0.03, 0.03, ICE, { band: false }),
  ],
  'workshop-0': [
    fx('sparks', 0.575, 0.505, { color: 0xffb347, rate: 1.4 }),
    moth(0.3, 0.19),
  ],
  'workshop-1': [
    fx('sparks', 0.6, 0.49, { color: 0xffc070, rate: 0.6 }),
  ],
  'workshop-2': [
    fx('weld', 0.335, 0.522, { color: 0xbfe6ff, size: 0.02 }),
    scr(0.86, 0.425, 0.05, 0.02), scr(0.885, 0.6, 0.04, 0.02), scr(0.6, 0.395, 0.02, 0.04),
    fx('pulse', 0.87, 0.5, { w: 0.13, h: 0.1, color: CYAN, rate: 1.1 }),
    led(0.075, 0.3, CYAN), led(0.105, 0.3, CYAN, 0.004, 2.7), led(0.075, 0.335, CYAN, 0.004, 3.4), led(0.105, 0.335, CYAN, 0.004, 5),
    led(0.92, 0.32, CYAN, 0.005, 1.5),
  ],
  'medbay-0': [
    fx('tube', 0.32, 0.226, { w: 0.24, h: 0.025, color: 0xdff4ff }),
    fx('drip', 0.135, 0.47, { to: 0.505, color: 0xcfe8ff, rate: 0.7 }),
    moth(0.32, 0.25),
  ],
  'medbay-1': [
    fx('tube', 0.31, 0.226, { w: 0.25, h: 0.03, color: 0xdff4ff }),
    fx('drip', 0.128, 0.455, { to: 0.49, color: 0xcfe8ff, rate: 0.7 }),
  ],
  'medbay-2': [
    scr(0.398, 0.415, 0.13, 0.085),
    fx('ecg', 0.385, 0.405, { w: 0.09, h: 0.04, color: 0x7dffb0 }),
    scr(0.835, 0.505, 0.11, 0.065), scr(0.015, 0.46, 0.03, 0.05), scr(0.09, 0.82, 0.06, 0.04),
    fx('pulse', 0.26, 0.43, { w: 0.12, h: 0.035, color: CYAN, rate: 1.8 }),
    fx('pulse', 0.79, 0.6, { w: 0.08, h: 0.025, color: CYAN }),
    led(0.025, 0.21, CYAN, 0.006, 1.2),
    fx('tube', 0.31, 0.212, { w: 0.25, h: 0.02, color: 0xe8fbff }),
    fx('drip', 0.045, 0.37, { to: 0.4, color: 0xcfe8ff, rate: 0.7 }),
  ],
  'canteen-0': [
    fx('flame', 0.15, 0.562, { w: 0.09, size: 0.006, color: GAS }),
    fx('steam', 0.15, 0.47, { color: STEAM, size: 0.06 }),
    fx('steam', 0.4, 0.515, { color: STEAM, size: 0.03, rate: 0.4 }),
    fx('steam', 0.575, 0.49, { color: STEAM, size: 0.01, rate: 0.5 }),
    fx('haze', 0.15, 0.4, { w: 0.13, h: 0.16 }),
    moth(0.605, 0.21),
  ],
  'canteen-1': [
    fx('flame', 0.14, 0.562, { w: 0.09, size: 0.006, color: GAS }),
    fx('steam', 0.145, 0.47, { color: STEAM, size: 0.06 }),
    fx('steam', 0.222, 0.52, { color: STEAM, size: 0.012, rate: 0.5 }),
    fx('haze', 0.145, 0.4, { w: 0.13, h: 0.16 }),
  ],
  'canteen-2': [
    fx('steam', 0.11, 0.5, { color: STEAM, size: 0.05 }),
    fx('pulse', 0.09, 0.605, { w: 0.1, h: 0.025, color: GAS, rate: 0.8 }),
    fx('pulse', 0.36, 0.535, { w: 0.1, h: 0.06, color: 0xffb050, rate: 3 }),
    fx('pulse', 0.71, 0.555, { w: 0.16, h: 0.07, color: 0xbfffe0, rate: 0.9 }),
    fx('haze', 0.11, 0.43, { w: 0.11, h: 0.13 }),
  ],
  'laboratory-0': [
    scr(0.8, 0.485, 0.105, 0.08, CRT),
    led(0.83, 0.665, RED, 0.003), led(0.865, 0.665, ORANGE, 0.003, 2.2),
    needle(0.27, 0.33), needle(0.915, 0.285, 0.012, 0.4),
    fx('bubbles', 0.555, 0.575, { to: 0.535, size: 0.012, color: 0xcfe8d0, rate: 0.5 }),
    moth(0.142, 0.17),
  ],
  'laboratory-1': [
    scr(0.8, 0.485, 0.11, 0.085, CRT),
    fx('bubbles', 0.645, 0.56, { to: 0.52, size: 0.02, color: 0xb8ff90 }),
    fx('steam', 0.645, 0.5, { color: 0xd8ffd0, size: 0.01, rate: 0.4 }),
    led(0.84, 0.665, RED, 0.003), led(0.875, 0.665, LED_G, 0.003, 2.2),
    needle(0.27, 0.335), needle(0.915, 0.29, 0.012, 0.4),
  ],
  'laboratory-2': [
    scr(0.555, 0.37, 0.4, 0.17),
    fx('pulse', 0.1, 0.5, { w: 0.14, h: 0.35, color: CYAN, rate: 0.7 }),
    scr(0.94, 0.53, 0.06, 0.07), scr(0.31, 0.575, 0.04, 0.02),
    scr(0.27, 0.305, 0.03, 0.03, CYAN, { band: false }), scr(0.91, 0.29, 0.03, 0.03, CYAN, { band: false }),
    led(0.92, 0.35, LED_G), led(0.92, 0.37, CYAN, 0.004, 2.6), led(0.92, 0.39, LED_G, 0.004, 5.1),
    scr(0.86, 0.69, 0.15, 0.015), scr(0.86, 0.735, 0.15, 0.015),
    fx('bubbles', 0.59, 0.585, { to: 0.535, size: 0.03, color: 0xbffff4 }),
  ],
  'radioTower-0': [...RADIO, moth(0.233, 0.2)],
  'radioTower-1': [
    ...RADIO,
    fx('reel', 0.335, 0.355, { size: 0.026, color: 0xb8b2a8 }),
    fx('reel', 0.395, 0.355, { size: 0.026, color: 0xb8b2a8, rate: 0.8 }),
  ],
  'radioTower-2': [
    fx('radar', 0.3, 0.585, { size: 0.09, color: 0x3dff7a }),
    scr(0.278, 0.35, 0.075, 0.055), scr(0.385, 0.35, 0.075, 0.055),
    fx('ecg', 0.34, 0.425, { w: 0.16, h: 0.05, color: CYAN, rate: 1.6 }),
    fx('ecg', 0.1, 0.52, { w: 0.12, h: 0.045, color: 0x7dff8a, rate: 0.8 }),
    fx('ecg', 0.48, 0.52, { w: 0.07, h: 0.04, color: 0x7dff8a, rate: 1.2 }),
    led(0.77, 0.215, RED, 0.012, 1.3),
    led(0.84, 0.46), led(0.88, 0.51, LED_G, 0.004, 2.1), led(0.86, 0.56, LED_G, 0.004, 5.3), led(0.89, 0.41, ORANGE, 0.004, 3.2),
    led(0.05, 0.64, ORANGE, 0.005, 1.7), led(0.11, 0.665, 0xff6040, 0.005, 2.9),
  ],
  'waterPurifier-0': [
    fx('bubbles', 0.085, 0.63, { to: 0.5, size: 0.03, color: 0xcfefff }),
    ...PURIFIER(0.725),
    moth(0.13, 0.19),
  ],
  'waterPurifier-1': [
    fx('bubbles', 0.085, 0.635, { to: 0.515, size: 0.035, color: 0xdff6ff }),
    ...PURIFIER(0.72),
  ],
  'waterPurifier-2': [
    fx('bubbles', 0.085, 0.66, { to: 0.565, size: 0.035, color: 0xdff6ff }),
    fx('bubbles', 0.82, 0.73, { to: 0.52, size: 0.09, color: 0xdff6ff }),
    scr(0.22, 0.47, 0.04, 0.055, ICE), scr(0.405, 0.47, 0.04, 0.055, ICE), scr(0.69, 0.352, 0.08, 0.035, ICE),
    scr(0.94, 0.425, 0.03, 0.03, ICE, { band: false }),
    fx('fan', 0.937, 0.525, { size: 0.022, color: 0x30343a }),
    fx('stream', 0.534, 0.8, { to: 0.875, color: 0xbfefff, size: 0.008, ring: 0.05 }),
    fx('stream', 0.87, 0.67, { to: 0.72, color: 0xbfefff, size: 0.005 }),
  ],
  'trainingRoom-0': [
    fx('drip', 0.44, 0.15, { to: 0.9, color: WATER, ring: 0.03 }),
    moth(0.227, 0.19),
  ],
  'trainingRoom-1': [
    fx('steam', 0.42, 0.135, { color: STEAM, size: 0.015, rate: 0.35 }),
    moth(0.224, 0.19),
  ],
  'trainingRoom-2': [
    scr(0.42, 0.33, 0.23, 0.2),
    fx('ecg', 0.47, 0.33, { w: 0.08, h: 0.04, color: CYAN, rate: 0.9 }),
    scr(0.82, 0.545, 0.1, 0.045),
    led(0.13, 0.375, CYAN, 0.006, 0.9), led(0.6, 0.345, CYAN, 0.004, 1.7), led(0.975, 0.355, CYAN, 0.004, 2.3),
  ],
  'armory-0': [
    scr(0.8, 0.56, 0.115, 0.075, 0xd8e0d0),
    led(0.62, 0.585, RED, 0.003, 1.1),
    moth(0.606, 0.155),
  ],
  'armory-1': [
    scr(0.73, 0.535, 0.09, 0.045, ICE), scr(0.84, 0.535, 0.09, 0.045, ICE),
    scr(0.73, 0.59, 0.09, 0.045, ICE), scr(0.84, 0.59, 0.09, 0.045, ICE),
    led(0.84, 0.64, LED_G, 0.003),
  ],
  'armory-2': [
    fx('pulse', 0.6, 0.155, { w: 0.14, h: 0.12, color: RED, rate: 2.2 }),
    ...[0.595, 0.7, 0.805, 0.91].flatMap(x => [scr(x, 0.535, 0.095, 0.055, ICE), scr(x, 0.6, 0.095, 0.055, ICE)]),
    scr(0.6, 0.645, 0.12, 0.02, ICE, { band: false }), scr(0.85, 0.65, 0.12, 0.02, ICE, { band: false }),
    led(0.925, 0.37, CYAN), led(0.925, 0.4, CYAN, 0.004, 2.4), led(0.905, 0.42, LED_G, 0.004, 3.9),
    fx('pulse', 0.04, 0.5, { w: 0.03, h: 0.3, color: CYAN, rate: 0.6 }),
  ],
  'reactor-0': [
    fx('pulse', 0.495, 0.55, { w: 0.085, h: 0.11, color: 0x9dff3a, rate: 2 }),
    fx('flame', 0.857, 0.445, { size: 0.007, color: CANDLE }),
    led(0.82, 0.635), led(0.84, 0.635, ORANGE, 0.004, 2.5), led(0.86, 0.635, LED_G, 0.004, 3.3),
    needle(0.8, 0.52, 0.008), needle(0.845, 0.52, 0.008, 0.4), needle(0.89, 0.52, 0.008, 1),
    fx('steam', 0.5, 0.315, { color: STEAM, size: 0.03, rate: 0.4 }),
    fx('haze', 0.5, 0.4, { w: 0.2, h: 0.2 }),
    moth(0.5, 0.21),
  ],
  'reactor-1': [
    fx('pulse', 0.492, 0.545, { w: 0.085, h: 0.11, color: 0xb8ff40, rate: 2 }),
    fx('flame', 0.857, 0.44, { size: 0.007, color: CANDLE }),
    led(0.82, 0.638), led(0.84, 0.638, LED_G, 0.004, 2.5), led(0.857, 0.638, LED_G, 0.004, 3.3),
    needle(0.8, 0.52, 0.009), needle(0.845, 0.52, 0.009, 0.4), needle(0.89, 0.52, 0.009, 1),
    fx('steam', 0.73, 0.61, { color: STEAM, size: 0.012, rate: 0.5 }),
    fx('haze', 0.492, 0.4, { w: 0.2, h: 0.2 }),
  ],
  'reactor-2': [
    fx('pulse', 0.5, 0.6, { w: 0.22, h: 0.3, color: CYAN, rate: 1.6 }),
    fx('bubbles', 0.5, 0.76, { to: 0.47, size: 0.15, color: 0xaafff0, rate: 1.5 }),
    fx('pulse', 0.5, 0.17, { w: 0.16, h: 0.04, color: CYAN, rate: 1.6 }),
    scr(0.12, 0.44, 0.11, 0.11), scr(0.89, 0.455, 0.11, 0.14),
    scr(0.82, 0.605, 0.05, 0.04), scr(0.87, 0.605, 0.05, 0.04), scr(0.925, 0.605, 0.05, 0.04),
    led(0.86, 0.665, CYAN), led(0.8, 0.665, LED_G, 0.004, 2.8),
    fx('haze', 0.5, 0.4, { w: 0.2, h: 0.2 }),
  ],
  'hydroponics-0': [
    fx('pulse', 0.51, 0.235, { w: 0.62, h: 0.05, color: PINK, rate: 0.7 }),
    fx('flame', 0.917, 0.668, { size: 0.007, color: CANDLE }),
    fx('drip', 0.123, 0.6, { to: 0.635, color: WATER, ring: 0.02 }),
    fx('drip', 0.53, 0.56, { to: 0.9, color: WATER, ring: 0.025, rate: 0.6 }),
    moth(0.917, 0.64),
  ],
  'hydroponics-1': [
    fx('pulse', 0.51, 0.235, { w: 0.62, h: 0.04, color: 0xe8d8ff, rate: 0.7 }),
    fx('flame', 0.917, 0.672, { size: 0.007, color: CANDLE }),
    fx('drip', 0.123, 0.6, { to: 0.638, color: WATER, ring: 0.02 }),
  ],
  'hydroponics-2': [
    fx('bubbles', 0.11, 0.79, { to: 0.7, size: 0.05, color: 0xbffff4 }),
    scr(0.92, 0.645, 0.08, 0.075), scr(0.5, 0.8, 0.08, 0.03), scr(0.105, 0.825, 0.035, 0.02, CYAN, { band: false }),
    fx('pulse', 0.23, 0.82, { w: 0.035, h: 0.035, color: CYAN, rate: 2.4 }),
    led(0.155, 0.258, RED, 0.003, 1.4), led(0.81, 0.178, RED, 0.003, 1.9),
    led(0.43, 0.8, CYAN), led(0.57, 0.8, CYAN, 0.004, 2.7),
  ],
  'storage-0': [
    fx('drip', 0.42, 0.06, { to: 0.885, color: WATER, ring: 0.04 }),
    moth(0.49, 0.19),
  ],
  'storage-1': [moth(0.479, 0.2)],
  'storage-2': [
    scr(0.72, 0.71, 0.08, 0.065),
    led(0.21, 0.81, CYAN, 0.004, 1.6), led(0.05, 0.135, CYAN, 0.004, 0.8), led(0.945, 0.135, CYAN, 0.004, 1.1),
  ],
};

/** Two-floor halls: the atrium's fountain, fairy lights and falling leaves; the reactor hall's twin cores. */
const HALL_FX: Record<string, FxSpot[]> = {
  atrium: [
    fx('stream', 0.5, 0.708, { to: 0.752, color: 0xcfe8ff, size: 0.03, ring: 0.07 }),
    fx('flame', 0.44, 0.685, { size: 0.005, color: CANDLE }),
    ...[[0.06, 0.262], [0.94, 0.258], [0.06, 0.612], [0.94, 0.612], [0.355, 0.565], [0.655, 0.565]]
      .map(([x, y]) => fx('flame', x, y, { size: 0.009, color: CANDLE, rate: 0.4 })),
    ...[[0.1, 0.205], [0.163, 0.243], [0.228, 0.27], [0.29, 0.29], [0.42, 0.31], [0.49, 0.315], [0.61, 0.305], [0.73, 0.275],
      [0.79, 0.235], [0.84, 0.233], [0.89, 0.205], [0.258, 0.505], [0.302, 0.518], [0.35, 0.523], [0.583, 0.533],
      [0.633, 0.538], [0.68, 0.53], [0.738, 0.53], [0.785, 0.535]].map(([x, y]) => fx('twinkle', x, y, { size: 0.006, color: 0xffd890 })),
    fx('leaf', 0.5, 0.22, { size: 0.42, to: 0.8, color: 0x6b7a2e }),
  ],
  reactorHall: [
    fx('pulse', 0.5, 0.37, { w: 0.18, h: 0.28, color: CYAN, rate: 1.5 }),
    fx('pulse', 0.5, 0.6, { w: 0.16, h: 0.2, color: CYAN, rate: 1.5 }),
    fx('bubbles', 0.5, 0.46, { to: 0.29, size: 0.12, color: 0xaafff0, rate: 1.2 }),
    fx('bubbles', 0.5, 0.66, { to: 0.53, size: 0.1, color: 0xaafff0 }),
    ...[[0.112, 0.255], [0.885, 0.255], [0.92, 0.36], [0.148, 0.635], [0.83, 0.635], [0.325, 0.8]]
      .map(([x, y]) => fx('flame', x, y, { size: 0.009, color: CANDLE, rate: 0.5 })),
    scr(0.14, 0.735, 0.05, 0.03), scr(0.17, 0.722, 0.05, 0.03), scr(0.435, 0.735, 0.045, 0.03), scr(0.555, 0.735, 0.045, 0.03),
    scr(0.835, 0.73, 0.05, 0.03),
    led(0.5, 0.77, LED_G), led(0.47, 0.775, ORANGE, 0.004, 2.6), led(0.53, 0.775, RED, 0.004, 1.4),
    fx('steam', 0.34, 0.33, { color: 0xbfe8e0, size: 0.06, rate: 0.5 }),
    fx('steam', 0.66, 0.33, { color: 0xbfe8e0, size: 0.06, rate: 0.5 }),
    fx('haze', 0.5, 0.48, { w: 0.22, h: 0.12 }),
  ],
};

function roomEntry(type: BuildingType, tier: RoomTier): ArtEntry {
  const key = `${type}-${tier}`;
  return {
    key: `rooms/${key}`,
    kind: 'room',
    out: roomSlots(type) === 3 ? WIDE_OUT : NARROW_OUT,
    lights: ROOM_LIGHTS[key],
    fx: ROOM_FX[key],
  };
}

export const PAINTED_TYPES: BuildingType[] = [
  'quarters', 'farm', 'generator', 'waterPump', 'workshop', 'medbay', 'canteen', 'laboratory',
  'radioTower', 'waterPurifier', 'trainingRoom', 'armory', 'reactor', 'hydroponics', 'storage',
];

/** Room paintings that exist on disk: every room type in all three tiers. */
const AVAILABLE_ROOMS: [BuildingType, RoomTier][] = PAINTED_TYPES.flatMap(t => [[t, 0], [t, 1], [t, 2]] as [BuildingType, RoomTier][]);

/** Ruin paintings: generic ruins in both widths, plus wrecked versions of the rooms found at the start. */
export const RUIN_KEYS = [
  'collapsed-wide', 'collapsed-narrow', 'debris-wide', 'debris-narrow', 'flooded-wide', 'flooded-narrow',
  'wreck-generator', 'wreck-waterPump', 'wreck-farm', 'wreck-canteen', 'wreck-medbay', 'wreck-workshop',
];

function ruinEntry(key: string): ArtEntry {
  const wide = key.endsWith('-wide') || key === 'wreck-farm';
  return { key: `ruins/${key}`, kind: 'ruin', out: wide ? WIDE_OUT : NARROW_OUT };
}

/** Painted survivor portraits; each survivor gets one by their portrait index. */
export const PORTRAIT_COUNT = 14;

/** Natural spaces found when digging sideways: each is a wide cavern painting. */
export const DISTRICT_KEYS = ['cave', 'lake', 'metro'] as const;
export type DistrictArt = typeof DISTRICT_KEYS[number];
/** District paintings are twice as wide as tall (6 slots × one floor, with headroom). */
export const DISTRICT_OUT: [number, number] = [960, 484];

/** Two-floor halls, painted tall. */
export const HALL_KEYS = ['atrium', 'reactorHall'] as const;
export const HALL_OUT: [number, number] = [560, 876];

/** One illustration per surface biome, shown on expedition reports and the map. */
export const BIOME_ART = ['ruins', 'wasteland', 'toxicForest', 'shatteredCity', 'caves', 'militaryZone'] as const;

/**
 * Structure kit of the graphics overhaul (tools/kit.html): seamless concrete, slab, steel and pipe
 * textures, and the excavated-bay paintings for empty slots. Suffix F = restored state.
 */
export const KIT: [string, [number, number]][] = [
  ...(['F', 'R', 'L'] as const).flatMap(st => [
    [`kit/wall-${st}`, [512, 512]], [`kit/slab-${st}`, [1024, 368]], [`kit/column-${st}`, [144, 512]], [`kit/pipes-${st}`, [1024, 252]],
  ] as [string, [number, number]][]),
  ['kit/bay-A-wide', WIDE_OUT], ['kit/bay-A-narrow', NARROW_OUT],
  ['kit/car', [288, 448]],
  ...Array.from({ length: 9 }, (_, i) => [`kit/wprop-${i}`, [160, 160]] as [string, [number, number]]), // signage: wall props sheet K-25b
  ...[0, 1, 3].map(i => [`kit/portal-${i}`, [840, 560]] as [string, [number, number]]), // surface: entrance portal per era look
  ['kit/wheel', [256, 256]], // surface: blast-door wheel
  ['kit/topsoil-R', [1024, 440]], ['kit/topsoil-L', [1024, 440]], // surface: topsoil cross-section strips
  ...Array.from({ length: 9 }, (_, i) => [`kit/prop-${i}`, [400, 400]] as [string, [number, number]]), // surface: props S-07 (+ mast S-08)
  ...['radioMast', 'purifier', 'greenhouse', 'skyDome', 'vaultSeal', 'wall', 'deepFoundry', 'metroTunnel', 'archive', 'surfaceGate', 'tradeLeague', 'constitution', 'ark', 'genesisCore']
    .map(id => [`kit/proj-${id}`, [512, 512]] as [string, [number, number]]), // surface: big project buildings (P-01/P-02 sheets, Moda)
  ...['crack-a', 'crack-b', 'crack-c', 'crack-d', 'crack-web', 'mould', 'soot', 'handprints', 'patch-b'].map(n => [`kit/decal-${n}`, [128, 128]] as [string, [number, number]]), // wear: decals (tools/decals.html)
  ...['stain-a', 'stain-b'].map(n => [`kit/decal-${n}`, [96, 256]] as [string, [number, number]]), ['kit/decal-rust-drip', [64, 192]], // wear: streaks
  ...['scratch-tally', 'chalk-tally', 'patch'].map(n => [`kit/decal-${n}`, [128, 96]] as [string, [number, number]]), // wear: tallies, cement patch
  ['kit/decal-chalk-kid', [192, 128]], ['kit/decal-chalk-kid-b', [160, 128]], ['kit/decal-arrow', [128, 64]], // wear: chalk drawings, stencil arrow
  ['kit/decal-stencil-B', [96, 96]], ['kit/decal-stencil-digits', [640, 96]], ['kit/decal-jbox', [96, 128]], // wear: stencil letter + digit strip, broken junction box
  ...['sign-radiation', 'sign-voltage', 'sign-nosmoke', 'sign-water'].map(n => [`kit/decal-${n}`, [96, 96]] as [string, [number, number]]), // wear: enamel signs
  ['kit/decal-sign-exit', [128, 64]], ['kit/decal-sign-exit-glow', [128, 64]], // wear: exit sign + its glow (add)
];

export function portraitKey(index: number): string {
  return `portraits/p${String((Math.abs(index) % PORTRAIT_COUNT) + 1).padStart(2, '0')}`;
}

export const ART: ArtEntry[] = [
  ...AVAILABLE_ROOMS.map(([t, tier]) => roomEntry(t, tier)),
  ...RUIN_KEYS.map(ruinEntry),
  ...[1, 2, 3].map(i => ({ key: `story/intro-${i}`, kind: 'story' as const, out: [720, 963] as [number, number] })),
  ...[0, 1, 2, 3].map(i => ({ key: `backdrops/surface-${i}`, kind: 'backdrop' as const, out: [1400, 706] as [number, number] })),
  ...Array.from({ length: PORTRAIT_COUNT }, (_, i) => ({ key: portraitKey(i), kind: 'portrait' as const, out: [256, 256] as [number, number] })),
  ...DISTRICT_KEYS.map(k => ({ key: `districts/${k}`, kind: 'district' as const, out: DISTRICT_OUT })),
  ...HALL_KEYS.map(k => ({ key: `halls/${k}`, kind: 'hall' as const, out: HALL_OUT, fx: HALL_FX[k] })),
  { key: 'backdrops/rock', kind: 'backdrop', out: [472, 840], focusY: 0 },
  ...BIOME_ART.map(k => ({ key: `biomes/${k}`, kind: 'biome' as const, out: [840, 472] as [number, number] })),
  ...KIT.map(([key, out]) => ({ key, kind: 'kit' as const, out })),
];

const BY_KEY = new Map(ART.map(a => [a.key, a]));

export function artEntry(key: string): ArtEntry | undefined {
  return BY_KEY.get(key);
}

/** Best available painting for a room: exact tier, else the nearest lower tier, else any tier. */
export function roomArtKey(type: BuildingType, tier: RoomTier): string | null {
  for (let t = tier; t >= 0; t--) if (BY_KEY.has(`rooms/${type}-${t}`)) return `rooms/${type}-${t}`;
  for (let t = tier + 1; t <= 2; t++) if (BY_KEY.has(`rooms/${type}-${t}`)) return `rooms/${type}-${t}`;
  return null;
}

/** Painting for any building type, including districts and halls (which have one look). */
export function buildingArtKey(type: BuildingType, tier: RoomTier): string | null {
  if ((DISTRICT_KEYS as readonly string[]).includes(type)) return `districts/${type}`;
  if ((HALL_KEYS as readonly string[]).includes(type)) return `halls/${type}`;
  return roomArtKey(type, tier);
}

/** Raw file name in art-src/raw for an entry. */
export function rawName(entry: ArtEntry): string {
  return `${entry.key.split('/').pop()}.png`;
}

/** Painting for a ruin: its own wreck/ruin art, else the room's rusty painting sunk in darkness. */
export function ruinArtKey(r: Ruin): { key: string; darken: boolean } | null {
  if (r.restoresTo) {
    if (BY_KEY.has(`ruins/wreck-${r.restoresTo}`)) return { key: `ruins/wreck-${r.restoresTo}`, darken: false };
    const room = roomArtKey(r.restoresTo, 0);
    return room ? { key: room, darken: true } : null;
  }
  const key = `ruins/${r.kind}-${r.w >= 3 ? 'wide' : 'narrow'}`;
  return BY_KEY.has(key) ? { key, darken: false } : null;
}

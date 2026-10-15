/**
 * World redesign "The City Below": the art-direction tokens.
 *
 * Every visual and ambience value the world agents need lives here: strata identity, the depth-layer stack, light pools and
 * readability floors, fog of war, camera feel, detail per quality tier and ambience gains per stratum. The prose behind each
 * number is in `store/world-redesign/C-style-guide.md`; when you change a value here, keep the guide in step.
 *
 * Conventions
 * - Colours are 0xRRGGBB (sRGB, the same space Pixi tints use). Alphas and levels are 0..1.
 * - Distances are WORLD UNITS (1 unit = 1 CSS px at zoom 1). Reference sizes from `rendering/geom.ts`: SLOT_W 46, ROOM_H 100,
 *   FLOOR_H 144 (airy), an adult survivor is 48 tall.
 * - Times are seconds, rates are 1/s, frequencies are Hz.
 * - Strata are keyed by LOGICAL FLOOR INDEX (0 = B1, -1 = surface row), never by world y, so a change of geometry cannot move a
 *   stratum. `yHint` is only the current airy geometry, for tools and docs.
 * - The world is never mirrored by language: the entrance is on the right and the city deepens to the left in Hebrew and English.
 *
 * This module is pure data plus a few pure helpers. It imports nothing at runtime.
 */
import type { QualityLevel } from '../utils/PerformanceMonitor';

export type Hex = number;
export type Tier = QualityLevel;
export type Bilingual = { readonly he: string; readonly en: string };

// =================================================================================================================================
// STRATA
// =================================================================================================================================

export type StratumId = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type StratumKey = 'surface' | 'shelter' | 'service' | 'metro' | 'mines' | 'caves' | 'core';

export interface StratumPalette {
  /** Main rock of the cut face (the earth around the city). */
  rock: Hex;
  /** Rock in shadow / crevices. */
  rockDark: Hex;
  /** The lit lip where the cut meets a cavity (the "section edge" rim). */
  rockRim: Hex;
  /** Built surfaces: walls, slabs, floors (the dominant made material). */
  built: Hex;
  /** Built surfaces in shadow. */
  builtDark: Hex;
  /** Second material (trim, tiles, timber, enamel paint). */
  secondary: Hex;
  /** Metal of the stratum (steel, cast iron, brass, rails). */
  metal: Hex;
  /** The one saturated accent that names the stratum at a glance (signage paint, ore, crystal, magma). */
  accent: Hex;
  /** Safety / warning paint (hazard bands, barriers). */
  hazard: Hex;
  /** The far-plane silhouette colour (back/far layers sit on this before fog). */
  farBase: Hex;
}

export interface StratumLight {
  /** The stratum's signature key light (its most common lamp). */
  key: Hex;
  /** Correlated colour temperature of the key light, for documentation and audio/UI cues. */
  kelvin: number;
  /** A second light colour that recurs (work light, signal, glow). */
  secondary: Hex;
  /** Lightmap clear colour: what unlit rock and structure look like here, before any lamp. */
  ambient: Hex;
  /** Ambient strength 0..1 (multiplies `ambient`). The deeper, the lower; readability floors in LIGHT.read override it for rooms. */
  ambientLevel: number;
  /** Multiplier on all pool intensities in the stratum (deep strata get slightly hotter pools so islands of light pop). */
  poolGain: number;
  /** Additive halo strength multiplier (bloom-feed) for lamp cores in this stratum. */
  glowGain: number;
}

export interface StratumFog {
  /** Colour the back/far layers fade toward, and the tint of in-cavity haze. */
  color: Hex;
  /** 0..1, how strongly depth layers fade toward `color` (multiplies LAYERS[i].fog). */
  density: number;
  /** Alpha of the screen-space haze band drawn between depth layers. */
  haze: number;
  /** Lit dust motes per 1000x1000 world units at High (scaled by DETAIL). */
  motes: number;
  /** Mote colour before the lamp that lights it tints it. */
  moteColor: Hex;
}

export interface StratumTokens {
  id: StratumId;
  key: StratumKey;
  name: Bilingual;
  /** Inclusive logical floor range (0 = B1). The surface is [-1, -1]; the world above the ground is also stratum 0. */
  floors: readonly [number, number];
  /** Current airy geometry only (world y of the top and bottom), for tools and docs. */
  yHint: readonly [number, number];
  feelsLike: Bilingual;
  /** Architecture language in a few words, for the kit builders. */
  architecture: string;
  materials: readonly string[];
  signatureProps: readonly string[];
  palette: StratumPalette;
  light: StratumLight;
  fog: StratumFog;
  /** The colour of a "tease" (a light glimpsed through fog / rubble) that belongs to this stratum. */
  tease: Hex;
  /** Sound mood in words; numbers live in AUDIO. */
  sound: string;
}

/**
 * The seven strata. Boundaries follow the service galleries (GALLERY_ABOVE_FLOORS = 3, 7, 11, 15, 19): every gallery band is a
 * stratum seam, so the existing floor-index rules (zones, galleries, fire code, collapse) stay meaningful.
 */
export const STRATA: readonly StratumTokens[] = [
  {
    id: 0, key: 'surface', floors: [-1, -1], yHint: [-700, 0],
    name: { he: 'פני השטח', en: 'The Surface' },
    feelsLike: { he: 'האור החם האחרון לפני הירידה', en: 'The last warm light before the descent' },
    architecture: 'ruins and scorched concrete; one propped blast hatch; everything leans',
    materials: ['ash soil', 'scorched concrete', 'rebar', 'rusted sheet', 'sandbags', 'dead timber'],
    signatureProps: ['propped hatch leaf', 'sandbag wall', 'radio mast with red beacon', 'dead tree', 'rusted car', 'sagging power line', 'barrel fire'],
    palette: {
      rock: 0x4a3426, rockDark: 0x2c1f17, rockRim: 0xb89a78, built: 0x6e6860, builtDark: 0x3e3a36, secondary: 0x8a7d5e,
      metal: 0x7a4a2c, accent: 0xd88a44, hazard: 0xc89a2a, farBase: 0x2a1c18,
    },
    light: { key: 0xffb070, kelvin: 2600, secondary: 0x7f95c8, ambient: 0x6a5446, ambientLevel: 0.85, poolGain: 0.8, glowGain: 0.8 },
    fog: { color: 0x6a5040, density: 0.35, haze: 0.18, motes: 10, moteColor: 0xd8c8b0 },
    tease: 0xff3a2a,
    sound: 'wind over ash, a loose sheet of metal knocking, a geiger tick now and then',
  },
  {
    id: 1, key: 'shelter', floors: [0, 3], yHint: [0, 646],
    name: { he: 'המקלט העליון', en: 'Upper Shelter' },
    feelsLike: { he: 'כיכר עיר בתוך מקלט של הג"א שהפך לבית', en: 'A town square inside a civil-defence shelter that became home' },
    architecture: 'poured concrete, chamfered beams, riveted blast doors, three-storey hub with balconies and stair flights',
    materials: ['board-formed concrete', 'enamel green and cream paint', 'riveted steel', 'brass fittings', 'hazard bands', 'stencil numbers'],
    signatureProps: ['brass ring chandelier', 'balconies with railings', 'notice board', 'ration posters', 'string lights', 'benches', 'old lift cage'],
    palette: {
      rock: 0x4d3322, rockDark: 0x2c1f17, rockRim: 0x9a8a72, built: 0x8f8a80, builtDark: 0x524e48, secondary: 0x5d6b58,
      metal: 0xb08a4a, accent: 0x5d6b58, hazard: 0xc89a2a, farBase: 0x16120f,
    },
    light: { key: 0xffd8a0, kelvin: 2900, secondary: 0xffc27a, ambient: 0x40382f, ambientLevel: 0.34, poolGain: 1.0, glowGain: 1.0 },
    fog: { color: 0x2a2622, density: 0.45, haze: 0.14, motes: 40, moteColor: 0xffe2b8 },
    tease: 0xffc27a,
    sound: 'mains hum, a crowd murmur, boots on steel grating, a far ventilation fan',
  },
  {
    id: 2, key: 'service', floors: [4, 7], yHint: [646, 1256],
    name: { he: 'רשת השירות', en: 'Service Network' },
    feelsLike: { he: 'הריאות והוורידים של העיר', en: 'The lungs and veins of the city' },
    architecture: 'galleries and catwalks, pipe racks, tiled maintenance corridors, everything bolted and labelled',
    materials: ['green and cream glazed tile', 'galvanised steel', 'grating', 'insulated pipe', 'cable trays', 'painted valves'],
    signatureProps: ['pipe manifold with red valve wheels', 'steam vent', 'pressure gauges', 'caged fluorescent tubes (one failing)', 'big wall fan', 'junction boxes'],
    palette: {
      rock: 0x6c6252, rockDark: 0x3a342c, rockRim: 0xa89a82, built: 0x7a8288, builtDark: 0x454b54, secondary: 0x4f6b5e,
      metal: 0x5b636b, accent: 0x8a3a2a, hazard: 0xd1a62b, farBase: 0x10141a,
    },
    light: { key: 0xc8f0e0, kelvin: 5000, secondary: 0xff9a3c, ambient: 0x2a332f, ambientLevel: 0.26, poolGain: 1.0, glowGain: 0.9 },
    fog: { color: 0x1e2a26, density: 0.55, haze: 0.2, motes: 55, moteColor: 0xd8f0e8 },
    tease: 0xc8f0e0,
    sound: 'ventilation roar, pipe knocks, a buzzing ballast, steam hiss, drips on metal',
  },
  {
    id: 3, key: 'metro', floors: [8, 11], yHint: [1256, 1866],
    name: { he: 'המטרו הישן', en: 'The Old Metro' },
    feelsLike: { he: 'הנסיעה היומית של עיר מתה, שהפכה לשוק', en: 'A dead city’s commute, reoccupied as a bazaar' },
    architecture: 'vaulted tunnels, glazed tile platforms, cast-iron columns, viaducts; long horizontals',
    materials: ['dirty glazed tile', 'teal enamel trim', 'cast iron', 'rail steel', 'creosote sleepers', 'granite'],
    signatureProps: ['enamel station sign', 'platform clock', 'turnstiles', 'derailed car with lit windows (market)', 'signal lamps', 'viaduct'],
    palette: {
      rock: 0x4a4c52, rockDark: 0x24262b, rockRim: 0x8a929e, built: 0xbcb59c, builtDark: 0x5e5a4c, secondary: 0x2f6b5c,
      metal: 0x3a3e44, accent: 0x2f6b5c, hazard: 0xd1a62b, farBase: 0x0c0f16,
    },
    light: { key: 0xff9a3c, kelvin: 2000, secondary: 0x40e0c0, ambient: 0x1c2228, ambientLevel: 0.2, poolGain: 1.1, glowGain: 1.1 },
    fog: { color: 0x1a2130, density: 0.65, haze: 0.24, motes: 45, moteColor: 0xffd0a0 },
    tease: 0x40e0c0,
    sound: 'tunnel wind, a ghost train rumble far away, long echo, market chatter in a hall',
  },
  {
    id: 4, key: 'mines', floors: [12, 15], yHint: [1866, 2476],
    name: { he: 'המכרות', en: 'The Mines' },
    feelsLike: { he: 'עבודה קשה לאור פנסים, במקום שבו העיר מרוויחה את האבן שלה', en: 'Hard labour by lantern light, where the city earns its stone' },
    architecture: 'timbered drifts, rough-hewn rock, headframes and winches, ladders and chutes; nothing is straight',
    materials: ['raw wet rock', 'rough timber', 'iron straps', 'rail and ore carts', 'rope', 'canvas'],
    signatureProps: ['headframe with winch wheel', 'ore carts on rails', 'timber sets', 'hanging lanterns', 'marked blasting crates', 'copper veins in the wall'],
    palette: {
      rock: 0x322e2c, rockDark: 0x181514, rockRim: 0x7a6a58, built: 0x6b4c2e, builtDark: 0x3a2a1a, secondary: 0x54412f,
      metal: 0x8c4c2b, accent: 0x3fa58a, hazard: 0xd8b04a, farBase: 0x0c0a09,
    },
    light: { key: 0xffcc80, kelvin: 2400, secondary: 0xfff0d0, ambient: 0x1a1512, ambientLevel: 0.13, poolGain: 1.15, glowGain: 1.1 },
    fog: { color: 0x2a2018, density: 0.75, haze: 0.28, motes: 80, moteColor: 0xe8c8a0 },
    tease: 0xffcc80,
    sound: 'picks, a distant blast and its rumble, timber creak, winch ratchet, dripping',
  },
  {
    id: 5, key: 'caves', floors: [16, 19], yHint: [2476, 3086],
    name: { he: 'המערות העמוקות', en: 'The Deep Caves' },
    feelsLike: { he: 'קתדרלה שאף אחד לא בנה', en: 'A cathedral nobody built' },
    architecture: 'natural caverns, stalactites, ledges; human building is light: rope bridges, stilt platforms, tarps',
    materials: ['violet-black cave rock', 'flowstone', 'crystal', 'still black water', 'rope', 'tarp and pole'],
    signatureProps: ['crystal clusters', 'bioluminescent fungus beds', 'rope bridge', 'stilt platform', 'still pool with reflections', 'stalactites'],
    palette: {
      rock: 0x352c47, rockDark: 0x15111e, rockRim: 0x6a5a88, built: 0x5a4a3a, builtDark: 0x2a2230, secondary: 0x2e2740,
      metal: 0x5a5e66, accent: 0x7af2ff, hazard: 0xd1a62b, farBase: 0x08070c,
    },
    light: { key: 0x4affc8, kelvin: 9000, secondary: 0xb07aff, ambient: 0x0c1018, ambientLevel: 0.08, poolGain: 1.25, glowGain: 1.3 },
    fog: { color: 0x101626, density: 0.85, haze: 0.3, motes: 60, moteColor: 0xb0fff0 },
    tease: 0x7af2ff,
    sound: 'water drips with long echoes, a low resonant tone, a far waterfall',
  },
  {
    id: 6, key: 'core', floors: [20, 23], yHint: [3086, 3660],
    name: { he: 'הליבה', en: 'The Core' },
    feelsLike: { he: 'הלב החם של האדמה: מסוכן ונדיב', en: 'The warm heart of the earth, dangerous and generous' },
    architecture: 'basalt and obsidian, magma fissures, heavy pre-war vault machinery and heat shields',
    materials: ['basalt', 'obsidian glass', 'heat-blued steel', 'vault brass', 'ceramic tiles', 'steam'],
    signatureProps: ['magma fissures in the floor', 'heat shields', 'geothermal pipes', 'vault ring door', 'steam plumes', 'shimmering air'],
    palette: {
      rock: 0x1a1618, rockDark: 0x0e0b0c, rockRim: 0x6a3020, built: 0x4a3a36, builtDark: 0x221a18, secondary: 0x2b1411,
      metal: 0xc8a060, accent: 0xff5a1e, hazard: 0xffa040, farBase: 0x0a0505,
    },
    light: { key: 0xff3a10, kelvin: 1500, secondary: 0xffa040, ambient: 0x2a0d06, ambientLevel: 0.12, poolGain: 1.2, glowGain: 1.35 },
    fog: { color: 0x2a0d06, density: 0.7, haze: 0.26, motes: 50, moteColor: 0xffa060 },
    tease: 0xff5a1e,
    sound: 'deep rumble, steam hiss, a slow machine pulse like a heartbeat',
  },
];

/** The stratum of a logical floor (0 = B1, -1 = surface). Floors past the last range stay in the core. */
export function stratumOfFloor(floor: number): StratumTokens {
  if (floor < 0) return STRATA[0];
  for (let i = 1; i < STRATA.length; i++) if (floor <= STRATA[i].floors[1]) return STRATA[i];
  return STRATA[STRATA.length - 1];
}

/**
 * Seam between two strata: the last `blendFloors` floors of a stratum blend their ambient, fog and audio toward the next one,
 * and the service gallery band at the seam carries the transition art (a change of rock + one signature prop of the next stratum).
 */
export const STRATA_SEAM = { blendFloors: 1, transitionH: 60 } as const;

/**
 * Side districts (cave, lake, metro, geothermal, oldVault) keep their own painting and identity even when it belongs to another
 * stratum (the Metro station on B4 foreshadows stratum 3); they take the HOST stratum's ambient, fog and grade.
 */
export const DISTRICT_HOST_GRADE = { ambientFromHost: true, fogFromHost: true, ownTeaseColour: true } as const;

// =================================================================================================================================
// LAYERS (depth stack, back to front)
// =================================================================================================================================

export type LayerId = 'sky' | 'far' | 'back' | 'mid' | 'play' | 'fore';
/** How a layer is lit: self-lit art, art with baked fog and its own glows, the shared lightmap, or a dark silhouette with rim. */
export type LayerLighting = 'self' | 'baked' | 'lightmap' | 'silhouette';

export interface LayerTokens {
  id: LayerId;
  /** Parallax factor: 1 = play plane. Position = screen/2 - cam * p * scale. */
  p: number;
  /** Scale = zoom ^ (p * zoomCoupling): far planes zoom less as well as scroll less. */
  zoomCoupling: number;
  /** 0..1 fade toward the stratum fog colour (multiplied by STRATA[i].fog.density). */
  fog: number;
  /** Multiply tint applied to the layer before fog (brightness of the layer's art). */
  tint: Hex;
  lighting: LayerLighting;
  /** Hidden below this zoom (layer stops reading / costs too much at map zoom). */
  minZoom: number;
  /** Hidden above this zoom. */
  maxZoom: number;
  /** Fade band width (zoom units) around minZoom / maxZoom. */
  fadeBand: number;
  /** The lowest tier that draws this layer. */
  minTier: Tier;
  /** May be rendered into one cached render texture and refreshed only when the camera moves more than CACHE.refreshPx. */
  cacheable: boolean;
  /** Is it hit-tested? Only the play plane is. */
  interactive: boolean;
  contents: string;
}

export const LAYERS: readonly LayerTokens[] = [
  {
    id: 'sky', p: 0.15, zoomCoupling: 1, fog: 0, tint: 0xffffff, lighting: 'self', minZoom: 0, maxZoom: 99, fadeBand: 0,
    minTier: 'low', cacheable: true, interactive: false,
    contents: 'surface sky painting (backdrops/surface-<era>.webp) pinned to the horizon vertically; above ground only',
  },
  {
    id: 'far', p: 0.4, zoomCoupling: 1, fog: 0.72, tint: 0x9098a8, lighting: 'baked', minZoom: 0.3, maxZoom: 99, fadeBand: 0.04,
    minTier: 'medium', cacheable: true, interactive: false,
    contents: 'colossal cavern pillars, terraced distant districts as window-light clusters, far lifts, haze bands; per-stratum painted far plate',
  },
  {
    id: 'back', p: 0.68, zoomCoupling: 1, fog: 0.48, tint: 0xb0b0b8, lighting: 'baked', minZoom: 0.3, maxZoom: 99, fadeBand: 0.04,
    minTier: 'low', cacheable: true, interactive: false,
    contents: 'cavern wall ribs, backlit house clusters, metro viaduct + moving train, ruins skyline above ground (on Low it also carries the far plate, merged)',
  },
  {
    id: 'mid', p: 0.88, zoomCoupling: 1, fog: 0.12, tint: 0xd8d4cc, lighting: 'lightmap', minZoom: 0.38, maxZoom: 99, fadeBand: 0.04,
    minTier: 'medium', cacheable: false, interactive: false,
    contents: 'galleries and pipes behind the hub window, shanties and scaffolds behind districts, crystal spires behind caves',
  },
  {
    id: 'play', p: 1, zoomCoupling: 1, fog: 0, tint: 0xffffff, lighting: 'lightmap', minZoom: 0, maxZoom: 99, fadeBand: 0,
    minTier: 'low', cacheable: false, interactive: true,
    contents: 'rock cut-face, back walls, structure, painted rooms, stairs/balconies/bridges, survivors, in-world signs',
  },
  {
    id: 'fore', p: 1.32, zoomCoupling: 1, fog: 0, tint: 0x060708, lighting: 'silhouette', minZoom: 0.85, maxZoom: 99, fadeBand: 0.1,
    minTier: 'high', cacheable: false, interactive: false,
    contents: 'ragged black rock lip, outcrops, sagging cables, end pipes; never over a room centre, max 12% of the screen',
  },
];

/** Cached far/back render texture (Medium/Low). */
export const LAYER_CACHE = {
  /** Re-render the cached planes when the camera has moved this many screen px since the last bake. */
  refreshPx: 24,
  /** ...or when zoom changed by this factor. */
  refreshZoom: 0.04,
  /** Never refresh more often than this while the camera moves (seconds). */
  minInterval: 0.12,
  /** Extra border baked around the view so small pans need no refresh (fraction of the screen). */
  overscan: 0.15,
} as const;

/** Haze drawn between depth layers (screen-space band in the stratum fog colour, alpha = STRATA[i].fog.haze). */
export const LAYER_HAZE = { betweenFarAndBack: 1, betweenBackAndMid: 0.6, betweenMidAndPlay: 0 } as const;

// =================================================================================================================================
// LIGHT
// =================================================================================================================================

export type FlickerKind = 'steady' | 'fire' | 'failingTube' | 'pulse' | 'sway' | 'blink' | 'tv' | 'weld';

export interface FlickerTokens {
  /** Amplitude 0..1 of intensity modulation. */
  amp: number;
  /** Main frequency (Hz). */
  hz: number;
  /** Chance per second of a drop-out (failing tube) or burst (weld). */
  events: number;
  /** Length of one drop-out / burst (s). */
  eventLen: number;
  /** Radius wobble as a fraction of the radius (fire, sway). */
  radiusWobble: number;
}

export interface LightPreset {
  color: Hex;
  /** Pool radius (world units): light reaches 0 here. */
  radius: number;
  /** Peak intensity in the lightmap (1 = brings a surface to its full painted value; above 1 overexposes into bloom). */
  intensity: number;
  flicker: FlickerKind;
  /** Additive halo sprite size as a fraction of the radius (0 = none). */
  halo: number;
  /** Downward cone length (world units, 0 = none). */
  cone: number;
  /** Lights dust motes inside the pool. */
  litMotes: boolean;
}

export const LIGHT = {
  /**
   * Falloff of every pool: I(d) = intensity * (1 - clamp((d - core*r) / (r - core*r)))^exp. The flat core keeps a lamp's floor
   * readable; exp 2.2 gives the soft "pool in darkness" edge prototypes A and C agreed on.
   */
  falloff: { exp: 2.2, core: 0.12 },
  /** Lightmap render texture: resolution vs the screen, per tier, and how it is applied. */
  lightmap: {
    scale: { high: 0.5, medium: 0.35, low: 0.25 } as Record<Tier, number>,
    /** Low only: redraw the lightmap at most this many times per second (flicker steps instead of sliding). */
    lowMaxHz: 15,
    /** Multiply that KEEPS the destination alpha (open caverns stay transparent; far planes show through un-darkened). */
    blend: 'multiplyKeepAlpha' as const,
    /** Additive glow layer above the lit play plane (lamp cores, cones, god-ray, flames, sparks, dust), strength. */
    glow: 0.55,
  },
  /** Global multiplier for all pools (debug / accessibility brightness hook). */
  intensity: 1,
  /** meta.json lamp radii (fraction of the painting) to world radius. */
  roomArtLightScale: 1.6,
  /** Lamp spill from a painted room into the corridor in front of it: fraction of the room lamp intensity. */
  roomSpill: 0.45,
  presets: {
    roomLamp: { color: 0xffd8a0, radius: 110, intensity: 1.0, flicker: 'steady', halo: 0.35, cone: 0, litMotes: true },
    wallLamp: { color: 0xffc27a, radius: 90, intensity: 0.9, flicker: 'steady', halo: 0.4, cone: 0, litMotes: true },
    cageLamp: { color: 0xffd8a0, radius: 120, intensity: 1.0, flicker: 'steady', halo: 0.35, cone: 110, litMotes: true },
    fluoroTube: { color: 0xc8f0e0, radius: 130, intensity: 0.95, flicker: 'steady', halo: 0.25, cone: 90, litMotes: false },
    failingTube: { color: 0xc8f0e0, radius: 130, intensity: 0.9, flicker: 'failingTube', halo: 0.25, cone: 90, litMotes: false },
    sodium: { color: 0xff9a3c, radius: 170, intensity: 1.05, flicker: 'steady', halo: 0.45, cone: 140, litMotes: true },
    streetLamp: { color: 0xffc27a, radius: 160, intensity: 1.1, flicker: 'steady', halo: 0.5, cone: 150, litMotes: true },
    chandelier: { color: 0xffc27a, radius: 320, intensity: 1.25, flicker: 'sway', halo: 0.45, cone: 260, litMotes: true },
    stringBulb: { color: 0xffd090, radius: 36, intensity: 0.7, flicker: 'sway', halo: 0.9, cone: 0, litMotes: false },
    fireBarrel: { color: 0xff7a2a, radius: 140, intensity: 1.3, flicker: 'fire', halo: 0.6, cone: 0, litMotes: true },
    forge: { color: 0xff5a1e, radius: 150, intensity: 1.4, flicker: 'fire', halo: 0.55, cone: 0, litMotes: true },
    lantern: { color: 0xffcc80, radius: 80, intensity: 0.95, flicker: 'fire', halo: 0.5, cone: 0, litMotes: true },
    headlamp: { color: 0xfff0d0, radius: 70, intensity: 0.9, flicker: 'steady', halo: 0.3, cone: 120, litMotes: true },
    floodlight: { color: 0xfff0d0, radius: 220, intensity: 1.2, flicker: 'steady', halo: 0.4, cone: 200, litMotes: true },
    emergency: { color: 0xff3a2a, radius: 90, intensity: 0.8, flicker: 'blink', halo: 0.6, cone: 0, litMotes: false },
    signal: { color: 0x40e0c0, radius: 70, intensity: 0.7, flicker: 'steady', halo: 0.7, cone: 0, litMotes: false },
    tv: { color: 0x6fb2ff, radius: 70, intensity: 0.7, flicker: 'tv', halo: 0.3, cone: 0, litMotes: false },
    growLight: { color: 0xd27aff, radius: 110, intensity: 0.9, flicker: 'steady', halo: 0.35, cone: 90, litMotes: false },
    weld: { color: 0xcfe6ff, radius: 120, intensity: 1.6, flicker: 'weld', halo: 0.5, cone: 0, litMotes: true },
    bioFungus: { color: 0x4affc8, radius: 90, intensity: 0.75, flicker: 'pulse', halo: 0.8, cone: 0, litMotes: true },
    crystal: { color: 0x7af2ff, radius: 120, intensity: 0.85, flicker: 'pulse', halo: 0.7, cone: 0, litMotes: true },
    magma: { color: 0xff3a10, radius: 200, intensity: 1.2, flicker: 'pulse', halo: 0.5, cone: 0, litMotes: true },
    teaseBeyond: { color: 0x6aa8ff, radius: 140, intensity: 0.6, flicker: 'pulse', halo: 0.6, cone: 0, litMotes: true },
  } satisfies Record<string, LightPreset>,
  flicker: {
    steady: { amp: 0, hz: 0, events: 0, eventLen: 0, radiusWobble: 0 },
    fire: { amp: 0.18, hz: 9, events: 0, eventLen: 0, radiusWobble: 0.06 },
    failingTube: { amp: 0.04, hz: 50, events: 0.35, eventLen: 0.12, radiusWobble: 0 },
    pulse: { amp: 0.15, hz: 0.25, events: 0, eventLen: 0, radiusWobble: 0.03 },
    sway: { amp: 0.05, hz: 0.4, events: 0, eventLen: 0, radiusWobble: 0.02 },
    blink: { amp: 1, hz: 0.8, events: 0, eventLen: 0, radiusWobble: 0 },
    tv: { amp: 0.3, hz: 3, events: 0.6, eventLen: 0.2, radiusWobble: 0 },
    weld: { amp: 0.9, hz: 14, events: 0.25, eventLen: 1.4, radiusWobble: 0.1 },
  } satisfies Record<FlickerKind, FlickerTokens>,
  /** Per-tier: which flickers animate. Others draw at their mean intensity. */
  flickerTiers: {
    high: ['fire', 'failingTube', 'pulse', 'sway', 'blink', 'tv', 'weld'],
    medium: ['fire', 'failingTube', 'blink', 'weld', 'pulse'],
    low: ['blink'],
  } as Record<Tier, readonly FlickerKind[]>,
  /**
   * READABILITY FLOORS. The darkness is for the world, never for the work. Values are minimum lightmap values (0..1 of the
   * painted exposure) inside a room's rectangle, drawn as a flat fill under that room's own lamps.
   */
  read: {
    /** Powered room with people working in it: the painting reads at >= 70% of its exposure everywhere. */
    roomWorking: 0.7,
    /** Powered room, nobody in it. */
    roomIdle: 0.55,
    /** Under construction / upgrading (the blueprint ghost must read). */
    roomBuilding: 0.5,
    /** Unpowered (blackout): dim but legible, plus one emergency preset in the room. */
    roomUnpowered: 0.3,
    /** Ruin not yet cleared: shape and label readable, interior murky. */
    ruin: 0.22,
    /** The room the player selected / is placing next to gets this much extra (eases in 0.2 s). */
    selectedLift: 0.15,
    /** Corridor / walkway floor strip in front of any built room (people walk there). */
    walkway: 0.32,
    /** Fill softness: the floor rect fades out over this many world units past the room edge. */
    edgeFeather: 18,
    /** Minimum luminance contrast (WCAG-style ratio) between a badge/plate and what is behind it. */
    badgeContrast: 4.5,
  },
  /** Ambient ramp from the surface down (world y -> added light). Above ground the sky pours in; below ~420 it is all lamps. */
  depthRamp: [
    { y: 0, color: 0xffd2a0, a: 1 },
    { y: 300, color: 0xd09068, a: 0.9 },
    { y: 420, color: 0x4a3a30, a: 0.35 },
    { y: 700, color: 0x1a1a20, a: 0.25 },
    { y: 1500, color: 0x000000, a: 0 },
  ] as readonly { y: number; color: Hex; a: number }[],
  /** Faint cool fill on the rock cut face so the section silhouette always reads (from prototype C). */
  sectionFill: { color: 0x1a1a22, a: 0.6 },
  /** Light cones (additive). */
  cones: { alpha: 0.16, softEdge: 0.35 },
  /** Sky light pouring down the entrance ramp (additive). Day only; scaled by DAY_NIGHT. */
  godRay: { alpha: 0.32, color: 0xffb070, length: 520, width: 140, sway: 0.03 },
  /** Lit dust motes: alpha is lamp light at the mote times this. */
  motes: { alpha: 0.35, size: [1, 2.6] as readonly [number, number], drift: 6, rise: 2 },
  /** Light budget: max pools drawn into the lightmap per frame (nearest to the view centre win; room lamps first). */
  budget: { high: 96, medium: 56, low: 28 } as Record<Tier, number>,
  /** Pools fade in/out over this time when they enter/leave the budget, so nothing pops. */
  budgetFade: 0.4,
} as const;

/** Warm/cool rule (from prototype B): warm = people live here; cool = outside, abandoned, unknown, or a discovery tease. */
export const TEMPERATURE = {
  inhabited: [0xffd8a0, 0xffc27a, 0xffb066, 0xffcc80] as readonly Hex[],
  work: [0xc8f0e0, 0xfff0d0] as readonly Hex[],
  abandoned: [0x6aa8ff, 0x40e0c0, 0x7f95c8] as readonly Hex[],
  danger: [0xff3a2a, 0xff5a1e] as readonly Hex[],
  /** Max share of a stratum's lamps that may be cool while it is inhabited (the rest warm). */
  maxCoolShareInhabited: 0.25,
} as const;

/** Eras scale the civic light of the city (data/eras.ts keeps its grade, gloom and ambient; these ride on top). */
export const ERA_LIGHT = [
  // remnant: a few work lamps and the hatch; most public lamps dead; cold teases everywhere
  { key: 'remnant', ambientMul: 0.8, civicLampsLit: 0.25, stringLights: false, warmShift: -0.1, motesMul: 1.3 },
  // restoration: lamps come back unevenly, one failing tube per corridor
  { key: 'restoration', ambientMul: 0.9, civicLampsLit: 0.6, stringLights: false, warmShift: 0, motesMul: 1.1 },
  // colony: string lights over the hub and streets, market fires
  { key: 'colony', ambientMul: 1.0, civicLampsLit: 0.9, stringLights: true, warmShift: 0.05, motesMul: 1 },
  // undercity: every public lamp lit, signage glows, the far plates fill with window lights
  { key: 'undercity', ambientMul: 1.1, civicLampsLit: 1, stringLights: true, warmShift: 0.08, motesMul: 0.9 },
] as const;

/**
 * Day and night. Only the surface and the first strata see the sky; below, "night" is a civic rhythm (public lamps dim, homes
 * glow warmer). The underground night grade in postfx (structure.nightLight) stays; these are the light-pool side of it.
 */
export const DAY_NIGHT = {
  /** Strata whose ambient follows the sky clock directly. */
  skyStrata: [0, 1] as readonly StratumId[],
  /** God-ray strength by phase. */
  godRay: { day: 1, dusk: 0.6, night: 0 },
  /** Surface key light: day = low sun, night = moon. */
  surfaceKey: { day: 0xffb070, night: 0x7f95c8 },
  surfaceAmbient: { day: 0.85, night: 0.3 },
  /** At night public lamps (street, string, chandelier) run at this fraction; room lamps of quarters warm by `homeWarm`. */
  civicNight: 0.6,
  homeWarm: 0.08,
  /** Window lights on far/back plates: share lit by day / by night. */
  farWindowsLit: { day: 0.45, night: 0.85 },
  /** Fade between phases (s of real time). */
  transition: 6,
} as const;

// =================================================================================================================================
// FOG OF WAR
// =================================================================================================================================

export const FOG = {
  /** World units per fog texel; bilinear upscale gives the soft organic edge. */
  cell: 8,
  states: {
    /** Never seen: near-black with slow mottling. No labels, no pins, lights hidden except teases. */
    undiscovered: { color: 0x030406, alpha: 0.94, noiseAlpha: 0.5, noiseScale: 220, drift: 4 },
    /** Seen but not lit / not built: a "memory" look. Shape and outline read; colour drained; label dim. */
    known: { darken: 0.55, desaturate: 0.7, tint: 0x6a7a90, tintAlpha: 0.18, labelAlpha: 0.55 },
    /** Lit and in use: no fog at all. */
    lit: { darken: 0, desaturate: 0 },
  },
  /** Soft breathing halo around the undiscovered edge. */
  edge: { softCells: 2.5, breathAlpha: 0.25, breathSpeed: 0.6, warmRim: 0xbf6b2e, warmRimAlpha: 0.06 },
  /** Reveal by tap, by digging or by a story event. */
  reveal: { radius: 190, time: 0.9, ease: 'outCubic' as const, digRadius: 120, storyRadius: 320 },
  /** A tease light shows through undiscovered fog at this fraction of its strength. */
  teaseAlpha: 0.3,
  /** Partly revealed start for a dark edge (e.g. the blocked tunnel): fraction already open. */
  hintStart: 0.3,
  /** Persistence: one bit per cell, packed per district. */
  persist: { bitsPerCell: 1, maxBytesPerDistrict: 2048 },
} as const;

// =================================================================================================================================
// CAMERA (defaults; the camera agent tunes. Current controller values kept where they exist.)
// [world:C1 camera-nav] Read by CameraController in city mode only: zoom.min/max, pan.friction/edgeSpring/maxFling*, springs, follow, city.
// homeDesktop / homePhone are superseded in the city by the framing rules in `city` (fit the slice / hub + 4 slots); kept for reference.
// =================================================================================================================================

export const CAMERA = {
  zoom: {
    min: 0.32,
    max: 3,
    /** Below this the city map LOD takes over (CameraController.FAR_ZOOM). */
    far: 0.42,
    farHysteresis: 1.07,
    /** Above this name tags and fine signs appear. */
    close: 1.2,
    closeHysteresis: 1.1,
    /** Start / home zoom: desktop shows a whole district and its neighbours; phones a district at readable people size. */
    homeDesktop: 0.8,
    homePhone: 0.62,
    /** Rubber-band softness beyond min/max (log factor). */
    overshoot: 0.3,
  },
  pan: {
    friction: 4.2,
    maxFlingDesktop: 4200,
    maxFlingPhone: 2600,
    edgeSpring: 13,
    /** How far past the world rectangle the camera may look (world units). */
    margin: 140,
    dragThreshold: 6,
    doubleTapMs: 320,
  },
  wheel: { step: 0.0016, pinchGain: 1 },
  springs: { focus: 7.5, zoom: 14 },
  follow: {
    /** Following a survivor / a moving event: critically damped spring rate (1/s). */
    spring: 5,
    /** Look ahead along the walker's velocity (seconds). */
    lookAhead: 0.25,
    /** Re-centre only when the target leaves this central fraction of the screen. */
    deadZone: 0.2,
    /** A user drag cancels follow; follow resumes only on an explicit tap. */
    cancelOnDrag: true,
  },
  /** Framing a district / room on focus: padding as a fraction of the screen. */
  framing: { district: 0.08, room: 0.12, maxRoomZoom: 2.2 },
  /** Parallax never moves a foreground object more than this many screen px from its play-plane position at home zoom. */
  foreMaxShift: 120,
  shake: { px: 16, decay: 6 },
  /** Phone: people must be at least this many CSS px tall at the home zoom (adult 48 u x zoom). */
  minPersonPx: 30,
  /**
   * [world:C1 camera-nav] City mode framing and limits (CameraController with `?city`; classic ignores this block).
   *  - phoneSlots: the phone home view is spine-centred and shows the hub with its two vestibules plus this many slots across;
   *  - phoneMaxZoom: cap of that home zoom on wide phones (people get large past it);
   *  - desktopPad: the desktop home view fits the whole dug city (strips, edges, districts) with this fraction of the screen as margin;
   *  - desktopMaxZoom: cap of that fit (a 1-floor city on a big monitor);
   *  - topY: the world y the home view's top may show (the surface strip above the hub; classic VIEW_TOP);
   *  - personH: an adult's height in world units (for minPersonPx);
   *  - glide: spring rate (1/s) of glideTo, the gentle move for later follow / story moves (focus spring is 7.5);
   *  - calmFocusSpring: reduced motion: focus moves settle faster (no long drifting glide);
   *  - calmFling: reduced motion: release velocity is dropped (no coasting), the rubber band still springs back without overshoot.
   */
  city: {
    phoneSlots: 4,
    phoneMaxZoom: 1.25,
    desktopPad: 0.04,
    desktopMaxZoom: 1.6,
    topY: -140,
    personH: 48,
    glide: 4,
    calmFocusSpring: 12,
    calmFling: false,
  },
} as const;

// =================================================================================================================================
// DETAIL per quality tier
// =================================================================================================================================

export interface DetailTier {
  /** Global density multiplier for procedural scatter (rubble, stalactites, pebbles, cables). */
  density: number;
  layers: readonly LayerId[];
  /** Fore layer drawn only above this zoom (High); Infinity = never. */
  foreMinZoom: number;
  farStructures: number;
  backStructures: number;
  farWindowLights: number;
  backWindows: number;
  rubble: number;
  stalactites: number;
  foreItems: number;
  stringBulbsPerRun: number;
  /** Lit dust motes on screen at most. */
  motes: number;
  sparks: number;
  /** Max additive glow sprites alive. */
  glows: number;
  /** Max light pools in the lightmap (same as LIGHT.budget). */
  lights: number;
  /** Fog breathing halo and mottling animate. */
  fogAnimated: boolean;
  /** Moving far/back life (train, lifts, distant walkers). */
  backLife: boolean;
  /** God-ray and cones. */
  cones: boolean;
  /** Animate decorative motion (cable sway, laundry, chandelier sway). */
  sway: boolean;
  /** Survivor rim light. */
  rim: boolean;
  /** Rock cut-face bake resolution relative to world units. */
  rockRes: number;
}

export const DETAIL: Record<Tier, DetailTier> = {
  high: {
    density: 1, layers: ['sky', 'far', 'back', 'mid', 'play', 'fore'], foreMinZoom: 0.85,
    farStructures: 26, backStructures: 34, farWindowLights: 140, backWindows: 120, rubble: 70, stalactites: 40, foreItems: 26,
    stringBulbsPerRun: 14, motes: 140, sparks: 26, glows: 300, lights: 96,
    fogAnimated: true, backLife: true, cones: true, sway: true, rim: true, rockRes: 0.6,
  },
  medium: {
    density: 0.6, layers: ['sky', 'far', 'back', 'mid', 'play'], foreMinZoom: Infinity,
    farStructures: 16, backStructures: 20, farWindowLights: 80, backWindows: 70, rubble: 42, stalactites: 24, foreItems: 0,
    stringBulbsPerRun: 10, motes: 70, sparks: 14, glows: 160, lights: 56,
    fogAnimated: true, backLife: true, cones: true, sway: true, rim: true, rockRes: 0.45,
  },
  low: {
    density: 0.35, layers: ['sky', 'back', 'play'], foreMinZoom: Infinity,
    farStructures: 0, backStructures: 14, farWindowLights: 0, backWindows: 40, rubble: 24, stalactites: 12, foreItems: 0,
    stringBulbsPerRun: 6, motes: 0, sparks: 6, glows: 60, lights: 28,
    fogAnimated: false, backLife: false, cones: false, sway: false, rim: false, rockRes: 0.3,
  },
};

// =================================================================================================================================
// UNIFY: painted rooms + procedural structure must read as one hand
// =================================================================================================================================

export const UNIFY = {
  /** One outline weight for every made object edge that meets darkness (world units) and its colour. */
  outline: { width: 1.5, color: 0x0a0806, alpha: 0.85 },
  /** Painted room frame: alcove lip + inner ambient occlusion. */
  roomFrame: { lip: 4, lipColor: 0x2a2420, aoWidth: 10, aoAlpha: 0.45, topAoBoost: 1.4 },
  /** Cut-away section edge (from prototype B): a light rim on the cut, a dark AO band just inside. */
  cutEdge: { rimWidth: 2, rimAlpha: 0.35, aoWidth: 14, aoAlpha: 0.42 },
  /** Contact shadow under everything that stands on a floor (people, props, carts). */
  contactShadow: { color: 0x000000, alpha: 0.4, widthMul: 1.1, height: 5, blur: 3 },
  /** Every procedural flat fill gets a vertical gradient (top lighter) and the shared grain, so vector reads painterly. */
  fill: { gradientTop: 1.08, gradientBottom: 0.9, grainAlpha: 0.12, grainScale: 1.5, grainMode: 'multiply' as const },
  /** Procedural colours are pulled toward the painting palette: saturation cap and a warm-grey bias. */
  material: { maxSaturation: 0.45, greyBias: 0x6a6258, greyBiasAmount: 0.15 },
  /** Painted rooms get the same lightmap as structure, but never below LIGHT.read; their baked lamps add these pools. */
  paintedRoomsUseLightmap: true,
  /** Thin vector parts (railings, treads, cables) use at most this many values + the outline. */
  vectorMaxValues: 2,
  /** Prefer painted kit tiles (public/art/kit) for slabs, columns, walls, pipes; vector only below this thickness (world units). */
  vectorMaxThickness: 6,
} as const;

// =================================================================================================================================
// PEOPLE readability
// =================================================================================================================================

export const PEOPLE = {
  adultHeight: 48,
  childScale: 0.74,
  /** Minimum light on a survivor (multiply floor), so nobody drowns in a dark corridor. */
  minLight: 0.28,
  /** Rim light: an additive copy offset toward the strongest nearby pool, tinted by it. */
  rim: { alpha: 0.35, offset: 1, minPoolIntensity: 0.2, darkAlpha: 0.5 },
  /** In a pool darker than this, the survivor's own self-light lifts (prototype C "figureLift"). */
  darkThreshold: 0.2,
  /** One saturated accent per job outfit; the rest of the outfit stays muted. */
  accentSaturation: 0.65,
  /** Below this zoom people become single lit dots in the city map (no sprites). */
  dotZoom: 0.42,
  dot: { radius: 2.2, color: 0xffd8a0 },
  /** Share of walkers in dark strata (4..6) who carry a lantern (a real moving pool). */
  lanternShareDeep: 0.35,
  lanternShareUpper: 0.08,
  /** Headlamps instead of lanterns in the mines. */
  headlampStrata: [4] as readonly StratumId[],
} as const;

// =================================================================================================================================
// SIGNS (in-world text)
// =================================================================================================================================

export const SIGNS = {
  /** Never set letterSpacing on Pixi Text that holds Hebrew: Pixi then draws glyph by glyph and reverses the word. */
  letterSpacing: 0,
  /** Never build words out of per-glyph sprites. Numbers inside Hebrew go in a separate Text object. */
  splitNumbers: true,
  /** Minimum on-screen size of any in-world text at the home zoom (CSS px). Below it, hide the text, keep the plate. */
  minPx: 11,
  maxWords: 3,
  fonts: { plate: 'Rubik', stencil: 'Karantina' },
  /** Plate: dark enamel with a lighter rim, the text in warm off-white. Lit by the lightmap like everything else, with a floor. */
  plate: { fill: 0x1c1a17, rim: 0x8f8a80, text: 0xeadfc6, minLight: 0.6, padding: 6, radius: 2 },
  /** Stratum signage paint: the plate text colour of a stratum's own signs (wayfinding colour per stratum). */
  stratumInk: [0xeadfc6, 0xeadfc6, 0xd8f0e0, 0xf2ead6, 0xf0d8a8, 0xbffff0, 0xffd0a0] as readonly Hex[],
  /** Labels and badges always draw above fog and lightmap (screen-space layer). */
  aboveFog: true,
} as const;

// =================================================================================================================================
// LIFE: the city's people off duty (src/world/life/*, walkers.ts). Presentation only: who works where never changes.
// =================================================================================================================================

/** Kinds of places off-duty people loiter at in the hubs and corridors (src/world/life/idleSpots.ts). */
export type IdleSpotKind = 'rail' | 'barrel' | 'bench' | 'plaza' | 'corridor';

export const LIFE = {
  idle: {
    /** Most people loitering at once, per render tier (each is one walker slot that stays out). */
    max: { high: 16, medium: 10, low: 5, lite: 0 } as Record<'high' | 'medium' | 'low' | 'lite', number>,
    /** One loiter cycle (s, varied ±20% per person); a person is out for `outShare` of it at a phase of their own. */
    cycle: 130,
    outShare: 0.5,
    /** Once at the spot, nobody is called back by the schedule before this many seconds (a job, the night or a meal still call at once). */
    minHold: 20,
    /** Spots nearer the person's room weigh more: weight / (1 + dx / near + floors apart). */
    near: 170,
    /** Below this zoom nobody walks out (the far map shows dots); the ones out stay where they are. */
    minZoom: 0.42,
    /** Decisions (who goes out, who comes back) run this often per second; positions update every frame. */
    passHz: 2,
    /** At most this many walks out are planned in one pass (route planning is the costly part; the rest wait for the next pass). */
    startsPerPass: 3,
    /** After a walk could not be planned (a shut door, a trip too long), the person stays in for this long (s). */
    retry: 25,
    /** A spot is only offered to people whose room is at most this many floors away (keeps the walks short). */
    maxFloors: 3,
    /**
     * Workers' short breaks (presentation only: production runs on, the room keeps its crew in the simulation). A worker steps out for
     * `breakShare` of their own `breakCycle` (±20%), to a spot within `breakFloors`; never the last one in the room, one per room at a time.
     */
    breakCycle: 260,
    breakShare: 0.18,
    breakFloors: 1,
    breakMinCrew: 2,
    /** How much each kind of place draws people (relative). */
    weights: { rail: 3, barrel: 4, bench: 2, plaza: 3, corridor: 1 } as Record<IdleSpotKind, number>, // [world:C2] corridor 2 -> 1: the hub is where people gather
    /** Spacing of standing places along a balcony rail / the bridge, and how far in from the ends. */
    railStep: 20,
    railInset: 7,
    /** Offsets of the places around the fire barrel (x from the barrel; facing toward it). */
    barrelRing: [-17, -31, 13] as readonly number[],
    /** Offsets on the bench (x from its left end). */
    benchSeats: [9, 27] as readonly number[],
    /** Plaza pair beside the spine (x from the spine's edges). */
    plazaGap: 8,
    /** Corridor places: per vestibule, and per floor strip (from the strip's hub end, every `stripStep`, at most `stripMax`). */
    vestInset: 6,
    /**
     * [world:C2] No place within this many units of an edge tunnel (a blocked or dug wing end, `c:edge:*`): nobody idles at the mouth of
     * a sealed tunnel (with no wing on a side, the vestibule's outer end is that mouth).
     */
    edgeClear: 24,
    stripFirst: 46,
    stripStep: 130,
    stripMax: 3,
  },
  /** Carried light (style guide 7): lanterns and headlamps are real moving pools; the share per stratum is PEOPLE.lantern*. */
  lantern: {
    /** Most carried lights at once, per tier (the people over the cap carry nothing). */
    max: { high: 8, medium: 5, low: 2, lite: 0 } as Record<'high' | 'medium' | 'low' | 'lite', number>,
    /** Where the lantern hangs (from the feet, facing side) and where the headlamp sits (from the top of the head). */
    hand: { x: 7, y: -19 },
    head: { x: 3, y: 7 },
    /** Strata counted as deep for PEOPLE.lanternShareDeep. */
    deepFrom: 4,
    /** The carried prop drawn on the person (people.ts setCarry): hook wire, iron body, lit glass, base; the headlamp's band and lens. */
    prop: { wire: 0x2a2420 as Hex, body: 0x3a3028 as Hex, glass: 0xffe2a0 as Hex, headBand: 0x2a2420 as Hex, headLens: 0xfff4d8 as Hex },
  },
  /** Self-light (style guide 7): somebody standing in a pool darker than `below` (lightAt, pools only) gets a faint light of their own. */
  selfLight: {
    max: { high: 8, medium: 5, low: 3, lite: 0 } as Record<'high' | 'medium' | 'low' | 'lite', number>,
    below: 0.3,
    radius: 34,
    intensity: 0.34,
    color: 0xffe2c0,
    /** Kept at least this long once lit (s), so it never flickers on and off at a pool's edge. */
    hold: 3,
    /** The light sits this far above the feet (world units: about the chest of a 48 u adult). */
    dy: 22,
  },
  /** Rim (style guide 7): an additive copy of the body, offset toward the brighter side and tinted by the stratum's key light. */
  rim: {
    /** Sample offsets for the brighter-side test (world units from the feet), and every how many frames a person is re-sampled. */
    sampleDx: 10,
    sampleY: -26,
    every: 3,
  },
  /** One saturated accent per job outfit (style guide 7): the shirt (or the hat under a coat) pulled to this HSL saturation, the rest muted. */
  accent: { saturation: 0.65, lightness: [0.34, 0.58] as readonly [number, number], mute: 0.55 },
  /** The dig crew (architecture 4.2): at the dig face (floor dig) or at the edge's rubble (wing dig). */
  dig: {
    /** Most diggers shown working at one face; the others carry rubble back toward the ladder. */
    atFace: 3,
    /** Spacing between diggers, and their stand-off from the rubble wall / the edge choke. */
    step: 19,
    standOff: 7,
    /** The ladder down from the plaza into the pit (x from the pit's west end). */
    ladderX: 16,
    /** A digger with a headlamp at the face (on top of the work lamp), on tiers that have lights. */
    headlamp: true,
  },
} as const;

// =================================================================================================================================
// AUDIO: ambience per stratum (the audio agent wires these into AudioEngine / ambience beds)
// =================================================================================================================================

export type AmbienceLayer = 'wind' | 'hum' | 'crowd' | 'vent' | 'drip' | 'machine' | 'rumble' | 'water' | 'resonance' | 'fire' | 'train';

export interface StratumAudio {
  /** Master gain of the stratum ambience bed (0..1) before the global ambience volume. */
  master: number;
  /** Gain per synthesized layer (0..1). `crowd` is further scaled by the population in view. */
  layers: Partial<Record<AmbienceLayer, number>>;
  /** Reverb send (0..1): small rooms dry, caverns and tunnels wet. */
  reverb: number;
  /** Low-pass cutoff (Hz) on the bed: deeper = darker. */
  lowpass: number;
}

export const AUDIO = {
  strata: [
    { master: 0.55, layers: { wind: 0.8, fire: 0.2, machine: 0.05 }, reverb: 0.05, lowpass: 12000 },
    { master: 0.5, layers: { hum: 0.5, crowd: 0.6, vent: 0.3, drip: 0.1 }, reverb: 0.25, lowpass: 9000 },
    { master: 0.5, layers: { vent: 0.7, hum: 0.6, machine: 0.35, drip: 0.25 }, reverb: 0.3, lowpass: 8000 },
    { master: 0.5, layers: { wind: 0.35, train: 0.25, crowd: 0.45, drip: 0.15, resonance: 0.15 }, reverb: 0.55, lowpass: 7000 },
    { master: 0.5, layers: { machine: 0.45, rumble: 0.35, drip: 0.3, fire: 0.1 }, reverb: 0.4, lowpass: 5500 },
    { master: 0.45, layers: { drip: 0.55, water: 0.4, resonance: 0.5, wind: 0.1 }, reverb: 0.75, lowpass: 4500 },
    { master: 0.5, layers: { rumble: 0.7, fire: 0.3, machine: 0.4, vent: 0.25 }, reverb: 0.45, lowpass: 3500 },
  ] as readonly StratumAudio[],
  /** Crossfade between strata as the camera centre moves (s). */
  crossfade: 1.5,
  /** At map zoom (< CAMERA.zoom.far) the strata beds duck and the existing 'city' bed takes over. */
  mapDuck: 0.35,
  /** Undiscovered fog in view lowers crowd and raises resonance (the unknown is quiet). */
  fogQuiet: { crowd: 0.4, resonance: 1.3 },
  /** Era beds (audio/bedKeys.ts ERA_BEDS) stay underneath at this share. */
  eraBedShare: 0.5,
  /**
   * [world:C2] A city bed (or the crowd loop) that has been silent this long (s of audio time) is stopped and its buffer released (each
   * is ~4 MB of PCM); it is rendered again the next time the camera wants it.
   */
  bedReleaseAfter: 30,
  /** Below this gain a bed counts as silent (and is not rendered when first wanted). */
  bedSilent: 0.02,
} as const;

// =================================================================================================================================
// VERTICAL SLICE (the first build of the new world: surface entrance -> hub -> corridor -> living district -> dark edge)
// =================================================================================================================================

export interface SliceBeat {
  id: 'entrance' | 'ramp' | 'hub' | 'corridor' | 'district' | 'edge';
  name: Bilingual;
  stratum: StratumId;
  /** Ambient zone fill drawn into the lightmap under the beat's lamps. */
  zoneAmbient: Hex;
  /** Lights by preset name and count (positions are the slice builder's). */
  lights: readonly { preset: keyof typeof LIGHT.presets; count: number }[];
  /** Fog state at a new game. */
  fogStart: 'lit' | 'known' | 'hint' | 'undiscovered';
}

export const SLICE: readonly SliceBeat[] = [
  {
    id: 'entrance', name: { he: 'פתח הכניסה', en: 'The Hatch' }, stratum: 0, zoneAmbient: 0x6a5446,
    lights: [{ preset: 'fireBarrel', count: 1 }, { preset: 'emergency', count: 1 }], fogStart: 'lit',
  },
  {
    id: 'ramp', name: { he: 'הרמפה', en: 'The Ramp' }, stratum: 1, zoneAmbient: 0x3a2e26,
    lights: [{ preset: 'cageLamp', count: 2 }, { preset: 'emergency', count: 1 }], fogStart: 'lit',
  },
  {
    id: 'hub', name: { he: 'כיכר הפעמון', en: 'Bell Square' }, stratum: 1, zoneAmbient: 0x2a221c,
    lights: [{ preset: 'chandelier', count: 1 }, { preset: 'wallLamp', count: 6 }, { preset: 'stringBulb', count: 24 }, { preset: 'fireBarrel', count: 1 }],
    fogStart: 'lit',
  },
  {
    id: 'corridor', name: { he: 'מסדרון השירות', en: 'Service Corridor' }, stratum: 1, zoneAmbient: 0x1e2a26,
    lights: [{ preset: 'fluoroTube', count: 2 }, { preset: 'failingTube', count: 1 }], fogStart: 'lit',
  },
  {
    id: 'district', name: { he: 'רובע הכורים', en: "Miners' Quarter" }, stratum: 1, zoneAmbient: 0x3c3026,
    lights: [{ preset: 'roomLamp', count: 10 }, { preset: 'streetLamp', count: 1 }, { preset: 'fireBarrel', count: 1 }, { preset: 'stringBulb', count: 16 }, { preset: 'lantern', count: 2 }],
    fogStart: 'known',
  },
  {
    id: 'edge', name: { he: 'המנהרה החסומה', en: 'The Blocked Tunnel' }, stratum: 1, zoneAmbient: 0x0c1018,
    lights: [{ preset: 'lantern', count: 1 }, { preset: 'teaseBeyond', count: 1 }], fogStart: 'hint',
  },
];

// =================================================================================================================================
// Helpers (pure)
// =================================================================================================================================

/** Pool falloff 0..1 at distance d from a light of radius r (LIGHT.falloff). */
export function poolFalloff(d: number, r: number): number {
  const core = LIGHT.falloff.core * r;
  if (d <= core) return 1;
  if (d >= r) return 0;
  const x = (d - core) / (r - core);
  return Math.pow(1 - x, LIGHT.falloff.exp);
}

/** Layer scale for a zoom (LAYERS[i].p and zoomCoupling). */
export function layerScale(layer: LayerTokens, zoom: number): number {
  return Math.pow(zoom, layer.p * layer.zoomCoupling);
}

/** Effective ambient level of a stratum in an era (0..3). */
export function ambientLevel(stratum: StratumTokens, era: number): number {
  const e = ERA_LIGHT[Math.max(0, Math.min(ERA_LIGHT.length - 1, era))];
  return stratum.light.ambientLevel * e.ambientMul;
}

/** Minimum lightmap value for a room in a given state (LIGHT.read). */
export function roomFloorLight(state: 'working' | 'idle' | 'building' | 'unpowered' | 'ruin', selected = false): number {
  const r = LIGHT.read;
  const base = state === 'working' ? r.roomWorking : state === 'idle' ? r.roomIdle : state === 'building' ? r.roomBuilding : state === 'unpowered' ? r.roomUnpowered : r.ruin;
  return Math.min(1, base + (selected ? r.selectedLift : 0));
}

// =================================================================================================================================
// CITY (level-builder, phase C0): the projection frames and the hub atrium geometry
// =================================================================================================================================

/**
 * One stratum's horizontal frame (world units). The shaft (the logical spine) always stands at x 0..58. The hub atrium spans
 * hubL..hubR around it; the east rooms start a vestibule (vestE) past hubR, the west rooms end a vestibule (vestW) before hubL; a
 * district opens `tunnel` past the end of its floor. `slotX(f, s) = s >= 0 ? hubR + vestE + s * SLOT_W : hubL - vestW + s * SLOT_W`.
 */
export interface CityFrameTokens {
  readonly hubL: number;
  readonly hubR: number;
  readonly vestW: number;
  readonly vestE: number;
  readonly tunnel: number;
}

/** The classic tower: no hub beyond the shaft, a 6-unit gap each side (geom.ts SHAFT_GAP), an 18-unit district tunnel. */
const CLASSIC_FRAME: CityFrameTokens = { hubL: 0, hubR: 58, vestW: 6, vestE: 6, tunnel: 18 };
/**
 * Every underground stratum through C and M1 (architecture D5: one shared frame; distinct frames arrive with the nav graph in M2).
 * The atrium is 186 wide: the 58 shaft plus 64 each side, room for a stair column (CITY.hub.stairW) and a balcony landing.
 */
const UNDER_FRAME: CityFrameTokens = { hubL: -64, hubR: 122, vestW: 36, vestE: 36, tunnel: 18 };

export const CITY = {
  /** Indexed by stratum id. Stratum 0 (the surface row) always keeps the classic frame. */
  frames: [CLASSIC_FRAME, UNDER_FRAME, UNDER_FRAME, UNDER_FRAME, UNDER_FRAME, UNDER_FRAME, UNDER_FRAME] as readonly CityFrameTokens[],
  classic: CLASSIC_FRAME,
  hub: {
    /** Thickness of the atrium's side walls, drawn inside hubL / hubR. */
    wallW: 10,
    /** Width of the stair-flight column on each side of the spine, and its gap from the wall. */
    stairW: 44,
    stairInset: 8,
    /** Balconies sit on the corridor lane (routes laneY): their deck depth and railing height. */
    balconyDepth: 14,
    balconyRail: 14,
    /** The atrium vault rises this far above the ceiling of the stratum's top floor (it eats into the gallery/rock above). */
    vaultRise: 56,
    /** The floor (0-based within the stratum) that carries a bridge across the spine in front of the lift; -1 = none. */
    bridgeFloor: 1,
    bridgeH: 8,
    /** Vestibule ceiling light pitch (fluorescent tubes) along a vestibule. */
    vestLampEvery: 24,
    /** [world:C1] The big arched observation window in the vault wall behind the spine (half width; 0 = none) and its frame. */
    windowHalfW: 70,
    windowMullion: 3,
    /** [world:C1] The plaza floor slab under the hub's bottom storey (thicker than a balcony deck). */
    plazaSlab: 18,
    /** [world:C2] The hub-vault tile is drawn one storey tall: one vaultTileW bay scaled to this pitch, so a bay's arch sits behind the lift on every storey. */
    vaultPitch: 144,
    vaultTileW: 192,
    /** [world:C2] Drawn balcony / walkway deck strip height and the railing tile above it (art kit scale, not the walkable depth). */
    deckH: 32,
    railH: 24,
  },
  /**
   * [world:C1] The cut of the city into the rock (src/world/model/cityLayout.ts): how ragged each cavity is and how far the dark edges, dig
   * faces, districts and pockets reach. World units.
   */
  layout: {
    /** Floor strips: the cut sits at least `stripHead` above the rooms' ceilings and is pushed out by up to `stripRag` (noise wavelength `stripWave`). */
    stripHead: 6,
    stripRag: 10,
    stripWave: 34,
    /** The blocked tunnel stub past the end of a floor (an edge site): its length, ceiling (below floorTop at the mouth), arch and raggedness. */
    edgeLen: 132,
    edgeTop: 24,
    edgeRag: 8,
    /** Where the rubble choke of an edge stands, as a share of edgeLen from the mouth. */
    edgeChoke: 0.62,
    /** The dig face under the bottom storey: from the hub's west wall to this many slots past the east vestibule. */
    digSlots: 3,
    digRag: 9,
    /** District caverns around the painted district room: side pad, rise above the room, ledge below; how lumpy. */
    cavernPad: 52,
    cavernRise: 78,
    cavernLumps: 0.16,
    /** Pockets: how lumpy their blob is. */
    pocketLumps: 0.24,
    /** [world:C2] The rock ledge under a district room reaches this far past the room on each side. */
    cavernSlabPad: 40,
    /** [world:C2] Depth of the packed-dirt floor drawn under an edge tunnel's lane. */
    edgeFloorDepth: 30,
    /** How many strata below the deepest reached one get (hidden) storey areas, so the fog keeps the next stratum dark. */
    strataAhead: 1,
    /** Layout bounds margin: sideways, above ground (the sky) and below the deepest area. */
    boundsPad: { x: 420, top: 700, bottom: 520 },
  },
} as const;

/**
 * [world:C2] Dressing colours of the city shell (src/world/render/shell/*): the made things it draws in vector outside the stratum
 * palettes (tools, plates, plaza props, pipes, the cold that leaks through a sealed end). Painted colour before the lightmap.
 */
export const PROPS = {
  tools: {
    /** Wooden hafts (pick, shovel). */
    haft: 0x7a5636 as Hex,
    pickHead: 0x6a6e72 as Hex,
    shovelBlade: 0x5e6266 as Hex,
    /** Timber posts (tape stands, plate posts). */
    post: 0x6b4c2e as Hex,
  },
  /** Crack lines in rock (a near-black stroke under the lit seam). */
  crack: { color: 0x0a0806 as Hex, alpha: 0.85, width: 2.2 },
  /** The cold that shows through a sealed end (a missing block, lit cracks), and in a pocket whose stratum tease is pocketRedTease. */
  coldLeak: 0x6aa8ff as Hex,
  /** A pocket in a stratum whose tease is this red (danger) shows the cold leak instead. */
  pocketRedTease: 0xff3a2a as Hex,
  edges: {
    /** The red bar on a "sealed by order" plate. */
    sealBar: 0xb03a2a as Hex,
    plateRod: 0x4a4440 as Hex,
    /** Water drips down a cracked face or a collapse. */
    drip: 0x9ab0c0 as Hex,
    /** The chalked arrow of a marked dig site. */
    chalk: 0xe8e0c8 as Hex,
    chalkAlpha: 0.6,
    chalkWidth: 2.4,
  },
  hub: {
    /** The dark of a doorway into a vestibule. */
    doorway: 0x050405 as Hex,
    doorwayAlpha: 0.92,
    noticeBoard: 0x4a3a28 as Hex,
    notePaper: 0xb8a888 as Hex,
    notePin: 0xa03a2a as Hex,
    benchSeat: 0x6b4c2e as Hex,
    benchLeg: 0x3a3430 as Hex,
    crate: 0x7a5a36 as Hex,
    crateStrap: 0x3a2a1a as Hex,
    crateSmall: 0x6a4e30 as Hex,
    waterDrum: 0x2f5a5a as Hex,
    fireBarrel: 0x5a3a26 as Hex,
    flame: 0xffa040 as Hex,
    flameCore: 0xffe0a0 as Hex,
    stringWire: 0x1a1612 as Hex,
  },
  cavern: {
    streetLampHood: 0x2a2622 as Hex,
    streetLampBulb: 0xffe0a8 as Hex,
    /** The lake district's own signal colour through its choked mouth. */
    lakeTease: 0x40c8e0 as Hex,
  },
  vestibule: {
    /** The insulated pipe run, the valve stem and the red valve wheel. */
    pipe: 0x8a7a5e as Hex,
    valveStem: 0x5a4a3a as Hex,
    valveWheel: 0x8a3a2a as Hex,
  },
  rock: {
    /**
     * The rock face is the darkest made surface after the fore silhouettes: its painted tile is pulled down this much (the lightmap's
     * section fill and the stratum ambient light it back up), so the lit city reads as islands in dark earth.
     */
    tint: 0x9a948e as Hex,
    /** Recessed rock at the back of a tunnel or pit: the same tile in shadow. */
    recessTint: 0x5a5450 as Hex,
  },
} as const;
